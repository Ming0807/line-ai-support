import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {parseWebSearchRequest,reserveWebSearch,observeWebSearch,type WebSearchAdmission,type WebSearchRequest,type WebSearchObservation} from './web-search-admission';
import {createTavilySearchAdapter,TavilySearchError,type TavilySearchAdapter,type TavilySearchResult,type TavilyUsage} from './tavily-search';

export type WebSearchRuntimeResult=Readonly<{status:'READY';attemptId:string;result:TavilySearchResult}|{
 status:'NOT_CONFIGURED'|'FREE_ONLY_UNVERIFIABLE'|'QUOTA_EXHAUSTED'|'ALREADY_ATTEMPTED'|'UNAVAILABLE'}>;
const configSchema=z.object({enabled:z.literal(true),apiKey:z.string().regex(/^[\x21-\x7e]{1,512}$/u),
 attestation:z.object({mode:z.string().max(80),keySha256:z.string().max(128),attestedAt:z.string().max(80)}).strict()}).strict();
type Config=z.infer<typeof configSchema>;
interface Options {
 pool:Pool;encryptionKey:string;config?:unknown;adapter?:TavilySearchAdapter;now?:()=>number;
 // Server-only seams for deterministic tests; never sourced from a request/model.
 reserve?:(request:WebSearchRequest)=>Promise<WebSearchAdmission>;
 observe?:(attemptId:string,value:WebSearchObservation)=>Promise<boolean>;
 preflight?:(request:WebSearchRequest,signal:AbortSignal)=>Promise<boolean>;
}
function attested(config:Config,now:number):boolean{
 const value=config.attestation,stamp=Date.parse(value.attestedAt);
 return value.mode==='RESEARCHER_NO_PAYG'&&value.keySha256===createHash('sha256').update(config.apiKey).digest('hex')&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.attestedAt)&&Number.isFinite(stamp)&&Number.isFinite(now)&&
  new Date(stamp).toISOString()===value.attestedAt&&now>=stamp&&now-stamp<=86400000;
}
function eligible(usage:TavilyUsage):'READY'|'FREE_ONLY_UNVERIFIABLE'|'QUOTA_EXHAUSTED'{
 const fields=[usage.keyUsage,usage.keyLimit,usage.planUsage,usage.planLimit,usage.paygoUsage,usage.paygoLimit];
 if(fields.some(v=>!Number.isSafeInteger(v)||v<0)||usage.currentPlan!=='Researcher'||usage.paygoUsage!==0||usage.paygoLimit!==0||
  usage.keyLimit<=0||usage.keyLimit>1000||usage.planLimit<=0||usage.planLimit>1000)return 'FREE_ONLY_UNVERIFIABLE';
 return usage.keyUsage>=usage.keyLimit||usage.planUsage>=usage.planLimit?'QUOTA_EXHAUSTED':'READY';
}

/** Connector gate only. A future caller must prove complete internal misses and fresh actor/source ownership. */
export function createWebSearchRuntime(options:Options):(input:unknown,signal:AbortSignal)=>Promise<WebSearchRuntimeResult>{
 let config:Config|undefined;
 try{config=freezeStructuredData(configSchema.parse(copyStructuredJson(options.config,4096,64)));}catch{config=undefined;}
 const adapter=options.adapter??createTavilySearchAdapter(),now=options.now??Date.now;
 const reserve=options.reserve??((request:WebSearchRequest)=>reserveWebSearch(options.pool,request,options.encryptionKey));
 const observe=options.observe??((attemptId:string,value:WebSearchObservation)=>observeWebSearch(options.pool,attemptId,value));
 const preflight=options.preflight;
 async function allowed(request:WebSearchRequest,signal:AbortSignal):Promise<boolean>{
  if(signal.aborted)return false;if(!preflight)return true;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>{};
  const stop=new Promise<boolean>(resolve=>{
   abort=()=>{controller.abort();resolve(false);};signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,5000);
  });
  try{
   if(signal.aborted){abort();return false;}
   return await Promise.race([stop,Promise.resolve().then(()=>preflight(request,controller.signal)).then(value=>value===true)])&&!signal.aborted;
  }catch{return false;}
  finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 }
 return async(input,signal)=>{
  let attemptId:string|undefined;
  const record=async(value:WebSearchObservation)=>{if(attemptId)try{await observe(attemptId,value);}catch{/* No refund, retry or raw error log. */}};
  try{
   const request=parseWebSearchRequest(input);
   if(!(signal instanceof AbortSignal)||signal.aborted)return {status:'UNAVAILABLE'};
   if(!config)return {status:'NOT_CONFIGURED'};
   if(!attested(config,now()))return {status:'FREE_ONLY_UNVERIFIABLE'};
   if(!await allowed(request,signal))return {status:'UNAVAILABLE'};
   const observed=eligible(await adapter.usage(config.apiKey,signal));
   if(signal.aborted)return {status:'UNAVAILABLE'};
   if(observed!=='READY')return {status:observed};
   if(!attested(config,now()))return {status:'FREE_ONLY_UNVERIFIABLE'};
   if(!await allowed(request,signal))return {status:'UNAVAILABLE'};
   const admission=await reserve(request);
   if(admission.status!=='RESERVED')return {status:admission.status==='DUPLICATE'?'ALREADY_ATTEMPTED':admission.status==='EXHAUSTED'?'QUOTA_EXHAUSTED':'UNAVAILABLE'};
   attemptId=admission.attemptId;
   if(signal.aborted)return {status:'UNAVAILABLE'};
   if(!attested(config,now()))return {status:'FREE_ONLY_UNVERIFIABLE'};
   if(!await allowed(request,signal))return {status:'UNAVAILABLE'};
   const result=await adapter.search({version:1,purpose:request.purpose,topic:request.topic,academicYear:request.academicYear},config.apiKey,signal);
   await record({kind:'SUCCESS',httpStatus:200,providerRequestId:result.requestId,credits:1});
   if(signal.aborted)return {status:'UNAVAILABLE'};
   if(!await allowed(request,signal))return {status:'UNAVAILABLE'};
   return freezeStructuredData({status:'READY' as const,attemptId,result});
  }catch(error){
   await record({kind:'ERROR',httpStatus:error instanceof TavilySearchError?error.httpStatus??null:null});
   return {status:'UNAVAILABLE'};
  }
 };
}
