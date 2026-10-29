import {beforeEach,describe,it,expect,vi} from 'vitest';
const doubles=vi.hoisted(()=>({actor:vi.fn(),ticket:vi.fn(),notice:vi.fn(),persist:vi.fn(),accept:vi.fn(),unfollow:vi.fn()}));
vi.mock('../lib/staff/line-case-context',()=>({loadStaffChatActor:doubles.actor,loadStaffChatTicket:doubles.ticket}));
vi.mock('../lib/staff/dashboard-notice',()=>({queueStaffDashboardNotice:doubles.notice}));
vi.mock('../lib/queue/staff-inbox',()=>({persistStaffInboxEvent:doubles.persist}));
vi.mock('../lib/tickets/staff-command',()=>({processStaffCommand:doubles.accept}));
vi.mock('../lib/staff/line-case-chat',()=>({processStaffCaseEvent:doubles.unfollow}));
import {processStaffNoticeEvent} from '../lib/staff/line-notifications';
const c={query:vi.fn()},job={id:'00000000-0000-4000-8000-000000000001',channel:'STAFF' as const,lease_token:'lease',payload_encrypted:'encrypted',user_hash:'hash',attempts:1};
const source={type:'user' as const,userId:'U00000000000000000000000000000001'};
const staff={id:'00000000-0000-4000-8000-000000000002',bindingHash:'binding',actor:{active:true}};
const ticketId='00000000-0000-4000-8000-000000000003',openData='yru:staff:chat:'+'a'.repeat(43);
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_BASE_URL','https://helpdesk.example.invalid');c.query.mockResolvedValue({rows:[],rowCount:0});doubles.actor.mockResolvedValue(staff);doubles.ticket.mockResolvedValue(null);doubles.persist.mockResolvedValue(null);doubles.notice.mockResolvedValue(undefined);doubles.accept.mockResolvedValue(null);});
describe('Staff OA notifications-only policy',()=>{
 it('stores typed Staff intake but never relays its text to a Student',async()=>{
  const text='PRIVATE_REPLY_MUST_NOT_BE_SENT';
  expect(await processStaffNoticeEvent(c,job,{type:'message',source,message:{type:'text',id:'message-1',text}},'key')).toBe('STAFF_DASHBOARD_ONLY');
  expect(doubles.persist).toHaveBeenCalledOnce();expect(doubles.accept).not.toHaveBeenCalled();expect(doubles.unfollow).not.toHaveBeenCalled();
  expect(doubles.notice).toHaveBeenCalledWith(c,staff,job.id,expect.any(String),'key',undefined);
  expect(doubles.notice.mock.calls[0]![3]).toContain('เปิดห้องแชตใน Dashboard');expect(doubles.notice.mock.calls[0]![3]).not.toContain(text);
 });
 it.each(['OPEN YRU-00000123','REPLY YRU-00000123 private text','private manual response'])('treats legacy typed command %j as guidance, never a Student reply',async(text)=>{
  expect(await processStaffNoticeEvent(c,job,{type:'message',source,message:{type:'text',id:`legacy-${text}`,text}},'key')).toBe('STAFF_DASHBOARD_ONLY');
  expect(doubles.persist).toHaveBeenCalledOnce();expect(doubles.accept).not.toHaveBeenCalled();expect(doubles.unfollow).not.toHaveBeenCalled();
  expect(doubles.notice).toHaveBeenCalledOnce();expect(doubles.notice.mock.calls[0]![3]).not.toContain(text);expect(doubles.notice.mock.calls[0]![5]).toBeUndefined();
 });
 it.each(['OPEN','REPLY','yru:staff:open:'+'a'.repeat(43)])('does not execute legacy postback %j as a chat command',async(data)=>{
  expect(await processStaffNoticeEvent(c,job,{type:'postback',source,postback:{data}},'key')).toBe('STAFF_DASHBOARD_ONLY');
  expect(doubles.persist).not.toHaveBeenCalled();expect(doubles.accept).not.toHaveBeenCalled();expect(doubles.unfollow).not.toHaveBeenCalled();
  expect(doubles.notice).toHaveBeenCalledOnce();expect(doubles.notice.mock.calls[0]![5]).toBeUndefined();
 });
 it('opens a current, assigned OPEN token only as an exact Dashboard notice link',async()=>{
  c.query.mockResolvedValue({rows:[{ticket_id:ticketId,assignment_epoch:'7'}],rowCount:1});
  doubles.ticket.mockResolvedValue({id:ticketId,staff_line_epoch:'7'});
  await processStaffNoticeEvent(c,job,{type:'postback',source,postback:{data:openData}},'key');
  expect(c.query).toHaveBeenCalledWith(expect.stringContaining("action='OPEN'"),expect.arrayContaining([staff.id,staff.bindingHash]));
  expect(doubles.ticket).toHaveBeenCalledWith(c,staff,ticketId,'7');
  expect(doubles.notice).toHaveBeenCalledWith(c,staff,job.id,expect.any(String),'key',ticketId);
  expect(doubles.accept).not.toHaveBeenCalled();
 });
 it('gives a revoked or stale OPEN token only generic guidance',async()=>{
  c.query.mockResolvedValue({rows:[{ticket_id:ticketId,assignment_epoch:'6'}],rowCount:1});
  doubles.ticket.mockResolvedValue(null);
  await processStaffNoticeEvent(c,job,{type:'postback',source,postback:{data:openData}},'key');
  expect(doubles.ticket).toHaveBeenCalledWith(c,staff,ticketId,'6');
  expect(doubles.notice).toHaveBeenCalledWith(c,staff,job.id,expect.any(String),'key',undefined);
  expect(doubles.notice.mock.calls[0]![3]).not.toContain(ticketId);expect(doubles.accept).not.toHaveBeenCalled();
 });
 it('retains only the scoped atomic ACCEPT action',async()=>{
  await processStaffNoticeEvent(c,job,{type:'postback',source,postback:{data:'yru:staff:accept:'+'a'.repeat(43)}},'key');
  expect(doubles.accept).toHaveBeenCalledOnce();expect(doubles.accept).toHaveBeenCalledWith(c,expect.objectContaining({type:'postback'}),'key',{eventId:job.id,staff});expect(doubles.notice).not.toHaveBeenCalled();
 });
 it('does not expose cases or queue a response for an unbound account',async()=>{
  doubles.actor.mockResolvedValue(null);
  expect(await processStaffNoticeEvent(c,job,{type:'message',source,message:{type:'text',id:'message-2',text:'OPEN YRU-00000123'}},'key')).toBe('UNBOUND_STAFF');
  expect(doubles.notice).not.toHaveBeenCalled();expect(doubles.accept).not.toHaveBeenCalled();
 });
 it('keeps binding completion as generic Dashboard guidance without exposing case data',async()=>{
  await processStaffNoticeEvent(c,job,{type:'message',source,message:{type:'text',id:'message-bind',text:'bind'}},'key',true);
  expect(doubles.notice).toHaveBeenCalledWith(c,staff,job.id,expect.any(String),'key',undefined);
  expect(doubles.notice.mock.calls[0]![3]).toContain('Dashboard');expect(doubles.persist).not.toHaveBeenCalled();expect(doubles.accept).not.toHaveBeenCalled();
 });
 it('preserves verified unfollow revocation without sending a follow-up message',async()=>{
  doubles.unfollow.mockResolvedValue(null);
  await processStaffNoticeEvent(c,job,{type:'unfollow',source},'key');
  expect(doubles.unfollow).toHaveBeenCalledOnce();expect(doubles.actor).not.toHaveBeenCalled();expect(doubles.notice).not.toHaveBeenCalled();
 });
});
