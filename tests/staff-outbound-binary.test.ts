import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,openChatMedia} from '../lib/chat/media-binary';
import {CHAT_MEDIA_BUCKET,createStaffOutboundStorage} from '../lib/chat/media-storage';
import {openStaffOutbound,sealStaffOutbound,staffOutboundObjectPath,type StaffOutboundRef} from '../lib/chat/staff-outbound-binary';

const key=randomBytes(32).toString('base64');
const bytes=new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF');
function ref(overrides:Partial<StaffOutboundRef>={}):StaffOutboundRef {
 return {attachmentId:randomUUID(),objectId:randomUUID(),ticketId:randomUUID(),mimeType:'application/pdf',byteLength:bytes.length,
  checksum:createHash('sha256').update(bytes).digest('hex'),...overrides};
}

it('round-trips the exact bytes through an AES-GCM envelope bound to the outbound draft identity',()=>{
 const value=ref(),envelope=sealStaffOutbound(bytes,value,key);
 expect(envelope.length).toBe(bytes.length+33);
 expect(Array.from(openStaffOutbound(envelope,value,key))).toEqual(Array.from(bytes));
});

it('rejects tampering, another draft, another ticket, another key and an inbound-purpose reader',()=>{
 const value=ref(),envelope=sealStaffOutbound(bytes,value,key);
 const tampered=Uint8Array.from(envelope);tampered[tampered.length-1]^=1;
 expect(()=>openStaffOutbound(tampered,value,key)).toThrow(ChatMediaError);
 expect(()=>openStaffOutbound(envelope,{...value,attachmentId:randomUUID()},key)).toThrow(ChatMediaError);
 expect(()=>openStaffOutbound(envelope,{...value,ticketId:randomUUID()},key)).toThrow(ChatMediaError);
 expect(()=>openStaffOutbound(envelope,{...value,objectId:randomUUID()},key)).toThrow(ChatMediaError);
 expect(()=>openStaffOutbound(envelope,value,randomBytes(32).toString('base64'))).toThrow(ChatMediaError);
 // The inbound Student-attachment purpose must never decrypt a Staff outbound object.
 expect(()=>openChatMedia(envelope,{attachmentId:value.attachmentId,messageId:randomUUID(),sourceEventId:randomUUID(),objectId:value.objectId,
  mimeType:value.mimeType,byteLength:value.byteLength,checksum:value.checksum},key)).toThrow(ChatMediaError);
});

it('refuses to seal bytes that do not match the reserved length and digest',()=>{
 expect(()=>sealStaffOutbound(bytes,ref({byteLength:bytes.length+1}),key)).toThrow(ChatMediaError);
 expect(()=>sealStaffOutbound(bytes,ref({checksum:'b'.repeat(64)}),key)).toThrow(ChatMediaError);
 expect(()=>sealStaffOutbound(bytes,ref({byteLength:CHAT_MEDIA_MAX_BYTES+1}),key)).toThrow(ChatMediaError);
});

it('uses a UUID-only path under a separate staff-outbound prefix',()=>{
 const value=ref();
 expect(staffOutboundObjectPath(value)).toBe(`staff-outbound/${value.attachmentId}/${value.objectId}.yruc`);
 expect(()=>staffOutboundObjectPath({...value,attachmentId:value.attachmentId.toUpperCase()})).toThrow(ChatMediaError);
 expect(()=>staffOutboundObjectPath({...value,objectId:'../x'})).toThrow(ChatMediaError);
});

it('uploads without upsert to the private bucket and reads back only the exact envelope size',async()=>{
 const value=ref(),envelope=sealStaffOutbound(bytes,value,key),path=staffOutboundObjectPath(value);
 const bucket={id:CHAT_MEDIA_BUCKET,name:CHAT_MEDIA_BUCKET,public:false,file_size_limit:CHAT_MEDIA_MAX_BYTES+33,allowed_mime_types:['application/octet-stream']};
 const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
  const target=new URL(String(input));
  if(target.pathname===`/storage/v1/bucket/${CHAT_MEDIA_BUCKET}`)return Response.json(bucket);
  if(init?.method==='POST')return Response.json({Key:`${CHAT_MEDIA_BUCKET}/${path}`});
  return new Response(Uint8Array.from(envelope).buffer,{headers:{'content-type':'application/octet-stream'}});
 });
 const storage=createStaffOutboundStorage({url:'https://fixture.supabase.co',secretKey:'fixture-server-only-storage-key',fetch});
 await storage.put(value,envelope);
 const upload=fetch.mock.calls.find(([,init])=>init?.method==='POST');
 expect(String(upload?.[0])).toBe(`https://fixture.supabase.co/storage/v1/object/${CHAT_MEDIA_BUCKET}/${path}`);
 expect(new Headers(upload?.[1]?.headers).get('x-upsert')).toBe('false');
 expect(Array.from(await storage.get(value))).toEqual(Array.from(envelope));
 await expect(storage.put(value,envelope.subarray(1))).rejects.toThrow(ChatMediaError);
});
