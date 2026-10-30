import {CHAT_MEDIA_MAX_BYTES,ChatMediaError} from './media-binary';

/** Abort-race even adapters that ignore signal; never leak a late response body. */
export function chatMediaInterruptible<T>(work:Promise<T>,signal:AbortSignal,onLate?:(value:T)=>void):Promise<T> {
 return new Promise((resolve,reject)=>{
  let settled=false;const abort=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(new ChatMediaError('UNAVAILABLE'));};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  work.then(value=>{if(settled){onLate?.(value);return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},()=>{abort();});
 });
}
export async function readChatMediaBody(response:Response,max:number,signal:AbortSignal):Promise<Uint8Array> {
 const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
 if(encoding&&encoding!=='identity'){void response.body?.cancel().catch(()=>undefined);throw new ChatMediaError('INVALID_ATTACHMENT');}
 if(length!==null&&(!/^\d{1,10}$/u.test(length)||Number(length)>max)){
  void response.body?.cancel().catch(()=>undefined);throw new ChatMediaError('TOO_LARGE');
 }
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0,done=false;
 try{
  if(reader)for(;;){const next=await chatMediaInterruptible(reader.read(),signal);if(next.done){done=true;break;}
   if(!(next.value instanceof Uint8Array)||size+next.value.length>max)throw new ChatMediaError('TOO_LARGE');
   size+=next.value.length;chunks.push(Uint8Array.from(next.value));}
  if(!size||(length!==null&&Number(length)!==size))throw new ChatMediaError('INVALID_ATTACHMENT');
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
 }finally{if(!done)void reader?.cancel().catch(()=>undefined);try{reader?.releaseLock();}catch{}}
}
export async function downloadLineChatMedia(messageId:string,options:{token?:string;fetch?:typeof fetch;signal?:AbortSignal;timeoutMs?:number}={}):Promise<{bytes:Uint8Array;contentType:string}> {
 const token=options.token??process.env.LINE_STUDENT_CHANNEL_ACCESS_TOKEN;
 if(!token||token.length>8192||/[\p{Cc}]/u.test(token))throw new ChatMediaError('UNAVAILABLE');
 if(!messageId||messageId.length>256||messageId==='.'||messageId==='..'||/[\p{Cc}]/u.test(messageId))throw new ChatMediaError('INVALID_ATTACHMENT');
 const timeout=options.timeoutMs??15000;if(!Number.isInteger(timeout)||timeout<1||timeout>15000)throw new ChatMediaError('INVALID_ATTACHMENT');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout),abort=()=>controller.abort();
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 try{
  const url=`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;
  const response=await chatMediaInterruptible((options.fetch??globalThis.fetch)(url,{headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'identity'},redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal,
   value=>{void value.body?.cancel().catch(()=>undefined);});
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);throw new ChatMediaError([404,410].includes(response.status)?'NOT_FOUND':'UNAVAILABLE');}
  if(response.url&&response.url!==url){void response.body?.cancel().catch(()=>undefined);throw new ChatMediaError('UNAVAILABLE');}
  return {bytes:await readChatMediaBody(response,CHAT_MEDIA_MAX_BYTES,controller.signal),contentType:response.headers.get('content-type')??'application/octet-stream'};
 }catch(error){if(error instanceof ChatMediaError)throw error;throw new ChatMediaError('UNAVAILABLE');}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.abort();}
}
