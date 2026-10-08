import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,isSupervisor} from '../tickets/authorization';
import {IncidentError,incidentStatusSchema,impactVerificationSchema,incidentConfigSchema} from './contracts';
import {readServerEnv} from '../config/env';
import {encryptValue} from '../security/identity';
import {incidentCatalogLock} from './worker';
import {incidentVisibleSql} from './reads';
import {canTransitionIncident,deriveIncidentSeverity} from './severity';
export const incidentActionSchema=z.strictObject({revision:z.number().int().nonnegative(),requestId:z.uuid(),status:incidentStatusSchema,impact:impactVerificationSchema.optional()});
export async function changeIncidentStatus(actorId:string,id:string,input:unknown,options:{pool?:Pool;encryptionKey?:string}={}){
 if(!z.uuid().safeParse(id).success)throw new IncidentError('INVALID_REQUEST');const parsed=incidentActionSchema.safeParse(input);
 if(!parsed.success)throw new IncidentError('INVALID_REQUEST');const action=parsed.data,hash=createHash('sha256').update(JSON.stringify(action)).digest('hex');
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='2s'");await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[incidentCatalogLock]);
  const actor=await loadActor(c,actorId);if(!isSupervisor(actor))throw new IncidentError('FORBIDDEN');
  await c.query(`select t.id from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=$1 order by t.id for share of t`,[id]);
  const row=(await c.query(`select i.* from public.incidents i where i.id=$1 and ${incidentVisibleSql} for update`,[id])).rows[0];if(!row)throw new IncidentError('NOT_FOUND');
  const receipt=(await c.query('select * from private.incident_action_receipts where actor_id=$1 and incident_id=$2 and request_id=$3',[actorId,id,action.requestId])).rows[0];
  if(receipt){if(receipt.payload_hash!==hash)throw new IncidentError('CONFLICT');return {revision:receipt.result_revision,replayed:true};}
  if(row.revision!==action.revision||!canTransitionIncident(row.status,action.status))throw new IncidentError('CONFLICT');
  const level=action.impact?deriveIncidentSeverity(row.distinct_session_count,{campusWide:action.impact.campusWide,criticalService:action.impact.criticalService,confirmedOutage:action.impact.confirmedOutage}):row.severity;
  const key=action.impact?(options.encryptionKey??readServerEnv().encryptionKey):null;
  if(action.impact&&!key)throw new IncidentError('UNAVAILABLE');
  const verification=action.impact?encryptValue(JSON.stringify(action.impact),key!):null;
  const updated=(await c.query(`update public.incidents set status=$2,severity=$3,revision=revision+1,updated_at=clock_timestamp() where id=$1 returning revision`,[id,action.status,level])).rows[0];
  await c.query('insert into private.incident_action_receipts(actor_id,incident_id,request_id,payload_hash,result_revision,impact_verification_encrypted) values($1,$2,$3,$4,$5,$6)',[actorId,id,action.requestId,hash,updated.revision,verification]);
  await c.query(`insert into private.activities(ticket_id,actor_id,action,metadata) select ticket_id,$2,'INCIDENT_STATUS_CHANGED',$3::jsonb
   from public.incident_tickets where incident_id=$1 order by ticket_id limit 1`,[id,actorId,JSON.stringify({from:row.status,to:action.status})]);
  return {revision:updated.revision,replayed:false};
 },options.pool);
}
export const incidentRulesEditSchema=z.strictObject({revision:z.number().int().nonnegative(),rules:incidentConfigSchema});
export async function updateIncidentRules(actorId:string,input:unknown,options:{pool?:Pool}={}){
 const parsed=incidentRulesEditSchema.safeParse(input);if(!parsed.success)throw new IncidentError('INVALID_REQUEST');const {revision,rules}=parsed.data;
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='2s'");await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[incidentCatalogLock]);
  const actor=await loadActor(c,actorId);if(actor.role!=='SUPER_ADMIN')throw new IncidentError('FORBIDDEN');
  const updated=(await c.query(`update private.incident_rules set min_reports=$2,min_distinct_sessions=$3,window_minutes=$4,min_similarity=$5,revision=revision+1,updated_by=$6,updated_at=clock_timestamp() where id=1 and revision=$1 returning revision`,[revision,rules.minReports,rules.minDistinctSessions,rules.windowMinutes,rules.minSimilarity,actorId])).rows[0];
  if(!updated)throw new IncidentError('CONFLICT');
  await c.query(`update private.incident_detection_jobs j set status='PENDING',attempts=0,available_at=clock_timestamp(),lease_token=null,lease_until=null
   from public.tickets t where t.id=j.ticket_id and t.status not in ('RESOLVED','CLOSED','CANCELLED') and j.status in ('DONE','SUPPRESSED','DEAD')`);
  await c.query("insert into private.activities(actor_id,action,metadata) values($1,'INCIDENT_RULES_CHANGED','{}'::jsonb)",[actorId]);return {revision:updated.revision};
 },options.pool);
}
