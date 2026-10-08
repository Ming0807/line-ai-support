import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction,getDatabasePool} from '../database/pool';
import {loadActor} from '../tickets/authorization';
import {OperationsError} from './contracts';
import {validateMetricFilters,summarySchema,analyticsSchema,usageSchema,departmentsSchema,settingsStatusSchema,type MetricFilters} from './metrics-contracts';
type Options={pool?:Pool;now?:()=>Date};
const openSql="t.status in ('NEW','AI_HANDLING','WAITING_STAFF','STAFF_HANDLING','WAITING_USER')";
async function start(client:PoolClient,staffId:string,superOnly=false){await client.query("set local statement_timeout='5000ms';set local lock_timeout='2000ms'");const actor=await loadActor(client,staffId);if(superOnly&&actor.role!=='SUPER_ADMIN')throw new OperationsError('FORBIDDEN');return actor;}
function context(input:MetricFilters,options:Options){const filters=validateMetricFilters(input),now=options.now?.()??new Date();if(!Number.isFinite(now.getTime()))throw new OperationsError('UNAVAILABLE');return {filters,now,window:{from:filters.from,to:filters.to,timeZone:'Asia/Bangkok' as const},departmentId:filters.department??null,observedAt:now.toISOString()};}
function safe<T>(schema:z.ZodType<T>,input:unknown){const value=schema.safeParse(input);if(!value.success)throw new OperationsError('UNAVAILABLE');return value.data;}
const scopedSql=`select t.* from public.tickets t where private.can_access_scope(t.department_id,t.sensitive_level) and ($3::uuid is null or t.department_id=$3) and t.created_at<=$4`;
const inWindow=(column:string)=>`${column}>=$1::date::timestamp at time zone 'Asia/Bangkok' and ${column}<($2::date+1)::timestamp at time zone 'Asia/Bangkok' and ${column}<=$4`;
function values(c:ReturnType<typeof context>){return [c.filters.from,c.filters.to,c.departmentId,c.now];}
export async function readOperationsSummary(staffId:string,input:MetricFilters,options:Options={}){
 const c=context(input,options);return transaction(async client=>{
  await start(client,staffId);
  const row=(await client.query(`with scoped as materialized (${scopedSql}),daily as (select (created_at at time zone 'Asia/Bangkok')::date as intake_date,count(*) n from scoped where ${inWindow('created_at')} group by 1),
   days as (select generate_series($1::date,$2::date,interval '1 day')::date as intake_date)
   select (select jsonb_build_object('total',count(*),'open',count(*) filter(where ${openSql}),
   'waitingStaff',count(*) filter(where t.status='WAITING_STAFF'),'handling',count(*) filter(where t.status='STAFF_HANDLING'),'waitingUser',count(*) filter(where t.status='WAITING_USER'),
   'resolved',count(*) filter(where t.status='RESOLVED'),'closed',count(*) filter(where t.status='CLOSED'),'critical',count(*) filter(where ${openSql} and t.priority='CRITICAL'),'high',count(*) filter(where ${openSql} and t.priority='HIGH')) from scoped t) counts,
   (select coalesce(jsonb_agg(jsonb_build_object('date',d.intake_date::text,'count',coalesce(n.n,0)) order by d.intake_date),'[]'::jsonb) from days d left join daily n using(intake_date)) intake`,values(c))).rows[0];
  return safe(summarySchema,{...row,observedAt:c.observedAt,window:c.window,departmentId:c.departmentId});
 },options.pool);
}
export async function readOperationsAnalytics(staffId:string,input:MetricFilters,options:Options={}){
 const c=context(input,options);return transaction(async client=>{
  await start(client,staffId);
  const row=(await client.query(`with scoped as materialized (${scopedSql}),events as (
   select t.created_at,(select min(m.created_at) from public.messages m where m.ticket_id=t.id and m.sender_type='STAFF' and m.created_at>=t.created_at and m.created_at<=$4) response_at,
    (select min(h.created_at) from public.ticket_history h where h.ticket_id=t.id and h.action='RESOLVED' and h.created_at>=t.created_at and h.created_at<=$4) resolved_at from scoped t),
   response as (select extract(epoch from response_at-created_at)::numeric seconds from events where ${inWindow('response_at')}),
   resolution as (select extract(epoch from resolved_at-created_at)::numeric seconds from events where ${inWindow('resolved_at')}),
   distribution as (select t.department_id,d.name_th,count(*) n from scoped t join public.departments d on d.id=t.department_id where ${inWindow('t.created_at')} group by t.department_id,d.name_th)
   select (select jsonb_build_object('samples',count(*),'averageSeconds',avg(seconds)) from response) "firstStaffResponse",
   (select jsonb_build_object('samples',count(*),'averageSeconds',avg(seconds)) from resolution) resolution,
   (select coalesce(jsonb_agg(jsonb_build_object('departmentId',department_id,'departmentName',name_th,'count',n) order by name_th,department_id),'[]'::jsonb) from distribution) distribution`,values(c))).rows[0];
  return safe(analyticsSchema,{...row,observedAt:c.observedAt,window:c.window,departmentId:c.departmentId,aiResolutionRate:null});
 },options.pool);
}
const usageAggregate=`jsonb_build_object('calls',count(*),'success',count(*) filter(where u.status='SUCCESS'),'errors',count(*) filter(where u.status='ERROR'),'fallback',count(*) filter(where u.fallback_used),
 'meanLatencyMs',avg(u.latency_ms),'inputTokens',jsonb_build_object('knownTotal',coalesce(sum(u.input_tokens),0),'unknownCalls',count(*) filter(where u.input_tokens is null)),
 'outputTokens',jsonb_build_object('knownTotal',coalesce(sum(u.output_tokens),0),'unknownCalls',count(*) filter(where u.output_tokens is null)),
 'cost',jsonb_build_object('knownTotal',coalesce(sum(u.estimated_cost),0)::text,'unknownCalls',count(*) filter(where u.estimated_cost is null)))`;
export async function readOperationsUsage(staffId:string,input:MetricFilters,options:Options={}){
 const c=context(input,options);if(c.departmentId!==null)throw new OperationsError('INVALID_REQUEST');return transaction(async client=>{
  await start(client,staffId,true);
  const row=(await client.query(`with matching as materialized (select u.* from private.ai_usage_logs u where u.created_at>=$1::date::timestamp at time zone 'Asia/Bangkok' and u.created_at<($2::date+1)::timestamp at time zone 'Asia/Bangkok' and u.created_at<=$3),
   models as (select p.name "providerName",m.display_name "modelName",${usageAggregate} totals from matching u join private.ai_providers p on p.id=u.provider_id join private.ai_models m on m.id=u.model_id group by p.id,p.name,m.id,m.display_name)
   select (select ${usageAggregate} from matching u) totals,(select coalesce(jsonb_agg(models order by "providerName","modelName"),'[]'::jsonb) from models) models`,[c.filters.from,c.filters.to,c.now])).rows[0];
  return safe(usageSchema,{...row,observedAt:c.observedAt,window:c.window});
 },options.pool);
}
export async function readOperationsDepartments(staffId:string,options:Options={}){
 const now=options.now?.()??new Date();return transaction(async client=>{
  await start(client,staffId);
  const rows=(await client.query(`select d.id,d.code,d.name_th name,
   (select count(*)::int from public.tickets t where t.department_id=d.id and private.can_access_scope(t.department_id,t.sensitive_level) and t.created_at<=$1) "totalTickets",
   (select count(*)::int from public.tickets t where t.department_id=d.id and private.can_access_scope(t.department_id,t.sensitive_level) and t.created_at<=$1 and ${openSql}) "openTickets",
   (select count(*)::int from public.staff_profiles s where s.active and (s.role='SUPER_ADMIN' or s.role in ('STAFF','SUPERVISOR') and s.department_id=d.id or s.role='ADMIN' and exists(select 1 from public.staff_department_grants g where g.staff_id=s.id and g.department_id=d.id))) "activeStaff"
   from public.departments d where d.active and private.can_access_scope(d.id,'GENERAL') order by d.code,d.id`,[now])).rows;
  return safe(departmentsSchema,{observedAt:now.toISOString(),items:rows});
 },options.pool);
}
export async function readOperationsSettings(staffId:string,options:Options={}){
 const pool=options.pool??getDatabasePool();return transaction(async client=>{
  await start(client,staffId,true);const row=(await client.query(`select clock_timestamp() observed_at,
   (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select status,channel,count(*)::int count from private.webhook_inbox group by status,channel) x) inbox,
   (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select status,null::text channel,count(*)::int count from private.ai_jobs group by status) x) ai,
   (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select status,channel,count(*)::int count from private.message_outbox group by status,channel) x) outbox`)).rows[0];
  return safe(settingsStatusSchema,{observedAt:row.observed_at.toISOString(),database:'OBSERVED_OK',pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount},queues:{inbox:row.inbox,ai:row.ai,outbox:row.outbox},workerLiveness:'UNKNOWN',line:{studentConfigured:Boolean(process.env.LINE_STUDENT_CHANNEL_SECRET&&process.env.LINE_STUDENT_CHANNEL_ACCESS_TOKEN),staffConfigured:Boolean(process.env.LINE_STAFF_CHANNEL_SECRET&&process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN)}});
 },pool);
}
