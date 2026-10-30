import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ChatMediaError} from '../lib/chat/media-binary';

const mediaMocks=vi.hoisted(()=>({apiStaffId:vi.fn(),readStaffChatAttachment:vi.fn()}));
vi.mock('../lib/tickets/api',()=>({apiStaffId:mediaMocks.apiStaffId}));
vi.mock('../lib/chat/media-access',()=>({readStaffChatAttachment:mediaMocks.readStaffChatAttachment}));
import {chatAttachmentHandler} from '../lib/chat/media-api';

const base='https://staff.example.edu',staffId=randomUUID(),ticketId=randomUUID(),attachmentId=randomUUID();
const bytes=new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x37,0x0a,0x25,0x25,0x45,0x4f,0x46]);
function req(path:string,method='GET'){return new Request(`${base}${path}`,{method});}
function file(name='current review.pdf') {return {bytes,name,mimeType:'application/pdf'};}

beforeEach(()=>{
 vi.resetAllMocks();
 mediaMocks.apiStaffId.mockResolvedValue(staffId);
 mediaMocks.readStaffChatAttachment.mockResolvedValue(file());
});

it('returns the complete attachment bytes through the authorized private download response',async()=>{
 const request=req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`);
 const response=await chatAttachmentHandler(request,ticketId,attachmentId);
 expect(response.status).toBe(200);
 expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
 expect(response.headers.get('content-type')).toBe('application/pdf');
 expect(response.headers.get('content-disposition')).toContain("; filename*=UTF-8''");
 expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('current review.pdf'));
 expect(response.headers.get('cache-control')).toContain('private');
 expect(response.headers.get('cache-control')).toContain('no-store');
 expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 expect(response.headers.get('content-security-policy')).toContain('sandbox');
 expect(mediaMocks.readStaffChatAttachment).toHaveBeenCalledWith(staffId,ticketId,attachmentId,{signal:request.signal});
});

it('requires authentication before reading attachment bytes',async()=>{
 mediaMocks.apiStaffId.mockResolvedValue(null);
 const response=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`),ticketId,attachmentId);
 expect(response.status).toBe(401);
 expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});
 expect(mediaMocks.readStaffChatAttachment).not.toHaveBeenCalled();
});

it('hides wrong-case and nonexistent attachment IDs and maps pending media to conflict',async()=>{
 mediaMocks.readStaffChatAttachment.mockRejectedValueOnce(new ChatMediaError('NOT_FOUND'));
 const missing=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`),ticketId,attachmentId);
 expect(missing.status).toBe(404);
 expect(await missing.json()).toEqual({error:'NOT_FOUND'});

 mediaMocks.readStaffChatAttachment.mockRejectedValueOnce(new ChatMediaError('NOT_READY'));
 const pending=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`),ticketId,attachmentId);
 expect(pending.status).toBe(409);
 expect(await pending.json()).toEqual({error:'NOT_READY'});
});

it('rejects methods, unknown query strings and malformed IDs before the access service',async()=>{
 const post=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`,'POST'),ticketId,attachmentId);
 const query=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}?range=0-1`),ticketId,attachmentId);
 const malformed=await chatAttachmentHandler(req(`/api/chat/tickets/not-a-uuid/attachments/${attachmentId}`),'not-a-uuid',attachmentId);
 expect([post.status,query.status,malformed.status].every(status=>status>=400)).toBe(true);
 expect(mediaMocks.readStaffChatAttachment).not.toHaveBeenCalled();
});

it('normalizes unsafe filenames and does not expose storage failures or error details',async()=>{
 mediaMocks.readStaffChatAttachment.mockResolvedValue(file('../../private\r\nX-Header.pdf'));
 const response=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`),ticketId,attachmentId);
 expect(response.status).toBe(200);
 const disposition=response.headers.get('content-disposition')??'';
 expect(disposition).not.toMatch(/[\r\n]/u);
 expect(disposition).not.toContain('../../');
 expect(response.headers.get('x-header')).toBeNull();

 mediaMocks.readStaffChatAttachment.mockRejectedValue(new Error('PRIVATE_STORAGE_KEY_OR_PATH'));
 const failed=await chatAttachmentHandler(req(`/api/chat/tickets/${ticketId}/attachments/${attachmentId}`),ticketId,attachmentId);
 expect(failed.status).toBe(503);
 expect(JSON.stringify(await failed.json())).not.toContain('PRIVATE_STORAGE_KEY_OR_PATH');
});
