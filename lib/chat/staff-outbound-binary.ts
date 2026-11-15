import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError} from './media-binary';

/**
 * CHAT-MEDIA-02E: Staff outbound files use their own HKDF purpose and AAD, so an inbound
 * Student-attachment reader can never open them and vice versa. The object path is UUID-only.
 */
export const staffOutboundRefSchema=z.strictObject({
 attachmentId:z.uuid(),objectId:z.uuid(),ticketId:z.uuid(),
 mimeType:z.enum(['image/jpeg','image/png','application/pdf']),
 byteLength:z.number().int().min(1).max(CHAT_MEDIA_MAX_BYTES),checksum:z.string().regex(/^[a-f0-9]{64}$/u),
});
export type StaffOutboundRef=z.infer<typeof staffOutboundRefSchema>;

const header=Buffer.from([89,82,85,79,1]);
function material(ref:StaffOutboundRef,key:string){
 const parsed=staffOutboundRefSchema.safeParse(ref),master=Buffer.from(key,'base64');
 if(!parsed.success||master.length!==32||master.toString('base64')!==key)throw new ChatMediaError('INVALID_ATTACHMENT');
 const v=parsed.data;
 return {key:Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','staff-outbound-attachment:v1',32)),
  aad:Buffer.from(JSON.stringify(['yru:staff-outbound:v1',v.attachmentId,v.objectId,v.ticketId,v.mimeType,v.byteLength,v.checksum]))};
}
export function staffOutboundObjectPath(ref:StaffOutboundRef):string {
 if(!staffOutboundRefSchema.safeParse(ref).success||ref.attachmentId!==ref.attachmentId.toLowerCase()||ref.objectId!==ref.objectId.toLowerCase())
  throw new ChatMediaError('INVALID_ATTACHMENT');
 return `staff-outbound/${ref.attachmentId}/${ref.objectId}.yruc`;
}
export function sealStaffOutbound(bytes:Uint8Array,ref:StaffOutboundRef,key:string):Uint8Array {
 const m=material(ref,key);
 if(bytes.length!==ref.byteLength||createHash('sha256').update(bytes).digest('hex')!==ref.checksum)throw new ChatMediaError('INVALID_ATTACHMENT');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',m.key,nonce);cipher.setAAD(m.aad);
 const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return Buffer.concat([header,nonce,cipher.getAuthTag(),encrypted]);
}
export function openStaffOutbound(envelope:Uint8Array,ref:StaffOutboundRef,key:string):Uint8Array {
 try{
  const m=material(ref,key),b=Buffer.from(envelope);
  if(b.length!==ref.byteLength+33||!b.subarray(0,5).equals(header))throw new ChatMediaError('INVALID_ATTACHMENT');
  const decipher=createDecipheriv('aes-256-gcm',m.key,b.subarray(5,17));decipher.setAAD(m.aad);decipher.setAuthTag(b.subarray(17,33));
  const bytes=Buffer.concat([decipher.update(b.subarray(33)),decipher.final()]);
  if(bytes.length!==ref.byteLength||createHash('sha256').update(bytes).digest('hex')!==ref.checksum)throw new ChatMediaError('INVALID_ATTACHMENT');
  return bytes;
 }catch{throw new ChatMediaError('INVALID_ATTACHMENT');}
}
