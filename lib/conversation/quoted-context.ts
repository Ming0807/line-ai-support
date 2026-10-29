import type {DbClient} from '../tickets/authorization';
import {decryptValue} from '../security/identity';
import {hashOpaqueToken} from './quick-reply';
import type {RouteCandidate} from './router';

export interface QuotedRoutingAnchor{
 messageId:string;conversationId:string;ticketId:string|null;senderType:'USER'|'AI'|'STAFF';outboxId:string|null;
}
const referenceHash=(value:string,key:string)=>hashOpaqueToken(value,key,'line-message:STUDENT');
async function receiptSchema(c:DbClient):Promise<boolean>{
 return (await c.query("select to_regclass('private.line_delivery_receipts') is not null ready")).rows[0]?.ready===true;
}

/** Caller owns the delivery-finish transaction. Optional indexing cannot roll back SENT. */
export async function recordLineDeliveryReceipt(c:DbClient,outboxId:string,ids:readonly string[],key:string):Promise<void>{
 if(ids.length<1||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!/^[0-9]{1,256}$/u.test(id)))return;
 await c.query('savepoint line_delivery_receipt');
 try{
  if(!await receiptSchema(c))return;
  const outbox=(await c.query("select channel,status,line_session_id,payload_encrypted from private.message_outbox where id=$1",[outboxId])).rows[0];
  if(!outbox||outbox.channel!=='STUDENT'||outbox.status!=='SENT'||!outbox.line_session_id)return;
  const payload=JSON.parse(decryptValue(outbox.payload_encrypted,key));
  if(!Array.isArray(payload.messages)||payload.messages.length!==ids.length)return;
  await c.query(`insert into private.line_delivery_receipts(outbox_id,message_hashes) values($1,$2)
   on conflict(outbox_id) do update set consistent=private.line_delivery_receipts.consistent
    and private.line_delivery_receipts.message_hashes=excluded.message_hashes`,[outboxId,ids.map(id=>referenceHash(id,key))]);
 }catch{
  await c.query('rollback to savepoint line_delivery_receipt');
  console.warn('LINE_RECEIPT_INDEX_UNAVAILABLE');
 }finally{await c.query('release savepoint line_delivery_receipt');}
}

interface SourceRow{id:string;conversation_id:string;ticket_id:string|null;sender_type:string;line_session_id?:string;routing_status?:string|null}
function currentAnchor(row:SourceRow,sessionId:string,candidates:RouteCandidate[],outboxId:string|null):QuotedRoutingAnchor|null{
 if(row.line_session_id!==sessionId||!['USER','AI','STAFF'].includes(row.sender_type))return null;
 const candidate=candidates.find(c=>c.conversationId===row.conversation_id);
 if(!candidate||['RESOLVED','CLOSED','CANCELLED'].includes(candidate.ticketStatus??'')||row.ticket_id!==null&&row.ticket_id!==candidate.ticketId)return null;
 if(candidate.mode==='HUMAN'&&!candidate.ticketId)return null;
 return {messageId:row.id,conversationId:row.conversation_id,ticketId:row.ticket_id,
  senderType:row.sender_type as QuotedRoutingAnchor['senderType'],outboxId};
}

/** Technical IDs never leave this reader. A quote is a semantic hint, not a route command. */
export async function resolveQuotedContext(c:DbClient,sessionId:string,id:string,candidates:RouteCandidate[],key:string):Promise<QuotedRoutingAnchor|null>{
 if(!id||id.length>256||!candidates.length)return null;
 const inbound=(await c.query<SourceRow>(`select m.id,m.conversation_id,m.ticket_id,m.sender_type,
  m.metadata->>'routing_status' routing_status,c.line_session_id from public.messages m
  join public.conversations c on c.id=m.conversation_id where m.line_message_id=$1 limit 2`,[id])).rows;
 if(inbound.length){
  if(inbound.length!==1||inbound[0].sender_type!=='USER'||['PENDING','ROUTE_CONTROL'].includes(inbound[0].routing_status??''))return null;
  return currentAnchor(inbound[0],sessionId,candidates,null);
 }
 if(!await receiptSchema(c))return null;
 // Count globally before scope filtering: an ID collision is never resolved by guessing a recipient.
 const matches=(await c.query(`select r.outbox_id,r.consistent,o.channel,o.status,o.line_session_id
  from private.line_delivery_receipts r join private.message_outbox o on o.id=r.outbox_id
  where r.message_hashes @> array[$1]::text[] limit 2`,[referenceHash(id,key)])).rows;
 if(matches.length!==1)return null;
 const receipt=matches[0];
 if(!receipt.consistent||receipt.channel!=='STUDENT'||receipt.status!=='SENT'||receipt.line_session_id!==sessionId)return null;
 const sources=(await c.query<SourceRow>(`select m.id,m.conversation_id,m.ticket_id,m.sender_type,c.line_session_id
  from private.message_outbox o join public.messages m on m.conversation_id=o.conversation_id
  join public.conversations c on c.id=m.conversation_id and c.line_session_id=o.line_session_id
  where o.id=$1 and m.message_type='TEXT' and
   ((o.kind='STAFF' and m.sender_type='STAFF' and m.ticket_id=o.ticket_id
     and o.idempotency_key='staff-reply:'||m.ticket_id::text||':'||m.id::text)
    or(o.kind='AI' and m.sender_type='AI' and o.idempotency_key='ai-job:'||(m.metadata->>'ai_job_id')))
  union
  select m.id,m.conversation_id,m.ticket_id,m.sender_type,c.line_session_id
  from private.message_outbox o join private.incident_reply_recipients r on r.outbox_id=o.id and r.line_session_id=o.line_session_id
  join private.incident_reply_cases b on b.recipient_id=r.id and b.batch_id=r.batch_id
  join public.messages m on m.id=b.staff_message_id and m.conversation_id=b.conversation_id and m.ticket_id=b.ticket_id
  join public.conversations c on c.id=m.conversation_id and c.line_session_id=o.line_session_id
  where o.id=$1 and o.kind='BATCH' and m.sender_type='STAFF' and m.message_type='TEXT' limit 2`,[receipt.outbox_id])).rows;
 // One batch packet can represent multiple cases for one Student: do not pick one of them.
 return sources.length===1?currentAnchor(sources[0],sessionId,candidates,receipt.outbox_id):null;
}
