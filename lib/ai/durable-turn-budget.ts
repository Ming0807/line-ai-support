import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {lockConversation} from '../tickets/authorization';
import {decryptValue,hashLineUserId} from '../security/identity';
import {userEventSchema} from '../line/events';
import type {AIErrorCode,AIModelConfig} from './types';
import type {TurnAttempt} from './turn-budget';

type Owner={kind:'INBOX'|'AI';id:string;leaseToken:string};
type Source={inboxId:string|null;jobId:string|null};
/** Resolve ownership from current rows, never caller-provided message/session IDs. */
async function ownedSource(client:PoolClient,owner:Owner,key:string):Promise<Source>{
 if(owner.kind==='INBOX'){
  const row=(await client.query("select payload_encrypted,user_hash from private.webhook_inbox where id=$1 and lease_token=$2 and status='PROCESSING' and channel='STUDENT' and lease_until>clock_timestamp() for update",[owner.id,owner.leaseToken])).rows[0];
  if(!row)throw new Error('TURN_OWNER_STALE');
  const event=userEventSchema.safeParse(JSON.parse(decryptValue(row.payload_encrypted,key)));
  if(!event.success||event.data.type!=='message'||event.data.message.type!=='text'||row.user_hash!==hashLineUserId(event.data.source.userId,key))throw new Error('TURN_SOURCE_MISMATCH');
  return {inboxId:owner.id,jobId:null};
 }
 const job=(await client.query('select conversation_id from private.ai_jobs where id=$1',[owner.id])).rows[0];
 if(!job)throw new Error('TURN_OWNER_STALE');
 await lockConversation(client,job.conversation_id);
 const row=(await client.query(`select j.id,m.content,m.line_message_id,m.source_event_id,i.user_hash from private.ai_jobs j
  join public.conversations c on c.id=j.conversation_id and c.line_session_id=j.line_session_id
  join public.line_sessions s on s.id=c.line_session_id and s.active
  join public.messages m on m.id=j.message_id and m.conversation_id=c.id and m.sender_type='USER' and m.message_type='TEXT'
  left join private.line_identities i on i.line_session_id=s.id
  where j.id=$1 and j.lease_token=$2 and j.status='PROCESSING' and j.lease_until>clock_timestamp()
  and c.revision=j.expected_conversation_revision and c.mode='AI' and c.status in('ACTIVE','WAITING')
  and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in('CLOSED','CANCELLED'))
  for update of j`,[owner.id,owner.leaseToken])).rows[0];
 if(!row)throw new Error('TURN_OWNER_STALE');
 if(row.source_event_id===null){
  if(row.line_message_id!==null)throw new Error('TURN_SOURCE_MISMATCH');
  return {inboxId:null,jobId:owner.id};
 }
 const inbox=(await client.query("select payload_encrypted,user_hash from private.webhook_inbox where id=$1 and channel='STUDENT' for share",[row.source_event_id])).rows[0];
 if(!inbox||inbox.user_hash!==row.user_hash)throw new Error('TURN_SOURCE_MISMATCH');
 const event=userEventSchema.safeParse(JSON.parse(decryptValue(inbox.payload_encrypted,key)));
 if(!event.success||event.data.type!=='message'||event.data.message.type!=='text'||
  event.data.message.id!==row.line_message_id||event.data.message.text!==row.content||hashLineUserId(event.data.source.userId,key)!==row.user_hash)throw new Error('TURN_SOURCE_MISMATCH');
 return {inboxId:row.source_event_id,jobId:null};
}

export const ASSISTANT_TURN_ATTEMPT_LIMIT=6;
export function createDurableTurnBudget(pool:Pool,owner:Owner,key:string,options:{limit?:number;reservedSlots?:number}={}) {
 if(!['INBOX','AI'].includes(owner.kind)||!z.uuid().safeParse(owner.id).success||!z.uuid().safeParse(owner.leaseToken).success)throw new Error('TURN_OWNER_INVALID');
 const limit=options.limit??4,reservedSlots=options.reservedSlots??0;
 if(!Number.isInteger(limit)||limit<1||limit>ASSISTANT_TURN_ATTEMPT_LIMIT||!Number.isInteger(reservedSlots)||reservedSlots<0||reservedSlots>=limit)throw new Error('TURN_BUDGET_INVALID');
 const binding={...owner};let used=0;
 async function access(model:AIModelConfig,reserve:boolean):Promise<string|null>{
  const revisions=[model.providerRevision,model.modelRevision,model.providerNetworkRevision??0,model.modelNetworkRevision??0];
  if(!z.uuid().safeParse(model.id).success||!z.uuid().safeParse(model.providerId).success||revisions.some(n=>!Number.isInteger(n)||n<0||n>2147483647))throw new Error('TURN_MODEL_INVALID');
  return transaction(async client=>{
   await client.query("set local statement_timeout='3s';set local lock_timeout='2s'");
   const source=await ownedSource(client,binding,key);
   await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`ai-turn:${source.inboxId??source.jobId}`]);
   // The owner row stays locked, but its lease can expire while the source lock waits.
   const fresh=await client.query(binding.kind==='INBOX'
    ?"select 1 from private.webhook_inbox where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()"
    :"select 1 from private.ai_jobs where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()",
   [binding.id,binding.leaseToken]);
   if(fresh.rowCount!==1)throw new Error('TURN_OWNER_STALE');
   const rows=(await client.query('select provider_id,model_id,provider_revision,model_revision,provider_network_revision,model_network_revision,status from private.ai_turn_attempts where inbox_id=$1 or ai_job_id=$2',[source.inboxId,source.jobId])).rows;
   used=rows.length;
   if(used>=limit-reservedSlots||rows.some(row=>row.provider_id===model.providerId&&row.model_id===model.id&&
    row.provider_revision===revisions[0]&&row.model_revision===revisions[1]&&row.provider_network_revision===revisions[2]&&row.model_network_revision===revisions[3]&&row.status!=='SUCCESS'))return null;
   if(!reserve)return 'AVAILABLE';
   const saved=(await client.query(`insert into private.ai_turn_attempts(inbox_id,ai_job_id,provider_id,model_id,provider_revision,model_revision,provider_network_revision,model_network_revision)
    values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[source.inboxId,source.jobId,model.providerId,model.id,...revisions])).rows[0];used++;
   return saved.id as string;
  },pool);
 }
 return {get used(){return used;},canAttempt:async(model:AIModelConfig)=>Boolean(await access(model,false)),reserve:async(model:AIModelConfig)=>{
  const id=await access(model,true);if(!id)return null;
  const attempt:TurnAttempt={finish:async(error?:AIErrorCode)=>{
   const query={text:"update private.ai_turn_attempts set status=$2,error_code=$3,finished_at=clock_timestamp() where id=$1 and status='RESERVED'",values:[id,error?'FAILED':'SUCCESS',error??null],query_timeout:3000};
   await pool.query(query);
  }};
  return attempt;
 }};
}
