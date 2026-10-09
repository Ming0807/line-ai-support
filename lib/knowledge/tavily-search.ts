import {isIP} from 'node:net';
import {z} from 'zod';
import {AIProviderError} from '../ai/types';
import {isPublicAddress,resolvePublicAddresses,type ResolvedAddress} from '../ai/public-addresses';
import {createPinnedHttpsRequest} from '../ai/compatible-pinned-https';
import type {CompatibleHttpResponse,PinnedHttpsRequest} from '../ai/compatible-network';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {buildPublicSearchQuery,type PublicSearchQuery} from './public-search-query';

export type TavilySearchErrorCode='WEB_SEARCH_INVALID'|'WEB_SEARCH_UNAVAILABLE'|'WEB_SEARCH_TIMEOUT'|
 'WEB_SEARCH_CANCELLED'|'WEB_SEARCH_RATE_LIMITED'|'WEB_SEARCH_FREE_LIMIT';
export class TavilySearchError extends Error {
 readonly httpStatus?:number;
 constructor(readonly code:TavilySearchErrorCode,status?:number){
  super(code);this.name='TavilySearchError';
  if(Number.isInteger(status)&&status!==undefined&&status>=100&&status<=599)this.httpStatus=status;
 }
}
export interface TavilyUsage {
 readonly keyUsage:number;readonly keyLimit:number;readonly currentPlan:string;
 readonly planUsage:number;readonly planLimit:number;readonly paygoUsage:number;readonly paygoLimit:number;
}
export interface TavilyCandidate {readonly title:string;readonly url:string;readonly content:string;readonly score:number}
export interface TavilySearchResult {readonly requestId:string;readonly credits:1;readonly results:readonly TavilyCandidate[]}
export interface TavilySearchAdapter {
 usage(apiKey:string,signal:AbortSignal):Promise<TavilyUsage>;
 search(input:unknown,apiKey:string,signal:AbortSignal):Promise<TavilySearchResult>;
}
interface TavilyTestOptions {
 resolvePublicAddresses?:(hostname:string,signal:AbortSignal)=>Promise<readonly ResolvedAddress[]>;
 requestImpl?:PinnedHttpsRequest;
}
const integer=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const usageSchema=z.object({key:z.object({usage:integer,limit:integer}),account:z.object({
 current_plan:z.string().min(1).max(80),plan_usage:integer,plan_limit:integer,paygo_usage:integer,paygo_limit:integer,
})});
const candidateSchema=z.object({title:z.string().min(1).max(500),url:z.string().min(1).max(2048),content:z.string().max(4000),score:z.number().finite().min(0).max(1)});
const searchSchema=z.object({request_id:z.uuid(),usage:z.object({credits:z.literal(1)}),results:z.array(candidateSchema).max(3)});
const invalid=():never=>{throw new TavilySearchError('WEB_SEARCH_INVALID');};
const unavailable=(status?:number):never=>{throw new TavilySearchError('WEB_SEARCH_UNAVAILABLE',status);};

function validateCall(apiKey:string,signal:AbortSignal):void{
 if(typeof apiKey!=='string'||!/^[\x21-\x7e]{1,512}$/u.test(apiKey)||!(signal instanceof AbortSignal))invalid();
 if(signal.aborted)throw new TavilySearchError('WEB_SEARCH_CANCELLED');
}
/** Own the deadline even if an injected resolver/transport ignores AbortSignal. */
async function bounded<T>(outer:AbortSignal,timeout:number,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let abort:()=>void=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  abort=()=>{controller.abort();reject(new TavilySearchError('WEB_SEARCH_CANCELLED'));};
  outer.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{controller.abort(new DOMException('Timeout','TimeoutError'));reject(new TavilySearchError('WEB_SEARCH_TIMEOUT'));},timeout);
 });
 try{
  if(outer.aborted){abort();return await boundary;}
  return await Promise.race([boundary,Promise.resolve().then(()=>work(controller.signal))]);
 }finally{if(timer)clearTimeout(timer);outer.removeEventListener('abort',abort);controller.abort();}
}
function checkedJson(response:CompatibleHttpResponse,limit:number):unknown{
 const status=response.status;
 if(!Number.isInteger(status)||status<100||status>599)unavailable();
 if(status!==200){
  throw new TavilySearchError(status===429?'WEB_SEARCH_RATE_LIMITED':status===432||status===433?'WEB_SEARCH_FREE_LIMIT':'WEB_SEARCH_UNAVAILABLE',status);
 }
 if(typeof response.contentType!=='string'||!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/iu.test(response.contentType))unavailable(status);
 try{
  const copied=copyStructuredJson(response.json,limit,8000);
  if(Buffer.byteLength(JSON.stringify(copied),'utf8')>limit)unavailable(status);
  return copied;
 }catch{return unavailable(status);}
}
function candidateUrl(value:string,query:PublicSearchQuery):string{
 try{
  if(/[\s\\\p{Cc}]/u.test(value)||/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value))return unavailable(200);
  const url=new URL(value),host=url.hostname;
  if(url.href!==value||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||isIP(host)!==0||host.length>253||
   host.split('.').length<2||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)))return unavailable(200);
  if(query.purpose==='YRU_INFORMATION'&&!query.includeDomains.some(domain=>host===domain||host.endsWith(`.${domain}`)))return unavailable(200);
  return url.href;
 }catch{return unavailable(200);}
}

/** Fixed low-level connector. The root runtime must authorize and commit a quota reservation before search. */
export function createTavilySearchAdapter(options:TavilyTestOptions={}):TavilySearchAdapter{
 const resolve=options.resolvePublicAddresses??resolvePublicAddresses,send=options.requestImpl??createPinnedHttpsRequest();
 async function request(route:'usage'|'search',apiKey:string,signal:AbortSignal,json?:unknown):Promise<CompatibleHttpResponse>{
  return bounded(signal,route==='usage'?4000:8000,async inner=>{
   try{
    if(inner.aborted)throw new TavilySearchError('WEB_SEARCH_CANCELLED');
    const addresses=await resolve('api.tavily.com',inner);
    if(inner.aborted)throw new TavilySearchError('WEB_SEARCH_CANCELLED');
    if(!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(address=>!isPublicAddress(address)))return unavailable();
    const body=route==='search'?Buffer.from(JSON.stringify(json),'utf8'):null;
    const headers:Record<string,string>={Authorization:`Bearer ${apiKey}`,Accept:'application/json'};
    if(body){headers['Content-Type']='application/json';headers['Content-Length']=String(body.byteLength);}
    const result=await send({url:new URL(`https://api.tavily.com/${route}`),method:route==='usage'?'GET':'POST',headers,
     body,pinnedAddress:{address:addresses[0].address,family:addresses[0].family},signal:inner,maxResponseBytes:route==='usage'?32*1024:256*1024});
    if(inner.aborted)throw new TavilySearchError('WEB_SEARCH_CANCELLED');
    return result;
   }catch(error){
    if(error instanceof TavilySearchError)throw error;
    if(error instanceof AIProviderError&&error.code==='TIMEOUT')throw new TavilySearchError('WEB_SEARCH_TIMEOUT',error.httpStatus);
    throw new TavilySearchError('WEB_SEARCH_UNAVAILABLE',error instanceof AIProviderError?error.httpStatus:undefined);
   }
  });
 }
 return {
  async usage(apiKey,signal){
   validateCall(apiKey,signal);const response=await request('usage',apiKey,signal);
   const parsed=usageSchema.safeParse(checkedJson(response,32*1024));if(!parsed.success)return unavailable(200);
   const {key,account}=parsed.data;
   return freezeStructuredData({keyUsage:key.usage,keyLimit:key.limit,currentPlan:account.current_plan,planUsage:account.plan_usage,
    planLimit:account.plan_limit,paygoUsage:account.paygo_usage,paygoLimit:account.paygo_limit});
  },
  async search(input,apiKey,signal){
   validateCall(apiKey,signal);let query:PublicSearchQuery;
   try{query=buildPublicSearchQuery(input);}catch{return invalid();}
   const body={query:query.query,topic:'general',search_depth:'basic',max_results:3,include_domains:query.includeDomains,include_domains_mode:'restrict',
    include_answer:false,include_raw_content:false,include_images:false,include_image_descriptions:false,include_favicon:false,auto_parameters:false,include_usage:true};
   const response=await request('search',apiKey,signal,body);
   const parsed=searchSchema.safeParse(checkedJson(response,256*1024));if(!parsed.success)return unavailable(200);
   return freezeStructuredData({requestId:parsed.data.request_id,credits:1 as const,results:parsed.data.results.map(row=>({...row,url:candidateUrl(row.url,query)}))});
  },
 };
}
