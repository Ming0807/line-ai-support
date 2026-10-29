import type {DirectUserEvent} from '../line/events';
import type {DbClient} from '../tickets/authorization';
import type {InboxJob} from '../queue/process-inbox';
import {persistStaffInboxEvent} from '../queue/staff-inbox';
import {loadStaffChatActor,loadStaffChatTicket} from './line-case-context';
import {processStaffCommand} from '../tickets/staff-command';
import {processStaffCaseEvent} from './line-case-chat';
import {queueStaffDashboardNotice} from './dashboard-notice';
import {hashOpaqueToken} from '../conversation/quick-reply';

/** Staff OA carries notices/actions. A message here can never become a Student reply. */
export async function processStaffNoticeEvent(c:DbClient,job:InboxJob,event:DirectUserEvent,key:string,bindingCompleted=false):Promise<string|null>{
 // Retain the verified revoke/fence implementation; never call its legacy text relay.
 if(event.type==='unfollow')return processStaffCaseEvent(c,job,event,key);
 const intake=event.type==='message'&&!bindingCompleted?await persistStaffInboxEvent(c,job,event,key):null;
 const staff=await loadStaffChatActor(c,event.source.userId,key);if(!staff)return 'UNBOUND_STAFF';
 if(event.type==='postback'&&event.postback.data.startsWith('yru:staff:accept:')){
  return processStaffCommand(c,event,key,{eventId:job.id,staff});
 }
 let ticketId:string|undefined;
 if(event.type==='postback'){
  const token=/^yru:staff:chat:([A-Za-z0-9_-]{43})$/u.exec(event.postback.data)?.[1];
  if(token){
   const command=(await c.query(`select ticket_id,assignment_epoch from private.staff_chat_commands
    where token_hash=$1 and staff_id=$2 and binding_hash=$3 and action='OPEN'
    and consumed_at is null and expires_at>clock_timestamp()`,[hashOpaqueToken(token,key,'staff-chat-command'),staff.id,staff.bindingHash])).rows[0];
   if(command?.ticket_id&&await loadStaffChatTicket(c,staff,command.ticket_id,String(command.assignment_epoch)))ticketId=command.ticket_id;
  }
 }
 const text=bindingCompleted?'เชื่อมบัญชีเจ้าหน้าที่แล้วครับ อ่านและตอบนักศึกษาใน Dashboard ได้เลย'
  :intake==='RATE_LIMITED'?'ส่งข้อความถี่เกินไปครับ เปิด Dashboard เพื่ออ่านและตอบเคสได้เลย'
  :'Staff OA ใช้แจ้งเตือนและรับเคสครับ ข้อความที่พิมพ์ที่นี่จะไม่ส่งถึงนักศึกษา กรุณาเปิดห้องแชตใน Dashboard เพื่ออ่านและตอบ';
 await queueStaffDashboardNotice(c,staff,job.id,text,key,ticketId);
 return bindingCompleted||event.type==='follow'?null:intake??'STAFF_DASHBOARD_ONLY';
}
