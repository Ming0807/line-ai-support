import {createHmac,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {decryptValue,encryptValue,hashLineUserId} from '../security/identity';
import {userEventSchema} from '../line/events';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,chatMediaRefSchema,normalizeChatMediaName,type ChatMediaRef} from './media-binary';
import type {ChatAttachment} from '../../types/inbox';

const sourceSchema=z.strictObject({lineMessageId:z.string().min(1).max(256),fileName:z.string().min(1).max(360),declaredBytes:z.number().safe().int().nonnegative().optional()});
export type ChatMediaSource=z.infer<typeof sourceSchema>;
export interface ChatMediaClaim {id:string;messageId:string;sourceEventId:string;leaseToken:string;kind:'IMAGE'|'FILE';source:ChatMediaSource}
export interface ChatMediaRow {id:string;message_id:string;source_event_id:string;kind:'IMAGE'|'FILE';source_encrypted:string;
 status:'PENDING'|'PROCESSING'|'READY'|'FAILED';attempts:number;lease_token:string|null;lease_until:Date|null;
 object_id:string|null;mime_type:ChatMediaRef['mimeType']|null;byte_length:number|null;checksum:string|null;error_code:string|null;revoked_at:Date|null}
type Client=Pick<PoolClient,'query'>;

/** Re-derive ownership from the signed source and current message/session, never a URL/body claim. */
function lineMessageDigest(id:string,key:string):string{return createHmac('sha256',Buffer.from(key,'base64')).update('yru:chat-media-unsend:v1\0').update(id).digest('hex');}
async function sourceFor(c:Client,messageId:string,sourceEventId:string,key:string):Promise<{kind:'IMAGE'|'FILE';source:ChatMediaSource;error:string|null;revokedAt:Date|null}> {
 const row=(await c.query(`select m.message_type,m.line_message_id,m.sender_type,i.channel,i.user_hash,i.payload_encrypted,
  identity.user_hash expected_hash from public.messages m join public.conversations conv on conv.id=m.conversation_id
  join private.line_identities identity on identity.line_session_id=conv.line_session_id
  join private.webhook_inbox i on i.id=m.source_event_id where m.id=$1 and m.source_event_id=$2`,[messageId,sourceEventId])).rows[0];
 if(!row||row.sender_type!=='USER'||row.channel!=='STUDENT'||!['IMAGE','FILE'].includes(row.message_type))throw new ChatMediaError('SOURCE_CHANGED');
 let raw:unknown;try{raw=JSON.parse(decryptValue(row.payload_encrypted,key));}catch{throw new ChatMediaError('SOURCE_CHANGED');}
 const event=userEventSchema.safeParse(raw);
 if(!event.success||event.data.type!=='message'||!['image','file'].includes(event.data.message.type)||
  event.data.message.id!==row.line_message_id||event.data.message.type.toUpperCase()!==row.message_type||
  hashLineUserId(event.data.source.userId,key)!==row.user_hash||row.user_hash!==row.expected_hash)throw new ChatMediaError('SOURCE_CHANGED');
 const message=(raw as {message:Record<string,unknown>}).message,kind=row.message_type as 'IMAGE'|'FILE';
 let error:string|null=null;const size=message.fileSize;
 if(size!==undefined&&(!Number.isSafeInteger(size)||typeof size!=='number'||size<0))error='INVALID_ATTACHMENT';
 if(typeof size==='number'&&size>CHAT_MEDIA_MAX_BYTES)error='TOO_LARGE';
 const provider=message.contentProvider;
 if(provider!==undefined&&(provider===null||typeof provider!=='object'||!('type'in provider)||provider.type!=='line'))error='UNSUPPORTED_TYPE';
 const revoked=(await c.query('select revoked_at from private.chat_media_revocations where user_hash=$1 and line_message_hash=$2',
  [row.user_hash,lineMessageDigest(row.line_message_id,key)])).rows[0];
 return {kind,revokedAt:revoked?.revoked_at??null,source:{lineMessageId:row.line_message_id,fileName:normalizeChatMediaName(message.fileName,kind),
  ...(typeof size==='number'&&Number.isSafeInteger(size)&&size>=0?{declaredBytes:size}:{})},error};
}
export async function registerStudentChatAttachment(c:Client,input:{messageId:string;sourceEventId:string},key:string):Promise<void> {
 if(!z.uuid().safeParse(input.messageId).success||!z.uuid().safeParse(input.sourceEventId).success)throw new ChatMediaError('INVALID_ATTACHMENT');
 const live=await sourceFor(c,input.messageId,input.sourceEventId,key);
 const old=(await c.query<ChatMediaRow>('select * from private.chat_attachments where message_id=$1',[input.messageId])).rows[0];
 if(old){
  if(old.source_event_id!==input.sourceEventId||old.kind!==live.kind||decryptValue(old.source_encrypted,key)!==JSON.stringify(live.source))throw new ChatMediaError('SOURCE_CHANGED');
  return;
 }
 await c.query(`insert into private.chat_attachments(message_id,source_event_id,kind,source_encrypted,status,error_code,revoked_at)
  values($1,$2,$3,$4,$5,$6,$7) on conflict(message_id) do nothing`,[input.messageId,input.sourceEventId,live.kind,
  encryptValue(JSON.stringify(live.source),key),live.error||live.revokedAt?'FAILED':'PENDING',live.revokedAt?'SOURCE_CHANGED':live.error,live.revokedAt]);
}
/** A verified unsend never creates a Student session; hashes also fence out-of-order originals. */
export async function revokeStudentChatAttachment(c:Client,input:{userHash:string;lineMessageId:string;eventId:string},key:string):Promise<void> {
 const source=(await c.query("select channel,user_hash,payload_encrypted from private.webhook_inbox where id=$1",[input.eventId])).rows[0];
 let event;try{event=userEventSchema.safeParse(JSON.parse(decryptValue(source?.payload_encrypted,key)));}catch{throw new ChatMediaError('SOURCE_CHANGED');}
 if(!event.success||event.data.type!=='unsend'||source.channel!=='STUDENT'||source.user_hash!==input.userHash||
  hashLineUserId(event.data.source.userId,key)!==input.userHash||event.data.unsend.messageId!==input.lineMessageId)throw new ChatMediaError('SOURCE_CHANGED');
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`processing:STUDENT:${input.userHash}`]);
 await c.query(`insert into private.chat_media_revocations(user_hash,line_message_hash,source_event_id) values($1,$2,$3)
  on conflict(user_hash,line_message_hash) do nothing`,[input.userHash,lineMessageDigest(input.lineMessageId,key),input.eventId]);
 await c.query(`update private.chat_attachments a set revoked_at=clock_timestamp(),
  status=case when a.status in('PENDING','PROCESSING') then 'FAILED' else a.status end,
  error_code=case when a.status in('PENDING','PROCESSING') then 'SOURCE_CHANGED' else a.error_code end,
  lease_token=null,lease_until=null from public.messages m join public.conversations conv on conv.id=m.conversation_id
  join private.line_identities i on i.line_session_id=conv.line_session_id
  where a.message_id=m.id and m.sender_type='USER' and m.line_message_id=$1 and i.user_hash=$2 and a.revoked_at is null`,
 [input.lineMessageId,input.userHash]);
}
async function sourceMatches(c:Client,row:ChatMediaRow,claim:ChatMediaClaim,key:string):Promise<boolean> {
 try{
  if(row.revoked_at||row.message_id!==claim.messageId||row.source_event_id!==claim.sourceEventId||row.kind!==claim.kind)return false;
  const source=sourceSchema.parse(JSON.parse(decryptValue(row.source_encrypted,key))),live=await sourceFor(c,row.message_id,row.source_event_id,key);
  return !live.error&&!live.revokedAt&&live.kind===row.kind&&JSON.stringify(source)===JSON.stringify(live.source)&&JSON.stringify(source)===JSON.stringify(claim.source);
 }catch{return false;}
}
export async function claimChatAttachment(pool:Pool,key:string):Promise<ChatMediaClaim|null> {
 return transaction(async c=>{
  // Bounded cleanup: a crash after the third attempt cannot strand PROCESSING forever.
  await c.query(`with expired as(select id from private.chat_attachments where status='PROCESSING' and attempts>=3
   and lease_until<=clock_timestamp() order by lease_until,id for update skip locked limit 25)
   update private.chat_attachments a set status='FAILED',lease_token=null,lease_until=null,error_code='LEASE_EXPIRED'
   from expired e where a.id=e.id`);
  const row=(await c.query<ChatMediaRow>(`select * from private.chat_attachments where revoked_at is null and attempts<3 and
   ((status='PENDING' and available_at<=clock_timestamp()) or(status='PROCESSING' and lease_until<=clock_timestamp()))
   order by available_at,created_at,id for update skip locked limit 1`)).rows[0];
  if(!row)return null;
  let source:ChatMediaSource;
  try{source=sourceSchema.parse(JSON.parse(decryptValue(row.source_encrypted,key)));}
  catch{await c.query("update private.chat_attachments set status='FAILED',lease_token=null,lease_until=null,error_code='SOURCE_CHANGED' where id=$1",[row.id]);return null;}
  const claim={id:row.id,messageId:row.message_id,sourceEventId:row.source_event_id,leaseToken:randomUUID(),kind:row.kind,source};
  if(!await sourceMatches(c,row,claim,key)){
   await c.query("update private.chat_attachments set status='FAILED',lease_token=null,lease_until=null,error_code='SOURCE_CHANGED' where id=$1",[row.id]);return null;
  }
  await c.query(`update private.chat_attachments set status='PROCESSING',attempts=attempts+1,lease_token=$2,
   lease_until=clock_timestamp()+interval '90 seconds',error_code=null where id=$1`,[row.id,claim.leaseToken]);return claim;
 },pool);
}
async function owned(c:Client,claim:ChatMediaClaim):Promise<ChatMediaRow|null> {
 return (await c.query<ChatMediaRow>(`select * from private.chat_attachments where id=$1 and status='PROCESSING' and revoked_at is null
  and lease_token=$2 and lease_until>clock_timestamp() for update`,[claim.id,claim.leaseToken])).rows[0]??null;
}
export async function finishChatAttachment(pool:Pool,claim:ChatMediaClaim,result:{ref:ChatMediaRef},key:string):Promise<boolean> {
 const ref=chatMediaRefSchema.parse(result.ref);
 if(ref.attachmentId!==claim.id||ref.messageId!==claim.messageId||ref.sourceEventId!==claim.sourceEventId||ref.objectId!==claim.leaseToken)throw new ChatMediaError('INVALID_ATTACHMENT');
 return transaction(async c=>{
  const row=await owned(c,claim);if(!row)return false;
  if(!await sourceMatches(c,row,claim,key)){
   await c.query("update private.chat_attachments set status='FAILED',lease_token=null,lease_until=null,error_code='SOURCE_CHANGED' where id=$1",[row.id]);return false;
  }
  await c.query(`update private.chat_attachments set status='READY',lease_token=null,lease_until=null,error_code=null,
   object_id=$2,mime_type=$3,byte_length=$4,checksum=$5 where id=$1`,[row.id,ref.objectId,ref.mimeType,ref.byteLength,ref.checksum]);return true;
 },pool);
}
export async function failChatAttachment(pool:Pool,claim:ChatMediaClaim,code:string):Promise<boolean> {
 const fixed=['INVALID_ATTACHMENT','TOO_LARGE','UNSUPPORTED_TYPE','UNAVAILABLE','NOT_FOUND','SOURCE_CHANGED'].includes(code)?code:'UNAVAILABLE';
 return transaction(async c=>{
  const row=await owned(c,claim);if(!row)return false;
  const terminal=fixed!=='UNAVAILABLE'||row.attempts>=3;
  await c.query(`update private.chat_attachments set status=$2,lease_token=null,lease_until=null,error_code=$3,
   available_at=clock_timestamp()+make_interval(secs=>least(300,10*power(2,attempts)::integer)) where id=$1`,[row.id,terminal?'FAILED':'PENDING',fixed]);return true;
 },pool);
}
export function chatMediaReference(row:ChatMediaRow):ChatMediaRef {
 return chatMediaRefSchema.parse({attachmentId:row.id,messageId:row.message_id,sourceEventId:row.source_event_id,objectId:row.object_id,
  mimeType:row.mime_type,byteLength:row.byte_length,checksum:row.checksum});
}
/** One bounded lookup for the selected message page; no technical object/source fields leave here. */
export async function verifyChatMediaRowSource(c:Client,row:ChatMediaRow,key:string):Promise<ChatMediaSource> {
 const source=sourceSchema.parse(JSON.parse(decryptValue(row.source_encrypted,key)));
 if(!await sourceMatches(c,row,{id:row.id,messageId:row.message_id,sourceEventId:row.source_event_id,kind:row.kind,leaseToken:row.lease_token??row.id,source},key))throw new ChatMediaError('SOURCE_CHANGED');
 return source;
}
export async function chatMediaForMessages(c:Client,ticketId:string,messageIds:string[],key?:string):Promise<Map<string,ChatAttachment[]>> {
 const result=new Map<string,ChatAttachment[]>();if(!messageIds.length)return result;
 const rows=(await c.query<ChatMediaRow>(`select a.* from private.chat_attachments a join public.messages m on m.id=a.message_id
  where m.ticket_id=$1 and a.message_id=any($2::uuid[]) order by a.created_at,a.id`,[ticketId,messageIds])).rows;
 for(const row of rows){
  if(!key)throw new ChatMediaError('UNAVAILABLE');
  let name:string;try{name=sourceSchema.parse(JSON.parse(decryptValue(row.source_encrypted,key))).fileName;}catch{throw new ChatMediaError('UNAVAILABLE');}
  const ready=row.status==='READY'&&!row.revoked_at,attachment:ChatAttachment={id:row.id,name:row.revoked_at?'ไฟล์ที่ยกเลิกส่งแล้ว':name,mimeType:row.mime_type??'application/octet-stream',
   size:row.byte_length??0,status:ready?'READY':row.revoked_at||row.status==='FAILED'?'FAILED':'PENDING',
   downloadUrl:ready?`/api/chat/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(row.id)}`:null};
  result.set(row.message_id,[...(result.get(row.message_id)??[]),attachment]);
 }
 return result;
}
