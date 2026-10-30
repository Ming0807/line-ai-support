import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {CHAT_MEDIA_MAX_BYTES,type ChatMediaRef} from '../lib/chat/media-binary';
import {CHAT_MEDIA_BUCKET,createChatMediaStorage,provisionChatMediaStorage} from '../lib/chat/media-storage';

const url='https://fixture.supabase.co',secretKey='fixture-server-only-storage-key';
const ref:ChatMediaRef={attachmentId:randomUUID(),messageId:randomUUID(),sourceEventId:randomUUID(),objectId:randomUUID(),
 mimeType:'application/pdf',byteLength:7,checksum:'a'.repeat(64)};
const envelope=new Uint8Array(40).fill(23);
const bucket={id:CHAT_MEDIA_BUCKET,name:CHAT_MEDIA_BUCKET,public:false,file_size_limit:CHAT_MEDIA_MAX_BYTES+33,allowed_mime_types:['application/octet-stream']};
function arrayBuffer(bytes:Uint8Array):ArrayBuffer{
 const copy=new ArrayBuffer(bytes.byteLength);new Uint8Array(copy).set(bytes);return copy;
}
function setup(overrides:{bucket?:unknown;download?:Response;upload?:Response}={}){
 const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
  const target=new URL(String(input));
  if(target.pathname===`/storage/v1/bucket/${CHAT_MEDIA_BUCKET}`)return Response.json(overrides.bucket??bucket);
  if(init?.method==='POST')return overrides.upload??Response.json({Key:`${CHAT_MEDIA_BUCKET}/${ref.attachmentId}/${ref.objectId}.yruc`});
  return overrides.download??new Response(arrayBuffer(envelope),{headers:{'content-type':'application/octet-stream'}});
 });
 return {fetch,storage:createChatMediaStorage({url,secretKey,fetch})};
}

it('stores and retrieves the exact encrypted envelope at an immutable UUID-only private object path',async()=>{
 const {fetch,storage}=setup();
 await storage.put(ref,envelope);
 expect(Array.from(await storage.get(ref))).toEqual(Array.from(envelope));
 const upload=fetch.mock.calls.find(([,init])=>init?.method==='POST');
 expect(upload).toBeDefined();
 expect(String(upload?.[0])).toBe(`${url}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${ref.attachmentId}/${ref.objectId}.yruc`);
 expect(new Headers(upload?.[1]?.headers).get('x-upsert')).toBe('false');
 expect(Array.from(new Uint8Array(await new Response(upload?.[1]?.body).arrayBuffer()))).toEqual(Array.from(envelope));
 expect(fetch.mock.calls.filter(([input])=>String(input).includes('/sign/'))).toHaveLength(0);
 expect(fetch.mock.calls.every(([,init])=>init?.redirect==='error'&&init?.cache==='no-store')).toBe(true);
 expect(fetch.mock.calls.every(([,init])=>new Headers(init?.headers).get('accept-encoding')==='identity')).toBe(true);
});

it('requires an exact private octet-stream bucket and never rewrites or deletes a mismatched existing bucket',async()=>{
 for(const changed of [
  {...bucket,public:true},
  {...bucket,file_size_limit:CHAT_MEDIA_MAX_BYTES},
  {...bucket,allowed_mime_types:['application/pdf']},
  {...bucket,id:'other'},
 ]){
  const {fetch,storage}=setup({bucket:changed});
  await expect(storage.put(ref,envelope)).rejects.toBeDefined();
  expect(fetch.mock.calls.some(([,init])=>init?.method==='POST'||init?.method==='PUT'||init?.method==='DELETE')).toBe(false);
 }
});

it('provisions only a missing bucket with the exact private limits and leaves existing setup alone',async()=>{
 let exists=false;
 const fetch=vi.fn<typeof globalThis.fetch>(async(_input,init)=>{
  if(init?.method==='POST'){
   exists=true;
   expect(JSON.parse(String(init.body))).toMatchObject({id:CHAT_MEDIA_BUCKET,public:false,file_size_limit:CHAT_MEDIA_MAX_BYTES+33,allowed_mime_types:['application/octet-stream']});
   return Response.json({name:CHAT_MEDIA_BUCKET});
  }
  if(!exists)return Response.json({statusCode:'404',message:'Bucket not found'},{status:404});
  return Response.json(bucket);
 });
 await provisionChatMediaStorage({url,secretKey,fetch});
 await provisionChatMediaStorage({url,secretKey,fetch});
 expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 expect(fetch.mock.calls.some(([,init])=>init?.method==='PUT'||init?.method==='DELETE')).toBe(false);
});

it('rejects invalid refs, wrong envelope lengths, and unsafe storage origins before object access',async()=>{
 const {fetch,storage}=setup();
 await expect(storage.put({...ref,attachmentId:'../outside'},envelope)).rejects.toBeDefined();
 await expect(storage.put(ref,new Uint8Array(envelope.length+1))).rejects.toBeDefined();
 expect(fetch).not.toHaveBeenCalled();
 for(const unsafe of [
  'https://name@fixture.supabase.co','https://evil.example','http://fixture.supabase.co',
  'https://fixture.supabase.co/storage','https://fixture.supabase.co/?key=value',
 ]) expect(()=>createChatMediaStorage({url:unsafe,secretKey,fetch})).toThrow();
});

it('caps response bytes and normalizes storage failures without exposing upstream details',async()=>{
 const tooLarge=new Response(new Uint8Array(ref.byteLength+34),{headers:{'content-length':String(ref.byteLength+34)}});
 const unavailable=new Response('PRIVATE_STORAGE_RESPONSE',{status:503});
 const redirect=new Response('',{status:302,headers:{location:'https://attacker.example/object'}});
 for(const download of [tooLarge,unavailable,redirect]){
  const {storage}=setup({download});
  await expect(storage.get(ref)).rejects.toBeDefined();
 }
 const secretError=new Response('PRIVATE_STORAGE_KEY',{status:403});
 const {storage}=setup({upload:secretError});
 await expect(storage.put(ref,envelope)).rejects.not.toThrow('PRIVATE_STORAGE_KEY');
});
