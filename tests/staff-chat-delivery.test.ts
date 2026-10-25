import {expect,it,vi} from 'vitest';
import {verifyStaffChatDelivery,type StaffChatDeliveryGuard} from '@/lib/staff/line-chat-delivery';
import type {DbClient} from '@/lib/tickets/authorization';
it('fails a fresh conversation mismatch against a previously loaded delivery guard',async()=>{
 const guard:StaffChatDeliveryGuard={staff_id:'staff',binding_hash:null,purpose:'CASE',cases:[{ticket_id:'ticket',assignment_epoch:'1',conversation_id:'frozen-conversation'}]};
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('select s.id,s.role'))return {rows:[{id:'staff',role:'STAFF'}],rowCount:1};
  if(sql.includes('select t.*'))return {rows:[{id:'ticket',conversation_id:'different-conversation',staff_line_epoch:'1',mode:'HUMAN',conversation_mode:'HUMAN',
   status:'WAITING_USER',sensitive_level:'GENERAL',conversation_status:'ACTIVE',active_ticket_id:'ticket',line_session_id:'session',assigned_staff_id:'staff',department_id:'department'}],rowCount:1};
  return {rows:[{id:'staff'}],rowCount:1};
 });
 const client={query} as unknown as DbClient;
 expect(await verifyStaffChatDelivery(client,guard,{kind:'BATCH',channel:'STUDENT',line_session_id:'session',recipient_staff_id:null,ticket_id:'ticket'})).toBe(false);
});
