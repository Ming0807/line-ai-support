import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {decryptValue,encryptValue} from '../security/identity';
import {nextTicketStatus,type TicketStatus} from '../conversation/state-machine';
import {TicketError,loadActor,authorizeScope,isSupervisor,lockConversation} from '../tickets/authorization';
import {staffChatAccessLock} from '../staff/line-case-context';
import {staffOutboundDraftInputSchema,type StaffOutboundDraftInput} from './staff-outbound-contracts';

type DraftInput=z.output<typeof staffOutboundDraftInputSchema>;
type Current={conversationId:string;lineSessionId:string;recipientHash:string;revision:number;assignmentEpoch:string};
export type StaffOutboundReservation=
 | {status:'UPLOADING';attachmentId:string;leaseToken:string;objectId:string}
 | {status:'READY'|'FAILED';attachmentId:string};
function digest(input:Pick<DraftInput,'revision'|'name'|'mimeType'|'byteLength'|'checksum'>):string {
 return createHash('sha256').update(JSON.stringify([input.revision,input.name,input.mimeType,input.byteLength,input.checksum])).digest('hex');
}
/** Follows the same actor, scope, conversation and assignment locks as STAFF_REPLY. */
async function current(c:PoolClient,staffId:string,ticketId:string,revision:number):Promise<Current>{
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 const actor=await loadActor(c,staffId);
 const ref=(await c.query('select conversation_id from public.tickets where id=$1',[ticketId])).rows[0];
 if(!ref)throw new TicketError('NOT_FOUND');await lockConversation(c,ref.conversation_id);
 const ticket=(await c.query('select * from public.tickets where id=$1 for update',[ticketId])).rows[0];
 if(!ticket)throw new TicketError('NOT_FOUND');await authorizeScope(c,ticket.department_id,ticket.sensitive_level);
 if(ticket.revision!==revision)throw new TicketError('CONFLICT');
 if(ticket.assigned_staff_id!==staffId&&!isSupervisor(actor))throw new TicketError('NOT_FOUND');
 const conversation=(await c.query('select * from public.conversations where id=$1 for update',[ticket.conversation_id])).rows[0];
 if(ticket.mode!=='HUMAN'||!nextTicketStatus(ticket.status as TicketStatus,'STAFF_REPLY')||!conversation||conversation.mode!=='HUMAN'||
  conversation.active_ticket_id!==ticket.id||!['ACTIVE','WAITING'].includes(conversation.status)||conversation.line_session_id!==ticket.line_session_id)
  throw new TicketError('INVALID_ACTION');
 const recipient=(await c.query(`select i.user_hash from private.line_identities i join public.line_sessions s
  on s.id=i.line_session_id and s.active where i.line_session_id=$1 for share of i,s`,[ticket.line_session_id])).rows[0];
 if(!recipient||typeof recipient.user_hash!=='string'||!/^[a-f0-9]{64}$/u.test(recipient.user_hash))throw new TicketError('NOT_FOUND');
 return {conversationId:ticket.conversation_id,lineSessionId:ticket.line_session_id,recipientHash:recipient.user_hash,
  revision:ticket.revision,assignmentEpoch:String(ticket.staff_line_epoch)};
}
function matches(row:Record<string,unknown>,scope:Current):boolean {
 return row.conversation_id===scope.conversationId&&row.line_session_id===scope.lineSessionId&&row.recipient_hash===scope.recipientHash&&
  row.ticket_revision===scope.revision&&String(row.assignment_epoch)===scope.assignmentEpoch;
}
/** Reserves metadata only. Caller must verify bytes and upload outside the SQL transaction. */
export async function beginStaffOutboundUpload(pool:Pool,input:StaffOutboundDraftInput,key:string):Promise<StaffOutboundReservation>{
 const parsed=staffOutboundDraftInputSchema.safeParse(input);if(!parsed.success)throw new TicketError('INVALID_REQUEST');
 const value=parsed.data,requestHash=digest(value),nameEncrypted=encryptValue(value.name,key);
 return transaction(async c=>{
  const scope=await current(c,value.staffId,value.ticketId,value.revision);
  const existing=(await c.query(`select *,lease_until>clock_timestamp() lease_live from private.staff_outbound_attachments
   where staff_id=$1 and ticket_id=$2 and request_id=$3 for update`,[value.staffId,value.ticketId,value.requestId])).rows[0];
  if(existing){
   if(existing.request_hash!==requestHash||!matches(existing,scope))throw new TicketError('CONFLICT');
   if(existing.status==='READY'||existing.status==='FAILED')return {status:existing.status,attachmentId:existing.id};
   if(existing.lease_live)throw new TicketError('CONFLICT');
   if(existing.attempts>=3){
    await c.query("update private.staff_outbound_attachments set status='FAILED',failure_code='ATTEMPT_LIMIT',lease_token=null,lease_until=null where id=$1",[existing.id]);
    return {status:'FAILED',attachmentId:existing.id};
   }
   const leaseToken=randomUUID();
   await c.query(`update private.staff_outbound_attachments set attempts=attempts+1,lease_token=$2,object_id=$2,
    lease_until=clock_timestamp()+interval '90 seconds' where id=$1`,[existing.id,leaseToken]);
   return {status:'UPLOADING',attachmentId:existing.id,leaseToken,objectId:leaseToken};
  }
  const attachmentId=randomUUID(),leaseToken=randomUUID();
  await c.query(`insert into private.staff_outbound_attachments(id,staff_id,ticket_id,conversation_id,line_session_id,recipient_hash,
   ticket_revision,assignment_epoch,request_id,request_hash,name_encrypted,mime_type,byte_length,checksum,status,attempts,lease_token,lease_until,object_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'UPLOADING',1,$15,clock_timestamp()+interval '90 seconds',$15)`,
  [attachmentId,value.staffId,value.ticketId,scope.conversationId,scope.lineSessionId,scope.recipientHash,scope.revision,scope.assignmentEpoch,
   value.requestId,requestHash,nameEncrypted,value.mimeType,value.byteLength,value.checksum,leaseToken]);
  return {status:'UPLOADING',attachmentId,leaseToken,objectId:leaseToken};
 },pool);
}
/** Internal finalization after the caller has verified successful immutable private upload. */
export async function finishStaffOutboundUpload(pool:Pool,input:{staffId:string;ticketId:string;attachmentId:string;leaseToken:string},key:string):Promise<boolean>{
 const parsed=z.strictObject({staffId:z.uuid(),ticketId:z.uuid(),attachmentId:z.uuid(),leaseToken:z.uuid()}).safeParse(input);
 if(!parsed.success)return false;
 try{return await transaction(async c=>{
  // Read the frozen revision without holding a draft lock; current() acquires the global actor/conversation/ticket order first.
  const snapshot=(await c.query(`select ticket_revision from private.staff_outbound_attachments where id=$1 and staff_id=$2 and ticket_id=$3`,
   [input.attachmentId,input.staffId,input.ticketId])).rows[0];if(!snapshot)return false;
  const scope=await current(c,input.staffId,input.ticketId,snapshot.ticket_revision);
  const row=(await c.query(`select * from private.staff_outbound_attachments where id=$1 and staff_id=$2 and ticket_id=$3
   and status='UPLOADING' and lease_token=$4 and lease_until>clock_timestamp() for update`,
   [input.attachmentId,input.staffId,input.ticketId,input.leaseToken])).rows[0];
  if(!row)return false;
  if(!matches(row,scope)||row.object_id!==input.leaseToken){
   await c.query("update private.staff_outbound_attachments set status='FAILED',failure_code='AUTHORITY_CHANGED',lease_token=null,lease_until=null where id=$1 and lease_token=$2",[row.id,input.leaseToken]);return false;
  }
  let name:string;try{name=decryptValue(row.name_encrypted,key);}catch{return false;}
  if(digest({revision:row.ticket_revision,name,mimeType:row.mime_type,byteLength:row.byte_length,checksum:row.checksum})!==row.request_hash){
   await c.query("update private.staff_outbound_attachments set status='FAILED',failure_code='SOURCE_INTEGRITY',lease_token=null,lease_until=null where id=$1 and lease_token=$2",[row.id,input.leaseToken]);return false;
  }
  const updated=await c.query(`update private.staff_outbound_attachments set status='READY',lease_token=null,lease_until=null,ready_at=clock_timestamp()
   where id=$1 and lease_token=$2 and lease_until>clock_timestamp() returning id`,[row.id,input.leaseToken]);
  return updated.rowCount===1;
 },pool);}catch(error){
  if(!(error instanceof TicketError))throw error;
  // A trusted uploader may retire only its still-matching lease, even after access is revoked.
  // A reclaimed lease has a different token and cannot be modified by the stale worker.
  await pool.query(`update private.staff_outbound_attachments set status='FAILED',failure_code='AUTHORITY_CHANGED',lease_token=null,lease_until=null
   where id=$1 and staff_id=$2 and ticket_id=$3 and status='UPLOADING' and lease_token=$4 and lease_until>clock_timestamp()`,
  [input.attachmentId,input.staffId,input.ticketId,input.leaseToken]);return false;
 }
}
/**
 * CHAT-MEDIA-02E: after a failed Storage write the uploader expires its OWN still-live lease, so the
 * same request can reclaim a new attempt at once instead of waiting 90 seconds. Shortening is the
 * only lease change the DB guard allows within an attempt; another or reclaimed lease is untouched.
 */
export async function releaseStaffOutboundLease(pool:Pool,input:{attachmentId:string;leaseToken:string}):Promise<boolean>{
 const parsed=z.strictObject({attachmentId:z.uuid(),leaseToken:z.uuid()}).safeParse(input);if(!parsed.success)return false;
 const result=await pool.query(`update private.staff_outbound_attachments set lease_until=clock_timestamp()
  where id=$1 and status='UPLOADING' and lease_token=$2 and lease_until>clock_timestamp()`,[input.attachmentId,input.leaseToken]);
 return result.rowCount===1;
}
