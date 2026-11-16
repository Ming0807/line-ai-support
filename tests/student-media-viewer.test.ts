import {createHash,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {StudentLineIdentityError} from '../lib/chat/student-line-verification';
import {createStudentMediaSession} from '../lib/chat/student-media-session';
import {sealStaffOutbound,type StaffOutboundRef} from '../lib/chat/staff-outbound-binary';
import {
 STUDENT_MEDIA_COOKIE,studentMediaFileHandler,studentMediaSessionHandler,type StudentMediaViewerDeps,
} from '../lib/chat/student-media-viewer-api';
import {TicketError} from '../lib/tickets/authorization';
import {readAttachmentParam,viewerMessageFor} from '../app/liff/media/viewer-state';

const mocks=vi.hoisted(()=>({apiStaffId:vi.fn(),revoke:vi.fn()}));
vi.mock('../lib/tickets/api',async original=>({...await original<typeof import('../lib/tickets/api')>(),apiStaffId:mocks.apiStaffId}));
vi.mock('../lib/chat/student-media-access',async original=>({...await original<typeof import('../lib/chat/student-media-access')>(),
 revokeStaffOutboundDelivery:mocks.revoke}));
import {staffOutboundRevokeHandler} from '../lib/chat/staff-outbound-revoke-api';

const key=Buffer.alloc(32,7).toString('base64');
const channelId='1234567890',liffId=`${channelId}-AbCdEfGh`;
const viewerEnv={LINE_STUDENT_MEDIA_VIEWER_ENABLED:'true',LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED:'true',LINE_STUDENT_LOGIN_CHANNEL_ID:channelId,
 LINE_STUDENT_LIFF_ID:liffId,ENCRYPTION_KEY:key};
const host='helpdesk.example.edu',attachmentId=randomUUID(),userHash='c'.repeat(64);
const idToken='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVMTIzIn0.c2lnbmF0dXJlLXNlY3JldC12YWx1ZQ';
const fileBytes=Buffer.from('%PDF-1.7\nprivate staff file\n%%EOF\n');
const ref:StaffOutboundRef={attachmentId,objectId:randomUUID(),ticketId:randomUUID(),mimeType:'application/pdf',byteLength:fileBytes.length,
 checksum:createHash('sha256').update(fileBytes).digest('hex')};
const nowMs=1_800_000_000_000,nowSec=nowMs/1000;

function deps(overrides:Partial<StudentMediaViewerDeps>={}):StudentMediaViewerDeps&{calls:string[]}{
 const calls:string[]=[];
 return {calls,key,now:()=>nowMs,
  verify:vi.fn(async()=>{calls.push('verify');return {userHash,expiresAt:nowSec+3600};}),
  authorize:vi.fn(async()=>{calls.push('authorize');return ref;}),
  storage:{get:vi.fn(async()=>{calls.push('storage');return sealStaffOutbound(fileBytes,ref,key);})},
  ...overrides};
}
function sessionRequest(overrides:{body?:unknown;raw?:string;origin?:string|null;path?:string;contentType?:string}={}):Request{
 const headers:Record<string,string>={host,'x-forwarded-proto':'https','content-type':overrides.contentType??'application/json'};
 if(overrides.origin!==null)headers.origin=overrides.origin??`https://${host}`;
 const body=overrides.raw??JSON.stringify(overrides.body??{attachmentId,idToken});
 return new Request(`https://${host}${overrides.path??'/api/student/media/session'}`,{method:'POST',headers,body});
}
function fileRequest(options:{cookie?:string|null;fetchSite?:string;path?:string}={}):Request{
 const headers:Record<string,string>={host,'x-forwarded-proto':'https'};
 const cookie=options.cookie===undefined?createStudentMediaSession({attachmentId,userHash,identityExpiresAt:nowSec+3600},key,nowSec):options.cookie;
 if(cookie!==null)headers.cookie=`other=1; ${STUDENT_MEDIA_COOKIE}=${cookie}`;
 if(options.fetchSite)headers['sec-fetch-site']=options.fetchSite;
 return new Request(`https://${host}${options.path??`/api/student/media/${attachmentId}`}`,{method:'GET',headers});
}
function expectPrivateHeaders(response:Response){
 expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
 expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('CHAT-MEDIA-02G POST /api/student/media/session',()=>{
 let logs:ReturnType<typeof vi.spyOn>[];
 beforeEach(()=>{for(const [name,value] of Object.entries(viewerEnv))vi.stubEnv(name,value);
  logs=(['log','info','warn','error'] as const).map(level=>vi.spyOn(console,level).mockImplementation(()=>undefined));});
 afterEach(()=>{
  for(const spy of logs){expect(JSON.stringify(spy.mock.calls)).not.toContain(idToken);expect(JSON.stringify(spy.mock.calls)).not.toContain(userHash);spy.mockRestore();}
  vi.unstubAllEnvs();
 });

 it('is hidden (404) unless the viewer gates and a LIFF ID of the same Login channel are configured',async()=>{
  for(const [name,value] of [['LINE_STUDENT_MEDIA_VIEWER_ENABLED','false'],['LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED',''],['LINE_STUDENT_LIFF_ID','9999999999-AbCdEfGh'],['ENCRYPTION_KEY','']]){
   vi.stubEnv(name,value);const d=deps(name==='ENCRYPTION_KEY'?{key:undefined}:{});
   const response=await studentMediaSessionHandler(sessionRequest(),d);
   expect(response.status,name).toBe(404);expect(d.calls).toEqual([]);
   vi.stubEnv(name,viewerEnv[name as keyof typeof viewerEnv]);
  }
 });

 it('rejects cross-origin, query strings, wrong content type, oversize and non-strict bodies before verifying',async()=>{
  const cases:[Request,number][]=[
   [sessionRequest({origin:'https://evil.example'}),403],[sessionRequest({origin:null}),403],
   [sessionRequest({path:'/api/student/media/session?x=1'}),400],[sessionRequest({contentType:'text/plain'}),400],
   [sessionRequest({raw:'x'.repeat(10_241)}),413],[sessionRequest({raw:'{'}),400],
   [sessionRequest({body:{attachmentId,idToken,userId:'U123'}}),400],[sessionRequest({body:{attachmentId:'nope',idToken}}),400],
   [sessionRequest({body:{attachmentId:attachmentId.toUpperCase(),idToken}}),400],[sessionRequest({body:{attachmentId,idToken:'a'.repeat(8193)}}),400],
   [sessionRequest({body:{attachmentId}}),400],
  ];
  for(const [request,status] of cases){const d=deps();const response=await studentMediaSessionHandler(request,d);
   expect(response.status).toBe(status);expect(d.calls).toEqual([]);expect(response.headers.get('set-cookie')).toBeNull();expectPrivateHeaders(response);}
 });

 it('maps invalid identity to 401 and an unavailable LINE verifier to 503, without a cookie or DB lookup',async()=>{
  for(const [code,status] of [['INVALID_IDENTITY',401],['UNAVAILABLE',503]] as const){
   const d=deps({verify:vi.fn(async()=>{throw new StudentLineIdentityError(code);})});
   const response=await studentMediaSessionHandler(sessionRequest(),d);
   expect(response.status).toBe(status);expect(d.authorize).not.toHaveBeenCalled();expect(response.headers.get('set-cookie')).toBeNull();
  }
  const d=deps({verify:vi.fn(async()=>{throw new Error('socket closed');})});
  expect((await studentMediaSessionHandler(sessionRequest(),d)).status).toBe(503);
 });

 it('answers 404 without a cookie when the verified account is not the SENT recipient',async()=>{
  const d=deps({authorize:vi.fn(async()=>null)});
  const response=await studentMediaSessionHandler(sessionRequest(),d);
  expect(response.status).toBe(404);expect(await response.json()).toEqual({error:'NOT_FOUND'});expect(response.headers.get('set-cookie')).toBeNull();
  expect(d.authorize).toHaveBeenCalledWith(attachmentId,userHash);
 });

 it('issues an attachment-bound HttpOnly/Secure/SameSite=Strict session of at most five minutes and no identity in the body',async()=>{
  const d=deps();
  const response=await studentMediaSessionHandler(sessionRequest(),d);
  expect(response.status).toBe(200);expectPrivateHeaders(response);
  expect(d.calls).toEqual(['verify','authorize']);expect(d.verify).toHaveBeenCalledWith(idToken);
  const body=await response.json();
  expect(body).toEqual({attachmentId,kind:'PDF',byteLength:fileBytes.length});
  const cookie=response.headers.get('set-cookie')??'';
  expect(cookie.startsWith(`${STUDENT_MEDIA_COOKIE}=v1.`)).toBe(true);
  for(const attribute of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=300'])expect(cookie).toContain(attribute);
  expect(cookie).not.toContain('Domain=');expect(cookie).not.toContain(idToken);expect(cookie).not.toContain(userHash);
  expect(JSON.stringify(body)).not.toMatch(/userHash|token|staff-outbound|\.yruc|objectId/u);
 });

 it('caps the session by the LINE token expiry and refuses an already expiring token',async()=>{
  const short=await studentMediaSessionHandler(sessionRequest(),deps({verify:vi.fn(async()=>({userHash,expiresAt:nowSec+42}))}));
  expect(short.status).toBe(200);expect(short.headers.get('set-cookie')).toContain('Max-Age=42');
  const expired=await studentMediaSessionHandler(sessionRequest(),deps({verify:vi.fn(async()=>({userHash,expiresAt:nowSec}))}));
  expect(expired.status).toBe(401);expect(expired.headers.get('set-cookie')).toBeNull();
 });

 it('maps a database failure to 503 without internals',async()=>{
  const response=await studentMediaSessionHandler(sessionRequest(),deps({authorize:vi.fn(async()=>{throw new Error('relation private.x does not exist');})}));
  expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/relation|private/u);
 });
});

describe('CHAT-MEDIA-02G GET /api/student/media/[attachmentId]',()=>{
 beforeEach(()=>{for(const [name,value] of Object.entries(viewerEnv))vi.stubEnv(name,value);vi.spyOn(console,'error').mockImplementation(()=>undefined);});
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

 it('is hidden unless the viewer is configured',async()=>{
  vi.stubEnv('LINE_STUDENT_MEDIA_VIEWER_ENABLED','false');const d=deps();
  expect((await studentMediaFileHandler(fileRequest(),attachmentId,d)).status).toBe(404);expect(d.calls).toEqual([]);
 });

 it('requires a valid session for exactly this attachment before any database or Storage access',async()=>{
  const other=randomUUID();
  const cases:[Request,string,number][]=[
   [fileRequest({cookie:null}),attachmentId,401],[fileRequest({cookie:'v1.bad.bad.bad'}),attachmentId,401],
   [fileRequest({cookie:createStudentMediaSession({attachmentId:other,userHash,identityExpiresAt:nowSec+3600},key,nowSec)}),attachmentId,401],
   [fileRequest({cookie:createStudentMediaSession({attachmentId,userHash,identityExpiresAt:nowSec+3600},key,nowSec-301)}),attachmentId,401],
   [fileRequest({fetchSite:'cross-site'}),attachmentId,403],[fileRequest({fetchSite:'same-site'}),attachmentId,403],
   [fileRequest({path:`/api/student/media/${attachmentId}?download=1`}),attachmentId,400],[fileRequest(),'not-a-uuid',404],
  ];
  for(const [request,id,status] of cases){const d=deps();const response=await studentMediaFileHandler(request,id,d);
   expect(response.status).toBe(status);expect(d.calls).toEqual([]);expectPrivateHeaders(response);}
 });

 it('checks SENT delivery and recipient before Storage, decrypts, then checks again before returning bytes',async()=>{
  const d=deps();
  const response=await studentMediaFileHandler(fileRequest({fetchSite:'same-origin'}),attachmentId,d);
  expect(response.status).toBe(200);expect(d.calls).toEqual(['authorize','storage','authorize']);
  expect(Buffer.from(await response.arrayBuffer()).equals(fileBytes)).toBe(true);
  expectPrivateHeaders(response);
  expect(response.headers.get('content-type')).toBe('application/pdf');expect(response.headers.get('content-length')).toBe(String(fileBytes.length));
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="yru-file.pdf"');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(response.headers.get('vary')).toContain('Cookie');
 });

 it('shows images inline so the viewer can preview them, still sandboxed',async()=>{
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
  const image:StaffOutboundRef={...ref,mimeType:'image/png',byteLength:png.length,checksum:createHash('sha256').update(png).digest('hex')};
  const d=deps({authorize:vi.fn(async()=>image),storage:{get:vi.fn(async()=>sealStaffOutbound(png,image,key))}});
  const response=await studentMediaFileHandler(fileRequest(),attachmentId,d);
  expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toBe('inline; filename="yru-image.png"');
 });

 it('returns 404 without touching Storage when delivery is not SENT, revoked or for another account',async()=>{
  const d=deps({authorize:vi.fn(async()=>null)});
  const response=await studentMediaFileHandler(fileRequest(),attachmentId,d);
  expect(response.status).toBe(404);expect(d.storage.get).not.toHaveBeenCalled();
 });

 it('drops the bytes when authority changes while Storage was being read',async()=>{
  for(const second of [null,{...ref,objectId:randomUUID()}]){
   const authorize=vi.fn().mockResolvedValueOnce(ref).mockResolvedValueOnce(second);
   const response=await studentMediaFileHandler(fileRequest(),attachmentId,deps({authorize}));
   expect(response.status).toBe(404);expect(Buffer.from(await response.arrayBuffer()).includes(fileBytes)).toBe(false);
  }
 });

 it('fails closed with 503 on Storage, envelope or database errors',async()=>{
  const failures:Partial<StudentMediaViewerDeps>[]=[
   {storage:{get:vi.fn(async()=>{throw new Error('storage down');})}},
   {storage:{get:vi.fn(async()=>sealStaffOutbound(fileBytes,ref,Buffer.alloc(32,9).toString('base64')))}},
   {authorize:vi.fn(async()=>{throw new Error('db down');})},
  ];
  for(const failure of failures){const response=await studentMediaFileHandler(fileRequest(),attachmentId,deps(failure));
   expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/storage down|db down|staff-outbound/u);}
 });
});

const staffId=randomUUID(),ticketId=randomUUID();
function revokeRequest(overrides:{origin?:string|null;path?:string;raw?:string}={}):Request{
 const headers:Record<string,string>={host,'x-forwarded-proto':'https','content-type':'application/json'};
 if(overrides.origin!==null)headers.origin=overrides.origin??`https://${host}`;
 return new Request(`https://${host}${overrides.path??`/api/chat/tickets/${ticketId}/outbound-attachments/${attachmentId}/revoke`}`,
  {method:'POST',headers,body:overrides.raw??'{}'});
}
describe('CHAT-MEDIA-02G POST .../outbound-attachments/[attachmentId]/revoke',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED','true');vi.stubEnv('DATABASE_URL','postgresql://fixture:fixture@127.0.0.1:1/fixture');
  mocks.apiStaffId.mockResolvedValue(staffId);mocks.revoke.mockResolvedValue({attachmentId,revoked:true});vi.spyOn(console,'error').mockImplementation(()=>undefined);});
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

 it('is hidden with the confirmation flag and checks origin, Staff, IDs, query and an empty JSON body',async()=>{
  vi.stubEnv('CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED','false');
  expect((await staffOutboundRevokeHandler(revokeRequest(),ticketId,attachmentId)).status).toBe(404);
  vi.stubEnv('CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED','true');
  expect((await staffOutboundRevokeHandler(revokeRequest({origin:'https://evil.example'}),ticketId,attachmentId)).status).toBe(403);
  mocks.apiStaffId.mockResolvedValueOnce(null);
  expect((await staffOutboundRevokeHandler(revokeRequest(),ticketId,attachmentId)).status).toBe(401);
  expect((await staffOutboundRevokeHandler(revokeRequest(),'x',attachmentId)).status).toBe(404);
  expect((await staffOutboundRevokeHandler(revokeRequest({path:`/api/chat/tickets/${ticketId}/outbound-attachments/${attachmentId}/revoke?a=1`}),ticketId,attachmentId)).status).toBe(400);
  expect((await staffOutboundRevokeHandler(revokeRequest({raw:'{"reason":"x"}'}),ticketId,attachmentId)).status).toBe(400);
  expect(mocks.revoke).not.toHaveBeenCalled();
 });

 it('revokes through the server function and maps errors without internals',async()=>{
  const ok=await staffOutboundRevokeHandler(revokeRequest(),ticketId,attachmentId);
  expect(ok.status).toBe(200);expect(await ok.json()).toEqual({attachmentId,revoked:true});
  expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(),{staffId,ticketId,attachmentId});
  expect(ok.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  mocks.revoke.mockRejectedValueOnce(new TicketError('NOT_FOUND'));
  expect((await staffOutboundRevokeHandler(revokeRequest(),ticketId,attachmentId)).status).toBe(404);
  mocks.revoke.mockRejectedValueOnce(new Error('relation private.x'));
  const failed=await staffOutboundRevokeHandler(revokeRequest(),ticketId,attachmentId);
  expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('relation');
 });
});

describe('CHAT-MEDIA-02G LIFF viewer state helpers',()=>{
 it('reads only a lowercase attachment UUID from the resolved LIFF query',()=>{
  expect(readAttachmentParam(`?attachment=${attachmentId}`)).toBe(attachmentId);
  expect(readAttachmentParam(`?attachment=${attachmentId.toUpperCase()}`)).toBeNull();
  expect(readAttachmentParam('?attachment=../../etc')).toBeNull();
  expect(readAttachmentParam('')).toBeNull();
  expect(readAttachmentParam(`?liff.state=%3Fattachment%3D${attachmentId}`)).toBeNull();
 });
 it('gives Thai guidance without revealing whether a file exists for someone else',()=>{
  expect(viewerMessageFor(404)).toBe(viewerMessageFor(403));
  expect(viewerMessageFor(401)).toMatch(/ยืนยัน/u);expect(viewerMessageFor(503)).toMatch(/ลองใหม่/u);
  expect(viewerMessageFor(404)).not.toMatch(/ไม่ใช่ผู้รับ|คนอื่น/u);
 });
});
