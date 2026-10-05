import {AIProviderError} from '../types';
import {readRetryEvidence} from '../retry-evidence';
import type {EmbeddingAdapter,EmbeddingRequest,EmbeddingResponse} from '../embedding-types';

const OPENROUTER_BASE='https://openrouter.ai/api/v1';
const MAX_REQUEST_BYTES=512*1024;
const MAX_RESPONSE_BYTES=2*1024*1024;
const MAX_INPUTS=16;
const MAX_INPUT_BYTES=6000;
const MAX_DIMENSIONS=4096;
const MAX_USAGE_TOKENS=300_000;
const MODEL_ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/;
const encoder=new TextEncoder();

type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasAllowedKeys(value:JsonRecord,required:string[],optional:string[]=[]):boolean {
 const actual=Object.keys(value);
 if(required.some((key)=>!Object.hasOwn(value,key))||actual.some((key)=>!required.includes(key)&&!optional.includes(key)))return false;
 for(const key of actual){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!('value' in descriptor))return false;
 }
 return true;
}

function invalidRequest():AIProviderError {return new AIProviderError('INVALID_REQUEST');}
function invalidOutput(httpStatus?:number):AIProviderError {return new AIProviderError('INVALID_OUTPUT',httpStatus);}
function unavailable():AIProviderError {return new AIProviderError('PROVIDER_UNAVAILABLE');}

function withHttpStatus(error:unknown,httpStatus:number):AIProviderError {
 if(error instanceof AIProviderError)return new AIProviderError(error.code,httpStatus);
 return invalidOutput(httpStatus);
}

function validateSignal(signal:unknown):asserts signal is AbortSignal {
 if(!signal||typeof signal!=='object'||typeof (signal as AbortSignal).aborted!=='boolean'||
  typeof (signal as AbortSignal).addEventListener!=='function'||
  typeof (signal as AbortSignal).removeEventListener!=='function')throw invalidRequest();
}

function validateRequest(value:EmbeddingRequest):string {
 if(!isRecord(value)||!hasAllowedKeys(value,
  ['modelId','baseUrl','apiKey','input','dimensions','signal'],['costMode']))throw invalidRequest();
 const request=value as JsonRecord;
 if(typeof request.modelId!=='string'||request.modelId.length>200||!MODEL_ID_PATTERN.test(request.modelId))throw invalidRequest();
 if(request.baseUrl!==OPENROUTER_BASE&&request.baseUrl!==`${OPENROUTER_BASE}/`)throw invalidRequest();
 if(typeof request.apiKey!=='string'||request.apiKey.length<1||request.apiKey.length>512||
  request.apiKey.trim()!==request.apiKey||/\s/.test(request.apiKey))throw invalidRequest();
 if(Object.hasOwn(request,'costMode')&&request.costMode!=='FREE_ONLY'&&request.costMode!=='ALLOW_PAID')throw invalidRequest();
 validateSignal(request.signal);
 if(!Number.isSafeInteger(request.dimensions)||Number(request.dimensions)<1||Number(request.dimensions)>MAX_DIMENSIONS)
  throw invalidRequest();
 if(!Array.isArray(request.input)||request.input.length<1||request.input.length>MAX_INPUTS)throw invalidRequest();
 const input:string[]=[];
 for(let index=0;index<request.input.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(request.input,String(index));
  if(!descriptor||!('value' in descriptor)||typeof descriptor.value!=='string'||descriptor.value.length===0||
   encoder.encode(descriptor.value).byteLength>MAX_INPUT_BYTES)throw invalidRequest();
  input.push(descriptor.value);
 }
 const body={model:request.modelId,input,encoding_format:'float',dimensions:request.dimensions};
 const serialized=JSON.stringify(body);
 if(encoder.encode(serialized).byteLength>MAX_REQUEST_BYTES)throw invalidRequest();
 return serialized;
}

function errorForSignal(signal:AbortSignal,error?:unknown):AIProviderError {
 const reason=signal.reason;
 const reasonName=reason&&typeof reason==='object'&&'name' in reason?String((reason as {name:unknown}).name):'';
 const errorName=error&&typeof error==='object'&&'name' in error?String((error as {name:unknown}).name):'';
 return new AIProviderError(reasonName==='TimeoutError'||errorName==='TimeoutError'?'TIMEOUT':'CANCELLED');
}

function isAbortError(error:unknown):boolean {
 return Boolean(error&&typeof error==='object'&&'name' in error&&
  ['AbortError','TimeoutError'].includes(String((error as {name:unknown}).name)));
}

function responseError(status:number,headers:Headers):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===408)return new AIProviderError('TIMEOUT',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status,readRetryEvidence(status,headers));
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500)return new AIProviderError('SERVER_ERROR',status,readRetryEvidence(status,headers));
 if(status>=400)return new AIProviderError('INVALID_REQUEST',status);
 return new AIProviderError('PROVIDER_UNAVAILABLE',status);
}

function cancelBody(response:Response):void {
 try{void response.body?.cancel().catch(()=>undefined);}catch{}
}

async function readWithAbort(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal,cancel:()=>void):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw errorForSignal(signal);
 let onAbort=()=>{};
 const aborted=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>{cancel();reject(errorForSignal(signal));};
  signal.addEventListener('abort',onAbort,{once:true});
 });
 try{
  if(signal.aborted)onAbort();
  return await Promise.race([reader.read(),aborted]);
 }finally{
  signal.removeEventListener('abort',onAbort);
 }
}

async function readBoundedBody(response:Response,signal:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();
 if(!reader)throw invalidOutput();
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
    throw invalidOutput();
   }
  }
  while(true){
   if(signal.aborted)throw errorForSignal(signal);
   const item=await readWithAbort(reader,signal,cancel);
   if(item.done)break;
   total+=item.value.byteLength;
   if(total>MAX_RESPONSE_BYTES){
    cancel();
    throw invalidOutput();
   }
   chunks.push(item.value);
  }
 }catch(error){
  cancel();
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted||isAbortError(error))throw errorForSignal(signal,error);
  throw unavailable();
 }finally{
  try{reader.releaseLock();}catch{}
 }
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw invalidOutput();}
}

async function fetchSafely(fetchImpl:typeof fetch,signal:AbortSignal,body:string,apiKey:string):Promise<Response> {
 if(signal.aborted)throw errorForSignal(signal);
 try{
  return await fetchImpl(`${OPENROUTER_BASE}/embeddings`,{
   method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
   body,signal,redirect:'error',
  });
 }catch(error){
  if(signal.aborted||isAbortError(error))throw errorForSignal(signal,error);
  throw unavailable();
 }
}

function parseUsage(value:unknown):number|null {
 if(value===undefined||value===null)return null;
 if(!isRecord(value))throw invalidOutput();
 const promptTokens=value.prompt_tokens;
 const totalTokens=value.total_tokens;
 if(typeof promptTokens!=='number'||!Number.isSafeInteger(promptTokens)||promptTokens<0||promptTokens>MAX_USAGE_TOKENS||
  typeof totalTokens!=='number'||!Number.isSafeInteger(totalTokens)||totalTokens<promptTokens||totalTokens>MAX_USAGE_TOKENS)
  throw invalidOutput();
 return promptTokens;
}

function parseResponse(value:unknown,request:EmbeddingRequest,httpStatus:number):EmbeddingResponse {
 if(!isRecord(value)||value.object!=='list'||value.model!==request.modelId||
  !Array.isArray(value.data)||value.data.length!==request.input.length)throw invalidOutput();
 const vectors:Array<number[]|undefined>=Array.from({length:request.input.length},()=>undefined);
 for(const item of value.data){
  if(!isRecord(item)||item.object!=='embedding'||typeof item.index!=='number'||!Number.isSafeInteger(item.index)||
   item.index<0||item.index>=vectors.length||vectors[item.index]!==undefined||
   !Array.isArray(item.embedding)||item.embedding.length!==request.dimensions)throw invalidOutput();
  const vector:number[]=[];
  for(const number of item.embedding){
   if(typeof number!=='number'||!Number.isFinite(number))throw invalidOutput();
   vector.push(number);
  }
  if(!vector.some((number)=>number!==0))throw invalidOutput();
  vectors[item.index]=vector;
 }
 if(vectors.some((vector)=>vector===undefined))throw invalidOutput();
 return {vectors:vectors as number[][],inputTokens:parseUsage(value.usage),httpStatus};
}

export function createOpenRouterEmbeddingAdapter(options:{fetchImpl?:typeof fetch}={}):EmbeddingAdapter {
 const fetchImpl=options.fetchImpl??fetch;
 return {
  async embed(request):Promise<EmbeddingResponse>{
   let body:string;
   try{body=validateRequest(request);}
   catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   const response=await fetchSafely(fetchImpl,request.signal,body,request.apiKey);
   if(response.status!==200){const failure=responseError(response.status,response.headers);cancelBody(response);throw failure;}
   let serialized:string;
   try{serialized=await readBoundedBody(response,request.signal);}
   catch(error){throw withHttpStatus(error,response.status);}
   let payload:unknown;
   try{payload=JSON.parse(serialized);}
   catch{throw invalidOutput(response.status);}
   try{return parseResponse(payload,request,response.status);}
   catch(error){throw withHttpStatus(error,response.status);}
  },
 };
}
