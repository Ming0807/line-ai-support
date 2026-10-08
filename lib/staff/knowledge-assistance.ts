import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {getDatabasePool} from '../database/pool';
import {readServerEnv} from '../config/env';
import {generate as gateway} from '../ai/gateway';
import {createAIStore} from '../ai/store';
import {createProviderRegistry} from '../ai/provider-registry';
import {createPriceReader} from '../ai/pricing';
import {aiResultSchema,type AIResult} from '../ai/jobs';
import type {AIWorkerOptions,AISnapshot} from '../ai/run-worker';
import {createKnowledgeProducer} from '../knowledge/answer-producer';
import {embedLocalConfigured} from '../knowledge/embedding-client';
import {searchKnowledge} from '../knowledge/retrieval';
import {searchStructured} from '../knowledge/structured-search';
import {evidenceStillMatches} from '../knowledge/citations';
import {ruleContextsStillMatch} from '../knowledge/rule-proof';
import {structuredEvidenceStillMatches} from '../knowledge/structured-citations';
import {assistInputSchema,AssistError} from './ai-assistance-contracts';
import {withStaffAssistanceSnapshot,type StaffAssistanceSnapshot} from './ai-assistance-snapshot';
import {projectStaffKnowledgeAdvice} from './knowledge-assistance-projection';
import type {StaffKnowledgeAdvice} from './knowledge-assistance-contracts';

async function produceBounded(produce:AIWorkerOptions['produce'],snapshot:AISnapshot,outer?:AbortSignal):Promise<AIResult>{
 if(outer?.aborted)throw new AssistError('UNAVAILABLE');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let abort:()=>void=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  abort=()=>{controller.abort();reject(new AssistError('UNAVAILABLE'));};
  outer?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,60000);
 });
 try{return await Promise.race([boundary,Promise.resolve().then(()=>produce(snapshot,controller.signal))]);}
 finally{if(timer)clearTimeout(timer);outer?.removeEventListener('abort',abort);controller.abort();}
}
/** Ephemeral staff advice: never runs a Student tool, writes a ticket, or enqueues delivery. */
export async function createStaffKnowledgeAssistance(actorId:string,id:string,input:unknown,
 options:{pool?:Pool;produce?:AIWorkerOptions['produce'];signal?:AbortSignal;key?:string}={}):Promise<StaffKnowledgeAdvice>{
 if(!z.uuid().safeParse(id).success)throw new AssistError('NOT_FOUND');
 const parsed=assistInputSchema.safeParse(input);if(!parsed.success)throw new AssistError('INVALID_REQUEST');
 const pool=options.pool??getDatabasePool();
 const snapshot=<T>(work:(client:PoolClient,current:StaffAssistanceSnapshot)=>Promise<T>)=>
  withStaffAssistanceSnapshot(actorId,id,parsed.data.revision,pool,work,{knowledgeCatalog:true});
 const before=await snapshot(async(_c,current)=>current);
 if(options.signal?.aborted)throw new AssistError('UNAVAILABLE');
 if(!before.knowledge)return {revision:before.revision,status:'NO_USER_QUESTION',answer:null,draftText:null,sources:[]};
 const unchanged=(current:StaffAssistanceSnapshot)=>{if(before.digest!==current.digest)throw new AssistError('CONFLICT');};
 let key=options.key,produce=options.produce;
 if(!produce){
  if(process.env.YRU_AI_ENABLED!=='true')throw new AssistError('UNAVAILABLE');
  key=key??readServerEnv().encryptionKey;if(!key)throw new AssistError('UNAVAILABLE');
  const configuredKey=key,store=createAIStore(pool),adapters=createProviderRegistry(),priceReader=createPriceReader();
  produce=createKnowledgeProducer({
   generate:call=>gateway({...call,ticketId:id},{store,key:configuredKey,adapters,priceReader}),
   embed:call=>embedLocalConfigured(call),
   search:call=>snapshot(async(c,current)=>{unchanged(current);return searchKnowledge(c,call);}),
   structuredSearch:call=>snapshot(async(c,current)=>{unchanged(current);return searchStructured(c,call,configuredKey);}),
  });
 }
 // The staff snapshot has committed. Provider and local embedding HTTP remain outside SQL.
 const raw=await produceBounded(produce,before.knowledge,options.signal);
 const validated=aiResultSchema.safeParse(raw);
 if(!validated.success||Buffer.byteLength(JSON.stringify(validated.data),'utf8')>150000||options.signal?.aborted)throw new AssistError('UNAVAILABLE');
 const result=validated.data;
 return snapshot(async(c,current)=>{
  unchanged(current);if(options.signal?.aborted)throw new AssistError('UNAVAILABLE');
  const advice=projectStaffKnowledgeAdvice(result,current.revision);
  if(result.kind==='ANSWER'){
   const fresh=await searchKnowledge(c,{scope:result.scope,vector:result.queryVector,fingerprint:result.fingerprint,limit:12});
   const cited=result.evidence.filter(e=>result.output.citationChunkIds.includes(e.chunkId));
   if(!ruleContextsStillMatch(result.evidence,fresh)||!evidenceStillMatches(cited,fresh))throw new AssistError('CONFLICT');
  }else if(result.kind==='STRUCTURED_ANSWER'){
   if(!key)throw new AssistError('UNAVAILABLE');
   const fresh=await searchStructured(c,{query:result.query,scope:result.scope},key);
   if(fresh.status!=='READY'||!structuredEvidenceStillMatches(result.evidence,fresh.evidence))throw new AssistError('CONFLICT');
  }
  return advice;
 });
}
