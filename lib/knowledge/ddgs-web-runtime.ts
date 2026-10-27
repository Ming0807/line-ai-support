import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {createDdgsSearchAdapter,type DdgsLead} from './ddgs-search';
import type {WebSearchAdmission,WebSearchObservation,WebSearchRequest} from './web-search-admission';

export type DdgsAdapter=Pick<ReturnType<typeof createDdgsSearchAdapter>,'search'>;
export type DdgsRuntimeResult=Readonly<{status:'READY';provider:'DDGS';attemptId:string;result:{results:readonly DdgsLead[]}}|
 {status:'UNAVAILABLE'|'ALREADY_ATTEMPTED'|'QUOTA_EXHAUSTED'}>;
const configSchema=z.object({enabled:z.literal(true),pythonPath:z.string().min(1).max(2048).refine(isAbsolute)}).strict();
interface Options {
 config?:unknown;adapter?:DdgsAdapter;
 reserve:(request:WebSearchRequest)=>Promise<WebSearchAdmission>;
 observe:(attemptId:string,value:WebSearchObservation)=>Promise<boolean>;
 preflight:(request:WebSearchRequest,signal:AbortSignal)=>Promise<boolean>;
}
/** Optional search capability; the caller supplies fresh owned-source checks and durable admission. */
export function createDdgsWebRuntime(options:Options){
 let config:z.infer<typeof configSchema>;
 try{config=configSchema.parse(copyStructuredJson(options.config,4096,32));}catch{return undefined;}
 const adapter=options.adapter??createDdgsSearchAdapter({pythonPath:config.pythonPath});
 return async(request:WebSearchRequest,signal:AbortSignal):Promise<DdgsRuntimeResult>=>{
  let attemptId:string|undefined;
  const record=async(value:WebSearchObservation)=>{if(attemptId)try{await options.observe(attemptId,value);}catch{/* Retain uncertain observations without replay/refund. */}};
  try{
   if(signal.aborted||!await options.preflight(request,signal))return {status:'UNAVAILABLE'};
   const admitted=await options.reserve(request);
   if(admitted.status!=='RESERVED')return {status:admitted.status==='DUPLICATE'?'ALREADY_ATTEMPTED':admitted.status==='EXHAUSTED'?'QUOTA_EXHAUSTED':'UNAVAILABLE'};
   attemptId=admitted.attemptId;
   if(signal.aborted||!await options.preflight(request,signal))return {status:'UNAVAILABLE'};
   const results=await adapter.search({version:1,purpose:request.purpose,topic:request.topic,academicYear:request.academicYear},signal);
   // DDGS can be blocked or incomplete; an empty response is not an official EMPTY proof.
   if(!Array.isArray(results)||results.length<1||results.length>3)throw new Error('DDGS_UNAVAILABLE');
   await record({kind:'DDGS_SUCCESS'});
   if(signal.aborted||!await options.preflight(request,signal))return {status:'UNAVAILABLE'};
   return freezeStructuredData({status:'READY' as const,provider:'DDGS' as const,attemptId,result:{results}});
  }catch{
   await record({kind:'ERROR',httpStatus:null});return {status:'UNAVAILABLE'};
  }
 };
}
