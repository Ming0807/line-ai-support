import {types as utilTypes} from 'node:util';
import {AIProviderError} from './types';
import {isPublicAddress,resolvePublicAddresses,type ResolvedAddress} from './public-addresses';
import {parseCompatibleBaseUrl} from './compatible-endpoint';
import {createPinnedHttpsRequest} from './compatible-pinned-https';

export type CompatibleHttpRequest=
 | {route:'models';apiKey:string;signal:AbortSignal}
 | {route:'chat/completions'|'embeddings';apiKey:string;json:unknown;signal:AbortSignal};
export interface CompatibleHttpResponse {
 readonly status:number;readonly contentType:string|null;readonly retryAfter:string|null;readonly json:unknown|null;
}
export interface PinnedHttpsRequestInput {
 readonly url:URL;readonly method:'GET'|'POST';readonly headers:Readonly<Record<string,string>>;
 readonly body:Uint8Array|null;readonly pinnedAddress:ResolvedAddress;readonly signal:AbortSignal;readonly maxResponseBytes:number;
}
export type PinnedHttpsRequest=(input:PinnedHttpsRequestInput)=>Promise<CompatibleHttpResponse>;
export interface CompatibleTransport {request(baseUrl:string,request:CompatibleHttpRequest):Promise<CompatibleHttpResponse>}
const MAX_REQUEST_BYTES=512*1024;
const invalid=():never=>{throw new AIProviderError('INVALID_REQUEST');};
export function compatibleSignalError(signal:AbortSignal,httpStatus?:number):AIProviderError{
 return new AIProviderError(signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED',httpStatus);
}

function serializeJson(value:unknown):Uint8Array{
 let nodes=0,bytes=0;const encoder=new TextEncoder(),stack=new Set<object>();
 const visit=(item:unknown,depth=0):void=>{
  if(++nodes>20_000||depth>40)invalid();
  if(item===null||typeof item==='boolean')return;
  if(typeof item==='number'){if(!Number.isFinite(item))invalid();return;}
  if(typeof item==='string'){bytes+=encoder.encode(item).byteLength;if(bytes>MAX_REQUEST_BYTES)invalid();return;}
  if(typeof item!=='object'||stack.has(item))return invalid();
  const prototype=Object.getPrototypeOf(item);if(!Array.isArray(item)&&prototype!==Object.prototype&&prototype!==null)invalid();
  stack.add(item);
  const keys=Object.keys(item);if(keys.length>10_000)invalid();
  for(const name of keys){
   bytes+=encoder.encode(name).byteLength;if(bytes>MAX_REQUEST_BYTES)invalid();
   const descriptor=Object.getOwnPropertyDescriptor(item,name);if(!descriptor||!('value' in descriptor))return invalid();
   visit(descriptor.value,depth+1);
  }
  stack.delete(item);
 };
 if(value===null||typeof value!=='object'||Array.isArray(value))invalid();
 try{visit(value);const body=encoder.encode(JSON.stringify(value));if(body.byteLength>MAX_REQUEST_BYTES)invalid();return body;}
 catch{ return invalid(); }
}

interface ValidatedCompatibleRequest {
 readonly route:CompatibleHttpRequest['route'];
 readonly apiKey:string;
 readonly signal:AbortSignal;
 readonly body:Uint8Array|null;
}

function snapshotRequest(value:unknown):ValidatedCompatibleRequest{
 try{
  if(value===null||typeof value!=='object'||utilTypes.isProxy(value))return invalid();
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return invalid();
  const fields=new Map<string,unknown>();
  for(const name of Reflect.ownKeys(value)){
   if(typeof name!=='string')return invalid();
   const descriptor=Object.getOwnPropertyDescriptor(value,name);
   if(!descriptor||!descriptor.enumerable||!('value' in descriptor))return invalid();
   fields.set(name,descriptor.value);
  }
  const route=fields.get('route');
  if(route!=='models'&&route!=='chat/completions'&&route!=='embeddings')return invalid();
  const required=route==='models'?['route','apiKey','signal']:['route','apiKey','json','signal'];
  if(fields.size!==required.length||required.some(name=>!fields.has(name)))return invalid();
  const apiKey=fields.get('apiKey'),signal=fields.get('signal');
  if(typeof apiKey!=='string'||apiKey.length<1||apiKey.length>512||!/^[\x21-\x7e]+$/.test(apiKey))return invalid();
  if(!(signal instanceof AbortSignal))return invalid();
  return {route,apiKey,signal,body:route==='models'?null:serializeJson(fields.get('json'))};
 }catch(error){
  if(error instanceof AIProviderError)throw error;
  return invalid();
 }
}

/** Race only resolution: native HTTPS owns abort cleanup and preserves received HTTP status. */
function resolveWithAbort<T>(signal:AbortSignal,operation:()=>Promise<T>):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  let settled=false;
  const finish=(action:()=>void)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);action();};
  const onAbort=()=>finish(()=>reject(compatibleSignalError(signal)));
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  try{operation().then(result=>finish(()=>resolve(result)),error=>finish(()=>reject(error)));}
  catch(error){finish(()=>reject(error));}
 });
}

export function createCompatibleTransport(options:{
 resolvePublicAddresses?:(hostname:string,signal:AbortSignal)=>Promise<readonly ResolvedAddress[]>;
 requestImpl?:PinnedHttpsRequest;
}={}):CompatibleTransport{
 const resolve=options.resolvePublicAddresses??resolvePublicAddresses;
 const send=options.requestImpl??createPinnedHttpsRequest();
 return {async request(baseUrl,request){
  const endpoint=parseCompatibleBaseUrl(baseUrl),snapshot=snapshotRequest(request);
  if(snapshot.signal.aborted)throw compatibleSignalError(snapshot.signal);
  const deadline=new AbortController();
  const signal=AbortSignal.any([snapshot.signal,deadline.signal]);
  const timer=setTimeout(()=>deadline.abort(new DOMException('TIMEOUT','TimeoutError')),snapshot.route==='models'?5000:10_000);
  try{
   const addresses=await resolveWithAbort(signal,()=>resolve(endpoint.hostname,signal));
   if(signal.aborted)throw compatibleSignalError(signal);
   if(!Array.isArray(addresses)||addresses.length===0||addresses.length>64||addresses.some(address=>!isPublicAddress(address)))
    throw new AIProviderError('PROVIDER_UNAVAILABLE');
   const headers:Record<string,string>={Authorization:`Bearer ${snapshot.apiKey}`,Accept:'application/json'};
   if(snapshot.body!==null){headers['Content-Type']='application/json';headers['Content-Length']=String(snapshot.body.byteLength);}
   return await send({url:new URL(`${endpoint.baseUrl}/${snapshot.route}`),method:snapshot.route==='models'?'GET':'POST',
    headers,body:snapshot.body,pinnedAddress:addresses[0],signal,maxResponseBytes:snapshot.route==='embeddings'?2*1024*1024:256*1024});
  }catch(error){
   if(error instanceof AIProviderError)throw error;
   if(signal.aborted)throw compatibleSignalError(signal);
   throw new AIProviderError('PROVIDER_UNAVAILABLE');
  }finally{clearTimeout(timer);}
 }};
}
