import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createOriginalStorage,provisionOriginalStorage,ORIGINAL_BUCKET} from '../lib/imports/original-storage';
import type {OriginalRef} from '../lib/imports/types';
const jobId=randomUUID(),ref:OriginalRef={id:randomUUID(),backend:'PRIVATE_STORAGE',format:'CSV',checksum:'a'.repeat(64),byteLength:8,keyVersion:1};
const envelope=new Uint8Array(41).fill(17),url='https://fixture.supabase.co',secretKey='dummy-server-only-storage-key';
const bucket={id:'knowledge-originals',name:'knowledge-originals',public:false,file_size_limit:20*1024*1024+33,allowed_mime_types:['application/octet-stream']};
it('caller cancellation interrupts in-flight download immediately even when fetch ignores abort',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 try{
  let receivedSignal:AbortSignal|null|undefined,settledAt:number|null=null;
  const fetch=vi.fn<typeof globalThis.fetch>(async(_input,init)=>{receivedSignal=init?.signal;return new Promise<Response>(()=>undefined);});
  const storage=createOriginalStorage({url,secretKey,fetch}),controller=new AbortController();
  const work=storage.download(jobId,ref,controller.signal).catch(error=>{settledAt=Date.now();return error;});
  await vi.advanceTimersByTimeAsync(0);controller.abort();await vi.advanceTimersByTimeAsync(5);
  const wasCancelledImmediately=settledAt!==null;await vi.advanceTimersByTimeAsync(15000);
  expect(await work).toMatchObject({message:'IMPORT_STORAGE_UNAVAILABLE'});expect(wasCancelledImmediately).toBe(true);expect(receivedSignal?.aborted).toBe(true);
  const before=fetch.mock.calls.length;
  await expect(storage.download(jobId,ref,controller.signal)).rejects.toThrow('IMPORT_STORAGE_UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(before);
 }finally{vi.useRealTimers();}
});
function setup(overrides:{bucket?:unknown;download?:Response;upload?:Response}={}){
 const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
  const target=new URL(String(input));
  if(target.pathname.includes('/bucket/'))return Response.json(overrides.bucket??bucket);
  if(init?.method==='POST')return overrides.upload??Response.json({Id:ref.id,Key:`${ORIGINAL_BUCKET}/${jobId}/${ref.id}.yrue`});
  return overrides.download??new Response(envelope);
 });
 return {fetch,storage:createOriginalStorage({url,secretKey,fetch})};
}
it('uploads encrypted bytes with an opaque immutable path and retrieves exact envelope bytes',async()=>{
 const {fetch,storage}=setup();await storage.upload(jobId,ref,envelope);expect(await storage.download(jobId,ref)).toEqual(envelope);
 const call=fetch.mock.calls.find(([,init])=>init?.method==='POST');expect(String(call?.[0])).toBe(`${url}/storage/v1/object/${ORIGINAL_BUCKET}/${jobId}/${ref.id}.yrue`);
 expect(new Headers(call?.[1]?.headers).get('x-upsert')).toBe('false');expect(call?.[1]?.body).toEqual(envelope);
 expect(fetch.mock.calls.every(([,init])=>init?.redirect==='error'&&init?.cache==='no-store')).toBe(true);
 expect(fetch.mock.calls.some(([input])=>String(input).includes('/sign/'))).toBe(false);
});
it('refuses a public or misconfigured bucket before uploading or downloading',async()=>{
 for(const changed of [{...bucket,public:true},{...bucket,allowed_mime_types:null},{...bucket,file_size_limit:null},{...bucket,id:'other'}]){
  const {storage,fetch}=setup({bucket:changed});await expect(storage.upload(jobId,ref,envelope)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
  await expect(storage.download(jobId,ref)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);expect(fetch).toHaveBeenCalledTimes(2);
 }
});
it('rejects invalid references, lengths and unsafe destination configuration before network',async()=>{
 const {storage,fetch}=setup();await expect(storage.upload('../unsafe',ref,envelope)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
 await expect(storage.upload(jobId,{...ref,backend:'PRIVATE_DATABASE'},envelope)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
 await expect(storage.upload(jobId,ref,new Uint8Array(42))).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);expect(fetch).not.toHaveBeenCalled();
 for(const unsafe of ['https://name@fixture.supabase.co','https://evil.example','http://fixture.supabase.co','https://fixture.supabase.co/path','https://fixture.supabase.co/?key=value'])
  expect(()=>createOriginalStorage({url:unsafe,secretKey,fetch})).toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
});
it('bounds decoded download bytes and normalizes upstream errors without leaking details',async()=>{
 for(const download of [new Response(new Uint8Array(42)),new Response('PRIVATE_UPSTREAM_FIXTURE',{status:503}),new Response('',{status:302,headers:{location:'https://evil.example'}})]){
  const {storage}=setup({download});await expect(storage.download(jobId,ref)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
 }
 const {storage}=setup({upload:Response.json({message:'PRIVATE_UPSTREAM_FIXTURE'},{status:409})});await expect(storage.upload(jobId,ref,envelope)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
});
it('cancels an unfinished download at the total storage deadline',async()=>{
 vi.useFakeTimers();try{
  const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1]));},cancel});
  const {storage}=setup({download:new Response(stream)}),pending=expect(storage.download(jobId,ref)).rejects.toThrow(/^IMPORT_STORAGE_UNAVAILABLE$/);
  await vi.advanceTimersByTimeAsync(15_000);await pending;expect(cancel).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
it('provisions only a missing private bucket and never updates or deletes an existing bucket',async()=>{
 let exists=false;
 const fetch=vi.fn<typeof globalThis.fetch>(async(_input,init)=>{
  if(init?.method==='POST'){exists=true;expect(JSON.parse(String(init.body))).toMatchObject({id:ORIGINAL_BUCKET,public:false,file_size_limit:20*1024*1024+33,allowed_mime_types:['application/octet-stream']});return Response.json({name:ORIGINAL_BUCKET});}
  return exists?Response.json(bucket):Response.json({message:'Bucket not found',statusCode:'404',error:'not found'},{status:404});
 });
 await provisionOriginalStorage({url,secretKey,fetch});await provisionOriginalStorage({url,secretKey,fetch});
 expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 expect(fetch.mock.calls.some(([,init])=>init?.method==='PUT'||init?.method==='DELETE')).toBe(false);
});
