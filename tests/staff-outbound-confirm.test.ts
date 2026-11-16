import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {TicketError} from '../lib/tickets/authorization';
import {readStudentMediaLinkConfig,staffAttachmentMessageText,studentMediaViewerUrl} from '../lib/chat/student-media-link';

const mocks=vi.hoisted(()=>({apiStaffId:vi.fn(),confirm:vi.fn()}));
vi.mock('../lib/tickets/api',async original=>({...await original<typeof import('../lib/tickets/api')>(),apiStaffId:mocks.apiStaffId}));
vi.mock('../lib/chat/staff-outbound-confirm',async original=>({...await original<typeof import('../lib/chat/staff-outbound-confirm')>(),
 confirmStaffOutboundAttachment:mocks.confirm}));
import {staffOutboundConfirmHandler} from '../lib/chat/staff-outbound-confirm-api';

const channelId='1234567890',liffId=`${channelId}-AbCdEfGh`;
const viewerEnv={LINE_STUDENT_MEDIA_VIEWER_ENABLED:'true',LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED:'true',LINE_STUDENT_LOGIN_CHANNEL_ID:channelId,LINE_STUDENT_LIFF_ID:liffId};

describe('CHAT-MEDIA-02F Student viewer link configuration',()=>{
 it('is available only with the 02A viewer gates and a LIFF ID owned by the same Login channel',()=>{
  expect(readStudentMediaLinkConfig(viewerEnv)).toEqual({liffId});
  expect(readStudentMediaLinkConfig({...viewerEnv,LINE_STUDENT_MEDIA_VIEWER_ENABLED:'false'})).toBeNull();
  expect(readStudentMediaLinkConfig({...viewerEnv,LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED:undefined})).toBeNull();
  expect(readStudentMediaLinkConfig({...viewerEnv,LINE_STUDENT_LOGIN_CHANNEL_ID:'1234567891'})).toBeNull();
  for(const bad of ['','1234567890','1234567890-AbCd','1234567890-AbCdEfGh/x','https://liff.line.me/1234567890-AbCdEfGh','1234567890-AbCdEfG!'])
   expect(readStudentMediaLinkConfig({...viewerEnv,LINE_STUDENT_LIFF_ID:bad})).toBeNull();
 });
 it('builds a fixed LIFF viewer link per attachment, never a direct Storage URL',()=>{
  const id=randomUUID();
  expect(studentMediaViewerUrl(liffId,id)).toBe(`https://liff.line.me/${liffId}?attachment=${id}`);
  expect(()=>studentMediaViewerUrl(liffId,'not-a-uuid')).toThrow();
  expect(()=>studentMediaViewerUrl('evil.example/x',id)).toThrow();
 });
 it('describes the file kind and the recipient-only rule without the file name or Storage details',()=>{
  const url=studentMediaViewerUrl(liffId,randomUUID());
  const pdf=staffAttachmentMessageText('application/pdf',url),image=staffAttachmentMessageText('image/png',url);
  expect(pdf).toContain('ไฟล์ PDF');expect(image).toContain('รูปภาพ');
  for(const text of [pdf,image]){expect(text).toContain(url);expect(text).toContain('เฉพาะบัญชี LINE ของคุณ');expect(text).not.toMatch(/supabase|storage|\.yruc/iu);expect(text.length).toBeLessThanOrEqual(5000);}
 });
});

const host='staff.example.edu',staffId=randomUUID(),ticketId=randomUUID(),attachmentId=randomUUID(),requestId=randomUUID(),messageId=randomUUID();
function request(overrides:{body?:unknown;raw?:string;origin?:string|null;path?:string}={}):Request{
 const headers:Record<string,string>={host,'x-forwarded-proto':'https','content-type':'application/json'};
 if(overrides.origin!==null)headers.origin=overrides.origin??`https://${host}`;
 const body=overrides.raw??JSON.stringify(overrides.body??{requestId,revision:7,ticketNo:'YRU-00000042'});
 return new Request(`https://${host}${overrides.path??`/api/chat/tickets/${ticketId}/outbound-attachments/${attachmentId}/confirm`}`,{method:'POST',headers,body});
}

describe('POST /api/chat/tickets/[id]/outbound-attachments/[attachmentId]/confirm',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED','true');vi.stubEnv('DATABASE_URL','postgresql://fixture:fixture@127.0.0.1:1/fixture');vi.stubEnv('ENCRYPTION_KEY',Buffer.alloc(32,3).toString('base64'));
  for(const [name,value] of Object.entries(viewerEnv))vi.stubEnv(name,value);
  mocks.apiStaffId.mockResolvedValue(staffId);
  mocks.confirm.mockResolvedValue({attachmentId,messageId,status:'WAITING_USER',revision:8});
 });
 afterEach(()=>{vi.unstubAllEnvs();});

 it('is hidden unless its own flag is enabled, independent of the upload flag',async()=>{
  vi.stubEnv('CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED','false');vi.stubEnv('CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED','true');
  expect((await staffOutboundConfirmHandler(request(),ticketId,attachmentId)).status).toBe(404);
  expect(mocks.apiStaffId).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('fails closed with 503 when the Student viewer link is not configured, before any database call',async()=>{
  vi.stubEnv('LINE_STUDENT_LIFF_ID','');
  const response=await staffOutboundConfirmHandler(request(),ticketId,attachmentId);
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'UNAVAILABLE'});expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('confirms through the server service with the derived link config and returns no-store JSON',async()=>{
  const response=await staffOutboundConfirmHandler(request(),ticketId,attachmentId);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({attachmentId,messageId,status:'WAITING_USER',revision:8});
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  const [, input,, link]=mocks.confirm.mock.calls[0];
  expect(input).toEqual({staffId,ticketId,attachmentId,requestId,revision:7,ticketNo:'YRU-00000042'});
  expect(link).toEqual({liffId});
 });
 it('rejects cross-origin, unauthenticated, malformed IDs, query strings and client-chosen recipients',async()=>{
  expect((await staffOutboundConfirmHandler(request({origin:'https://evil.example'}),ticketId,attachmentId)).status).toBe(403);
  expect((await staffOutboundConfirmHandler(request({origin:null}),ticketId,attachmentId)).status).toBe(403);
  mocks.apiStaffId.mockResolvedValueOnce(null);
  expect((await staffOutboundConfirmHandler(request(),ticketId,attachmentId)).status).toBe(401);
  expect((await staffOutboundConfirmHandler(request(),'nope',attachmentId)).status).toBe(404);
  expect((await staffOutboundConfirmHandler(request(),ticketId,'nope')).status).toBe(404);
  expect((await staffOutboundConfirmHandler(request({path:`/api/chat/tickets/${ticketId}/outbound-attachments/${attachmentId}/confirm?x=1`}),ticketId,attachmentId)).status).toBe(400);
  for(const body of [{requestId,revision:7},{requestId,revision:-1,ticketNo:'YRU-00000042'},{requestId:'x',revision:7,ticketNo:'YRU-00000042'},
   {requestId,revision:7,ticketNo:'T-1'},{requestId,revision:7,ticketNo:'YRU-00000042',recipientHash:'a'.repeat(64)},{requestId,revision:7,ticketNo:'YRU-00000042',lineSessionId:randomUUID()}])
   expect((await staffOutboundConfirmHandler(request({body}),ticketId,attachmentId)).status).toBe(400);
  expect((await staffOutboundConfirmHandler(request({raw:'{'}),ticketId,attachmentId)).status).toBe(400);
  expect((await staffOutboundConfirmHandler(request({raw:'x'.repeat(5000)}),ticketId,attachmentId)).status).toBe(413);
  expect(mocks.confirm).not.toHaveBeenCalled();
 });
 it('maps authority errors without leaking internals',async()=>{
  const cases:[TicketError['code'],number][]=[['NOT_FOUND',404],['CONFLICT',409],['INVALID_ACTION',409],['INVALID_REQUEST',400]];
  for(const [code,status] of cases){
   mocks.confirm.mockRejectedValueOnce(new TicketError(code));
   const response=await staffOutboundConfirmHandler(request(),ticketId,attachmentId);
   expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
  }
  const spy=vi.spyOn(console,'error').mockImplementation(()=>undefined);
  mocks.confirm.mockRejectedValueOnce(new Error('postgres://secret@db leaked'));
  const response=await staffOutboundConfirmHandler(request(),ticketId,attachmentId);
  expect(response.status).toBe(503);const text=await response.text();expect(text).not.toContain('secret');
  expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');spy.mockRestore();
 });
});
