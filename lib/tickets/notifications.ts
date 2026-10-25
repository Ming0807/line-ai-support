import {randomBytes} from 'node:crypto';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {enqueueOutbound} from '../queue/outbox';
import {eligibleScopeSql,loadActor,type DbClient} from './authorization';
import {guardStaffChatDelivery,issueStaffChatCommand,staffChatAccessLock,staffChatMenu,staffCaseLabel,type StaffChatActor} from '../staff/line-case-context';
import {staffChatMessage} from '../staff/line-chat-presentation';
import {captureStaffAlert} from '../incidents/staff-alerts';

export async function notifyTicketStaff(client:DbClient,ticket:{id:string;ticket_no:string;department_id:string;sensitive_level:string;priority:string;revision:number},key:string):Promise<void> {
 if(await captureStaffAlert(client,ticket))return;
 const recipients=await client.query(`select s.id from public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active where ${eligibleScopeSql} order by s.id`,[ticket.department_id,ticket.sensitive_level]);
 for(const recipient of recipients.rows){
  const token=randomBytes(32).toString('base64url');
  await client.query("insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at) values($1,$2,$3,'ACCEPT',$4,clock_timestamp()+interval '30 minutes')",[hashOpaqueToken(token,key,'staff-command'),recipient.id,ticket.id,ticket.revision]);
  const text=ticket.sensitive_level==='GENERAL'?`มีงานใหม่ ${ticket.ticket_no} · ความสำคัญ ${ticket.priority}\nเปิดแดชบอร์ดเพื่อดูรายละเอียด`:'มีงานที่ต้องตรวจสอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ';
  await enqueueOutbound(client,{idempotencyKey:`notification:${ticket.id}:${ticket.revision}:${recipient.id}`,channel:'STAFF',kind:'NOTIFICATION',recipientStaffId:recipient.id,ticketId:ticket.id,
   messages:[{type:'text',text,quickReply:{items:[{type:'action',action:{type:'postback',label:'รับงาน',data:`yru:staff:accept:${token}`}}]}}]},key);
 }
}

/** GENERAL source text can alert the current assignee without changing selected chat. Private bodies stay in Dashboard. */
export async function notifyTicketUserReply(client:DbClient,ticket:{id:string;ticket_no:string;department_id:string;sensitive_level:string;assigned_staff_id:string|null},messageId:string,key:string):Promise<void>{
 await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 const recipients=(await client.query(`select s.id from public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active
  where ${eligibleScopeSql} and ($3::uuid is null or s.id=$3) order by s.id`,[ticket.department_id,ticket.sensitive_level,ticket.assigned_staff_id])).rows;
 const text=ticket.sensitive_level==='GENERAL'?`มีข้อความเพิ่มเติมในงาน ${ticket.ticket_no}\nเปิดแดชบอร์ดเพื่ออ่านและตอบผู้แจ้ง`:'มีข้อความเพิ่มเติมในงานที่คุณรับผิดชอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ';
 for(const recipient of recipients){
  const current=ticket.sensitive_level==='GENERAL'&&ticket.assigned_staff_id===recipient.id?(await client.query(`select t.*,l.anonymous_code,m.content,i.user_hash
   from public.tickets t join public.line_sessions l on l.id=t.line_session_id join public.messages m on m.ticket_id=t.id and m.id=$2 and m.sender_type='USER'
   join private.staff_line_identities i on i.staff_id=t.assigned_staff_id and i.active
   where t.id=$1 and t.assigned_staff_id=$3 and t.sensitive_level='GENERAL' and t.mode='HUMAN' and t.status in('STAFF_HANDLING','WAITING_USER')`,[ticket.id,messageId,recipient.id])).rows[0]:null;
  if(current&&typeof current.content==='string'&&current.content.length<=5000){
   const staff:StaffChatActor={id:recipient.id,bindingHash:current.user_hash,actor:await loadActor(client,recipient.id)};
   const buttons=[await issueStaffChatCommand(client,staff,{action:'OPEN',label:'เปิดคุยเคสนี้',ticket:current},key),...await staffChatMenu(client,staff,key)];
   const outbox=await enqueueOutbound(client,{idempotencyKey:`user-reply:${messageId}:${recipient.id}`,channel:'STAFF',kind:'CHAT',recipientStaffId:recipient.id,ticketId:ticket.id,
    messages:[staffChatMessage(`มีข้อความใหม่ในเคส ${staffCaseLabel(current)}`),staffChatMessage(current.content||'(ไม่มีเนื้อหาข้อความ)'),
     staffChatMessage('ข้อความนี้ยังไม่เปลี่ยนเคสที่คุณกำลังตอบ กดเปิดเคสนี้เมื่อต้องการเปลี่ยนผู้รับ หรืออ่านประวัติทั้งหมดใน Dashboard',buttons)]},key);
   if(outbox)await guardStaffChatDelivery(client,outbox,staff,[current]);
  }else await enqueueOutbound(client,{idempotencyKey:`user-reply:${messageId}:${recipient.id}`,channel:'STAFF',kind:'NOTIFICATION',recipientStaffId:recipient.id,ticketId:ticket.id,messages:[{type:'text',text}]},key);
 }
}
