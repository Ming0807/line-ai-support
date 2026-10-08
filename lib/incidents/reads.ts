import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,isSupervisor} from '../tickets/authorization';
import {IncidentError,incidentConfigSchema,incidentStatusSchema,incidentQuerySchema} from './contracts';
export {incidentQuerySchema,parseIncidentQuery} from './contracts';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../knowledge/embedding-space';
const severity=z.enum(['MEDIUM','HIGH','CRITICAL']);
export const incidentItemSchema=z.strictObject({id:z.uuid(),revision:z.number().int().nonnegative(),title:z.string().max(200),category:z.string().max(100),
 departmentLabel:z.string(),status:incidentStatusSchema,severity,sensitivity:z.enum(['GENERAL','SENSITIVE','RESTRICTED']),
 reportCount:z.number().int().min(2),distinctSessionCount:z.number().int().min(2),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()});
export type IncidentItem=z.infer<typeof incidentItemSchema>;
export const incidentPageSchema=z.strictObject({items:z.array(incidentItemSchema),pagination:z.strictObject({page:z.number().int(),pageSize:z.number().int(),total:z.number().int(),totalPages:z.number().int()})});
export type IncidentPage=z.infer<typeof incidentPageSchema>;
export const incidentDetailSchema=z.strictObject({incident:incidentItemSchema,tickets:z.array(z.strictObject({id:z.uuid(),ticketCode:z.string(),status:z.string(),category:z.string()})),canManage:z.boolean()});
export type IncidentDetail=z.infer<typeof incidentDetailSchema>;
export const incidentRulesViewSchema=z.strictObject({rules:incidentConfigSchema,revision:z.number().int().nonnegative()});
export type IncidentRulesView=z.infer<typeof incidentRulesViewSchema>;
export interface SimilarIssuesView {status:'READY'|'PENDING';items:{id:string;ticketCode:string;status:string;category:string;similarity:number}[]}
export async function listIncidentDepartments(actorId:string,options:{pool?:Pool}={}):Promise<{id:string;name:string}[]>{
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await loadActor(c,actorId);
  return (await c.query("select id,name_th name from public.departments where active and private.can_access_scope(id,'GENERAL') order by name_th,id")).rows;
 },options.pool);
}
export const incidentVisibleSql=`private.can_access_scope(i.department_id,i.sensitive_level)
 and not exists(select 1 from public.incident_tickets hidden join public.tickets t on t.id=hidden.ticket_id
 where hidden.incident_id=i.id and not private.can_access_scope(t.department_id,t.sensitive_level))`;
const selectItem=`i.id,i.revision,i.title,i.category,d.name_th "departmentLabel",i.status,i.severity,i.sensitive_level sensitivity,
 i.report_count "reportCount",i.distinct_session_count "distinctSessionCount",
 to_char(i.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "createdAt",to_char(i.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "updatedAt"`;
export async function listIncidents(actorId:string,query:z.infer<typeof incidentQuerySchema>,options:{pool?:Pool}={}):Promise<IncidentPage>{
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await loadActor(c,actorId);
  const rows=(await c.query(`with eligible as (select ${selectItem} from public.incidents i join public.departments d on d.id=i.department_id
   where ${incidentVisibleSql} and ($1::text is null or i.status=$1) and ($2::text is null or i.severity=$2) and ($3::uuid is null or i.department_id=$3)),
   paged as(select * from eligible order by "createdAt" desc,id limit $4 offset $5)
   select (select count(*)::int from eligible) total,coalesce((select jsonb_agg(to_jsonb(p) order by "createdAt" desc,id) from paged p),'[]'::jsonb) items`,
  [query.status??null,query.severity??null,query.department??null,query.pageSize,(query.page-1)*query.pageSize])).rows[0];
  // JSON aggregation renders timestamps as ISO strings; the strict DTO remains the only public projection.
  return incidentPageSchema.parse({items:rows.items,pagination:{page:query.page,pageSize:query.pageSize,total:rows.total,totalPages:Math.ceil(rows.total/query.pageSize)}});
 },options.pool);
}
export async function getIncident(actorId:string,id:string,options:{pool?:Pool}={}):Promise<IncidentDetail>{
 if(!z.uuid().safeParse(id).success)throw new IncidentError('INVALID_REQUEST');
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");const actor=await loadActor(c,actorId);
  await c.query(`select t.id from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=$1 order by t.id for share of t`,[id]);
  const row=(await c.query(`select ${selectItem} from public.incidents i join public.departments d on d.id=i.department_id where i.id=$1 and ${incidentVisibleSql}`,[id])).rows[0];
  if(!row)throw new IncidentError('NOT_FOUND');
  const tickets=(await c.query(`select t.id,t.ticket_no "ticketCode",t.status,t.category from public.incident_tickets m join public.tickets t on t.id=m.ticket_id
   where m.incident_id=$1 and private.can_access_scope(t.department_id,t.sensitive_level) order by t.created_at,t.id limit 500`,[id])).rows;
  return incidentDetailSchema.parse({incident:row,tickets,canManage:isSupervisor(actor)});
 },options.pool);
}
export async function getIncidentRules(actorId:string,options:{pool?:Pool}={}):Promise<IncidentRulesView>{
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");const actor=await loadActor(c,actorId);if(actor.role!=='SUPER_ADMIN')throw new IncidentError('FORBIDDEN');
  const row=(await c.query('select * from private.incident_rules where id=1')).rows[0];if(!row)throw new IncidentError('UNAVAILABLE');
  return incidentRulesViewSchema.parse({rules:{minReports:row.min_reports,minDistinctSessions:row.min_distinct_sessions,windowMinutes:row.window_minutes,minSimilarity:row.min_similarity},revision:row.revision});
 },options.pool);
}
/** Read staff-visible similarity suggestions; raw messages, identities and vectors never leave the backend. */
export async function getSimilarIssues(actorId:string,ticketId:string,options:{pool?:Pool}={}):Promise<SimilarIssuesView>{
 if(!z.uuid().safeParse(ticketId).success)throw new IncidentError('INVALID_REQUEST');
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await loadActor(c,actorId);
  const anchor=(await c.query(`select t.id from public.tickets t where t.id=$1 and private.can_access_scope(t.department_id,t.sensitive_level) for share`,[ticketId])).rows[0];
  if(!anchor)throw new IncidentError('NOT_FOUND');
  const ready=(await c.query('select ticket_id from private.incident_ticket_vectors v join public.tickets t on t.id=v.ticket_id and t.revision=v.ticket_revision where v.ticket_id=$1 and v.embedding_fingerprint=$2',[ticketId,LOCAL_EMBEDDING_FINGERPRINT])).rowCount;
  if(!ready)return {status:'PENDING',items:[]};
  const items=(await c.query(`select t.id,t.ticket_no "ticketCode",t.status,t.category,1-(v.embedding operator(extensions.<=>) a.embedding) similarity
   from public.tickets base join private.incident_ticket_vectors a on a.ticket_id=base.id and a.ticket_revision=base.revision
   cross join private.incident_rules r join public.tickets t on t.id<>base.id and t.department_id=base.department_id and t.category=base.category
   join private.incident_ticket_vectors v on v.ticket_id=t.id and v.ticket_revision=t.revision and v.embedding_fingerprint=a.embedding_fingerprint
   where base.id=$1 and a.embedding_fingerprint=$2 and r.id=1 and private.can_access_scope(t.department_id,t.sensitive_level)
   and t.status not in ('RESOLVED','CLOSED','CANCELLED') and t.created_at between clock_timestamp()-make_interval(mins=>r.window_minutes) and clock_timestamp()
   and (a.system_code is null or v.system_code is null or a.system_code=v.system_code)
   and (a.location_code is null or v.location_code is null or a.location_code=v.location_code)
   and 1-(v.embedding operator(extensions.<=>) a.embedding)>=r.min_similarity order by similarity desc,t.id limit 10`,[ticketId,LOCAL_EMBEDDING_FINGERPRINT])).rows;
  return {status:'READY',items};
 },options.pool);
}
