import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {DirectUserEvent} from '../line/events';
import {hashStaffLineUserId} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {applyTicketAction} from './ticket-service';
import {TicketError,loadActor,lockConversation} from './authorization';
import {type StaffChatActor,type StaffChatTicket} from '../staff/line-case-context';
import {queueStaffDashboardNotice} from '../staff/dashboard-notice';

export async function processStaffCommand(client:Pick<PoolClient,'query'>,event:DirectUserEvent,key:string,source?:{eventId:string;staff:StaffChatActor}):Promise<string|null> {
 const receipt=async(text:string,ticket?:StaffChatTicket)=>{
  if(!source)return;
  await queueStaffDashboardNotice(client,source.staff,source.eventId,text,key,ticket?.id);
 };
 if(event.type!=='postback')return 'UNSUPPORTED_EVENT';
 const token=/^yru:staff:accept:([A-Za-z0-9_-]{43})$/.exec(event.postback.data)?.[1];if(!token)return 'INVALID_STAFF_COMMAND';
 const binding=(await client.query('select i.staff_id from private.staff_line_identities i join public.staff_profiles s on s.id=i.staff_id and s.active where i.user_hash=$1 and i.active',[hashStaffLineUserId(event.source.userId,key)])).rows[0];
 if(!binding)return 'UNBOUND_STAFF';
 const tokenHash=hashOpaqueToken(token,key,'staff-command');
 const reference=(await client.query('select t.conversation_id from private.staff_action_tokens a join public.tickets t on t.id=a.ticket_id where a.token_hash=$1 and a.staff_id=$2 and a.consumed_at is null and a.expires_at>clock_timestamp()',[tokenHash,binding.staff_id])).rows[0];
 if(!reference){await receipt('ตัวเลือกรับเคสนี้หมดอายุหรือถูกใช้แล้วครับ เปิด Dashboard เพื่อดูคิวล่าสุด');return 'INVALID_STAFF_COMMAND';}
 await loadActor(client,binding.staff_id);
 await lockConversation(client,reference.conversation_id);
 const command=(await client.query('select * from private.staff_action_tokens where token_hash=$1 and staff_id=$2 and consumed_at is null and expires_at>clock_timestamp() for update',[tokenHash,binding.staff_id])).rows[0];
 if(!command){await receipt('ตัวเลือกรับเคสนี้หมดอายุหรือถูกใช้แล้วครับ เปิด Dashboard เพื่อดูคิวล่าสุด');return 'INVALID_STAFF_COMMAND';}
 await client.query('savepoint staff_command_action');
 try{
  const consumed=await client.query('update private.staff_action_tokens set consumed_at=clock_timestamp() where token_hash=$1 and consumed_at is null and expires_at>clock_timestamp() returning token_hash',[tokenHash]);
  if(consumed.rowCount!==1){await client.query('release savepoint staff_command_action');return 'INVALID_STAFF_COMMAND';}
  await applyTicketAction(client as PoolClient,binding.staff_id,command.ticket_id,'ACCEPT',{revision:command.expected_revision,requestId:source?.eventId??randomUUID()},key);
  const ticket=(await client.query('select * from public.tickets where id=$1',[command.ticket_id])).rows[0];
  await receipt(ticket.sensitive_level==='GENERAL'?`รับเคส ${ticket.ticket_no} แล้วครับ เปิดห้องแชตใน Dashboard เพื่ออ่านและตอบ`:'รับเคสแล้วครับ กรุณาอ่านและตอบข้อมูลที่จำกัดการเข้าถึงใน Dashboard',ticket);
  await client.query('release savepoint staff_command_action');
  return null;
 }catch(error){await client.query('rollback to savepoint staff_command_action');await client.query('release savepoint staff_command_action');if(error instanceof TicketError){await receipt('เคสนี้มีผู้รับแล้วหรือสถานะเปลี่ยนไปครับ คุณไม่ได้รับเคสซ้ำ เปิด Dashboard เพื่อดูคิวล่าสุด');return 'STAFF_COMMAND_DENIED';}throw error;}
}
