import {AIProviderError} from '../types';
import type {EmbeddingAdapter,EmbeddingRequest,EmbeddingResponse} from '../embedding-types';
import {isEmbeddingDimensionAllowed} from '../embedding-models';

const OPENAI_BASE='https://api.openai.com/v1';
const MAX_REQUEST_BYTES=512*1024;
const MAX_RESPONSE_BYTES=2*1024*1024;
const MAX_INPUTS=16;
const MAX_INPUT_BYTES=6000;
const MAX_USAGE_TOKENS=300_000;
const MODEL_ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const encoder=new TextEncoder();

type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasExactKeys(value:JsonRecord,keys:string[]):boolean {
 const actual=Object.keys(value);
 if(actual.length!==keys.length||keys.some((key)=>!Object.hasOwn(value,key)))return false;
 for(const key of actual){
  if(!keys.includes(key))return false;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!('value' in descriptor))return false;
 }
 return true;
}

function invalidRequest():AIProviderError {return new AIProviderError('INVALID_REQUEST');}
function invalidOutput():AIProviderError {return new AIProviderError('INVALID_OUTPUT');}
function unavailable():AIProviderError {return new AIProviderError('PROVIDER_UNAVAILABLE');}

function validateSignal(signal:unknown):asserts signal is AbortSignal {
 if(!signal||typeof signal!=='object'||typeof (signal as AbortSignal).aborted!=='boolean'||
  typeof (signal as AbortSignal).addEventListener!=='function'||
  typeof (signal as AbortSignal).removeEventListener!=='function')throw invalidRequest();
}

function validateRequest(value:EmbeddingRequest):string {
 if(!isRecord(value)||!hasExactKeys(value,['modelId','baseUrl','apiKey','input','dimensions','signal']))throw invalidRequest();
 if(typeof value.modelId!=='string'||!MODEL_ID_PATTERN.test(value.modelId))throw invalidRequest();
 if(value.baseUrl!==OPENAI_BASE&&value.baseUrl!==`${OPENAI_BASE}/`)throw invalidRequest();
 if(typeof value.apiKey!=='string'||value.apiKey.length<1||value.apiKey.length>512||
  value.apiKey.trim()!==value.apiKey||/\s/.test(value.apiKey))throw invalidRequest();
 validateSignal(value.signal);
 if(!Number.isSafeInteger(value.dimensions)||!isEmbeddingDimensionAllowed(value.modelId,Number(value.dimensions)))throw invalidRequest();
 if(!Array.isArray(value.input)||value.input.length<1||value.input.length>MAX_INPUTS)throw invalidRequest();
 const input:string[]=[];
 for(let index=0;index<value.input.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value.input,String(index));
  if(!descriptor||!('value' in descriptor)||typeof descriptor.value!=='string'||descriptor.value.length===0||
   encoder.encode(descriptor.value).byteLength>MAX_INPUT_BYTES)throw invalidRequest();
  input.push(descriptor.value);
 }
 const body={model:value.modelId,input,encoding_format:'float',
  ...(value.modelId==='text-embedding-ada-002'?{}:{dimensions:value.dimensions})};
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

function responseError(status:number):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status);
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500)return new AIProviderError('SERVER_ERROR',status);
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
  if(contentLength&&/^\d+$/.test(contentLength)&&Number(contentLength)>MAX_RESPONSE_BYTES){
   cancel();
   throw invalidOutput();
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
  return await fetchImpl(`${OPENAI_BASE}/embeddings`,{
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

function parseResponse(value:unknown,request:EmbeddingRequest):EmbeddingResponse {
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
 return {vectors:vectors as number[][],inputTokens:parseUsage(value.usage)};
}

export function createOpenAIEmbeddingAdapter(options:{fetchImpl?:typeof fetch}={}):EmbeddingAdapter {
 const fetchImpl=options.fetchImpl??fetch;
 return {
  async embed(request):Promise<EmbeddingResponse>{
   let body:string;
   try{body=validateRequest(request);}
   catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   const response=await fetchSafely(fetchImpl,request.signal,body,request.apiKey);
   if(response.status!==200){cancelBody(response);throw responseError(response.status);}
   let payload:unknown;
   try{payload=JSON.parse(await readBoundedBody(response,request.signal));}
   catch(error){if(error instanceof AIProviderError)throw error;throw invalidOutput();}
   return parseResponse(payload,request);
  },
 };
}
