import type {PoolClient} from 'pg';
import {knowledgeStructuredCatalogLock} from '../knowledge/delivery-fence';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../knowledge/embedding-space';
import {searchStructured} from '../knowledge/structured-search';
import {decodeIncidentSupportSource} from './context-source';
import {planIncidentContext} from './context-resolution';
import {sealIncidentContextProof,openIncidentContextProof} from './context-proof';

export interface IncidentContextStamp {epoch:string;evaluationDate:string}
export interface IncidentContextRow extends Record<string,unknown> {
 id:string;revision:number;conversation_id:string;line_session_id:string;department_id:string;department_code:string;department_active:boolean;
 sensitive_level:'GENERAL'|'SENSITIVE'|'RESTRICTED';status:string;category:string;created_at:Date;
 copy_ticket_id:string|null;copy_conversation_id:string|null;copy_session_id:string|null;source_digest:string|null;state_digest:string|null;context_encrypted:string|null;
 proof_revision:number|null;support_binding_digest:string|null;proof_state:string|null;requires_catalog:boolean|null;catalog_revision:string|null;evaluation_date:string|null;proof_encrypted:string|null;
 vector_revision:number|null;embedding_fingerprint:string|null;system_code:string|null;location_code:string|null;over_budget:boolean;
}
export type IncidentContextEvaluation=
 | {state:'READY';bindingDigest:string|null;encrypted:string|null;requiresCatalog:boolean;systemKey:string|null;locationKey:string|null}
 | {state:'BLOCKED';bindingDigest:string|null;encrypted:null;requiresCatalog:true};
const inactive=new Set(['RESOLVED','CLOSED','CANCELLED']);
const rank={GENERAL:0,SENSITIVE:1,RESTRICTED:2} as const;
const proofBudget=8*1024*1024;
/** Must precede actor, ticket, incident and job row locks. Missing additive infrastructure is unavailable. */
export async function lockIncidentContextCatalog(c:PoolClient):Promise<IncidentContextStamp|null>{
 const installed=(await c.query("select to_regclass('private.structured_selection_epoch') is not null and to_regclass('private.incident_context_proofs') is not null and to_regprocedure('private.refresh_incident_context_jobs()') is not null ready")).rows[0]?.ready;
 if(!installed)return null;
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
 const row=(await c.query("select revision::text epoch,(clock_timestamp() at time zone 'Asia/Bangkok')::date::text \"evaluationDate\" from private.structured_selection_epoch where id=1")).rows[0];
 return row??null;
}
export async function incidentEvaluationDayIsCurrent(c:PoolClient,stamp:IncidentContextStamp):Promise<boolean>{
 return (await c.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date=$1::date current",[stamp.evaluationDate])).rows[0]?.current===true;
}
/** One snapshot includes vector, current copy and sidecar. SQL bounds the materialized encrypted batch. */
export async function loadIncidentContextRows(c:PoolClient,ids:string[],anchorId?:string):Promise<IncidentContextRow[]>{
 if(ids.length>1001)throw new Error('INCIDENT_CONTEXT_BATCH_INVALID');
 if(anchorId!==undefined&&!ids.includes(anchorId))throw new Error('INCIDENT_CONTEXT_BATCH_INVALID');
 return (await c.query<IncidentContextRow>(`with context_rows as (
  select t.*,d.code department_code,d.active department_active,
   s.ticket_id copy_ticket_id,s.conversation_id copy_conversation_id,s.line_session_id copy_session_id,s.source_digest,s.state_digest,s.context_encrypted,
   p.ticket_revision proof_revision,p.support_binding_digest,p.state proof_state,p.requires_catalog,p.catalog_revision::text,p.evaluation_date::text,p.proof_encrypted,
   v.ticket_revision vector_revision,v.embedding_fingerprint,v.system_code,v.location_code,
   sum(coalesce(octet_length(s.context_encrypted),0)+coalesce(octet_length(p.proof_encrypted),0)) over(order by (t.id=$3::uuid) desc nulls last,t.id) proof_bytes
  from public.tickets t join public.departments d on d.id=t.department_id
  left join private.ticket_support_contexts s on s.ticket_id=t.id
  left join private.incident_context_proofs p on p.ticket_id=t.id
  left join private.incident_ticket_vectors v on v.ticket_id=t.id
  where t.id=any($1::uuid[])
 ) select id,revision,conversation_id,line_session_id,department_id,department_code,department_active,sensitive_level,status,category,created_at,
  copy_ticket_id,copy_conversation_id,copy_session_id,source_digest,state_digest,
  case when proof_bytes<=$2 then context_encrypted else null end context_encrypted,
  proof_revision,support_binding_digest,proof_state,requires_catalog,catalog_revision,evaluation_date,
  case when proof_bytes<=$2 then proof_encrypted else null end proof_encrypted,
  vector_revision,embedding_fingerprint,system_code,location_code,proof_bytes>$2 over_budget
 from context_rows order by id`,[ids,proofBudget,anchorId??null])).rows;
}
function ticket(row:IncidentContextRow){return {id:row.id,revision:row.revision,conversationId:row.conversation_id,sessionId:row.line_session_id,
 departmentId:row.department_id,departmentCode:row.department_code,sensitiveLevel:row.sensitive_level};}
function source(row:IncidentContextRow,key?:string){
 return decodeIncidentSupportSource({id:row.id,conversationId:row.conversation_id,sessionId:row.line_session_id,departmentId:row.department_id},
  row.copy_ticket_id===null?null:{ticket_id:row.copy_ticket_id,conversation_id:row.copy_conversation_id,line_session_id:row.copy_session_id,
   source_digest:row.source_digest,state_digest:row.state_digest,context_encrypted:row.context_encrypted},key);
}
/** Only the authorized worker calls exact searches while its shared catalog fence is held. */
export async function evaluateIncidentContext(c:PoolClient,row:IncidentContextRow,stamp:IncidentContextStamp,key?:string):Promise<IncidentContextEvaluation>{
 const decoded=source(row,key),blocked:IncidentContextEvaluation={state:'BLOCKED',bindingDigest:decoded.status==='READY'?decoded.bindingDigest:null,encrypted:null,requiresCatalog:true};
 if(row.over_budget||!row.department_active||inactive.has(row.status)||decoded.status==='UNAVAILABLE')return blocked;
 if(decoded.status==='NO_COPY')return {state:'READY',bindingDigest:null,encrypted:null,requiresCatalog:false,systemKey:null,locationKey:null};
 if(!key||rank[row.sensitive_level]<rank[decoded.retainedSensitivity])return blocked;
 try{
  const plan=planIncidentContext(decoded.claims,row.department_code),results=[];
  for(const attempt of plan.attempts)results.push({slot:attempt.slot,result:await searchStructured(c,attempt,key,stamp.evaluationDate)});
  const sealed=sealIncidentContextProof({ticket:ticket(row),source:decoded,stamp:plan.attempts.length?stamp:null,results},key);
  return {state:'READY',bindingDigest:decoded.bindingDigest,...sealed};
 }catch{return blocked;}
}
export async function persistIncidentContext(c:PoolClient,row:IncidentContextRow,evaluation:IncidentContextEvaluation,stamp:IncidentContextStamp):Promise<void>{
 await c.query(`insert into private.incident_context_proofs(ticket_id,ticket_revision,support_binding_digest,state,requires_catalog,catalog_revision,evaluation_date,proof_encrypted)
  values($1,$2,$3,$4,$5,$6::bigint,$7::date,$8) on conflict(ticket_id) do update set ticket_revision=excluded.ticket_revision,
  support_binding_digest=excluded.support_binding_digest,state=excluded.state,requires_catalog=excluded.requires_catalog,catalog_revision=excluded.catalog_revision,
  evaluation_date=excluded.evaluation_date,proof_encrypted=excluded.proof_encrypted,captured_at=clock_timestamp()`,
 [row.id,row.revision,evaluation.bindingDigest,evaluation.state,evaluation.requiresCatalog,evaluation.requiresCatalog?stamp.epoch:null,
  evaluation.requiresCatalog?stamp.evaluationDate:null,evaluation.encrypted]);
}
/** Authentication is required even for unknown claims. Epoch/day checks alone never authorize stored keys. */
export function authenticateIncidentContext(row:IncidentContextRow,stamp:IncidentContextStamp,key?:string):{systemKey:string|null;locationKey:string|null}|null{
 if(row.over_budget||!row.department_active||row.proof_state!=='READY'||row.proof_revision!==row.revision||row.vector_revision!==row.revision||row.embedding_fingerprint!==LOCAL_EMBEDDING_FINGERPRINT)return null;
 const decoded=source(row,key);if(decoded.status==='UNAVAILABLE')return null;
 if(decoded.status==='NO_COPY')return row.support_binding_digest===null&&row.proof_encrypted===null&&row.requires_catalog===false&&row.catalog_revision===null&&row.evaluation_date===null&&row.system_code===null&&row.location_code===null?{systemKey:null,locationKey:null}:null;
 if(!key||rank[row.sensitive_level]<rank[decoded.retainedSensitivity]||row.support_binding_digest!==decoded.bindingDigest||!row.proof_encrypted)return null;
 try{
  const needs=planIncidentContext(decoded.claims,row.department_code).attempts.length>0;
  if(row.requires_catalog!==needs||(needs?(row.catalog_revision!==stamp.epoch||row.evaluation_date!==stamp.evaluationDate):(row.catalog_revision!==null||row.evaluation_date!==null)))return null;
  const opened=openIncidentContextProof(row.proof_encrypted,{ticket:ticket(row),source:decoded,stamp:needs?stamp:null},key);
  return opened&&opened.systemKey===row.system_code&&opened.locationKey===row.location_code?opened:null;
 }catch{return null;}
}
/** Reads may enqueue stale work once, never reset repeated same-stamp failures or a live processing lease. */
export async function queueStaleIncidentContexts(c:PoolClient,ids:string[],stamp:IncidentContextStamp):Promise<void>{
 if(!ids.length)return;
 await c.query(`with eligible as (
  select j.ticket_id from private.incident_detection_jobs j join public.tickets t on t.id=j.ticket_id
  where j.ticket_id=any($1::uuid[]) and t.status not in ('RESOLVED','CLOSED','CANCELLED')
   and not(j.status='PROCESSING' and j.lease_until>clock_timestamp())
   and (j.status in ('DONE','SUPPRESSED') or j.context_epoch is distinct from $2::bigint or j.context_evaluation_date is distinct from $3::date)
  order by j.ticket_id for update of j skip locked
 ) update private.incident_detection_jobs j set status='PENDING',expected_revision=t.revision,attempts=0,available_at=clock_timestamp(),
  lease_token=null,lease_until=null,last_error_code=null,context_epoch=$2::bigint,context_evaluation_date=$3::date
 from eligible e join public.tickets t on t.id=e.ticket_id where j.ticket_id=e.ticket_id`,[ids,stamp.epoch,stamp.evaluationDate]);
}
