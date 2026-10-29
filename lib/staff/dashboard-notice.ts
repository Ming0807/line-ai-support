import type {DbClient} from '../tickets/authorization';
import {enqueueOutbound} from '../queue/outbox';
import {guardStaffChatDelivery,type StaffChatActor} from './line-case-context';
import {staffDashboardLink} from './dashboard-link';

/** Case notices retain dispatch scope; generic guidance contains no case information. */
export async function queueStaffDashboardNotice(c:DbClient,staff:StaffChatActor,eventId:string,text:string,key:string,ticketId?:string):Promise<void>{
 const link=staffDashboardLink(ticketId);
 const outbox=await enqueueOutbound(c,{idempotencyKey:`staff-chat:${eventId}`,channel:'STAFF',
  kind:ticketId?'NOTIFICATION':'CONTROL',recipientStaffId:staff.id,...(ticketId?{ticketId}:{}),
  messages:[{type:'text',text:text+(link?'\n'+link:''),...(link?{quickReply:{items:[{type:'action',action:{type:'uri',
   label:ticketId?'เปิดห้องแชต':'เปิด Dashboard',uri:link}}]}}:{})}]},key);
 if(outbox&&!ticketId)await guardStaffChatDelivery(c,outbox,staff,[],'CONTROL');
}
