import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {readServerEnv} from '../config/env';
import {IMPORT_LIMITS,importFormats,type OriginalRef} from './types';
export const ORIGINAL_BUCKET='knowledge-originals';
const envelopeLimit=IMPORT_LIMITS.originalBytes+33,metadataLimit=64*1024;
export interface OriginalStorage {
 upload(jobId:string,ref:OriginalRef,envelope:Uint8Array):Promise<void>;
 download(jobId:string,ref:OriginalRef):Promise<Uint8Array>;
}
export interface OriginalStorageConfig {url?:string;secretKey?:string;fetch?:typeof globalThis.fetch}
const unavailable=():never=>{throw new Error('IMPORT_STORAGE_UNAVAILABLE');};
const reference=z.object({id:z.uuid(),backend:z.literal('PRIVATE_STORAGE'),format:z.enum(importFormats),checksum:z.string().regex(/^[a-f0-9]{64}$/),
 byteLength:z.number().int().min(1).max(IMPORT_LIMITS.originalBytes),keyVersion:z.literal(1)}).strict();
function objectPath(jobId:string,ref:OriginalRef):string{
 if(!z.uuid().safeParse(jobId).success||jobId!==jobId.toLowerCase()||!reference.safeParse(ref).success||ref.id!==ref.id.toLowerCase())return unavailable();
 return `${jobId}/${ref.id}.yrue`;
}
function configuration(options:OriginalStorageConfig):{url:string;secretKey:string;fetch:typeof globalThis.fetch}{
 try{
  const env=options.url&&options.secretKey?null:readServerEnv();
  const input=options.url??env?.supabaseUrl,secretKey=options.secretKey??env?.supabaseSecretKey;
  if(!input||!secretKey||secretKey.length>8192||/[\r\n\u0000]/.test(secretKey))return unavailable();
  const url=new URL(input),local=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port==='54421';
  if(!local&&(url.protocol!=='https:'||url.port||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname))||
   url.username||url.password||url.pathname!=='/'||url.search||url.hash)return unavailable();
  return {url:url.origin,secretKey,fetch:options.fetch??globalThis.fetch};
 }catch{return unavailable();}
}
async function interruptible<T>(work:Promise<T>,signal:AbortSignal,onLateValue?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;const onAbort=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);reject(new Error('IMPORT_STORAGE_UNAVAILABLE'));};
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
  work.then(value=>{if(settled){try{onLateValue?.(value);}catch{}return;}settled=true;signal.removeEventListener('abort',onAbort);resolve(value);},()=>{
   if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);reject(new Error('IMPORT_STORAGE_UNAVAILABLE'));
  });
 });
}
async function boundedResponse(response:Response,max:number,signal:AbortSignal):Promise<Response>{
 if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>undefined);return unavailable();}
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,10}$/.test(declared)||Number(declared)>max)){void response.body?.cancel().catch(()=>undefined);return unavailable();}
 const chunks:Uint8Array[]=[];let length=0,complete=false;const reader=response.body?.getReader();
 try{
  if(reader)for(;;){
   const {done,value}=await interruptible(reader.read(),signal);if(done){complete=true;break;}
   if(!(value instanceof Uint8Array)||value.byteLength+length>max)return unavailable();length+=value.byteLength;chunks.push(Uint8Array.from(value));
  }
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.set('content-length',String(length));headers.set('cache-control','private, no-store');
  return new Response(bytes.length?bytes:null,{status:response.status,headers});
 }finally{if(!complete)void reader?.cancel().catch(()=>undefined);try{reader?.releaseLock();}catch{}}
}
async function operation<T>(config:ReturnType<typeof configuration>,path:string|null,max:number,work:(client:SupabaseClient)=>Promise<T>):Promise<T>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const target=new URL(String(input)),method=init?.method??'GET';
  const isObject=path!==null&&target.pathname===`/storage/v1/object/${ORIGINAL_BUCKET}/${path}`&&['GET','POST'].includes(method);
  const isBucket=target.pathname===`/storage/v1/bucket/${ORIGINAL_BUCKET}`&&method==='GET'||target.pathname==='/storage/v1/bucket'&&method==='POST'&&path===null;
  if(target.origin!==config.url||target.search||target.hash||!isObject&&!isBucket||controller.signal.aborted)return unavailable();
  const response=await interruptible(config.fetch(target.href,{...init,redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal,value=>{void value.body?.cancel().catch(()=>undefined);});
  if(response.url&&response.url!==target.href){void response.body?.cancel().catch(()=>undefined);return unavailable();}
  return boundedResponse(response,isObject&&method==='GET'&&response.ok?max:metadataLimit,controller.signal);
 };
 try{
  const client=createClient(config.url,config.secretKey,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch}});
  return await work(client);
 }catch{return unavailable();}finally{clearTimeout(timer);}
}
function verifyBucket(bucket:unknown):void{
 const value=z.object({id:z.literal(ORIGINAL_BUCKET),name:z.literal(ORIGINAL_BUCKET),public:z.literal(false),
  file_size_limit:z.literal(envelopeLimit),allowed_mime_types:z.tuple([z.literal('application/octet-stream')])}).safeParse(bucket);
 if(!value.success)return unavailable();
}
async function privateBucket(client:SupabaseClient):Promise<void>{const {data,error}=await client.storage.getBucket(ORIGINAL_BUCKET);if(error)return unavailable();verifyBucket(data);}
/** Backend-only access. Authorization/revision checks belong to the staging service. */
export function createOriginalStorage(options:OriginalStorageConfig={}):OriginalStorage{
 const config=configuration(options);
 return {
  async upload(jobId,ref,envelope){
   const path=objectPath(jobId,ref);if(!(envelope instanceof Uint8Array)||envelope.length!==ref.byteLength+33)return unavailable();
   await operation(config,path,envelope.length,async client=>{
    await privateBucket(client);
    const {error}=await client.storage.from(ORIGINAL_BUCKET).upload(path,envelope,{contentType:'application/octet-stream',cacheControl:'0',upsert:false});
    if(error)return unavailable();
   });
  },
  async download(jobId,ref){
   const path=objectPath(jobId,ref);
   return operation(config,path,ref.byteLength+33,async client=>{
    await privateBucket(client);const {data,error}=await client.storage.from(ORIGINAL_BUCKET).download(path);
    if(error||!data||data.size!==ref.byteLength+33)return unavailable();return new Uint8Array(await data.arrayBuffer());
   });
  },
 };
}
/** Explicit setup action; existing bucket settings are inspected, never overwritten. */
export async function provisionOriginalStorage(options:OriginalStorageConfig={}):Promise<void>{
 await operation(configuration(options),null,metadataLimit,async client=>{
  const existing=await client.storage.getBucket(ORIGINAL_BUCKET);
  if(!existing.error){verifyBucket(existing.data);return;}
  if(!('status' in existing.error&&existing.error.status===404||'statusCode' in existing.error&&existing.error.statusCode==='404'))return unavailable();
  const {error}=await client.storage.createBucket(ORIGINAL_BUCKET,{public:false,fileSizeLimit:envelopeLimit,allowedMimeTypes:['application/octet-stream']});
  if(error)return unavailable();await privateBucket(client);
 });
}
