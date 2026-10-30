import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';
import sharp from 'sharp';

export const CHAT_MEDIA_MAX_BYTES=10*1024*1024;
export class ChatMediaError extends Error {
 constructor(public readonly code:'INVALID_ATTACHMENT'|'TOO_LARGE'|'UNSUPPORTED_TYPE'|'UNAVAILABLE'|'NOT_FOUND'|'NOT_READY'|'SOURCE_CHANGED'|'STALE_LEASE'){super(code);}
}
export const chatMediaRefSchema=z.strictObject({attachmentId:z.uuid(),messageId:z.uuid(),sourceEventId:z.uuid(),objectId:z.uuid(),
 mimeType:z.enum(['image/jpeg','image/png','application/pdf']),byteLength:z.number().int().min(1).max(CHAT_MEDIA_MAX_BYTES),checksum:z.string().regex(/^[a-f0-9]{64}$/u)});
export type ChatMediaRef=z.infer<typeof chatMediaRefSchema>;
export interface ChatMediaStorage {put(ref:ChatMediaRef,envelope:Uint8Array):Promise<void>;get(ref:ChatMediaRef,signal?:AbortSignal):Promise<Uint8Array>}
export function normalizeChatMediaName(value:unknown,kind:'IMAGE'|'FILE'):string {
 const name=typeof value==='string'?value.normalize('NFC').replace(/[\\/\p{Cc}\p{Cf}\p{Cs}]/gu,'').replace(/^\.+/u,'').trim():'';
 return Array.from(name).slice(0,180).join('')||(kind==='IMAGE'?'รูปภาพ':'เอกสาร.pdf');
}
export function inspectChatMedia(bytes:Uint8Array,contentType:string,kind:'IMAGE'|'FILE',declaredBytes?:number):{mimeType:ChatMediaRef['mimeType'];byteLength:number;checksum:string} {
 if(!(bytes instanceof Uint8Array)||!bytes.length)throw new ChatMediaError('INVALID_ATTACHMENT');
 if(bytes.length>CHAT_MEDIA_MAX_BYTES)throw new ChatMediaError('TOO_LARGE');
 if(declaredBytes!==undefined&&(!Number.isSafeInteger(declaredBytes)||declaredBytes!==bytes.length))throw new ChatMediaError('INVALID_ATTACHMENT');
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let mimeType:ChatMediaRef['mimeType']|undefined;
 if(b.length>=32&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217&&b.includes(Buffer.from([255,218])))mimeType='image/jpeg';
 else if(b.length>=57&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.readUInt32BE(8)===13&&b.toString('ascii',12,16)==='IHDR'&&
  b.subarray(-8,-4).toString('ascii')==='IEND'&&b.includes(Buffer.from('IDAT'))){
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  if(!width||!height||width*height>16000000)throw new ChatMediaError('INVALID_ATTACHMENT');
  mimeType='image/png';
 }else if(/^%PDF-[12]\.\d/u.test(b.toString('ascii',0,8))&&b.subarray(Math.max(0,b.length-1024)).includes(Buffer.from('%%EOF')))mimeType='application/pdf';
 if(!mimeType||(kind==='IMAGE'?(mimeType==='application/pdf'):(mimeType!=='application/pdf')))throw new ChatMediaError('UNSUPPORTED_TYPE');
 const declared=contentType.split(';',1)[0].trim().toLowerCase();
 if(declared!==mimeType&&declared!=='application/octet-stream')throw new ChatMediaError('UNSUPPORTED_TYPE');
 return {mimeType,byteLength:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')};
}
/** Decode with bounded pixels/time outside SQL; a file signature is not proof of an image. */
export async function verifyChatMediaImage(bytes:Uint8Array,mimeType:string):Promise<void> {
 if(mimeType==='application/pdf')return;
 if(bytes.length>CHAT_MEDIA_MAX_BYTES||!['image/jpeg','image/png'].includes(mimeType))throw new ChatMediaError('INVALID_ATTACHMENT');
 try{
  const decoder=sharp(bytes,{limitInputPixels:16000000,failOn:'warning',sequentialRead:true}).timeout({seconds:10});
  const metadata=await decoder.metadata();
  if(metadata.format!==(mimeType==='image/png'?'png':'jpeg')||!metadata.width||!metadata.height||metadata.width*metadata.height>16000000||
   (metadata.pages!==undefined&&metadata.pages!==1))throw new ChatMediaError('INVALID_ATTACHMENT');
  await decoder.raw().toBuffer();
 }catch{throw new ChatMediaError('INVALID_ATTACHMENT');}
}
const header=Buffer.from([89,82,85,65,1]);
function material(ref:ChatMediaRef,key:string){
 const parsed=chatMediaRefSchema.safeParse(ref),master=Buffer.from(key,'base64');
 if(!parsed.success||master.length!==32||master.toString('base64')!==key)throw new ChatMediaError('INVALID_ATTACHMENT');
 const v=parsed.data;
 return {key:Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','chat-attachment:v1',32)),
  aad:Buffer.from(JSON.stringify(['yru:chat-attachment:v1',v.attachmentId,v.messageId,v.sourceEventId,v.objectId,v.mimeType,v.byteLength,v.checksum]))};
}
export function sealChatMedia(bytes:Uint8Array,ref:ChatMediaRef,key:string):Uint8Array {
 const m=material(ref,key);
 if(bytes.length!==ref.byteLength||createHash('sha256').update(bytes).digest('hex')!==ref.checksum)throw new ChatMediaError('INVALID_ATTACHMENT');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',m.key,nonce);cipher.setAAD(m.aad);
 const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([header,nonce,cipher.getAuthTag(),encrypted]);
}
export function openChatMedia(envelope:Uint8Array,ref:ChatMediaRef,key:string):Uint8Array {
 try{
  const m=material(ref,key),b=Buffer.from(envelope);
  if(b.length!==ref.byteLength+33||!b.subarray(0,5).equals(header))throw new ChatMediaError('INVALID_ATTACHMENT');
  const decipher=createDecipheriv('aes-256-gcm',m.key,b.subarray(5,17));decipher.setAAD(m.aad);decipher.setAuthTag(b.subarray(17,33));
  const bytes=Buffer.concat([decipher.update(b.subarray(33)),decipher.final()]);
  if(bytes.length!==ref.byteLength||createHash('sha256').update(bytes).digest('hex')!==ref.checksum)throw new ChatMediaError('INVALID_ATTACHMENT');
  return bytes;
 }catch{throw new ChatMediaError('INVALID_ATTACHMENT');}
}
