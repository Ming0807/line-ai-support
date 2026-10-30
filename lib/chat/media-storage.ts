import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {readServerEnv} from '../config/env';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,chatMediaRefSchema,type ChatMediaRef,type ChatMediaStorage} from './media-binary';
import {chatMediaInterruptible,readChatMediaBody} from './media-line';

export const CHAT_MEDIA_BUCKET='chat-attachments';
type Config={url?:string;secretKey?:string;fetch?:typeof globalThis.fetch};
function configuration(options:Config){
 try{
  const env=options.url&&options.secretKey?null:readServerEnv(),value=options.url??env?.supabaseUrl,secretKey=options.secretKey??env?.supabaseSecretKey;
  if(!value||!secretKey||secretKey.length>8192||/[\p{Cc}]/u.test(secretKey))throw new ChatMediaError('UNAVAILABLE');
  const url=new URL(value),local=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port==='54421';
  if((!local&&(url.protocol!=='https:'||url.port||!/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname)))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
   throw new ChatMediaError('UNAVAILABLE');
  return {url:url.origin,secretKey,fetch:options.fetch??globalThis.fetch};
 }catch{throw new ChatMediaError('UNAVAILABLE');}
}
function pathFor(ref:ChatMediaRef):string {
 if(!chatMediaRefSchema.safeParse(ref).success||ref.attachmentId!==ref.attachmentId.toLowerCase()||ref.objectId!==ref.objectId.toLowerCase())throw new ChatMediaError('INVALID_ATTACHMENT');
 return `${ref.attachmentId}/${ref.objectId}.yruc`;
}
const bucketSchema=z.object({id:z.literal(CHAT_MEDIA_BUCKET),name:z.literal(CHAT_MEDIA_BUCKET),public:z.literal(false),
 file_size_limit:z.literal(CHAT_MEDIA_MAX_BYTES+33),allowed_mime_types:z.tuple([z.literal('application/octet-stream')])});
async function verifyBucket(client:SupabaseClient){const {data,error}=await client.storage.getBucket(CHAT_MEDIA_BUCKET);
 if(error||!bucketSchema.safeParse(data).success)throw new ChatMediaError('UNAVAILABLE');}
async function operation<T>(config:ReturnType<typeof configuration>,path:string|null,max:number,work:(client:SupabaseClient)=>Promise<T>,signal?:AbortSignal):Promise<T> {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  const target=new URL(String(input)),method=init?.method??'GET';
  const object=path!==null&&target.pathname===`/storage/v1/object/${CHAT_MEDIA_BUCKET}/${path}`&&['GET','POST'].includes(method);
  const bucket=target.pathname===`/storage/v1/bucket/${CHAT_MEDIA_BUCKET}`&&method==='GET'||path===null&&target.pathname==='/storage/v1/bucket'&&method==='POST';
  if(target.origin!==config.url||target.search||target.hash||!object&&!bucket||controller.signal.aborted)throw new ChatMediaError('UNAVAILABLE');
  const headers=new Headers(init?.headers);headers.set('accept-encoding','identity');
  const response=await chatMediaInterruptible(config.fetch(target.href,{...init,headers,redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal,
   value=>{void value.body?.cancel().catch(()=>undefined);});
  if(response.status>=300&&response.status<400||response.url&&response.url!==target.href){void response.body?.cancel().catch(()=>undefined);throw new ChatMediaError('UNAVAILABLE');}
  const bytes=await readChatMediaBody(response,object&&method==='GET'&&response.ok?max:65536,controller.signal);
  const responseHeaders=new Headers(response.headers);responseHeaders.delete('content-encoding');responseHeaders.set('content-length',String(bytes.length));
  return new Response(new Uint8Array(bytes).buffer,{status:response.status,headers:responseHeaders});
 };
 try{
  const client=createClient(config.url,config.secretKey,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch}});
  return await work(client);
 }catch{throw new ChatMediaError('UNAVAILABLE');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
export function createChatMediaStorage(options:Config={}):ChatMediaStorage {
 const config=configuration(options);
 return {
  async put(ref,envelope){
   const path=pathFor(ref);if(!(envelope instanceof Uint8Array)||envelope.length!==ref.byteLength+33)throw new ChatMediaError('INVALID_ATTACHMENT');
   await operation(config,path,envelope.length,async client=>{
    await verifyBucket(client);
    const {error}=await client.storage.from(CHAT_MEDIA_BUCKET).upload(path,envelope,{contentType:'application/octet-stream',cacheControl:'0',upsert:false});
    if(error)throw new ChatMediaError('UNAVAILABLE');
   });
  },
  async get(ref,signal){
   const path=pathFor(ref);return operation(config,path,ref.byteLength+33,async client=>{
    await verifyBucket(client);const {data,error}=await client.storage.from(CHAT_MEDIA_BUCKET).download(path);
    if(error||!data||data.size!==ref.byteLength+33)throw new ChatMediaError('UNAVAILABLE');return new Uint8Array(await data.arrayBuffer());
   },signal);
  },
 };
}
/** Read-only startup readiness; provisioning remains an explicit guarded action. */
export async function verifyChatMediaStorage(options:Config={}):Promise<void> {
 await operation(configuration(options),null,65536,client=>verifyBucket(client));
}
/** Operator setup: existing bucket configuration must already match, never rewrite it. */
export async function provisionChatMediaStorage(options:Config={}):Promise<void> {
 await operation(configuration(options),null,65536,async client=>{
  const existing=await client.storage.getBucket(CHAT_MEDIA_BUCKET);
  if(!existing.error){if(!bucketSchema.safeParse(existing.data).success)throw new ChatMediaError('UNAVAILABLE');return;}
  if(!('status'in existing.error&&existing.error.status===404||'statusCode'in existing.error&&existing.error.statusCode==='404'))throw new ChatMediaError('UNAVAILABLE');
  const {error}=await client.storage.createBucket(CHAT_MEDIA_BUCKET,{public:false,fileSizeLimit:CHAT_MEDIA_MAX_BYTES+33,allowedMimeTypes:['application/octet-stream']});
  if(error)throw new ChatMediaError('UNAVAILABLE');await verifyBucket(client);
 });
}
