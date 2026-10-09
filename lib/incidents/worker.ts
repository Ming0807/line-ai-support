import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {lockConversation} from '../tickets/authorization';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../knowledge/embedding-space';
import {incidentConfigSchema,incidentVectorSchema,IncidentError,type TicketDescriptor} from './contracts';
import {detectIncidentCandidate,canExtendIncident} from './detector';
import {lockIncidentContextCatalog,loadIncidentContextRows,evaluateIncidentContext,persistIncidentContext,authenticateIncidentContext,queueStaleIncidentContexts,incidentEvaluationDayIsCurrent} from './context-state';
interface Job {ticket_id:string;expected_revision:number;lease_token:string;attempts:number}
export const incidentCatalogLock='incident-catalog:v1';
async function leased(c:PoolClient,job:Job){
 const row=(await c.query(`select * from private.incident_detection_jobs where ticket_id=$1 and expected_revision=$2
  and lease_token=$3 and status='PROCESSING' and lease_until>clock_timestamp() for update`,[job.ticket_id,job.expected_revision,job.lease_token])).rows[0];
 if(!row)throw new IncidentError('CONFLICT');return row;
}
function descriptor(row:Record<string,unknown>):TicketDescriptor{
 return {id:row.id as string,revision:row.revision as number,departmentId:row.department_id as string,category:row.category as string,
  systemCode:(row.system_code as string|null)??null,locationCode:(row.location_code as string|null)??null,sensitivity:row.sensitive_level as TicketDescriptor['sensitivity'],
  createdAt:(row.created_at as Date).toISOString(),status:row.status as TicketDescriptor['status'],anonymousSessionKey:row.line_session_id as string,
  vector:JSON.parse(row.embedding as string)};
}
/** Durable claim → committed snapshot → local CPU HTTP → fresh locked state → idempotent membership. */
export async function runIncidentCycle(pool:Pool,options:{embed(text:string):Promise<number[]>;key?:string}):Promise<{claimed:number;detected:number;suppressed:number;failed:number}>{
 const stats={claimed:0,detected:0,suppressed:0,failed:0};let job:Job|undefined;
 try{
  const installed=(await pool.query("select to_regprocedure('private.refresh_incident_context_jobs()') is not null ready")).rows[0]?.ready;
  if(!installed)return {...stats,failed:1};
  await pool.query('select private.refresh_incident_context_jobs()');
  job=(await pool.query('select * from private.claim_incident_detection()')).rows[0];if(!job)return stats;stats.claimed=1;
  const snapshot=(await pool.query(`select t.* from public.tickets t join private.incident_detection_jobs j on j.ticket_id=t.id
   where t.id=$1 and t.revision=$2 and j.lease_token=$3 and j.lease_until>clock_timestamp() and t.status not in ('RESOLVED','CLOSED','CANCELLED')`,[job.ticket_id,job.expected_revision,job.lease_token])).rows[0];
  if(!snapshot){await pool.query("update private.incident_detection_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,last_error_code='CONTEXT_CHANGED' where ticket_id=$1 and lease_token=$2",[job.ticket_id,job.lease_token]);stats.suppressed=1;return stats;}
  const vector=incidentVectorSchema.parse(await options.embed(snapshot.problem_summary));
  stats.detected=await transaction(async c=>{
   await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='2s'");
   const stamp=await lockIncidentContextCatalog(c);if(!stamp)throw new IncidentError('UNAVAILABLE');
   await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[incidentCatalogLock]);
   const rule=(await c.query('select * from private.incident_rules where id=1 for share')).rows[0];
   const config=incidentConfigSchema.parse({minReports:rule.min_reports,minDistinctSessions:rule.min_distinct_sessions,windowMinutes:rule.window_minutes,minSimilarity:rule.min_similarity});
   const available=(await c.query(`select t.*,v.embedding::text,v.system_code,v.location_code,m.incident_id from public.tickets t
    left join private.incident_ticket_vectors v on v.ticket_id=t.id and v.ticket_revision=t.revision and v.embedding_fingerprint=$4
    left join public.incident_tickets m on m.ticket_id=t.id left join public.incidents i on i.id=m.incident_id
    where t.department_id=$1 and t.category=$2 and t.created_at between clock_timestamp()-make_interval(mins=>$3) and clock_timestamp()
    and t.status not in ('RESOLVED','CLOSED','CANCELLED') and (m.incident_id is null or i.status in ('DETECTED','INVESTIGATING','MONITORING'))
    and (v.ticket_id is not null or t.id=$5) order by t.created_at desc,t.id limit 500`,[snapshot.department_id,snapshot.category,config.windowMinutes,LOCAL_EMBEDDING_FINGERPRINT,job!.ticket_id])).rows;
   // Catalog membership is read only AFTER its lock. Include all old members before acquiring sorted ticket locks.
   const incidentIds=[...new Set(available.filter(r=>r.incident_id).map(r=>r.incident_id))];
   const historical=(await c.query(`select t.*,v.embedding::text,v.system_code,v.location_code,m.incident_id
    from public.incident_tickets m join public.tickets t on t.id=m.ticket_id
    left join private.incident_ticket_vectors v on v.ticket_id=t.id and v.ticket_revision=t.revision and v.embedding_fingerprint=$2
    where m.incident_id=any($1::uuid[]) order by t.id limit 501`,[incidentIds,LOCAL_EMBEDDING_FINGERPRINT])).rows;
   // Match existing writers' conversation → ticket → job order; the catalog serializes incident mutations.
   const conversationIds=[...new Set<string>([snapshot.conversation_id,...available.map(r=>r.conversation_id),...historical.map(r=>r.conversation_id)])].sort();
   for(const id of conversationIds)await lockConversation(c,id);
   const ids=[...new Set<string>([job!.ticket_id,...available.map(r=>r.id),...historical.map(r=>r.id)])].sort();
   // UPDATE also serializes supported late immutable-copy insertion through its ticket FK.
   const current=(await c.query('select * from public.tickets where id=any($1::uuid[]) order by id for update',[ids])).rows;
   await leased(c,job!);
   const fresh=current.find(r=>r.id===job!.ticket_id);
   if(!fresh||fresh.revision!==snapshot.revision||fresh.department_id!==snapshot.department_id||fresh.category!==snapshot.category||['RESOLVED','CLOSED','CANCELLED'].includes(fresh.status)){
    await c.query("update private.incident_detection_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,last_error_code='CONTEXT_CHANGED' where ticket_id=$1 and lease_token=$2",[job!.ticket_id,job!.lease_token]);stats.suppressed=1;return 0;
   }
   const contexts=await loadIncidentContextRows(c,ids,fresh.id),anchorContext=contexts.find(row=>row.id===fresh.id);
   if(!anchorContext)throw new IncidentError('CONFLICT');
   const evaluation=await evaluateIncidentContext(c,anchorContext,stamp,options.key??process.env.ENCRYPTION_KEY);
   await leased(c,job!);
   await persistIncidentContext(c,anchorContext,evaluation,stamp);
   if(evaluation.state==='BLOCKED'){
    stats.failed=1;console.error('INCIDENT_CONTEXT_UNAVAILABLE');
    await c.query(`update private.incident_detection_jobs set status=case when attempts>=5 then 'DEAD' else 'PENDING' end,
     available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempts)::integer)),lease_token=null,lease_until=null,
     last_error_code='PROCESSING_FAILED',context_epoch=$3::bigint,context_evaluation_date=$4::date
     where ticket_id=$1 and lease_token=$2`,[job!.ticket_id,job!.lease_token,stamp.epoch,stamp.evaluationDate]);return 0;
   }
   await c.query(`insert into private.incident_ticket_vectors(ticket_id,ticket_revision,embedding,embedding_fingerprint,system_code,location_code)
    values($1,$2,$3::extensions.vector,$4,$5,$6) on conflict(ticket_id) do update set ticket_revision=excluded.ticket_revision,embedding=excluded.embedding,
    embedding_fingerprint=excluded.embedding_fingerprint,system_code=excluded.system_code,location_code=excluded.location_code,captured_at=clock_timestamp()`,
    [fresh.id,fresh.revision,JSON.stringify(vector),LOCAL_EMBEDDING_FINGERPRINT,evaluation.systemKey,evaluation.locationKey]);
   const anchor=descriptor({...fresh,embedding:JSON.stringify(vector),system_code:evaluation.systemKey,location_code:evaluation.locationKey});
   const authenticated=new Map(contexts.filter(row=>row.id!==fresh.id).map(row=>[row.id,authenticateIncidentContext(row,stamp,options.key??process.env.ENCRYPTION_KEY)]));
   await queueStaleIncidentContexts(c,contexts.filter(row=>row.id!==fresh.id&&!authenticated.get(row.id)).map(row=>row.id),stamp);
   const candidates=available.filter(row=>row.id===fresh.id||authenticated.get(row.id)&&current.some(r=>r.id===row.id&&r.revision===row.revision)).map(row=>row.id===fresh.id?anchor:descriptor({...row,...current.find(r=>r.id===row.id)}));
   const now=(await c.query('select clock_timestamp() now')).rows[0].now.toISOString();
   const candidate=detectIncidentCandidate(anchor,candidates,now,config);
   let count=0;
   if(candidate){
    const memberIds=candidate.members.map(m=>m.ticketId),existing=[...new Set(available.filter(r=>memberIds.includes(r.id)&&r.incident_id).map(r=>r.incident_id))];
    // Never silently merge two independently managed incidents.
    const complete=historical.filter(r=>r.incident_id===existing[0]);
    const completeIsFresh=complete.every(row=>row.id===fresh.id||row.embedding&&authenticated.get(row.id)&&current.some(r=>r.id===row.id&&r.revision===row.revision));
    const completeDescriptors=completeIsFresh?complete.map(row=>row.id===fresh.id?anchor:descriptor({...row,...current.find(r=>r.id===row.id)})):[];
    const proposed=candidates.filter(row=>memberIds.includes(row.id));
    if(existing.length<=1&&(!existing.length||(historical.length<=500&&completeIsFresh&&canExtendIncident(completeDescriptors,proposed,config.minSimilarity)))){
     const incidentId=existing[0]??(await c.query(`insert into public.incidents(department_id,title,category,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at)
      select $1,'ปัญหาที่มีหลายคำร้อง: '||$2,$2,$3,$4,$5,$6,min(created_at),max(created_at) from public.tickets where id=any($7::uuid[]) returning id`,
     [fresh.department_id,fresh.category,candidate.severity,candidate.maxSensitivity,candidate.reportCount,candidate.distinctSessionCount,memberIds])).rows[0].id;
     for(const member of candidate.members){
      const inserted=await c.query(`insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,$3,$4)
       on conflict(ticket_id) do update set ticket_revision=excluded.ticket_revision,similarity_score=excluded.similarity_score
       where incident_tickets.incident_id=excluded.incident_id returning ticket_id`,[incidentId,member.ticketId,member.revision,member.cosineSimilarity]);
      if(inserted.rowCount!==1)throw new IncidentError('CONFLICT');
     }
     const totals=(await c.query(`select count(*)::int reports,count(distinct t.line_session_id)::int sessions
      from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=$1`,[incidentId])).rows[0];
     if(totals.reports<config.minReports||totals.sessions<config.minDistinctSessions||totals.reports>500)throw new IncidentError('CONFLICT');
     await c.query(`update public.incidents i set report_count=x.reports,distinct_session_count=x.sessions,
      sensitive_level=case x.sensitivity when 2 then 'RESTRICTED' when 1 then 'SENSITIVE' else 'GENERAL' end,
      first_report_at=x.first_at,last_report_at=x.last_at,revision=i.revision+1,updated_at=clock_timestamp()
      from(select count(*)::int reports,count(distinct t.line_session_id)::int sessions,min(t.created_at) first_at,max(t.created_at) last_at,
       max(case t.sensitive_level when 'RESTRICTED' then 2 when 'SENSITIVE' then 1 else 0 end) sensitivity
       from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=$1) x where i.id=$1`,[incidentId]);count=1;
    }
   }
   const completed=await c.query("update private.incident_detection_jobs set status='DONE',lease_token=null,lease_until=null,last_error_code=null,context_epoch=$3::bigint,context_evaluation_date=$4::date where ticket_id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp() returning ticket_id",
    [job!.ticket_id,job!.lease_token,evaluation.requiresCatalog?stamp.epoch:null,evaluation.requiresCatalog?stamp.evaluationDate:null]);
   if(completed.rowCount!==1)throw new IncidentError('CONFLICT');
   if(!await incidentEvaluationDayIsCurrent(c,stamp))throw new IncidentError('UNAVAILABLE');
   return count;
  },pool);
 }catch(error){
  if(error instanceof IncidentError&&error.code==='CONFLICT'){stats.suppressed=1;return stats;}
  stats.failed=1;console.error('INCIDENT_PROCESSING_FAILED');
  if(job)await pool.query(`update private.incident_detection_jobs set status=case when attempts>=5 then 'DEAD' else 'PENDING' end,
   available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempts)::integer)),lease_token=null,lease_until=null,last_error_code='PROCESSING_FAILED'
   where ticket_id=$1 and lease_token=$2 and status='PROCESSING'`,[job.ticket_id,job.lease_token]).catch(()=>console.error('INCIDENT_RETRY_FAILED'));
 }
 return stats;
}
