import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {getDatabasePool,transaction} from '../database/pool';
import {loadActor,authorizeScope,lockConversation,TicketError} from '../tickets/authorization';
import {getTicketDetail} from '../tickets/reads';
import {decryptValue,encryptValue} from '../security/identity';
import {readChatInputSchema,noteChatInputSchema,type InboxQuery,type ThreadQuery} from './contracts';
import type {InboxListResult,InboxThreadResult,ChatMessage,ChatNote} from '../../types/inbox';
import type {TicketListItem} from '../../types/tickets';

type Options={pool?:Pool;key?:string};
const seq=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error('INBOX_SEQUENCE_INVALID');return n;};
const stamp=(value:Date|string)=>new Date(value).toISOString();
const ticketSelect=`select t.id,t.ticket_no,t.department_id,d.name_th department_name,t.category,t.problem_summary,t.priority,t.status,t.mode,
 t.sensitive_level,t.assigned_staff_id,s.display_name assignee_name,t.revision,t.created_at,t.updated_at,l.anonymous_code
 from public.tickets t join public.departments d on d.id=t.department_id join public.line_sessions l on l.id=t.line_session_id
 left join public.staff_profiles s on s.id=t.assigned_staff_id`;
const unreadSql=`(select count(*)::int from private.inbox_message_order mo join public.messages mm on mm.id=mo.message_id
 where mo.ticket_id=t.id and mm.sender_type='USER' and mo.message_seq>coalesce((select cr.read_through_seq
 from private.inbox_read_cursors cr where cr.ticket_id=t.id and cr.staff_id=$1),0))`;

/** Same active actor/scope rules as ticket reads, including totals before pagination. */
export async function listInbox(staffId:string,query:InboxQuery,options:Options={}):Promise<InboxListResult>{
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s';set local lock_timeout='2s'");await loadActor(c,staffId);
  const params:unknown[]=[staffId],conditions=['private.can_access_scope(t.department_id,t.sensitive_level)'];
  for(const [key,column] of Object.entries({department:'department_id',status:'status',priority:'priority',assignee:'assigned_staff_id',sensitivity:'sensitive_level',category:'category'})){
   const value=query[key as keyof InboxQuery];if(value!==undefined){params.push(value);conditions.push(`t.${column}=$${params.length}`);}
  }
  if(query.view==='mine')conditions.push('t.assigned_staff_id=$1');
  if(query.view==='unassigned')conditions.push('t.assigned_staff_id is null');
  if(query.view==='waiting_staff')conditions.push("t.status in('WAITING_STAFF','STAFF_HANDLING')");
  if(query.view==='waiting_user')conditions.push("t.status='WAITING_USER'");
  if(query.view==='unread')conditions.push(`${unreadSql}>0`);
  if(query.from){params.push(query.from);conditions.push(`t.created_at>=$${params.length}::date::timestamp at time zone 'Asia/Bangkok'`);}
  if(query.to){params.push(query.to);conditions.push(`t.created_at<($${params.length}::date+1)::timestamp at time zone 'Asia/Bangkok'`);}
  if(query.q){params.push('%'+query.q.replace(/[!%_]/gu,v=>'!'+v)+'%');const p='$'+params.length;
   conditions.push(`(t.ticket_no ilike ${p} escape '!' or t.problem_summary ilike ${p} escape '!' or t.category ilike ${p} escape '!' or l.anonymous_code ilike ${p} escape '!')`);}
  const page=query.page??1,pageSize=query.pageSize??25;
  params.push(pageSize,(page-1)*pageSize);
  const rows=(await c.query(`with matching as materialized(${ticketSelect},lateral(select ${unreadSql} unread_count) uc
   where ${conditions.join(' and ')}),totals as(select count(*)::text total from matching)
   select p.*,totals.total from totals left join lateral(select * from matching order by updated_at desc,id limit $${params.length-1} offset $${params.length})p on true
   order by p.updated_at desc,p.id`,params)).rows;
  const total=seq(rows[0]?.total??0),unreadCounts:Record<string,number>={};
  // The lateral count is intentionally selected separately in this bounded page.
  const tickets:TicketListItem[]=rows.filter(r=>r.id).map(({total:ignored,...r})=>{void ignored;return {...r,created_at:stamp(r.created_at),updated_at:stamp(r.updated_at)};});
  if(tickets.length){const counts=(await c.query(`select t.id,${unreadSql} unread_count from public.tickets t where t.id=any($2::uuid[])
   and private.can_access_scope(t.department_id,t.sensitive_level)`,[staffId,tickets.map(t=>t.id)])).rows;for(const row of counts)unreadCounts[row.id]=seq(row.unread_count);}
  const departments=(await c.query("select id,code,name_th from public.departments where active and private.can_access_scope(id,'GENERAL') order by code")).rows;
  const assignees=(await c.query(`select s.id,s.display_name from public.staff_profiles s where s.active and
   (s.id=$1 or s.role='SUPER_ADMIN' or private.can_access_scope(s.department_id,'GENERAL')) order by s.display_name`,[staffId])).rows;
  const categories=(await c.query('select distinct category from public.tickets where private.can_access_scope(department_id,sensitive_level) order by category')).rows.map(r=>r.category);
  return {tickets,unreadCounts,departments,assignees,categories,pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize),hasNext:page*pageSize<total,hasPrevious:page>1}};
 },options.pool??getDatabasePool());
}

const deliverySql=`coalesce((select o.status from private.message_outbox o where o.channel='STUDENT'
 and o.line_session_id=(select cc.line_session_id from public.conversations cc where cc.id=m.conversation_id)
 and ((m.sender_type='STAFF' and o.kind='STAFF' and o.ticket_id=m.ticket_id and o.conversation_id=m.conversation_id
   and o.idempotency_key='staff-reply:'||m.ticket_id::text||':'||m.id::text)
  or(m.sender_type='AI' and o.kind='AI' and o.conversation_id=m.conversation_id and o.idempotency_key='ai-job:'||(m.metadata->>'ai_job_id')))
 order by o.created_at desc,o.id desc limit 1),
 (select o.status from private.incident_reply_cases bc join private.incident_reply_recipients br on br.id=bc.recipient_id and br.batch_id=bc.batch_id
 join private.message_outbox o on o.id=br.outbox_id where bc.staff_message_id=m.id and bc.ticket_id=m.ticket_id
 and bc.conversation_id=m.conversation_id and br.line_session_id=(select cc.line_session_id from public.conversations cc where cc.id=m.conversation_id)
 and o.line_session_id=br.line_session_id and o.kind='BATCH' and o.channel='STUDENT' limit 1))`;

export async function readThread(staffId:string,ticketId:string,query:Partial<ThreadQuery>={},options:Options={}):Promise<InboxThreadResult>{
 const pool=options.pool??getDatabasePool();
 return transaction(async c=>{
  await lockedTicket(c,staffId,ticketId);
  const detail=await getTicketDetail(staffId,ticketId,{client:c,includeMessages:false});if(!detail)throw new TicketError('NOT_FOUND');
  const ticket=(await c.query('select department_id,sensitive_level from public.tickets where id=$1',[ticketId])).rows[0];if(!ticket)throw new TicketError('NOT_FOUND');
  await authorizeScope(c,ticket.department_id,ticket.sensitive_level);
  const limit=query.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw new TicketError('INVALID_REQUEST');
  const before=query.beforeSequence;if(before!==undefined&&(!Number.isSafeInteger(before)||before<=0))throw new TicketError('INVALID_REQUEST');
  const rows=(await c.query(`select m.id,mo.message_seq,m.sender_type,m.content,m.created_at,s.display_name staff_name,${deliverySql} delivery_status
   from private.inbox_message_order mo join public.messages m on m.id=mo.message_id and m.ticket_id=mo.ticket_id and m.conversation_id=mo.conversation_id
   left join public.staff_profiles s on s.id=m.sender_staff_id where mo.ticket_id=$1 and ($2::bigint is null or mo.message_seq<$2)
   order by mo.message_seq desc limit $3`,[ticketId,before??null,limit+1])).rows;
  const hasMore=rows.length>limit,selected=rows.slice(0,limit).reverse();
  const messages:ChatMessage[]=selected.map(r=>({id:r.id,sequence:seq(r.message_seq),senderType:r.sender_type,staffName:r.staff_name??null,
   content:r.content,createdAt:stamp(r.created_at),deliveryStatus:r.delivery_status??null,attachments:[]}));
  const latestSequence=seq((await c.query('select coalesce(max(message_seq),0) n from private.inbox_message_order where ticket_id=$1',[ticketId])).rows[0].n);
  const readThroughSequence=seq((await c.query('select read_through_seq from private.inbox_read_cursors where staff_id=$1 and ticket_id=$2',[staffId,ticketId])).rows[0]?.read_through_seq??0);
  const noteRows=(await c.query(`select n.id,n.content_encrypted,n.created_at,s.display_name from private.inbox_notes n join public.staff_profiles s on s.id=n.staff_id
   where n.ticket_id=$1 order by n.created_at,n.id limit 100`,[ticketId])).rows;
  const key=options.key??process.env.ENCRYPTION_KEY;
  const notes:ChatNote[]=noteRows.map(r=>{if(!key)throw new Error('ENCRYPTION_NOT_CONFIGURED');return {id:r.id,text:decryptValue(r.content_encrypted,key),staffName:r.display_name,createdAt:stamp(r.created_at)};});
  return {detail,messages,notes,latestSequence,readThroughSequence,hasMore,nextBefore:hasMore?messages[0]?.sequence??null:null};
 },pool);
}

async function lockedTicket(c:PoolClient,staffId:string,ticketId:string){
 await loadActor(c,staffId);const ref=(await c.query('select conversation_id from public.tickets where id=$1',[ticketId])).rows[0];if(!ref)throw new TicketError('NOT_FOUND');
 await lockConversation(c,ref.conversation_id);const row=(await c.query('select department_id,sensitive_level from public.tickets where id=$1 for share',[ticketId])).rows[0];
 if(!row)throw new TicketError('NOT_FOUND');await authorizeScope(c,row.department_id,row.sensitive_level);
}
export async function acknowledgeRead(staffId:string,ticketId:string,throughSequence:number,options:Options={}){
 readChatInputSchema.parse({throughSequence});
 return transaction(async c=>{
  await lockedTicket(c,staffId,ticketId);
  if(throughSequence!==0&&!(await c.query('select message_id from private.inbox_message_order where ticket_id=$1 and message_seq=$2',[ticketId,throughSequence])).rowCount)throw new TicketError('INVALID_REQUEST');
  const row=(await c.query(`insert into private.inbox_read_cursors(staff_id,ticket_id,read_through_seq)values($1,$2,$3)
   on conflict(staff_id,ticket_id)do update set read_through_seq=greatest(private.inbox_read_cursors.read_through_seq,excluded.read_through_seq)
   returning read_through_seq`,[staffId,ticketId,throughSequence])).rows[0];return {readThroughSequence:seq(row.read_through_seq)};
 },options.pool??getDatabasePool());
}
export async function addInternalNote(staffId:string,ticketId:string,input:{text:string;requestId:string},options:Options={}):Promise<ChatNote>{
 const parsed=noteChatInputSchema.parse(input),key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new Error('ENCRYPTION_NOT_CONFIGURED');
 const hash=createHash('sha256').update(parsed.text).digest('hex');
 return transaction(async c=>{
  await lockedTicket(c,staffId,ticketId);
  const previous=(await c.query('select id,payload_hash,content_encrypted,created_at from private.inbox_notes where staff_id=$1 and ticket_id=$2 and request_id=$3',[staffId,ticketId,parsed.requestId])).rows[0];
  if(previous&&previous.payload_hash!==hash)throw new TicketError('CONFLICT');
  const row=previous??(await c.query(`insert into private.inbox_notes(ticket_id,staff_id,request_id,payload_hash,content_encrypted)
   values($1,$2,$3,$4,$5) returning id,created_at`,[ticketId,staffId,parsed.requestId,hash,encryptValue(parsed.text,key)])).rows[0];
  const staff=(await c.query('select display_name from public.staff_profiles where id=$1',[staffId])).rows[0];
  return {id:row.id,text:parsed.text,staffName:staff.display_name,createdAt:stamp(row.created_at)};
 },options.pool??getDatabasePool());
}
