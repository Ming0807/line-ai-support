import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {loadActor} from '../tickets/authorization';
import {OperationsError,activityGroups,activityLabels,activityActions,aiCodes,lineCodes,projectActivity,projectLog,makePagination,validateActivityFilters,validateLogFilters,type ActivityFilters,type LogFilters,type ActivityItem,type LogItem,type ReadEnvelope} from './contracts';

// These literals come only from this module's fixed vocabularies, never request data.
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const actionSql=`case ${Object.entries(activityGroups).filter(([,values])=>values.length).map(([action,values])=>`when a.action in (${values.map(literal).join(',')}) then ${literal(action)}`).join(' ')} else 'OTHER' end`;
const actionLabelSql=`case action_code ${activityActions.map(action=>`when ${literal(action)} then ${literal(activityLabels[action])}`).join(' ')} end`;
async function actor(client:PoolClient,staffId:string){await client.query("set local statement_timeout='5000ms';set local lock_timeout='2000ms'");return loadActor(client,staffId);}
const escaped=(value:string)=>'%'+value.replace(/[!%_]/gu,char=>'!'+char)+'%';
function conditions(filters:ActivityFilters|LogFilters,values:unknown[],dateColumn:string){
 values.push(filters.from,filters.to);return [`${dateColumn}>=$${values.length-1}::date::timestamp at time zone 'Asia/Bangkok'`,`${dateColumn}<($${values.length}::date+1)::timestamp at time zone 'Asia/Bangkok'`];
}
function result<T>(rows:(Record<string,unknown>&{matched_count:string})[],filters:ActivityFilters|LogFilters,project:(row:Record<string,unknown>)=>T):ReadEnvelope<T>{
 const total=Number(rows[0]?.matched_count);if(!Number.isSafeInteger(total)||total<0)throw new OperationsError('UNAVAILABLE');
 try{return {items:rows.filter(row=>row.id!==null).map(project),pagination:makePagination(filters.page,filters.pageSize,total),window:{from:filters.from,to:filters.to,timeZone:'Asia/Bangkok'}};}
 catch{throw new OperationsError('UNAVAILABLE');}
}
function pageSql(values:unknown[],filters:ActivityFilters|LogFilters){values.push(filters.pageSize,(filters.page-1)*filters.pageSize);return `totals as (select count(*)::text matched_count from matching)
 select p.*,n.matched_count from totals n left join lateral
 (select * from matching order by created_at desc,id limit $${values.length-1} offset $${values.length}) p on true order by p.created_at desc,p.id`;}

export async function readActivities(staffId:string,input:ActivityFilters,options:{pool?:Pool}={}):Promise<ReadEnvelope<ActivityItem>>{
 const filters=validateActivityFilters(input);
 return transaction(async client=>{
  const staff=await actor(client,staffId);const values:unknown[]=[staff.role==='SUPER_ADMIN'];
  const where=conditions(filters,values,'created_at');
  if(filters.action){values.push(filters.action);where.push(`action_code=$${values.length}`);}
  if(filters.q){values.push(escaped(filters.q));where.push(`(action_label ilike $${values.length} escape '!' or actor_name ilike $${values.length} escape '!' or ticket_code ilike $${values.length} escape '!' or department_label ilike $${values.length} escape '!')`);}
  const query=`with scoped as materialized (
   select a.id,a.created_at,a.action,s.display_name actor_name,t.ticket_no ticket_code,d.name_th department_label,${actionSql} action_code
   from private.activities a left join public.tickets t on t.id=a.ticket_id left join public.departments d on d.id=t.department_id left join public.staff_profiles s on s.id=a.actor_id
   where ($1::boolean or (a.ticket_id is not null and t.id is not null and private.can_access_scope(t.department_id,t.sensitive_level)))
  ), labelled as (select *,${actionLabelSql} action_label from scoped),matching as materialized (select * from labelled where ${where.join(' and ')}),${pageSql(values,filters)}`;
  return result((await client.query(query,values)).rows,filters,projectActivity);
 },options.pool);
}
export async function readLogs(staffId:string,input:LogFilters,options:{pool?:Pool}={}):Promise<ReadEnvelope<LogItem>>{
 const filters=validateLogFilters(input);
 return transaction(async client=>{
  const staff=await actor(client,staffId);if(staff.role!=='SUPER_ADMIN')throw new OperationsError('FORBIDDEN');
  const values:unknown[]=[];const where=conditions(filters,values,'created_at');
  for(const key of ['severity','component','code'] as const){if(filters[key]){values.push(filters[key]);where.push(`${key}=$${values.length}`);}}
  if(filters.q){values.push(escaped(filters.q));where.push(`(code ilike $${values.length} escape '!' or component ilike $${values.length} escape '!')`);}
  const query=`with observations as (
   select 'ai:'||id::text id,created_at,'ai-gateway'::text component,error_type::text error_code,http_status,false accepted from private.ai_errors
   union all select 'line:'||id::text,created_at,'line-delivery',error_code,http_status,accepted from private.delivery_attempts
  ),coded as (select *,case when component='line-delivery' and accepted then 'LINE_DELIVERED'
   when component='ai-gateway' and error_code in (${aiCodes.map(literal).join(',')}) then error_code
   when component='line-delivery' and error_code in (${lineCodes.filter(code=>code!=='LINE_DELIVERED').map(literal).join(',')}) then error_code
   when component='line-delivery' then 'LINE_DELIVERY_FAILED' else 'PROVIDER_UNAVAILABLE' end code from observations),
  labelled as (select *,case when accepted and component='line-delivery' then 'INFO' when http_status=429 or code in ('CANCELLED','REPLY_OUTCOME_UNKNOWN','REPLY_ALREADY_ATTEMPTED') then 'WARN' else 'ERROR' end severity from coded),
  matching as materialized (select * from labelled where ${where.join(' and ')}),${pageSql(values,filters)}`;
  return result((await client.query(query,values)).rows,filters,projectLog);
 },options.pool);
}
