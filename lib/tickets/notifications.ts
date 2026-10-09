import {randomBytes} from 'node:crypto';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {enqueueOutbound} from '../queue/outbox';
import {eligibleScopeSql,type DbClient} from './authorization';

export async function notifyTicketStaff(client:DbClient,ticket:{id:string;ticket_no:string;department_id:string;sensitive_level:string;priority:string;revision:number},key:string):Promise<void> {
 const recipients=await client.query(`select s.id from public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active where ${eligibleScopeSql}`,[ticket.department_id,ticket.sensitive_level]);
 for(const recipient of recipients.rows){
  const token=randomBytes(32).toString('base64url');
  await client.query("insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at) values($1,$2,$3,'ACCEPT',$4,clock_timestamp()+interval '30 minutes')",[hashOpaqueToken(token,key,'staff-command'),recipient.id,ticket.id,ticket.revision]);
  const text=ticket.sensitive_level==='GENERAL'?`มีงานใหม่ ${ticket.ticket_no} · ความสำคัญ ${ticket.priority}\nเปิดแดชบอร์ดเพื่อดูรายละเอียด`:'มีงานที่ต้องตรวจสอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ';
  await enqueueOutbound(client,{idempotencyKey:`notification:${ticket.id}:${ticket.revision}:${recipient.id}`,channel:'STAFF',kind:'NOTIFICATION',recipientStaffId:recipient.id,ticketId:ticket.id,
   messages:[{type:'text',text,quickReply:{items:[{type:'action',action:{type:'postback',label:'รับงาน',data:`yru:staff:accept:${token}`}}]}}]},key);
 }
}

/** Select the current bound assignee; dispatch rechecks access scope before sending. USER text stays in the dashboard. */
export async function notifyTicketUserReply(client:DbClient,ticket:{id:string;ticket_no:string;department_id:string;sensitive_level:string;assigned_staff_id:string|null},messageId:string,key:string):Promise<void>{
 const recipients=(await client.query(`select s.id from public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active
  where ${eligibleScopeSql} and ($3::uuid is null or s.id=$3) order by s.id`,[ticket.department_id,ticket.sensitive_level,ticket.assigned_staff_id])).rows;
 const text=ticket.sensitive_level==='GENERAL'?`มีข้อความเพิ่มเติมในงาน ${ticket.ticket_no}\nเปิดแดชบอร์ดเพื่ออ่านและตอบผู้แจ้ง`:'มีข้อความเพิ่มเติมในงานที่คุณรับผิดชอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ';
 for(const recipient of recipients)await enqueueOutbound(client,{idempotencyKey:`user-reply:${messageId}:${recipient.id}`,channel:'STAFF',kind:'NOTIFICATION',recipientStaffId:recipient.id,ticketId:ticket.id,messages:[{type:'text',text}]},key);
}
