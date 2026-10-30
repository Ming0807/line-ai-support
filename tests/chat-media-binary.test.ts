import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,inspectChatMedia,normalizeChatMediaName,openChatMedia,sealChatMedia,verifyChatMediaImage} from '../lib/chat/media-binary';

const key=randomBytes(32).toString('base64');
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function jpeg():Uint8Array{return new Uint8Array(Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIQAxFX/2Q==','base64'));}
function png():Uint8Array{return new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==','base64'));}
function markerOnlyJpeg():Uint8Array{return new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x01,0x11,0xff,0xd9]);}
function markerOnlyPng():Uint8Array{
 const value=new Uint8Array(33),view=new DataView(value.buffer);
 value.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);view.setUint32(8,13);
 value.set([0x49,0x48,0x44,0x52],12);view.setUint32(16,1);view.setUint32(20,1);
 value.set([8,6,0,0,0],24);return value;
}
function pngWithDimensions(width:number,height:number):Uint8Array{
 const value=png(),view=new DataView(value.buffer,value.byteOffset,value.byteLength);
 view.setUint32(16,width);view.setUint32(20,height);
 let crc=0xffffffff;
 for(const byte of value.subarray(12,29)){
  crc^=byte;
  for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 view.setUint32(29,(crc^0xffffffff)>>>0);
 return value;
}
function pdf():Uint8Array{return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');}
function ref(bytes:Uint8Array,mimeType:'image/jpeg'|'image/png'|'application/pdf'='application/pdf'){
 return {attachmentId:randomUUID(),messageId:randomUUID(),sourceEventId:randomUUID(),objectId:randomUUID(),mimeType,byteLength:bytes.length,checksum:sha(bytes)};
}

it('sniffs only JPEG/PNG image and PDF file bytes, including generic LINE content types',()=>{
 for(const [bytes,contentType,kind,mimeType] of [
  [jpeg(),'application/octet-stream','IMAGE','image/jpeg'],
  [png(),'image/png','IMAGE','image/png'],
  [pdf(),'application/pdf','FILE','application/pdf'],
 ] as const){
  const result=inspectChatMedia(bytes,contentType,kind);
  expect(result).toEqual({mimeType,byteLength:bytes.length,checksum:sha(bytes)});
 }
});

it('requires a nonempty, correctly declared, size-matching and supported image or PDF',()=>{
 expect(CHAT_MEDIA_MAX_BYTES).toBe(10*1024*1024);
 const cases:[Uint8Array,string,'IMAGE'|'FILE',number?][]=[
  [new Uint8Array(),'image/jpeg','IMAGE'],
  [jpeg(),'image/png','IMAGE'],
  [jpeg(),'image/jpeg','FILE'],
  [pdf(),'application/pdf','IMAGE'],
  [pdf(),'text/plain','FILE'],
  [jpeg(),'image/jpeg','IMAGE',jpeg().length+1],
  [new Uint8Array([0xff,0xd8,0xff]),'image/jpeg','IMAGE'],
 ];
 for(const [bytes,contentType,kind,declaredBytes] of cases){
  expect(()=>inspectChatMedia(bytes,contentType,kind,declaredBytes)).toThrow(ChatMediaError);
 }
 const oversized=new Uint8Array(CHAT_MEDIA_MAX_BYTES+1);oversized.set(jpeg());oversized.set([0xff,0xd9],oversized.length-2);
 expect(()=>inspectChatMedia(oversized,'image/jpeg','IMAGE')).toThrow(ChatMediaError);
});

it('rejects a JPEG that contains only start/end markers without image data',()=>{
 expect(markerOnlyJpeg()).toHaveLength(9);
 expect(()=>inspectChatMedia(markerOnlyJpeg(),'image/jpeg','IMAGE')).toThrow(ChatMediaError);
});

it('rejects a PNG that contains only a bare IHDR without image data',()=>{
 expect(markerOnlyPng()).toHaveLength(33);
 expect(()=>inspectChatMedia(markerOnlyPng(),'image/png','IMAGE')).toThrow(ChatMediaError);
});

it('fully decodes real JPEG and PNG bytes and rejects marker-only pseudo-images',async()=>{
 await verifyChatMediaImage(jpeg(),'image/jpeg');
 await verifyChatMediaImage(png(),'image/png');
 await expect(verifyChatMediaImage(markerOnlyJpeg(),'image/jpeg')).rejects.toBeInstanceOf(ChatMediaError);
 await expect(verifyChatMediaImage(markerOnlyPng(),'image/png')).rejects.toBeInstanceOf(ChatMediaError);
});

it('rejects an otherwise bounded PNG whose IHDR exceeds the 16-megapixel decode limit',async()=>{
 const oversized=pngWithDimensions(4001,4000);
 expect(()=>inspectChatMedia(oversized,'image/png','IMAGE')).toThrow(ChatMediaError);
 await expect(verifyChatMediaImage(oversized,'image/png')).rejects.toBeInstanceOf(ChatMediaError);
});

it('seals an opaque encrypted envelope and opens the exact bytes only for the bound reference',()=>{
 const bytes=pdf(),reference=ref(bytes),envelope=sealChatMedia(bytes,reference,key);
 expect(envelope).toBeInstanceOf(Uint8Array);
 expect(envelope.byteLength).toBe(bytes.byteLength+33);
 expect(Array.from(openChatMedia(envelope,reference,key))).toEqual(Array.from(bytes));
 for(const changed of ([
  {...reference,attachmentId:randomUUID()},
  {...reference,messageId:randomUUID()},
  {...reference,sourceEventId:randomUUID()},
  {...reference,objectId:randomUUID()},
  {...reference,checksum:'0'.repeat(64)},
  {...reference,mimeType:'image/png'},
  {...reference,byteLength:reference.byteLength+1},
 ] as const)) expect(()=>openChatMedia(envelope,changed,key)).toThrow(ChatMediaError);

 const corrupted=envelope.slice();corrupted[corrupted.length-1]^=1;
 expect(()=>openChatMedia(corrupted,reference,key)).toThrow(ChatMediaError);
 expect(()=>openChatMedia(envelope,reference,'bad-key')).toThrow(ChatMediaError);
});

it('normalizes display names without allowing paths or control characters and bounds their length',()=>{
 const name=normalizeChatMediaName('../../private\r\nX-Header: yes.pdf','FILE');
 expect(name.length).toBeGreaterThan(0);
 expect(name.length).toBeLessThanOrEqual(180);
 expect(name).not.toMatch(/[\\/\p{Cc}]/u);
 expect(normalizeChatMediaName(null,'IMAGE').length).toBeGreaterThan(0);
 expect(normalizeChatMediaName('portrait.png','IMAGE')).toBe('portrait.png');
});
