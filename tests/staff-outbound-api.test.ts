import {createHash,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {ChatMediaError,CHAT_MEDIA_MAX_BYTES} from '../lib/chat/media-binary';
import {TicketError} from '../lib/tickets/authorization';

const mocks=vi.hoisted(()=>({apiStaffId:vi.fn(),upload:vi.fn()}));
vi.mock('../lib/tickets/api',async original=>({...await original<typeof import('../lib/tickets/api')>(),apiStaffId:mocks.apiStaffId}));
vi.mock('../lib/chat/staff-outbound-upload',async original=>({...await original<typeof import('../lib/chat/staff-outbound-upload')>(),
 uploadStaffOutboundAttachment:mocks.upload}));
import {staffOutboundUploadHandler} from '../lib/chat/staff-outbound-api';

const host='staff.example.edu',staffId=randomUUID(),ticketId=randomUUID(),requestId=randomUUID(),attachmentId=randomUUID();
const body=new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF\n');
const checksum=createHash('sha256').update(body).digest('hex');

function request(overrides:{headers?:Record<string,string|null>;body?:Uint8Array;path?:string;method?:string}={}):Request{
 const headers:Record<string,string>={origin:`https://${host}`,host,'x-forwarded-proto':'https','content-type':'application/pdf',
  'content-length':String((overrides.body??body).length),'x-yru-request-id':requestId,'x-yru-ticket-revision':'4',
  'x-yru-file-name':encodeURIComponent('คู่มือ ลงทะเบียน.pdf'),'x-yru-content-sha256':checksum};
 for(const [name,value] of Object.entries(overrides.headers??{})){if(value===null)delete headers[name];else headers[name]=value;}
 const payload=overrides.body??body;
 return new Request(`https://${host}${overrides.path??`/api/chat/tickets/${ticketId}/outbound-attachments`}`,
  {method:overrides.method??'POST',headers,body:payload.slice().buffer as ArrayBuffer});
}

beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED','true');
 mocks.apiStaffId.mockResolvedValue(staffId);mocks.upload.mockResolvedValue({status:'READY',attachmentId});
});
afterEach(()=>{vi.unstubAllEnvs();});

it('is hidden unless the server flag is explicitly enabled',async()=>{
 vi.stubEnv('CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED','false');
 const response=await staffOutboundUploadHandler(request(),ticketId);
 expect(response.status).toBe(404);expect(mocks.apiStaffId).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();
});

it('creates a private READY draft from the authenticated Staff request and returns no-store JSON',async()=>{
 const response=await staffOutboundUploadHandler(request(),ticketId);
 expect(response.status).toBe(201);
 expect(await response.json()).toEqual({attachmentId,status:'READY'});
 expect(response.headers.get('cache-control')).toContain('no-store');
 const call=mocks.upload.mock.calls[0][1];
 expect(call).toMatchObject({staffId,ticketId,requestId,revision:4,name:'คู่มือ ลงทะเบียน.pdf',contentType:'application/pdf',declaredChecksum:checksum});
 expect(Array.from(call.bytes as Uint8Array)).toEqual(Array.from(body));
});

it('rejects cross-origin writes and unauthenticated callers before reading the body',async()=>{
 expect((await staffOutboundUploadHandler(request({headers:{origin:'https://evil.example'}}),ticketId)).status).toBe(403);
 mocks.apiStaffId.mockResolvedValueOnce(null);
 expect((await staffOutboundUploadHandler(request(),ticketId)).status).toBe(401);
 expect(mocks.upload).not.toHaveBeenCalled();
});

it('requires exact upload metadata headers and no query string',async()=>{
 for(const headers of [
  {'x-yru-request-id':'not-a-uuid'},{'x-yru-ticket-revision':'-1'},{'x-yru-ticket-revision':'4.5'},{'x-yru-content-sha256':'XYZ'},
  {'x-yru-file-name':null},{'x-yru-file-name':'%E0%A4%A'},{'content-length':null},{'content-length':'abc'},{'content-type':'text/html'},
 ] as Record<string,string|null>[]) expect((await staffOutboundUploadHandler(request({headers}),ticketId)).status,JSON.stringify(headers)).toBe(400);
 expect((await staffOutboundUploadHandler(request({path:`/api/chat/tickets/${ticketId}/outbound-attachments?x=1`}),ticketId)).status).toBe(400);
 expect((await staffOutboundUploadHandler(request(),'not-a-ticket')).status).toBe(404);
 expect(mocks.upload).not.toHaveBeenCalled();
});

it('refuses an oversized declaration and a body whose length differs from Content-Length (proxy truncation)',async()=>{
 expect((await staffOutboundUploadHandler(request({headers:{'content-length':String(CHAT_MEDIA_MAX_BYTES+1)}}),ticketId)).status).toBe(413);
 expect((await staffOutboundUploadHandler(request({headers:{'content-length':String(body.length+5)}}),ticketId)).status).toBe(400);
 expect(mocks.upload).not.toHaveBeenCalled();
});

it('maps validation, conflict, stale lease and unavailable outcomes without leaking details',async()=>{
 const cases:[unknown,number,string][]=[
  [new ChatMediaError('INVALID_ATTACHMENT'),400,'INVALID_ATTACHMENT'],[new ChatMediaError('UNSUPPORTED_TYPE'),400,'UNSUPPORTED_TYPE'],
  [new ChatMediaError('TOO_LARGE'),413,'TOO_LARGE'],[new ChatMediaError('STALE_LEASE'),409,'STALE_LEASE'],
  [new ChatMediaError('UNAVAILABLE'),503,'UNAVAILABLE'],[new TicketError('CONFLICT'),409,'CONFLICT'],[new TicketError('NOT_FOUND'),404,'NOT_FOUND'],
  [new Error('db password=secret'),503,'UNAVAILABLE'],
 ];
 for(const [failure,status,code] of cases){
  mocks.upload.mockRejectedValueOnce(failure);
  const response=await staffOutboundUploadHandler(request(),ticketId);
  expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
 }
 mocks.upload.mockResolvedValueOnce({status:'FAILED',attachmentId});
 const failed=await staffOutboundUploadHandler(request(),ticketId);
 expect(failed.status).toBe(409);expect(await failed.json()).toEqual({error:'DRAFT_FAILED',attachmentId});
});
