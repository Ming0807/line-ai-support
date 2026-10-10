import type {PoolClient} from 'pg';
import type {DirectUserEvent} from '../line/events';
import type {DbClient} from '../tickets/authorization';
import {applyTicketAction} from '../tickets/ticket-service';
import {TicketError} from '../tickets/authorization';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {processStaffCommand} from '../tickets/staff-command';
import {persistStaffInboxEvent} from '../queue/staff-inbox';
import type {InboxJob} from '../queue/process-inbox';
import {formatStaffCase,formatStaffReceipt,parseStaffChatControl} from './line-chat-presentation';
import {loadStaffChatActor,loadStaffChatTicket,issueStaffChatCommand,staffChatMenu,queueStaffChat,selectStaffChatCase,
 acknowledgeStaffChat,guardStaffChatDelivery,staffCaseLabel,type StaffChatActor,type StaffChatTicket} from './line-case-context';
import {showStaffCaseQueue} from './line-case-queue';
import {selectStaffCaseSnapshot} from './line-case-snapshot';
import {hashStaffLineUserId} from '../security/identity';

function dashboardHint(){
 try{const url=new URL(process.env.APP_BASE_URL??'');if(!url.username&&!url.password&&['https:','http:'].includes(url.protocol))return `\n${url.origin}/tickets`;}
 catch{/* Optional local public URL. */}return '';
}
async function say(c:DbClient,staff:StaffChatActor,eventId:string,text:string,key:string,extra:Awaited<ReturnType<typeof staffChatMenu>>=[],ticket?:StaffChatTicket){
 await queueStaffChat(c,staff,eventId,formatStaffReceipt({text,buttons:[...extra,...await staffChatMenu(c,staff,key)]}),key,ticket);
}
async function openCase(c:DbClient,staff:StaffChatActor,ticket:StaffChatTicket,eventId:string,eventSeq:string,key:string){
 if(ticket.sensitive_level!=='GENERAL'){await say(c,staff,eventId,'เคสนี้มีข้อมูลที่จำกัดการเข้าถึง กรุณาอ่านและตอบใน Dashboard'+dashboardHint(),key);return;}
 const newer=(await c.query('select staff_id from private.staff_line_case_context where staff_id=$1 and source_event_seq>=$2::bigint',[staff.id,eventSeq])).rowCount;
 if(newer){await say(c,staff,eventId,'มีการเลือกเคสจากคำสั่งที่ใหม่กว่านี้แล้วครับ ข้อความนี้ไม่เปลี่ยนผู้รับ เลือกจาก “งานของฉัน” อีกครั้งหากต้องการเปลี่ยนเคส',key);return;}
 const cursor=(await c.query('select read_through_seq from private.staff_chat_read_cursors where staff_id=$1 and ticket_id=$2',[staff.id,ticket.id])).rows[0]?.read_through_seq??'0';
 const pending=(await c.query(`select m.content,o.message_seq from private.staff_chat_message_order o join public.messages m on m.id=o.message_id and m.ticket_id=o.ticket_id and m.sender_type='USER'
  where o.ticket_id=$1 and o.message_seq>$2 order by o.message_seq limit 5`,[ticket.id,cursor])).rows;
 const snapshot=selectStaffCaseSnapshot(staffCaseLabel(ticket),pending,String(cursor)),through=snapshot.readThrough;
 const selection=await selectStaffChatCase(c,staff,ticket,eventSeq,through);
 const buttons=await staffChatMenu(c,staff,key);
 if(BigInt(through)>BigInt(cursor))buttons.unshift(await issueStaffChatCommand(c,staff,{action:'ACK',label:'รับทราบข้อความ',ticket,selectionId:selection,readThrough:through},key));
 buttons.push(await issueStaffChatCommand(c,staff,{action:'RESOLVE',label:'แก้ไขเสร็จ',ticket,selectionId:selection},key));
 await queueStaffChat(c,staff,eventId,formatStaffCase({code:staffCaseLabel(ticket),messages:snapshot.messages,hasOlder:snapshot.hasMore,buttons}),key,ticket);
}
/** Verified ingress only. All effects share the inbox lease transaction; there is no LINE HTTP here. */
export async function processStaffCaseEvent(c:DbClient,job:InboxJob,event:DirectUserEvent,key:string,bindingCompleted=false):Promise<string|null>{
 if(event.type==='unfollow'){
  await c.query('update private.staff_line_identities set active=false where user_hash=$1 and active',[hashStaffLineUserId(event.source.userId,key)]);
  return null;
 }
 const intake=event.type==='message'&&!bindingCompleted?await persistStaffInboxEvent(c,job,event,key):null;
 const staff=await loadStaffChatActor(c,event.source.userId,key);if(!staff)return event.type==='message'?intake:'UNBOUND_STAFF';
 if((await c.query('select id from private.message_outbox where idempotency_key=$1',[`staff-chat:${job.id}`])).rowCount)return null;
 const source=(await c.query('select event_seq from private.webhook_inbox where id=$1 and channel=\'STAFF\'',[job.id])).rows[0];if(!source)throw new Error('STAFF_SOURCE_MISSING');
 const eventSeq=String(source.event_seq);
 if(bindingCompleted){await say(c,staff,job.id,'ผูกบัญชีเจ้าหน้าที่เรียบร้อยครับ เลือก “งานของฉัน” หรือ “คิวฝ่าย” เพื่อเริ่มทำงาน',key);return null;}
 if(event.type==='postback'&&event.postback.data.startsWith('yru:staff:accept:'))return processStaffCommand(c,event,key,{eventId:job.id,staff});
 if(event.type==='message'){
  if(intake){await say(c,staff,job.id,intake==='RATE_LIMITED'?'ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วส่งใหม่ครับ':'ตอนนี้ตอบผ่าน LINE ได้เฉพาะข้อความตัวอักษรครับ กรุณาใช้ Dashboard สำหรับข้อมูลอื่น'+dashboardHint(),key);return intake;}
 }
 let command:{action:string;ticket_id:string|null;assignment_epoch:string|null;selection_id:string|null;read_through_seq:string;page:number}|undefined;
 const control=event.type==='message'&&event.message.type==='text'?parseStaffChatControl(event.message.text):null;
 if(event.type==='postback'){
  const token=/^yru:staff:chat:([A-Za-z0-9_-]{43})$/.exec(event.postback.data)?.[1];
  if(token)command=(await c.query(`update private.staff_chat_commands set consumed_at=clock_timestamp() where token_hash=$1 and staff_id=$2 and binding_hash=$3
   and consumed_at is null and expires_at>clock_timestamp() returning *`,[hashOpaqueToken(token,key,'staff-chat-command'),staff.id,staff.bindingHash])).rows[0];
  if(!command){await say(c,staff,job.id,'ตัวเลือกนี้หมดอายุ ถูกใช้แล้ว หรือสถานะเปลี่ยนไปครับ เลือกงานจากรายการล่าสุดอีกครั้ง',key);return 'STALE_STAFF_CHAT_COMMAND';}
 }
 const action=command?.action??(control==='MY_CASES'?'MINE':control==='DEPARTMENT_QUEUE'?'DEPARTMENT':control==='STOP'?'STOP':null);
 if(action==='MINE'||action==='DEPARTMENT'){await showStaffCaseQueue(c,staff,job.id,action,command?.page??1,key);return null;}
 if(action==='STOP'){
  const changed=await c.query(`update private.staff_line_case_context set expires_at=clock_timestamp(),source_event_seq=$4::bigint where staff_id=$1 and binding_hash=$2
   and ($3::uuid is null or selection_id=$3) and source_event_seq<$4::bigint`,[staff.id,staff.bindingHash,command?.selection_id??null,eventSeq]);
  await say(c,staff,job.id,changed.rowCount?'หยุดคุยเคสที่เลือกแล้วครับ ข้อความถัดไปจะยังไม่ส่งหาใครจนกว่าจะเปิดเคสใหม่':'ตัวเลือกนี้ไม่ได้อยู่ในเคสที่กำลังคุยครับ เลือก “งานของฉัน” เพื่อดูสถานะล่าสุด',key);return null;
 }
 if(command?.ticket_id){
  const ticket=await loadStaffChatTicket(c,staff,command.ticket_id,command.assignment_epoch??undefined);
  if(!ticket){await say(c,staff,job.id,'เคสนี้ไม่ใช่งานที่คุณรับอยู่ หรือถูกย้าย/ปิดแล้วครับ กรุณาเลือกงานล่าสุด',key);return 'STALE_STAFF_CHAT_CASE';}
  if(action==='OPEN'){await openCase(c,staff,ticket,job.id,eventSeq,key);return null;}
  const selected=(await c.query(`select * from private.staff_line_case_context where staff_id=$1 and ticket_id=$2 and binding_hash=$3
   and selection_id=$4 and assignment_epoch=$5 and expires_at>clock_timestamp()`,[staff.id,ticket.id,staff.bindingHash,command.selection_id,ticket.staff_line_epoch])).rows[0];
  if(!selected||ticket.sensitive_level!=='GENERAL'){await say(c,staff,job.id,'เคสที่เลือกเปลี่ยนไปหรือหมดเวลาคุยแล้วครับ กรุณาเปิดเคสอีกครั้ง',key);return 'STALE_STAFF_CHAT_SELECTION';}
  if(action==='ACK'){
   if(BigInt(command.read_through_seq)>BigInt(selected.viewed_through_seq))throw new Error('STAFF_READ_SNAPSHOT_MISMATCH');
   await acknowledgeStaffChat(c,staff,ticket,command.read_through_seq);
   await openCase(c,staff,ticket,job.id,eventSeq,key);return null;
  }
  if(action==='RESOLVE'){
   const confirm=await issueStaffChatCommand(c,staff,{action:'CONFIRM_RESOLVE',label:'ยืนยันแก้ไขเสร็จ',ticket,selectionId:selected.selection_id},key);
   await say(c,staff,job.id,`ยืนยันว่าแก้ไขเคส ${staffCaseLabel(ticket)} เสร็จแล้วใช่ไหมครับ? การยืนยันนี้เปลี่ยนเฉพาะเคสนี้`,key,[confirm],ticket);return null;
  }
  if(action==='CONFIRM_RESOLVE'){
   await applyTicketAction(c as PoolClient,staff.id,ticket.id,'RESOLVE',{revision:ticket.revision,requestId:job.id},key);
   await say(c,staff,job.id,'บันทึกแก้ไขเสร็จสำหรับเคสที่คุณยืนยันแล้วครับ ตรวจประวัติใน Dashboard หรือเลือกงานถัดไปได้เลย',key);return null;
  }
 }
 if(event.type!=='message'||event.message.type!=='text'){await say(c,staff,job.id,'เลือก “งานของฉัน” หรือ “คิวฝ่าย” เพื่อเริ่มทำงานครับ',key);return 'UNSUPPORTED_EVENT';}
 const selected=(await c.query(`select * from private.staff_line_case_context where staff_id=$1 and binding_hash=$2 and expires_at>clock_timestamp()
  and source_event_seq<$3::bigint`,[staff.id,staff.bindingHash,eventSeq])).rows[0];
 const ticket=selected?await loadStaffChatTicket(c,staff,selected.ticket_id,selected.assignment_epoch):null;
 const stillSelected=selected&&(await c.query(`select staff_id from private.staff_line_case_context where staff_id=$1 and selection_id=$2
  and binding_hash=$3 and expires_at>clock_timestamp() and source_event_seq<$4::bigint`,[staff.id,selected.selection_id,staff.bindingHash,eventSeq])).rowCount===1;
 if(!ticket||ticket.sensitive_level!=='GENERAL'||!stillSelected){
  await say(c,staff,job.id,'ข้อความนี้ยังไม่ได้ส่งครับ กรุณาเปิดเคสจาก “งานของฉัน” ก่อน แล้วส่งข้อความอีกครั้ง ข้อความที่พักไว้จะไม่ถูกส่งอัตโนมัติ',key);return 'STAFF_CHAT_NO_CASE';
 }
 await c.query('savepoint staff_chat_reply');
 try{
  await applyTicketAction(c as PoolClient,staff.id,ticket.id,'STAFF_REPLY',{revision:ticket.revision,requestId:job.id,text:event.message.text},key);
  const outbox=(await c.query(`select o.id from private.message_outbox o join public.messages m on o.idempotency_key='staff-reply:'||m.ticket_id::text||':'||m.id::text
   where m.ticket_id=$1 and m.sender_staff_id=$2 order by o.outbox_seq desc limit 1`,[ticket.id,staff.id])).rows[0];
  if(!outbox)throw new Error('STAFF_CHAT_REPLY_OUTBOX_MISSING');
  await guardStaffChatDelivery(c,outbox.id,staff,[ticket]);
  await queueStaffChat(c,staff,job.id,formatStaffReceipt({text:`บันทึกข้อความเพื่อส่งถึง ${staffCaseLabel(ticket)} แล้วครับ\nตรวจสถานะการส่งและประวัติทั้งหมดได้ใน Dashboard`,buttons:await staffChatMenu(c,staff,key)}),key,ticket);
  await c.query('release savepoint staff_chat_reply');return null;
 }catch(e){
  await c.query('rollback to savepoint staff_chat_reply');await c.query('release savepoint staff_chat_reply');
  if(e instanceof TicketError){await say(c,staff,job.id,'ยังส่งข้อความไม่ได้ครับ สถานะเคสเปลี่ยนไปหรือข้อความยาวเกินกำหนด กรุณาตรวจงานล่าสุดแล้วส่งอีกครั้ง',key);return 'STAFF_CHAT_REPLY_DENIED';}throw e;
 }
}
