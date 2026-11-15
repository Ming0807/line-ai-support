import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {ChatMediaError} from '../lib/chat/media-binary';
import {openStaffOutbound} from '../lib/chat/staff-outbound-binary';
import {uploadStaffOutboundAttachment,type StaffOutboundUploadDeps} from '../lib/chat/staff-outbound-upload';

const key=randomBytes(32).toString('base64');
const pdf=new TextEncoder().encode('%PDF-1.7\n'+'x'.repeat(40)+'\n%%EOF\n');
const checksum=createHash('sha256').update(pdf).digest('hex');
const staffId=randomUUID(),ticketId=randomUUID(),requestId=randomUUID(),attachmentId=randomUUID(),leaseToken=randomUUID();
const events:string[]=[];
let deps:StaffOutboundUploadDeps;

function input(overrides:Partial<Parameters<typeof uploadStaffOutboundAttachment>[1]>={}){
 return {staffId,ticketId,requestId,revision:4,name:'คู่มือ.pdf',contentType:'application/pdf',declaredChecksum:checksum,bytes:pdf,...overrides};
}

beforeEach(()=>{
 events.length=0;
 deps={
  key,
  begin:vi.fn(async()=>{events.push('begin');return {status:'UPLOADING' as const,attachmentId,leaseToken,objectId:leaseToken};}),
  finish:vi.fn(async()=>{events.push('finish');return true;}),
  release:vi.fn(async()=>{events.push('release');}),
  storage:{put:vi.fn(async()=>{events.push('put');}),get:vi.fn()},
  verifyPdf:vi.fn(async()=>{events.push('verify-pdf');}),
  verifyImage:vi.fn(async()=>{events.push('verify-image');}),
 };
});

it('verifies bytes before reserving, then stores the sealed envelope outside SQL and finalizes the same lease',async()=>{
 await expect(uploadStaffOutboundAttachment(deps,input())).resolves.toEqual({status:'READY',attachmentId});
 expect(events).toEqual(['verify-pdf','begin','put','finish']);
 expect(deps.begin).toHaveBeenCalledWith({staffId,ticketId,requestId,revision:4,name:'คู่มือ.pdf',mimeType:'application/pdf',byteLength:pdf.length,checksum});
 const [ref,envelope]=vi.mocked(deps.storage.put).mock.calls[0];
 expect(ref).toEqual({attachmentId,objectId:leaseToken,ticketId,mimeType:'application/pdf',byteLength:pdf.length,checksum});
 expect(Array.from(openStaffOutbound(envelope,ref,key))).toEqual(Array.from(pdf));
 expect(deps.finish).toHaveBeenCalledWith({staffId,ticketId,attachmentId,leaseToken});
});

it('rejects a declared digest mismatch (for example a body truncated by the proxy) before any reservation',async()=>{
 await expect(uploadStaffOutboundAttachment(deps,input({declaredChecksum:'f'.repeat(64)}))).rejects.toMatchObject({code:'INVALID_ATTACHMENT'});
 await expect(uploadStaffOutboundAttachment(deps,input({bytes:pdf.subarray(0,pdf.length-3)}))).rejects.toBeInstanceOf(ChatMediaError);
 expect(deps.begin).not.toHaveBeenCalled();expect(deps.storage.put).not.toHaveBeenCalled();
});

it('rejects content that does not match its declared type and runs the image decoder for images',async()=>{
 await expect(uploadStaffOutboundAttachment(deps,input({contentType:'image/png'}))).rejects.toMatchObject({code:'UNSUPPORTED_TYPE'});
 await expect(uploadStaffOutboundAttachment(deps,input({contentType:'text/html'}))).rejects.toMatchObject({code:'UNSUPPORTED_TYPE'});
 vi.mocked(deps.verifyPdf).mockRejectedValueOnce(new ChatMediaError('INVALID_ATTACHMENT'));
 await expect(uploadStaffOutboundAttachment(deps,input())).rejects.toMatchObject({code:'INVALID_ATTACHMENT'});
 expect(deps.begin).not.toHaveBeenCalled();
});

it('returns an existing READY or FAILED draft for the same request without storing again',async()=>{
 vi.mocked(deps.begin).mockResolvedValueOnce({status:'READY',attachmentId});
 await expect(uploadStaffOutboundAttachment(deps,input())).resolves.toEqual({status:'READY',attachmentId});
 vi.mocked(deps.begin).mockResolvedValueOnce({status:'FAILED',attachmentId});
 await expect(uploadStaffOutboundAttachment(deps,input())).resolves.toEqual({status:'FAILED',attachmentId});
 expect(deps.storage.put).not.toHaveBeenCalled();expect(deps.finish).not.toHaveBeenCalled();
});

it('releases its own lease when Storage fails so the same request can retry at once, and reports UNAVAILABLE',async()=>{
 vi.mocked(deps.storage.put).mockRejectedValueOnce(new ChatMediaError('UNAVAILABLE'));
 await expect(uploadStaffOutboundAttachment(deps,input())).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(deps.release).toHaveBeenCalledWith({attachmentId,leaseToken});
 expect(deps.finish).not.toHaveBeenCalled();
});

it('reports a lost lease or changed authority at finalization as STALE_LEASE, never as READY',async()=>{
 vi.mocked(deps.finish).mockResolvedValueOnce(false);
 await expect(uploadStaffOutboundAttachment(deps,input())).rejects.toMatchObject({code:'STALE_LEASE'});
});
