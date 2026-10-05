import {parseCompatibleBaseUrl} from '../compatible-endpoint';
import type {CompatibleTransport} from '../compatible-network';
import {AIProviderError} from '../types';
import {readRetryEvidence} from '../retry-evidence';
import type {EmbeddingAdapter,EmbeddingRequest,EmbeddingResponse} from '../embedding-types';

const MAX_REQUEST_BYTES=512*1024;
const MAX_INPUTS=16;
const MAX_INPUT_BYTES=6000;
const MAX_DIMENSIONS=4096;
const MAX_USAGE_TOKENS=300_000;
const MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)?$/;
const encoder=new TextEncoder();
type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasExactKeys(value:JsonRecord,required:string[],optional:string[]=[]):boolean {
 const allowed=new Set([...required,...optional]),keys=Object.keys(value);
 if(required.some(key=>!Object.hasOwn(value,key))||keys.some(key=>!allowed.has(key)))return false;
 return keys.every(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return Boolean(descriptor&&'value'in descriptor);});
}

function invalidRequest():AIProviderError{return new AIProviderError('INVALID_REQUEST');}
function invalidOutput(httpStatus?:number):AIProviderError{return new AIProviderError('INVALID_OUTPUT',httpStatus);}
function unavailable(httpStatus?:number):AIProviderError{return new AIProviderError('PROVIDER_UNAVAILABLE',httpStatus);}

function safeJson(value:unknown):string {
 let nodes=0,bytes=0;
 const stack=new Set<object>();
 const visit=(item:unknown,depth=0):void=>{
  if(++nodes>20_000||depth>40)throw invalidRequest();
  if(item===null||typeof item==='boolean')return;
  if(typeof item==='number'){if(!Number.isFinite(item))throw invalidRequest();return;}
  if(typeof item==='string'){
   bytes+=encoder.encode(item).byteLength;
   if(bytes>MAX_REQUEST_BYTES)throw invalidRequest();
   return;
  }
  if(typeof item!=='object'||stack.has(item))throw invalidRequest();
  stack.add(item);
  if(Array.isArray(item)){
   if(item.length>10_000)throw invalidRequest();
   for(let index=0;index<item.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(item,String(index));
    if(!descriptor||!('value'in descriptor))throw invalidRequest();
    visit(descriptor.value,depth+1);
   }
  }else{
   if(!isRecord(item))throw invalidRequest();
   const keys=Object.keys(item);
   if(keys.length>10_000)throw invalidRequest();
   for(const key of keys){
    bytes+=encoder.encode(key).byteLength;
    const descriptor=Object.getOwnPropertyDescriptor(item,key);
    if(!descriptor||!('value'in descriptor))throw invalidRequest();
    visit(descriptor.value,depth+1);
   }
  }
  stack.delete(item);
 };
 try{
  if(value===null||typeof value!=='object'||Array.isArray(value))throw invalidRequest();
  visit(value);
  const serialized=JSON.stringify(value);
  if(typeof serialized!=='string'||encoder.encode(serialized).byteLength>MAX_REQUEST_BYTES)throw invalidRequest();
  return serialized;
 }catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
}

function validateSignal(value:unknown):asserts value is AbortSignal {
 if(!(value instanceof AbortSignal))throw invalidRequest();
}

function validateRequest(value:EmbeddingRequest):{baseUrl:string;body:JsonRecord} {
 if(!isRecord(value)||!hasExactKeys(value,['modelId','baseUrl','apiKey','input','dimensions','signal'],['costMode']))throw invalidRequest();
 if(typeof value.modelId!=='string'||value.modelId.length>200||!MODEL_ID.test(value.modelId))throw invalidRequest();
 if(typeof value.apiKey!=='string'||value.apiKey.length<1||value.apiKey.length>512||!/^[\x21-\x7e]+$/.test(value.apiKey))throw invalidRequest();
 if(value.costMode!==undefined&&value.costMode!=='FREE_ONLY'&&value.costMode!=='ALLOW_PAID')throw invalidRequest();
 validateSignal(value.signal);
 if(!Number.isSafeInteger(value.dimensions)||Number(value.dimensions)<1||Number(value.dimensions)>MAX_DIMENSIONS)throw invalidRequest();
 if(!Array.isArray(value.input)||value.input.length<1||value.input.length>MAX_INPUTS)throw invalidRequest();
 const input:string[]=[];
 for(let index=0;index<value.input.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value.input,String(index));
  const item=descriptor&&'value'in descriptor?descriptor.value:undefined;
  if(typeof item!=='string'||item.length===0||encoder.encode(item).byteLength>MAX_INPUT_BYTES)throw invalidRequest();
  input.push(item);
 }
 let baseUrl:string;
 try{baseUrl=parseCompatibleBaseUrl(value.baseUrl).baseUrl;}catch{throw invalidRequest();}
 const body={model:value.modelId,input,encoding_format:'float',dimensions:value.dimensions};
 safeJson(body);
 return {baseUrl,body};
}

function retryEvidence(status:number,retryAfter:unknown) {
 if(typeof retryAfter!=='string'||retryAfter.length>1024)return undefined;
 try{return readRetryEvidence(status,new Headers({'Retry-After':retryAfter}));}catch{return undefined;}
}

function responseError(status:number,retryAfter:unknown):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===408)return new AIProviderError('TIMEOUT',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status,retryEvidence(status,retryAfter));
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500&&status<=599)return new AIProviderError('SERVER_ERROR',status,retryEvidence(status,retryAfter));
 if(status>=400&&status<=499)return new AIProviderError('INVALID_REQUEST',status);
 return unavailable(status);
}

function preserveTransportError(error:unknown):AIProviderError {
 if(error instanceof AIProviderError)return new AIProviderError(error.code,error.httpStatus,error.retryEvidence);
 return unavailable();
}

function jsonContentType(value:unknown):boolean {
 if(typeof value!=='string'||value.length>256)return false;
 const mediaType=value.split(';',1)[0]!.trim().toLowerCase();
 return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(mediaType);
}

function parseUsage(value:unknown):number|null {
 if(value===undefined||value===null)return null;
 if(!isRecord(value))throw invalidOutput();
 const promptTokens=value.prompt_tokens,totalTokens=value.total_tokens;
 if(typeof promptTokens!=='number'||!Number.isSafeInteger(promptTokens)||promptTokens<0||promptTokens>MAX_USAGE_TOKENS||
  typeof totalTokens!=='number'||!Number.isSafeInteger(totalTokens)||totalTokens<promptTokens||totalTokens>MAX_USAGE_TOKENS)
  throw invalidOutput();
 return promptTokens;
}

function parseResponse(value:unknown,request:EmbeddingRequest,httpStatus:number):EmbeddingResponse {
 if(!isRecord(value)||value.object!=='list'||value.model!==request.modelId||!Array.isArray(value.data)||value.data.length!==request.input.length)
  throw invalidOutput(httpStatus);
 const vectors:Array<number[]|undefined>=Array.from({length:request.input.length},()=>undefined);
 for(const item of value.data){
  if(!isRecord(item)||item.object!=='embedding'||typeof item.index!=='number'||!Number.isSafeInteger(item.index)||
   item.index<0||item.index>=vectors.length||vectors[item.index]!==undefined||!Array.isArray(item.embedding)||
   item.embedding.length!==request.dimensions)throw invalidOutput(httpStatus);
  const vector:number[]=[];
  for(let index=0;index<item.embedding.length;index++){
   const descriptor=Object.getOwnPropertyDescriptor(item.embedding,String(index));
   const number=descriptor&&'value'in descriptor?descriptor.value:undefined;
   if(typeof number!=='number'||!Number.isFinite(number))throw invalidOutput(httpStatus);
   vector.push(number);
  }
  if(!vector.some(number=>number!==0))throw invalidOutput(httpStatus);
  vectors[item.index]=vector;
 }
 if(vectors.some(vector=>vector===undefined))throw invalidOutput(httpStatus);
 let inputTokens:number|null;
 try{inputTokens=parseUsage(value.usage);}catch(error){
  if(error instanceof AIProviderError)throw invalidOutput(httpStatus);
  throw invalidOutput(httpStatus);
 }
 return {vectors:vectors as number[][],inputTokens,httpStatus};
}

function parseStatus(value:unknown):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<100||value>599)throw unavailable();
 return value;
}

export function createCompatibleEmbeddingAdapter(options:{transport:CompatibleTransport}):EmbeddingAdapter {
 const transport=options.transport;
 return {
  async embed(request):Promise<EmbeddingResponse>{
   let validated:{baseUrl:string;body:JsonRecord};
   try{validated=validateRequest(request);}catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   if(request.signal.aborted){
    const reason=request.signal.reason;
    throw new AIProviderError(reason instanceof DOMException&&reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED');
   }
   try{
    const response=await transport.request(validated.baseUrl,{route:'embeddings',apiKey:request.apiKey,json:validated.body,signal:request.signal});
    const status=parseStatus(response.status);
    if(status!==200)throw responseError(status,response.retryAfter);
    if(!jsonContentType(response.contentType))throw invalidOutput(status);
    return parseResponse(response.json,request,status);
   }catch(error){
    if(error instanceof AIProviderError)throw preserveTransportError(error);
    if(request.signal.aborted){
     const reason=request.signal.reason;
     throw new AIProviderError(reason instanceof DOMException&&reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED');
    }
    throw unavailable();
   }
  },
 };
}
