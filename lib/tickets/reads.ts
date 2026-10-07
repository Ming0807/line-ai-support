import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,authorizeScope,eligibleScopeSql,isSupervisor} from './authorization';
import {ticketFiltersSchema,type TicketFilters,type TicketListItem,type TicketListResult,type TicketDetail} from '../../types/tickets';
import {nextTicketStatus} from '../conversation/state-machine';

const selectTicket=`select t.id,t.ticket_no,t.department_id,d.name_th as department_name,t.category,t.problem_summary,t.priority,t.status,t.mode,t.sensitive_level,t.assigned_staff_id,s.display_name as assignee_name,t.revision,t.created_at,t.updated_at,l.anonymous_code from public.tickets t join public.departments d on d.id=t.department_id join public.line_sessions l on l.id=t.line_session_id left join public.staff_profiles s on s.id=t.assigned_staff_id`;
type TicketRow=Omit<TicketListItem,'created_at'|'updated_at'>&{created_at:Date;updated_at:Date};
const dto=(row:TicketRow):TicketListItem=>({...row,created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()});

export async function listTickets(staffId:string,filters:TicketFilters={},options:{pool?:Pool}={}):Promise<TicketListResult> {
 const parsed=ticketFiltersSchema.parse(filters);
 return transaction(async client=>{
  await client.query("set local statement_timeout='5000ms';set local lock_timeout='2000ms'");
  await loadActor(client,staffId);
  const conditions=['private.can_access_scope(t.department_id,t.sensitive_level)'];const values:unknown[]=[];
  for(const [field,column] of Object.entries({department:'department_id',status:'status',priority:'priority',assignee:'assigned_staff_id',sensitivity:'sensitive_level'})){
   const value=parsed[field as keyof TicketFilters];if(value){values.push(value);conditions.push(`t.${column}=$${values.length}`);}
  }
  if(parsed.from){values.push(parsed.from);conditions.push(`t.created_at>=$${values.length}::date::timestamp at time zone 'Asia/Bangkok'`);}
  if(parsed.to){values.push(parsed.to);conditions.push(`t.created_at<($${values.length}::date+1)::timestamp at time zone 'Asia/Bangkok'`);}
  if(parsed.q){values.push('%'+parsed.q.replace(/[!%_]/gu,value=>'!'+value)+'%');const parameter='$'+values.length;conditions.push(`(t.ticket_no ilike ${parameter} escape '!' or t.problem_summary ilike ${parameter} escape '!' or t.category ilike ${parameter} escape '!' or l.anonymous_code ilike ${parameter} escape '!')`);}
  const page=parsed.page??1,pageSize=parsed.pageSize??100;values.push(pageSize,(page-1)*pageSize);
  const tickets=await client.query<TicketRow&{matched_count:string}>(`with matching as materialized (${selectTicket} where ${conditions.join(' and ')}),
   totals as (select count(*)::text matched_count from matching)
   select p.*,n.matched_count from totals n left join lateral
   (select * from matching order by created_at desc,id limit $${values.length-1} offset $${values.length}) p on true order by p.created_at desc,p.id`,values);
  const total=Number(tickets.rows[0]?.matched_count);if(!Number.isSafeInteger(total)||total<0)throw new Error('TICKET_TOTAL_INVALID');
  const departments=(await client.query("select id,code,name_th from public.departments where active and private.can_access_scope(id,'GENERAL') order by code")).rows;
  const assignees=(await client.query(`select distinct s.id,s.display_name from public.staff_profiles s where s.active and
   (s.role='SUPER_ADMIN' or private.can_access_scope(s.department_id,'GENERAL') or exists(select 1 from public.staff_department_grants g where g.staff_id=s.id and private.can_access_scope(g.department_id,'GENERAL'))) order by s.display_name`)).rows;
  return {tickets:tickets.rows.filter(row=>row.id!==null).map(({matched_count,...row})=>{void matched_count;return dto(row);}),departments,assignees,
   pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize),hasNext:page*pageSize<total,hasPrevious:page>1}};
 },options.pool);
}

export async function getTicketDetail(staffId:string,id:string):Promise<TicketDetail|null> {
 if(!z.uuid().safeParse(id).success)return null;
 return transaction(async client=>{
  const actor=await loadActor(client,staffId);
  const row=(await client.query<TicketRow>(`${selectTicket} where t.id=$1 and private.can_access_scope(t.department_id,t.sensitive_level)`,[id])).rows[0];
  if(!row)return null;await authorizeScope(client,row.department_id,row.sensitive_level);
  const messages=(await client.query(`select m.id,m.sender_type,m.content,m.created_at,s.display_name as staff_name from public.messages m left join public.staff_profiles s on s.id=m.sender_staff_id where m.ticket_id=$1 order by m.created_at,m.id`,[id])).rows.map(m=>({...m,created_at:m.created_at.toISOString()}));
  const history=(await client.query(`select h.id,h.action,h.from_status,h.to_status,h.created_at,s.display_name as actor_name,h.metadata from public.ticket_history h left join public.staff_profiles s on s.id=h.actor_id where h.ticket_id=$1 order by h.history_seq`,[id])).rows.map(h=>({id:h.id,action:h.action,from_status:h.from_status,to_status:h.to_status,created_at:h.created_at.toISOString(),actor_name:h.actor_name,...(typeof h.metadata?.reason==='string'?{reason:h.metadata.reason}:{})}));
  const assignees=(await client.query(`select s.id,s.display_name from public.staff_profiles s where ${eligibleScopeSql} order by s.display_name`,[row.department_id,row.sensitive_level])).rows;
  const deliveries=(await client.query('select status,last_error_code,created_at from private.message_outbox where ticket_id=$1 and channel=\'STUDENT\' order by created_at desc limit 20',[id])).rows.map(d=>({...d,created_at:d.created_at.toISOString()}));
  const manages=row.assigned_staff_id===staffId||isSupervisor(actor),human=row.mode==='HUMAN';
  const allowed=(action:Parameters<typeof nextTicketStatus>[1])=>nextTicketStatus(row.status,action)!==null;
  return {ticket:dto(row),messages,history,assignees,deliveries,permissions:{
   accept:allowed('ACCEPT')&&!row.assigned_staff_id,
   reply:human&&manages&&allowed('STAFF_REPLY'),resolve:human&&manages&&allowed('RESOLVE'),close:human&&manages&&allowed('CLOSE'),
   reassign:human&&isSupervisor(actor)&&allowed('REASSIGN'),reopen:human&&isSupervisor(actor)&&allowed('REOPEN'),
  }};
 });
}
