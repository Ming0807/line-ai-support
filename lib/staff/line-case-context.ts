import {randomBytes,randomUUID} from 'node:crypto';
import type {DbClient} from '../tickets/authorization';
import {loadActor,authorizeScope,lockConversation,TicketError} from '../tickets/authorization';
import {hashStaffLineUserId} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {enqueueOutbound} from '../queue/outbox';
import type {LineMessage} from '../line/delivery';
import type {StaffIdentity} from '../auth/staff';
import type {StaffChatButton} from './line-chat-presentation';

export const staffChatAccessLock='staff-chat:access';
export interface StaffChatActor {id:string;bindingHash:string;actor:StaffIdentity}
export type StaffChatAction='OPEN'|'MINE'|'DEPARTMENT'|'STOP'|'ACK'|'RESOLVE'|'CONFIRM_RESOLVE';
export interface StaffChatTicket {id:string;conversation_id:string;line_session_id:string;ticket_no:string;anonymous_code:string;
 department_id:string;sensitive_level:string;assigned_staff_id:string|null;mode:string;status:string;revision:number;staff_line_epoch:string}
export async function loadStaffChatActor(c:DbClient,userId:string,key:string):Promise<StaffChatActor|null>{
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 const bindingHash=hashStaffLineUserId(userId,key);
 const binding=(await c.query(`select i.staff_id from private.staff_line_identities i join public.staff_profiles s on s.id=i.staff_id and s.active
  where i.user_hash=$1 and i.active`,[bindingHash])).rows[0];
 if(!binding)return null;
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`staff-chat:actor:${binding.staff_id}`]);
 const actor=await loadActor(c,binding.staff_id);
 return {id:binding.staff_id,bindingHash,actor};
}
export async function loadStaffChatTicket(c:DbClient,staff:StaffChatActor,id:string,epoch?:string):Promise<StaffChatTicket|null>{
 const reference=(await c.query('select conversation_id from public.tickets where id=$1',[id])).rows[0];if(!reference)return null;
 await lockConversation(c,reference.conversation_id);
 const row=(await c.query(`select t.*,l.anonymous_code from public.tickets t join public.line_sessions l on l.id=t.line_session_id
  where t.id=$1 for update of t`,[id])).rows[0];
 if(!row)return null;
 try{await authorizeScope(c,row.department_id,row.sensitive_level);}catch(e){if(e instanceof TicketError)return null;throw e;}
 if(epoch!==undefined&&String(row.staff_line_epoch)!==String(epoch))return null;
 if(row.assigned_staff_id!==staff.id||row.mode!=='HUMAN'||!['STAFF_HANDLING','WAITING_USER'].includes(row.status))return null;
 return row;
}
export async function issueStaffChatCommand(c:DbClient,staff:StaffChatActor,input:{action:StaffChatAction;label:string;
 ticket?:StaffChatTicket;selectionId?:string;readThrough?:string;page?:number},key:string):Promise<StaffChatButton>{
 const token=randomBytes(32).toString('base64url');
 await c.query(`insert into private.staff_chat_commands(token_hash,staff_id,binding_hash,ticket_id,action,assignment_epoch,selection_id,read_through_seq,page,expires_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '30 minutes')`,
 [hashOpaqueToken(token,key,'staff-chat-command'),staff.id,staff.bindingHash,input.ticket?.id??null,input.action,input.ticket?.staff_line_epoch??null,
 input.selectionId??null,input.readThrough??'0',input.page??1]);
 return {label:input.label,data:`yru:staff:chat:${token}`};
}
export async function staffChatMenu(c:DbClient,staff:StaffChatActor,key:string):Promise<StaffChatButton[]>{
 const buttons=[await issueStaffChatCommand(c,staff,{action:'MINE',label:'งานของฉัน'},key),await issueStaffChatCommand(c,staff,{action:'DEPARTMENT',label:'คิวฝ่าย'},key)];
 const selected=(await c.query(`select selection_id from private.staff_line_case_context where staff_id=$1 and binding_hash=$2 and expires_at>clock_timestamp()`,[staff.id,staff.bindingHash])).rows[0];
 if(selected)buttons.push(await issueStaffChatCommand(c,staff,{action:'STOP',label:'หยุดคุย',selectionId:selected.selection_id},key));
 return buttons;
}
export async function queueStaffChat(c:DbClient,staff:StaffChatActor,eventId:string,messages:LineMessage[],key:string,ticket?:StaffChatTicket,queueSnapshot?:StaffChatTicket[]):Promise<void>{
 const outbox=await enqueueOutbound(c,{idempotencyKey:`staff-chat:${eventId}`,channel:'STAFF',kind:ticket?'CHAT':'CONTROL',recipientStaffId:staff.id,
  ...(ticket?{ticketId:ticket.id}:{}),messages},key);
 if(outbox)await guardStaffChatDelivery(c,outbox,staff,ticket?[ticket]:queueSnapshot??[],ticket?'CASE':queueSnapshot?'QUEUE':'CONTROL');
}
export async function guardStaffChatDelivery(c:DbClient,outbox:string,staff:StaffChatActor,tickets:StaffChatTicket[],purpose:'CASE'|'CONTROL'|'QUEUE'='CASE'):Promise<void>{
 await c.query(`insert into private.staff_chat_delivery_guards(outbox_id,staff_id,binding_hash,purpose) values($1,$2,$3,$4) on conflict do nothing`,[outbox,staff.id,staff.bindingHash,purpose]);
 for(const ticket of tickets)await c.query(`insert into private.staff_chat_delivery_cases(outbox_id,ticket_id,assignment_epoch) values($1,$2,$3) on conflict do nothing`,[outbox,ticket.id,ticket.staff_line_epoch]);
}
export async function selectStaffChatCase(c:DbClient,staff:StaffChatActor,ticket:StaffChatTicket,eventSeq:string,viewedThrough:string):Promise<string>{
 const selection=randomUUID();
 await c.query(`insert into private.staff_line_case_context(staff_id,ticket_id,assignment_epoch,binding_hash,selection_id,source_event_seq,expires_at,viewed_through_seq)
  values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 minutes',$7) on conflict(staff_id) do update set
  ticket_id=excluded.ticket_id,assignment_epoch=excluded.assignment_epoch,binding_hash=excluded.binding_hash,selection_id=excluded.selection_id,
  source_event_seq=excluded.source_event_seq,expires_at=excluded.expires_at,viewed_through_seq=excluded.viewed_through_seq`,
 [staff.id,ticket.id,ticket.staff_line_epoch,staff.bindingHash,selection,eventSeq,viewedThrough]);
 return selection;
}
export async function acknowledgeStaffChat(c:DbClient,staff:StaffChatActor,ticket:StaffChatTicket,through:string):Promise<void>{
 await c.query(`insert into private.staff_chat_read_cursors(staff_id,ticket_id,read_through_seq) values($1,$2,$3)
  on conflict(staff_id,ticket_id) do update set read_through_seq=greatest(staff_chat_read_cursors.read_through_seq,excluded.read_through_seq)`,[staff.id,ticket.id,through]);
}
export function staffCaseLabel(ticket:StaffChatTicket):string{return `${ticket.ticket_no} / ${ticket.anonymous_code}`.slice(0,100);}
