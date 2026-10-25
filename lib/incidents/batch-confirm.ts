import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,authorizeScope} from '../tickets/authorization';
import {applyIncidentBatchStaffReply} from '../tickets/ticket-service';
import {staffChatAccessLock} from '../staff/line-case-context';
import {encryptValue} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {enqueueOutbound} from '../queue/outbox';
import {IncidentError} from './contracts';
import {decodeIncidentReplyReceipt,verifyIncidentReplyPreview} from './batch-preview';
import {incidentBatchConfirmInputSchema,incidentBatchConfirmResultSchema,type IncidentBatchConfirmResult} from './batch-confirm-contracts';
import {incidentBatchPacketDigest} from './batch-delivery';
import {incidentCatalogLock} from './worker';
import {incidentVisibleSql} from './reads';

interface Header {id:string;incident_id:string;request_id:string;request_hash:string;case_count:number;recipient_count:number;created_at:Date}
function result(header:Header,replayed:boolean):IncidentBatchConfirmResult{
 return incidentBatchConfirmResultSchema.parse({status:'ACCEPTED',batchId:header.id,incidentId:header.incident_id,requestId:header.request_id,
  caseCount:header.case_count,recipientCount:header.recipient_count,createdAt:header.created_at.toISOString(),replayed});
}
async function reauthorizeReplay(c:PoolClient,header:Header){
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[incidentCatalogLock]);
 if(!(await c.query(`select i.id from public.incidents i where i.id=$1 and ${incidentVisibleSql}`,[header.incident_id])).rowCount)throw new IncidentError('NOT_FOUND');
 const members=(await c.query(`select t.id,t.conversation_id,t.department_id,t.sensitive_level from private.incident_reply_cases b
  join public.tickets t on t.id=b.ticket_id where b.batch_id=$1 order by t.id`,[header.id])).rows;
 if(members.length!==header.case_count)throw new IncidentError('CONFLICT');
 const references=(await c.query(`select t.id,t.conversation_id from public.tickets t where
  exists(select 1 from public.incident_tickets m where m.incident_id=$1 and m.ticket_id=t.id)
  or t.id=any($2::uuid[]) order by t.id limit 3001`,[header.incident_id,members.map(row=>row.id)])).rows;
 if(references.length>3000)throw new IncidentError('UNAVAILABLE');
 await c.query(`with ordered as materialized (select distinct unnest($1::uuid[]) id order by id)
  select pg_advisory_xact_lock(hashtextextended('conversation:'||id::text,0)) from ordered`,[references.map(row=>row.conversation_id)]);
 await c.query('select id from public.tickets where id=any($1::uuid[]) order by id for share',[references.map(row=>row.id)]);
 if(!(await c.query(`select i.id from public.incidents i where i.id=$1 and ${incidentVisibleSql}`,[header.incident_id])).rowCount)throw new IncidentError('NOT_FOUND');
 const locked=(await c.query('select department_id,sensitive_level from public.tickets where id=any($1::uuid[]) order by id for share',[members.map(row=>row.id)])).rows;
 if(locked.length!==members.length)throw new IncidentError('CONFLICT');
 for(const member of locked)await authorizeScope(c,member.department_id,member.sensitive_level);
}
/** One SQL transaction owns final review validation, immutable provenance and every enqueue. */
export async function confirmIncidentReply(actorId:string,incidentId:string,raw:unknown,options:{pool?:Pool;key?:string}={}):Promise<IncidentBatchConfirmResult>{
 const input=incidentBatchConfirmInputSchema.parse(raw),key=options.key??process.env.ENCRYPTION_KEY;
 if(!key)throw new IncidentError('UNAVAILABLE');
 const receipt=decodeIncidentReplyReceipt(actorId,incidentId,input.previewReceipt,key);
 const requestHash=hashOpaqueToken(JSON.stringify({...receipt,selection:{...receipt.selection,ticketIds:[...receipt.selection.ticketIds].sort()}}),key,'incident-batch-request-v1');
 return transaction(async c=>{
  await c.query("set local statement_timeout='8s';set local lock_timeout='2s'");
  await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
  await loadActor(c,receipt.actorId);
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`incident-batch-request:${receipt.actorId}:${receipt.selection.requestId}`]);
  const previous=(await c.query('select * from private.incident_reply_batches where staff_id=$1 and request_id=$2',[receipt.actorId,receipt.selection.requestId])).rows[0] as Header|undefined;
  if(previous){
   if(previous.incident_id!==receipt.incidentId||previous.request_hash!==requestHash)throw new IncidentError('CONFLICT');
   await reauthorizeReplay(c,previous);return result(previous,true);
  }
  const state=await verifyIncidentReplyPreview(c,receipt,key,true);
  const header=(await c.query(`insert into private.incident_reply_batches(incident_id,staff_id,request_id,request_hash,prepared_encrypted,case_count,recipient_count)
   values($1,$2,$3,$4,$5,$6,$7) returning *`,[receipt.incidentId,receipt.actorId,receipt.selection.requestId,requestHash,
   encryptValue(JSON.stringify({receipt,deliveries:state.deliveries}),key),state.members.length,state.deliveries.length])).rows[0] as Header;
  const messages=new Map<string,string>();
  for(const member of state.members){
   const applied=await applyIncidentBatchStaffReply(c,receipt.actorId,member.id,{revision:member.revision,requestId:receipt.selection.requestId,text:receipt.selection.text},key,receipt.selection.intervention);
   messages.set(member.id,applied.messageId);
  }
  for(const packet of state.deliveries){
   const members=packet.cases.map(item=>state.members.find(member=>member.id===item.ticketId)!);
   const anchor=members[0];
   const outbox=await enqueueOutbound(c,{idempotencyKey:`incident-batch:${header.id}:${packet.recipientCode}`,channel:'STUDENT',kind:'BATCH',
    lineSessionId:anchor.line_session_id,conversationId:anchor.conversation_id,ticketId:anchor.id,messages:packet.messages},key);
   if(!outbox)throw new IncidentError('CONFLICT');
   const recipient=(await c.query(`insert into private.incident_reply_recipients(batch_id,recipient_code,line_session_id,outbox_id,packet_digest,case_count)
    values($1,$2,$3,$4,$5,$6) returning id`,[header.id,packet.recipientCode,anchor.line_session_id,outbox,incidentBatchPacketDigest(packet.messages,key),members.length])).rows[0];
   await c.query("insert into private.staff_chat_delivery_guards(outbox_id,staff_id,purpose) values($1,$2,'CASE')",[outbox,receipt.actorId]);
   for(const member of members){
    await c.query('insert into private.incident_reply_cases(batch_id,ticket_id,recipient_id,staff_message_id,assignment_epoch,conversation_id,ticket_code,reporter_label) values($1,$2,$3,$4,$5,$6,$7,$8)',[header.id,member.id,recipient.id,messages.get(member.id),member.staff_line_epoch,member.conversation_id,member.ticket_no,member.anonymous_code]);
    await c.query('insert into private.staff_chat_delivery_cases(outbox_id,ticket_id,assignment_epoch) values($1,$2,$3)',[outbox,member.id,member.staff_line_epoch]);
   }
  }
  return result(header,false);
 },options.pool);
}
