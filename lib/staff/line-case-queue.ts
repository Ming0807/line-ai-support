import {randomBytes} from 'node:crypto';
import type {DbClient} from '../tickets/authorization';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {formatStaffQueue,type StaffQueueRow} from './line-chat-presentation';
import {issueStaffChatCommand,staffChatMenu,queueStaffChat,type StaffChatActor,staffCaseLabel,type StaffChatTicket} from './line-case-context';
export async function staffAcceptButton(c:DbClient,staff:StaffChatActor,ticket:Pick<StaffChatTicket,'id'|'revision'>,key:string,label='รับเคส'){
 const token=randomBytes(32).toString('base64url');
 await c.query(`insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at)
  values($1,$2,$3,'ACCEPT',$4,clock_timestamp()+interval '30 minutes')`,[hashOpaqueToken(token,key,'staff-command'),staff.id,ticket.id,ticket.revision]);
 return {label,data:`yru:staff:accept:${token}`};
}
const statusLabels:Record<string,string>={STAFF_HANDLING:'กำลังดูแล',WAITING_USER:'รอผู้แจ้งตอบ',WAITING_STAFF:'รอรับเคส'};
export async function showStaffCaseQueue(c:DbClient,staff:StaffChatActor,eventId:string,kind:'MINE'|'DEPARTMENT',page:number,key:string){
 const row=(await c.query(`with eligible as(select t.*,l.anonymous_code,
  (select count(*)::int from private.staff_chat_message_order o where o.ticket_id=t.id and o.message_seq>coalesce((
   select r.read_through_seq from private.staff_chat_read_cursors r where r.staff_id=$1 and r.ticket_id=t.id),0)) as pending
  from public.tickets t join public.line_sessions l on l.id=t.line_session_id
  where private.can_access_scope(t.department_id,t.sensitive_level) and t.mode='HUMAN' and
   (($2='MINE' and t.assigned_staff_id=$1 and t.status in('STAFF_HANDLING','WAITING_USER'))
   or ($2='DEPARTMENT' and t.assigned_staff_id is null and t.status='WAITING_STAFF'))),
  paged as(select * from eligible order by case priority when 'CRITICAL' then 0 when 'HIGH' then 1 else 2 end,created_at,id limit 5 offset $3)
  select (select count(*)::int from eligible) total,coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb) items`,[staff.id,kind,(page-1)*5])).rows[0];
 const rows:StaffQueueRow[]=[];
 for(const ticket of row.items as (StaffChatTicket&{pending:number})[]){
  const identifier=ticket.sensitive_level==='GENERAL'?ticket.ticket_no:`เคสจำกัด ${rows.length+1}`;
  const action=kind==='DEPARTMENT'?await staffAcceptButton(c,staff,ticket,key,`รับ ${identifier}`):
   await issueStaffChatCommand(c,staff,{action:'OPEN',label:`เปิด ${identifier}`,ticket},key);
  rows.push({code:staffCaseLabel(ticket),status:statusLabels[ticket.status]??'อยู่ระหว่างดำเนินการ',pendingCount:ticket.pending,privateOnly:ticket.sensitive_level!=='GENERAL',action});
 }
 const buttons=await staffChatMenu(c,staff,key);
 if(page>1)buttons.push(await issueStaffChatCommand(c,staff,{action:kind,label:'หน้าก่อน',page:page-1},key));
 if(page*5<row.total)buttons.push(await issueStaffChatCommand(c,staff,{action:kind,label:'หน้าถัดไป',page:page+1},key));
 await queueStaffChat(c,staff,eventId,formatStaffQueue({title:kind==='MINE'?'งานของฉัน':'คิวฝ่ายที่ยังไม่มีผู้รับ',total:row.total,page,rows,buttons}),key,undefined,row.items);
}
