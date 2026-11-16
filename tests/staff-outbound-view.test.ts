import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {canRevokeStaffOutbound,staffOutboundFilesEnabled,studentAttachmentAccess,STUDENT_MEDIA_ACCESS_DAYS} from '../lib/chat/staff-outbound-view';
import {encodeOutboundFileNameHeader} from '../app/(dashboard)/tickets/[id]/chat-outbound-state';
import {staffOutboundDraftInputSchema} from '../lib/chat/staff-outbound-contracts';

// CHAT-MEDIA-02H (DEC-205): Staff thread view of confirmed outbound files.
const channelId='1234567890';
const fullEnv={CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED:'true',CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED:'true',LINE_STUDENT_MEDIA_VIEWER_ENABLED:'true',
 LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED:'true',LINE_STUDENT_LOGIN_CHANNEL_ID:channelId,LINE_STUDENT_LIFF_ID:`${channelId}-AbCdEfGh`,ENCRYPTION_KEY:'k'.repeat(44)};

describe('CHAT-MEDIA-02H outboundFiles capability',()=>{
 it('is enabled only when upload, confirm and the complete Student viewer configuration are all set',()=>{
  expect(staffOutboundFilesEnabled(fullEnv)).toBe(true);
  expect(staffOutboundFilesEnabled({})).toBe(false);
  for(const missing of Object.keys(fullEnv))
   expect(staffOutboundFilesEnabled({...fullEnv,[missing]:undefined}),missing).toBe(false);
  expect(staffOutboundFilesEnabled({...fullEnv,CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED:'TRUE'})).toBe(false);
  expect(staffOutboundFilesEnabled({...fullEnv,LINE_STUDENT_LIFF_ID:'9999999999-AbCdEfGh'})).toBe(false);
 });
});

describe('CHAT-MEDIA-02H studentAccess derivation',()=>{
 const base={withinWindow:true,revoked:false};
 it('maps the bound outbox status, access window and revocation',()=>{
  for(const status of ['PENDING','PROCESSING','RETRY','UNKNOWN'])expect(studentAttachmentAccess({...base,outboxStatus:status}),status).toBe('WAITING_DELIVERY');
  expect(studentAttachmentAccess({...base,outboxStatus:'SENT'})).toBe('AVAILABLE');
  expect(studentAttachmentAccess({...base,outboxStatus:'SENT',withinWindow:false})).toBe('EXPIRED');
  for(const status of ['DEAD','SUPPRESSED'])expect(studentAttachmentAccess({...base,outboxStatus:status}),status).toBe('NOT_DELIVERED');
  for(const status of ['PENDING','SENT','DEAD'])expect(studentAttachmentAccess({outboxStatus:status,withinWindow:false,revoked:true})).toBe('REVOKED');
  expect(STUDENT_MEDIA_ACCESS_DAYS).toBe(30);
 });
 it('fails closed on an unknown outbox status',()=>{
  expect(studentAttachmentAccess({...base,outboxStatus:'SOMETHING_NEW'})).toBe('NOT_DELIVERED');
 });
});

describe('CHAT-MEDIA-02H canRevoke uses the revokeStaffOutboundDelivery rule',()=>{
 const sender='s',assignee='a',other='o';
 const base={revoked:false,revokeEnabled:true,senderId:sender,assigneeId:assignee,actorSupervisor:false};
 it('allows the sender, the current assignee and a scoped supervisor only',()=>{
  expect(canRevokeStaffOutbound({...base,actorId:sender})).toBe(true);
  expect(canRevokeStaffOutbound({...base,actorId:assignee})).toBe(true);
  expect(canRevokeStaffOutbound({...base,actorId:other})).toBe(false);
  expect(canRevokeStaffOutbound({...base,actorId:other,actorSupervisor:true})).toBe(true);
  expect(canRevokeStaffOutbound({...base,actorId:other,assigneeId:null})).toBe(false);
 });
 it('is false once revoked or while the revoke route is hidden',()=>{
  expect(canRevokeStaffOutbound({...base,actorId:sender,revoked:true})).toBe(false);
  expect(canRevokeStaffOutbound({...base,actorId:sender,revokeEnabled:false})).toBe(false);
 });
});

describe('P3: client file-name header uses the server UTF-16 length rule',()=>{
 it('keeps a mixed ASCII and emoji name within 360 UTF-16 code units without splitting a surrogate pair',()=>{
  const name='a'.repeat(300)+'😀'.repeat(60)+'.pdf';
  const encoded=encodeOutboundFileNameHeader(name),decoded=decodeURIComponent(encoded);
  expect(encoded.length).toBeLessThanOrEqual(1080);
  expect(decoded.length).toBeLessThanOrEqual(360);
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(decoded)).toBe(false);
  const parsed=staffOutboundDraftInputSchema.safeParse({staffId:crypto.randomUUID(),ticketId:crypto.randomUUID(),requestId:crypto.randomUUID(),
   revision:1,name:decoded,mimeType:'application/pdf',byteLength:10,checksum:'a'.repeat(64)});
  expect(parsed.success).toBe(true);
 });
 it('keeps short names unchanged',()=>{
  expect(decodeURIComponent(encodeOutboundFileNameHeader('คู่มือ 😀.pdf'))).toBe('คู่มือ 😀.pdf');
 });
});
