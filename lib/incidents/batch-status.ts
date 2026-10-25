import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,isSupervisor} from '../tickets/authorization';
import {staffChatAccessLock} from '../staff/line-case-context';
import {loadStaffChatDeliveryGuard,verifyStaffChatDelivery} from '../staff/line-chat-delivery';
import {decryptValue} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {IncidentError} from './contracts';
import {incidentVisibleSql} from './reads';
import {incidentCatalogLock} from './worker';
import {loadIncidentBatchDelivery,verifyIncidentBatchDelivery} from './batch-delivery';
import {incidentReplyReceiptSchema} from './batch-preview';
import {incidentReplyPacketSchema} from './batch-reply-contracts';
import {incidentBatchDraftSchema,type IncidentBatchDraft} from './batch-draft-contracts';
import {incidentBatchStatusListSchema,incidentBatchRetryInputSchema,incidentBatchRetryResultSchema,
 type IncidentBatchStatusList,type IncidentBatchRetryResult} from './batch-status-contracts';

interface Options {pool?:Pool;key?:string}
export async function getIncidentReplyDraft(actorId:string,incidentId:string,options:Options={}):Promise<IncidentBatchDraft>{
 actorId=uuid.parse(actorId);incidentId=uuid.parse(incidentId);
 return transaction(async c=>{
  const state=await scope(c,actorId,incidentId),header=state.headers[0];
  if(!header)return {status:'EMPTY'};
  const key=keyFor(options),stored=(await c.query('select incident_id,request_id,request_hash,prepared_encrypted from private.incident_reply_batches where id=$1',[header.id])).rows[0];
  try{
   const prepared=z.strictObject({receipt:incidentReplyReceiptSchema,deliveries:z.array(incidentReplyPacketSchema).min(1).max(100)})
    .parse(JSON.parse(decryptValue(stored.prepared_encrypted,key)));
   const receipt=prepared.receipt;
   const hash=hashOpaqueToken(JSON.stringify({...receipt,selection:{...receipt.selection,ticketIds:[...receipt.selection.ticketIds].sort()}}),key,'incident-batch-request-v1');
   if(stored.incident_id!==incidentId||receipt.incidentId!==incidentId||receipt.actorId!==header.staff_id
    ||receipt.selection.requestId!==stored.request_id||hash!==stored.request_hash||receipt.selection.ticketIds.length!==header.case_count
    ||prepared.deliveries.length!==header.recipient_count)throw new IncidentError('UNAVAILABLE');
   return incidentBatchDraftSchema.parse({status:'AVAILABLE',batchId:header.id,acceptedAt:header.created_at.toISOString(),text:receipt.selection.text});
  }catch{throw new IncidentError('UNAVAILABLE');}
 },options.pool);
}
interface Header {id:string;staff_id:string;case_count:number;recipient_count:number;created_at:Date}
interface Recipient {id:string;outbox_id:string;recipient_code:string;ticket_codes:string[];status:string;last_error_code:string|null;
 attempts:number;first_attempt_at:Date|null;now:Date;temporary_failure:boolean;delivery_current:boolean}
const uuid=z.uuid().transform(v=>v.toLowerCase());
const packetSchema=z.strictObject({messages:z.array(z.strictObject({type:z.literal('text'),text:z.string().min(1).max(5000)})).min(1).max(5)});
function keyFor(options:Options){const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new IncidentError('UNAVAILABLE');return key;}
async function scope(c:PoolClient,actorId:string,incidentId:string,batchId?:string){
 await c.query("set local statement_timeout='8s';set local lock_timeout='2s'");
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[incidentCatalogLock]);
 const actor=await loadActor(c,actorId);
 if(!(await c.query(`select i.id from public.incidents i where i.id=$1 and ${incidentVisibleSql}`,[incidentId])).rowCount)throw new IncidentError('NOT_FOUND');
 const headers=(await c.query(`select id,staff_id,case_count,recipient_count,created_at from private.incident_reply_batches
  where incident_id=$1 and ($2::uuid is null or id=$2) order by created_at desc,id limit 25`,[incidentId,batchId??null])).rows as Header[];
 if(batchId&&!headers.length)throw new IncidentError('NOT_FOUND');
 const references=(await c.query(`select t.id,t.conversation_id from public.tickets t where
  exists(select 1 from public.incident_tickets m where m.incident_id=$1 and m.ticket_id=t.id)
  or exists(select 1 from private.incident_reply_cases b where b.batch_id=any($2::uuid[]) and b.ticket_id=t.id) order by t.id limit 3001`,[incidentId,headers.map(h=>h.id)])).rows;
 if(references.length>3000)throw new IncidentError('UNAVAILABLE');
 // Evaluate volatile lock calls from the materialized canonical order in one
 // round-trip; a large history must not make thousands of sequential requests.
 await c.query(`with ordered as materialized (select distinct unnest($1::uuid[]) id order by id)
  select pg_advisory_xact_lock(hashtextextended('conversation:'||id::text,0)) from ordered`,[references.map(r=>r.conversation_id)]);
 await c.query('select id from public.tickets where id=any($1::uuid[]) order by id for share',[references.map(r=>r.id)]);
 if(!(await c.query(`select i.id from public.incidents i where i.id=$1 and ${incidentVisibleSql}`,[incidentId])).rowCount)throw new IncidentError('NOT_FOUND');
 const visible:Header[]=[];
 for(const header of headers){
  const rows=(await c.query(`select private.can_access_scope(t.department_id,t.sensitive_level) allowed from private.incident_reply_cases b
   join public.tickets t on t.id=b.ticket_id where b.batch_id=$1`,[header.id])).rows;
  if(rows.length===header.case_count&&rows.every(r=>r.allowed))visible.push(header);
 }
 if(batchId&&!visible.length)throw new IncidentError('NOT_FOUND');
 return {actor,headers:visible};
}
async function recipients(c:PoolClient,batchId:string):Promise<Recipient[]>{
 return (await c.query(`select r.id,r.outbox_id,r.recipient_code,o.status,o.last_error_code,o.attempts,o.first_attempt_at,clock_timestamp() now,
  array(select b.ticket_code from private.incident_reply_cases b where b.batch_id=r.batch_id and b.recipient_id=r.id order by b.ticket_id) ticket_codes,
  (o.last_error_code in('PUSH_RETRYABLE','PUSH_NETWORK_ERROR','PUSH_TIMEOUT') or (o.last_error_code='DELIVERY_EXHAUSTED' and
    (select a.error_code from private.delivery_attempts a where a.outbox_id=o.id order by a.id desc limit 1)
    in('PUSH_RETRYABLE','PUSH_NETWORK_ERROR','PUSH_TIMEOUT'))) temporary_failure,
  (author.active and o.kind='BATCH' and o.channel='STUDENT' and o.delivery_mode='PUSH'
   and exists(select 1 from public.line_sessions s join private.line_identities i on i.line_session_id=s.id where s.id=r.line_session_id and s.active)
   and exists(select 1 from private.staff_chat_delivery_guards g where g.outbox_id=o.id and g.staff_id=h.staff_id and g.purpose='CASE')
   and (select count(*) from private.staff_chat_delivery_cases g where g.outbox_id=o.id)=r.case_count
   and not exists(select 1 from private.incident_reply_cases b join public.tickets t on t.id=b.ticket_id
    join public.conversations v on v.id=t.conversation_id where b.batch_id=r.batch_id and b.recipient_id=r.id and (
     b.conversation_id<>t.conversation_id or b.assignment_epoch<>t.staff_line_epoch or t.line_session_id<>r.line_session_id
     or t.mode<>'HUMAN' or v.mode<>'HUMAN' or t.status not in('STAFF_HANDLING','WAITING_USER') or t.sensitive_level<>'GENERAL'
     or v.status not in('ACTIVE','WAITING') or v.active_ticket_id is distinct from t.id
     or (t.assigned_staff_id is distinct from author.id and author.role not in('SUPERVISOR','ADMIN','SUPER_ADMIN'))
     or not(author.role='SUPER_ADMIN' or (author.role='ADMIN' and exists(select 1 from public.staff_department_grants g where g.staff_id=author.id and g.department_id=t.department_id))
       or (author.role in('STAFF','SUPERVISOR') and author.department_id=t.department_id))
     or not exists(select 1 from private.staff_chat_delivery_cases g where g.outbox_id=o.id and g.ticket_id=b.ticket_id and g.assignment_epoch=b.assignment_epoch)
   ))) delivery_current
  from private.incident_reply_recipients r join private.message_outbox o on o.id=r.outbox_id
  join private.incident_reply_batches h on h.id=r.batch_id join public.staff_profiles author on author.id=h.staff_id where r.batch_id=$1
  order by substring(r.recipient_code from 2)::int`,[batchId])).rows;
}
function temporaryRetry(row:Recipient){
 return row.status==='DEAD'&&row.temporary_failure&&row.attempts>0&&row.attempts<10&&row.first_attempt_at!==null
  &&row.first_attempt_at.getTime()<=row.now.getTime()&&row.now.getTime()-row.first_attempt_at.getTime()<86400000;
}
async function guarded(c:PoolClient,outboxId:string,key:string){
 const batch=await loadIncidentBatchDelivery(c,outboxId),guard=await loadStaffChatDeliveryGuard(c,outboxId);
 const job=(await c.query('select * from private.message_outbox where id=$1',[outboxId])).rows[0];
 if(!job)return false;
 let payload:z.infer<typeof packetSchema>;
 try{payload=packetSchema.parse(JSON.parse(decryptValue(job.payload_encrypted,key)));}catch{return false;}
 return await verifyStaffChatDelivery(c,guard,job)&&await verifyIncidentBatchDelivery(c,batch,guard,job,payload,key)
  &&(await c.query(`select s.id from public.line_sessions s join private.line_identities i on i.line_session_id=s.id
   where s.id=$1 and s.active`,[job.line_session_id])).rowCount===1;
}
export async function listIncidentReplyBatches(actorId:string,incidentId:string,options:Options={}):Promise<IncidentBatchStatusList>{
 actorId=uuid.parse(actorId);incidentId=uuid.parse(incidentId);
 return transaction(async c=>{
  const state=await scope(c,actorId,incidentId),batches:IncidentBatchStatusList['batches']=[];
  for(const header of state.headers){
   const rows=await recipients(c,header.id),items=[];
   for(const row of rows){
    const permitted=header.staff_id===actorId||isSupervisor(state.actor);
    // This bounded SQL observation offers an action, never send authority. The
    // retry transaction repeats the complete keyed packet/auth guard before writes.
    const retryable=!!(permitted&&temporaryRetry(row)&&row.delivery_current);
    const safeFailureCode=row.status==='UNKNOWN'?'DELIVERY_UNCERTAIN':row.status==='SUPPRESSED'?'ACCESS_CHANGED':row.status==='DEAD'?(row.temporary_failure?'TEMPORARY_FAILURE':'DELIVERY_FAILED'):undefined;
    items.push({recipientCode:row.recipient_code,ticketCodes:row.ticket_codes,deliveryStatus:row.status,retryable,...(safeFailureCode?{safeFailureCode}:{})});
   }
   batches.push({status:'ACCEPTED',batchId:header.id,acceptedAt:header.created_at.toISOString(),caseCount:header.case_count,recipientCount:header.recipient_count,recipients:items} as IncidentBatchStatusList['batches'][number]);
  }
  return incidentBatchStatusListSchema.parse({batches});
 },options.pool);
}
export async function retryIncidentReplyBatch(actorId:string,incidentId:string,batchId:string,raw:unknown,options:Options={}):Promise<IncidentBatchRetryResult>{
 actorId=uuid.parse(actorId);incidentId=uuid.parse(incidentId);batchId=uuid.parse(batchId);
 const input=incidentBatchRetryInputSchema.parse(raw),codes=[...input.recipientCodes].sort(),key=keyFor(options);
 const hash=hashOpaqueToken(JSON.stringify({incidentId,batchId,codes}),key,'incident-batch-retry-v1');
 return transaction(async c=>{
  const state=await scope(c,actorId,incidentId,batchId),header=state.headers[0];
  if(header.staff_id!==actorId&&!isSupervisor(state.actor))throw new IncidentError('FORBIDDEN');
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`incident-batch-retry:${actorId}:${input.requestId}`]);
  const prior=(await c.query('select batch_id,request_hash,recipient_codes from private.incident_reply_retry_receipts where staff_id=$1 and request_id=$2',[actorId,input.requestId])).rows[0];
  const accepted=(replayed:boolean)=>incidentBatchRetryResultSchema.parse({status:'RETRY_ACCEPTED',batchId,requestId:input.requestId,recipientCodes:codes,replayed});
  if(prior){if(prior.batch_id!==batchId||prior.request_hash!==hash)throw new IncidentError('CONFLICT');return accepted(true);}
  const rows=await recipients(c,batchId),selected=codes.map(code=>rows.find(row=>row.recipient_code===code));
  if(selected.some(row=>!row))throw new IncidentError('CONFLICT');
  await c.query('select id from private.message_outbox where id=any($1::uuid[]) order by id for update',[selected.map(row=>row!.outbox_id)]);
  const fresh=await recipients(c,batchId);
  for(const code of codes){const row=fresh.find(row=>row.recipient_code===code);if(!row||!temporaryRetry(row)||!await guarded(c,row.outbox_id,key))throw new IncidentError('CONFLICT');}
  await c.query(`insert into private.incident_reply_retry_receipts(batch_id,staff_id,request_id,request_hash,recipient_codes) values($1,$2,$3,$4,$5)`,[batchId,actorId,input.requestId,hash,codes]);
  await c.query(`update private.message_outbox set status='PENDING',available_at=clock_timestamp(),completed_at=null,lease_token=null,lease_until=null,
   attempt_limit=greatest(attempt_limit,attempts+1) where id=any($1::uuid[])`,[selected.map(row=>row!.outbox_id)]);
  return accepted(false);
 },options.pool);
}
