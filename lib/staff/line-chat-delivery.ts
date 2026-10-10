import type {DbClient} from '../tickets/authorization';
import {eligibleScopeSql} from '../tickets/authorization';
export interface StaffChatDeliveryGuard {staff_id:string;binding_hash:string|null;purpose:'CASE'|'CONTROL'|'QUEUE';cases:{ticket_id:string;assignment_epoch:string;conversation_id:string}[]}
export async function loadStaffChatDeliveryGuard(c:DbClient,outboxId:string):Promise<StaffChatDeliveryGuard|null>{
 const header=(await c.query('select staff_id,binding_hash,purpose from private.staff_chat_delivery_guards where outbox_id=$1',[outboxId])).rows[0];
 if(!header)return null;
 const cases=(await c.query(`select g.ticket_id,g.assignment_epoch,t.conversation_id from private.staff_chat_delivery_cases g
  join public.tickets t on t.id=g.ticket_id where g.outbox_id=$1 order by t.conversation_id,g.ticket_id`,[outboxId])).rows;
 return {...header,cases};
}
/** Called under the shared access and every selected conversation's session lock, outside SQL transactions. */
export async function verifyStaffChatDelivery(c:DbClient,guard:StaffChatDeliveryGuard|null,job:{channel:string;kind:string;recipient_staff_id:string|null;line_session_id:string|null;ticket_id:string|null}):Promise<boolean>{
 if(!guard)return !['CHAT','CONTROL'].includes(job.kind);
 const staff=(await c.query(`select s.id,s.role from public.staff_profiles s where s.id=$1 and s.active and ($2::text is null or exists(
  select 1 from private.staff_line_identities i where i.staff_id=s.id and i.active and i.user_hash=$2))`,[guard.staff_id,guard.binding_hash])).rows[0];
 if(!staff)return false;
 if(job.channel==='STAFF'&&job.recipient_staff_id!==guard.staff_id)return false;
 if(job.kind==='CONTROL'&&(job.channel!=='STAFF'||guard.binding_hash===null||!['CONTROL','QUEUE'].includes(guard.purpose)))return false;
 if(guard.purpose==='CONTROL')return job.kind==='CONTROL'&&guard.cases.length===0;
 if(guard.purpose==='QUEUE'){
  if(job.kind!=='CONTROL')return false;
  for(const member of guard.cases){
   const current=(await c.query('select department_id,sensitive_level,staff_line_epoch from public.tickets where id=$1',[member.ticket_id])).rows[0];
   if(!current||String(current.staff_line_epoch)!==String(member.assignment_epoch)||!(await c.query(`select s.id from public.staff_profiles s where s.id=$3 and ${eligibleScopeSql}`,[current.department_id,current.sensitive_level,guard.staff_id])).rowCount)return false;
  }
  return true;
 }
 if(!guard.cases.length)return false;
 for(const member of guard.cases){
  const ticket=(await c.query(`select t.*,c.mode as conversation_mode,c.status as conversation_status from public.tickets t
   join public.conversations c on c.id=t.conversation_id where t.id=$1`,[member.ticket_id])).rows[0];
  if(!ticket||String(ticket.staff_line_epoch)!==String(member.assignment_epoch)||ticket.mode!=='HUMAN'||ticket.conversation_mode!=='HUMAN'
   ||!['STAFF_HANDLING','WAITING_USER'].includes(ticket.status)||ticket.sensitive_level!=='GENERAL')return false;
  if(job.channel==='STUDENT'&&ticket.line_session_id!==job.line_session_id)return false;
  if(ticket.assigned_staff_id!==guard.staff_id&&(job.channel==='STAFF'||!['SUPERVISOR','ADMIN','SUPER_ADMIN'].includes(staff.role)))return false;
  if(!(await c.query(`select s.id from public.staff_profiles s where s.id=$3 and ${eligibleScopeSql}`,[ticket.department_id,ticket.sensitive_level,guard.staff_id])).rowCount)return false;
 }
 return job.channel!=='STAFF'||guard.cases.some(member=>member.ticket_id===job.ticket_id);
}
