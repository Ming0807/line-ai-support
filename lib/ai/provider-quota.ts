import {AIProviderError} from './types';
import type {AIErrorCode} from './types';
import type {QuotaCounter,QuotaReadResult,QuotaState} from '../../types/provider-observations';

const OPENROUTER_BASE='https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS=10_000;
const MAX_RESPONSE_BYTES=64*1024;
// Five minutes is this app's freshness policy, not an OpenRouter quota guarantee.
const MAX_QUOTA_AGE_MS=5*60*1000;
const MAX_API_KEY_LENGTH=512;

type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function safeNow():string {return new Date().toISOString();}

function isAbortError(error:unknown):boolean {
 return Boolean(error&&typeof error==='object'&&'name' in error&&
  ['AbortError','TimeoutError'].includes(String((error as {name:unknown}).name)));
}

function signalError(signal:AbortSignal):AIProviderError {
 const reason=signal.reason;
 const name=reason&&typeof reason==='object'&&'name' in reason?String((reason as {name:unknown}).name):'';
 return new AIProviderError(name==='TimeoutError'?'TIMEOUT':'CANCELLED');
}

function normalizeError(error:unknown):AIErrorCode {
 if(error instanceof AIProviderError)return error.code;
 if(error&&typeof error==='object'&&'name' in error){
  const name=String((error as {name:unknown}).name);
  if(name==='TimeoutError')return 'TIMEOUT';
  if(name==='AbortError')return 'CANCELLED';
 }
 return 'PROVIDER_UNAVAILABLE';
}

function errorForStatus(status:number):AIErrorCode {
 if(status===401||status===403)return 'AUTH_ERROR';
 if(status===408)return 'TIMEOUT';
 if(status===429)return 'RATE_LIMITED';
 if(status===404)return 'MODEL_UNAVAILABLE';
 if(status>=500)return 'SERVER_ERROR';
 if(status>=400)return 'INVALID_REQUEST';
 return 'PROVIDER_UNAVAILABLE';
}

function result(supported:boolean,httpStatus:number|null,errorCode:AIErrorCode|null,counters:QuotaCounter[]=[],observedAt=safeNow()):QuotaReadResult {
 return {supported,httpStatus,errorCode,observedAt,counters};
}

function validateSignal(signal:unknown):asserts signal is AbortSignal {
 if(!signal||typeof signal!=='object'||typeof (signal as AbortSignal).aborted!=='boolean'||
  typeof (signal as AbortSignal).addEventListener!=='function'||
  typeof (signal as AbortSignal).removeEventListener!=='function')throw new AIProviderError('INVALID_REQUEST');
}

function validateConfig(config:unknown):asserts config is {adapter:string;baseUrl:string;apiKey:string} {
 if(!isRecord(config)||typeof config.adapter!=='string'||typeof config.baseUrl!=='string'||
  typeof config.apiKey!=='string'||config.apiKey.length<1||config.apiKey.length>MAX_API_KEY_LENGTH||
  config.apiKey.trim()!==config.apiKey||/\s/.test(config.apiKey)||
  (config.baseUrl!==OPENROUTER_BASE&&config.baseUrl!==`${OPENROUTER_BASE}/`))
  throw new AIProviderError('INVALID_REQUEST');
}

function makeDeadline(parent:AbortSignal):{signal:AbortSignal;dispose:()=>void} {
 const controller=new AbortController();
 const abortFromParent=()=>controller.abort(parent.reason??new DOMException('','AbortError'));
 if(parent.aborted)abortFromParent();
 else parent.addEventListener('abort',abortFromParent,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('','TimeoutError')),REQUEST_TIMEOUT_MS);
 return {signal:controller.signal,dispose:()=>{
  clearTimeout(timer);
  parent.removeEventListener('abort',abortFromParent);
 }};
}

function raceAbort<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>signal.removeEventListener('abort',onAbort);
  const onAbort=()=>{
   if(settled)return;
   settled=true;
   cleanup();
   reject(signalError(signal));
  };
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  promise.then((value)=>{
   if(settled)return;
   settled=true;
   cleanup();
   resolve(value);
  },(error:unknown)=>{
   if(settled)return;
   settled=true;
   cleanup();
   reject(error);
  });
 });
}

function cancelBody(response:Response):void {
 try{void response.body?.cancel().catch(()=>undefined);}catch{}
}

async function fetchBounded(fetchImpl:typeof fetch,apiKey:string,signal:AbortSignal):Promise<Response> {
 if(signal.aborted)throw signalError(signal);
 const fetchPromise=Promise.resolve().then(()=>fetchImpl(`${OPENROUTER_BASE}/key`,{
  method:'GET',headers:{authorization:`Bearer ${apiKey}`},signal,redirect:'error',
 })).then((response)=>{
  if(signal.aborted){cancelBody(response);throw signalError(signal);}
  return response;
 });
 try{return await raceAbort(fetchPromise,signal);}
 catch(error){
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted||isAbortError(error))throw signal.aborted?signalError(signal):new AIProviderError(normalizeError(error));
  throw new AIProviderError('PROVIDER_UNAVAILABLE');
 }
}

async function readWithAbort(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw signalError(signal);
 return raceAbort(reader.read(),signal);
}

async function readBoundedBody(response:Response,signal:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();
 if(!reader)throw new AIProviderError('INVALID_OUTPUT');
 const chunks:Uint8Array[]=[];
 let total=0;
 let cancellationRequested=false;
 const cancel=()=>{
  if(cancellationRequested)return;
  cancellationRequested=true;
  try{void reader.cancel().catch(()=>undefined);}catch{}
 };
 try{
  const contentLength=response.headers.get('content-length');
  if(contentLength!==null){
   if(!/^\d+$/.test(contentLength)||Number(contentLength)>MAX_RESPONSE_BYTES){
    cancel();
    throw new AIProviderError('INVALID_OUTPUT');
   }
  }
  while(true){
   if(signal.aborted)throw signalError(signal);
   const item=await readWithAbort(reader,signal);
   if(item.done)break;
   total+=item.value.byteLength;
   if(total>MAX_RESPONSE_BYTES){
    cancel();
    throw new AIProviderError('INVALID_OUTPUT');
   }
   chunks.push(item.value);
  }
 }catch(error){
  cancel();
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted||isAbortError(error))throw signal.aborted?signalError(signal):new AIProviderError(normalizeError(error));
  throw new AIProviderError('PROVIDER_UNAVAILABLE');
 }finally{
  try{reader.releaseLock();}catch{}
 }
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw new AIProviderError('INVALID_OUTPUT');}
}

function parseNullableNonNegativeNumber(value:unknown,present:boolean):number|null {
 if(!present)return null;
 if(value===null)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new AIProviderError('INVALID_OUTPUT');
 return value;
}

function keyCreditWindow(value:unknown,present:boolean):QuotaCounter['window'] {
 if(!present)return 'UNKNOWN';
 if(value===null)return 'TOTAL';
 if(typeof value!=='string')throw new AIProviderError('INVALID_OUTPUT');
 if(value==='daily')return 'DAY';
 if(value==='monthly')return 'MONTH';
 // The frozen counter contract has no WEEK window; do not relabel it as TOTAL or MONTH.
 return 'UNKNOWN';
}

function parseCounters(data:JsonRecord,observedAt:string):QuotaCounter[] {
 const counters:QuotaCounter[]=[];
 const hasLimit=Object.hasOwn(data,'limit');
 const hasRemaining=Object.hasOwn(data,'limit_remaining');
 const hasReset=Object.hasOwn(data,'limit_reset');
 if(hasLimit||hasRemaining||hasReset){
  const limit=parseNullableNonNegativeNumber(data.limit,hasLimit);
  const remaining=parseNullableNonNegativeNumber(data.limit_remaining,hasRemaining);
  if(hasLimit&&hasRemaining&&((limit===null)!==(remaining===null)))throw new AIProviderError('INVALID_OUTPUT');
  if(limit!==null&&remaining!==null&&remaining>limit)throw new AIProviderError('INVALID_OUTPUT');
  const window=keyCreditWindow(data.limit_reset,hasReset);
  counters.push({scope:'PROVIDER_KEY',unit:'CREDITS',window,source:'OPENROUTER_KEY',
   limit,remaining,resetAt:null,retryAfterSeconds:null,observedAt,currency:'USD'});
 }
 if(Object.hasOwn(data,'free_model_daily_requests')&&data.free_model_daily_requests!==null){
  const free=data.free_model_daily_requests;
  if(!isRecord(free)||!['used','limit','remaining'].every((key)=>Object.hasOwn(free,key)))
   throw new AIProviderError('INVALID_OUTPUT');
  const {used,limit,remaining}=free;
  if(typeof used!=='number'||!Number.isSafeInteger(used)||used<0||
   typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<0||
   typeof remaining!=='number'||!Number.isSafeInteger(remaining)||remaining<0||
   used>limit||remaining>limit||used+remaining!==limit)
   throw new AIProviderError('INVALID_OUTPUT');
  counters.push({scope:'ACCOUNT',unit:'REQUESTS',window:'DAY',source:'OPENROUTER_KEY',
   limit,remaining,resetAt:null,retryAfterSeconds:null,observedAt,currency:null});
 }
 return counters;
}

function parseResponse(text:string,observedAt:string):QuotaCounter[] {
 let payload:unknown;
 try{payload=JSON.parse(text);}catch{throw new AIProviderError('INVALID_OUTPUT');}
 if(!isRecord(payload)||!isRecord(payload.data))throw new AIProviderError('INVALID_OUTPUT');
 return parseCounters(payload.data,observedAt);
}

export function quotaState(counter:QuotaCounter,now=Date.now()):QuotaState {
 if(!Number.isFinite(now)||now<0||!isRecord(counter))return 'UNKNOWN';
 if(!['MODEL','PROVIDER_KEY','ACCOUNT'].includes(String(counter.scope))||
  !['REQUESTS','TOKENS','CREDITS'].includes(String(counter.unit))||
  !['MINUTE','DAY','MONTH','TOTAL'].includes(String(counter.window))||
  !['OPENROUTER_KEY','RATE_LIMIT_HEADERS'].includes(String(counter.source)))return 'UNKNOWN';
 if((counter.unit==='CREDITS'&&counter.currency!=='USD')||
  (counter.unit!=='CREDITS'&&counter.currency!==null))return 'UNKNOWN';
 if(counter.source==='OPENROUTER_KEY'&&
  ((counter.unit==='CREDITS'&&counter.scope!=='PROVIDER_KEY')||
   (counter.unit==='REQUESTS'&&counter.scope!=='ACCOUNT')))return 'UNKNOWN';
 const observedMs=Date.parse(counter.observedAt);
 if(!Number.isFinite(observedMs)||new Date(observedMs).toISOString()!==counter.observedAt||
  observedMs>now||now-observedMs>=MAX_QUOTA_AGE_MS)return 'UNKNOWN';
 if(counter.resetAt!==null){
  const resetMs=Date.parse(counter.resetAt);
  if(!Number.isFinite(resetMs)||new Date(resetMs).toISOString()!==counter.resetAt||
   resetMs<=observedMs||resetMs<=now)return 'UNKNOWN';
 }
 if(counter.retryAfterSeconds!==null&&
  (typeof counter.retryAfterSeconds!=='number'||!Number.isFinite(counter.retryAfterSeconds)||counter.retryAfterSeconds<0))
  return 'UNKNOWN';
 if(typeof counter.limit!=='number'||!Number.isFinite(counter.limit)||counter.limit<0||
  typeof counter.remaining!=='number'||!Number.isFinite(counter.remaining)||counter.remaining<0||
  counter.remaining>counter.limit)return 'UNKNOWN';
 if(counter.unit==='REQUESTS'&&( !Number.isSafeInteger(counter.limit)||!Number.isSafeInteger(counter.remaining)))return 'UNKNOWN';
 if(counter.remaining===0)return 'EXHAUSTED';
 if(counter.limit<=0)return 'UNKNOWN';
 return counter.remaining/counter.limit<=0.1?'NEAR_LIMIT':'AVAILABLE';
}

export function createQuotaReader(options:{fetchImpl?:typeof fetch}={}):(
 config:{adapter:string;baseUrl:string;apiKey:string},signal:AbortSignal,
)=>Promise<QuotaReadResult> {
 const fetchImpl=options.fetchImpl??fetch;
 return async(config,signal)=>{
  const startedAt=safeNow();
  if(!isRecord(config)||typeof config.adapter!=='string')return result(false,null,'INVALID_REQUEST',[],startedAt);
  if(config.adapter!=='OPENROUTER')return result(false,null,null,[],startedAt);
  try{
   validateConfig(config);
   validateSignal(signal);
  }catch(error){
   return result(true,null,normalizeError(error)==='PROVIDER_UNAVAILABLE'?'INVALID_REQUEST':normalizeError(error),[],startedAt);
  }
  const deadline=makeDeadline(signal);
  let response:Response|undefined;
  try{
   if(deadline.signal.aborted)throw signalError(deadline.signal);
   response=await fetchBounded(fetchImpl,config.apiKey,deadline.signal);
   if(response.status!==200){
    cancelBody(response);
    return result(true,response.status,errorForStatus(response.status),[],safeNow());
   }
   const text=await readBoundedBody(response,deadline.signal);
   if(deadline.signal.aborted)throw signalError(deadline.signal);
   const observedAt=safeNow();
   const counters=parseResponse(text,observedAt);
   return result(true,response.status,null,counters,observedAt);
  }catch(error){
   return result(true,response?.status??null,normalizeError(error),[],safeNow());
  }finally{deadline.dispose();}
 };
}
