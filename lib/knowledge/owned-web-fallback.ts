import {createHmac,hkdfSync} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {lockConversation} from '../tickets/authorization';
import {readAIKnowledgeSnapshot} from '../ai/knowledge-snapshot';
import {eligibleAIJob,type AISnapshot} from '../ai/run-worker';
import {lockedAIJob,type AIJob} from '../ai/jobs';
import {copyStructuredJson,freezeStructuredData,canonicalDigest} from '../imports/structured-mapping-contract';
import {withStaffAssistanceSnapshot,type StaffAssistanceSnapshot} from '../staff/ai-assistance-snapshot';
import {knowledgeStructuredCatalogLock} from './delivery-fence';
import {knowledgeScopeSchema} from './retrieval';
import {structuredQuerySchema} from './structured-query';
import {proveInternalMiss,internalMissStillApplies,internalMissSourceDigest,type InternalMissProof} from './internal-miss';
import {validatePublicWebPlan,type PublicWebPlan} from './public-web-plan';
import {createWebSearchRuntime} from './web-search-runtime';
import {createWebLeads,type WebLeadsResult} from './web-leads';
import type {TavilySearchAdapter} from './tavily-search';

export interface OwnedWebOptions {config?:unknown;adapter?:TavilySearchAdapter}
export type OwnedWebFallback=(input:unknown,signal:AbortSignal)=>Promise<WebLeadsResult|null>;
const inputSchema=z.object({question:z.string().min(1).max(6000),scope:knowledgeScopeSchema,structuredQuery:structuredQuerySchema,
 queryVector:z.array(z.number().finite()).length(384),fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),proposal:z.unknown()}).strict();
function configured(options:OwnedWebOptions):unknown{
 try{
  const value=copyStructuredJson(options.config??{enabled:process.env.YRU_WEB_SEARCH_ENABLED==='true',apiKey:process.env.TAVILY_API_KEY??'',
   attestation:{mode:process.env.TAVILY_FREE_NO_PAYG_ATTESTED==='true'?'RESEARCHER_NO_PAYG':'UNVERIFIED',
    keySha256:process.env.TAVILY_FREE_KEY_SHA256??'',attestedAt:process.env.TAVILY_FREE_ATTESTED_AT??''}},4096,64);
  return value&&typeof value==='object'&&'enabled' in value&&value.enabled===true?freezeStructuredData(value):undefined;
 }catch{return undefined;}
}
function snapshotCopy(input:AISnapshot):AISnapshot|undefined{
 try{const value=copyStructuredJson(input,128*1024,6000) as AISnapshot;internalMissSourceDigest(value);return freezeStructuredData(value);}catch{return undefined;}
}
function sameSource(before:AISnapshot,current:AISnapshot):boolean{
 return internalMissSourceDigest(before)===internalMissSourceDigest(current)&&(!before.support||!!current.support&&
  before.support.sourceDigest===current.support.sourceDigest&&before.support.directoryDigest===current.support.directoryDigest&&
  before.support.minimumSensitivity===current.support.minimumSensitivity);
}
type SourceRead=<T>(work:(client:PoolClient,current:AISnapshot)=>Promise<T>)=>Promise<T>;
function callback(pool:Pool,key:string,consumer:'STUDENT'|'STAFF',operationId:string,ownerId:string,before:AISnapshot|undefined,
 read:SourceRead,config:unknown,adapter?:TavilySearchAdapter):OwnedWebFallback{
 return async(input,signal)=>{
  try{
   if(!before||!z.uuid().safeParse(operationId).success||!z.uuid().safeParse(ownerId).success||signal.aborted)return null;
   const value=freezeStructuredData(inputSchema.parse(copyStructuredJson(input,64*1024,2200)));
   // A semantic family/department proposal cannot hide a higher-authority PUBLIC source.
   const candidate={scope:{...value.scope,familyCodes:[],departmentCode:null},structuredQuery:value.structuredQuery,
    queryVector:value.queryVector,fingerprint:value.fingerprint};
   const initial=await read(async(c,current)=>{
    if(!sameSource(before,current)||signal.aborted)return null;
    const questionAllowed=value.question===current.question||current.support?.input.sources.some(source=>
     source.code!=='U0'&&value.question===`${source.text}\n${current.question}`);
    if(!questionAllowed)return null;
    const plan=validatePublicWebPlan(value.proposal,{userText:value.question,scope:candidate.scope,query:candidate.structuredQuery});
    const receipt=await proveInternalMiss(c,candidate,current,key);
    return receipt.status==='EMPTY'?{plan,proof:receipt.proof}:null;
   });
   if(!initial||signal.aborted)return null;
   const {plan,proof}: {plan:PublicWebPlan;proof:InternalMissProof}=initial;
   let stamp:string|undefined;
   const request={consumer,operationId,ownerId,purpose:plan.purpose,topic:plan.topic,academicYear:plan.academicYear};
   const runtime=createWebSearchRuntime({pool,encryptionKey:key,config,adapter,preflight:async(current,inner)=>{
    if(canonicalDigest('owned-web-request',current)!==canonicalDigest('owned-web-request',request)||inner.aborted||signal.aborted)return false;
    return read(async(c,source)=>{
     if(!sameSource(before,source)||inner.aborted||signal.aborted||!await internalMissStillApplies(c,proof,source,key))return false;
     const observed=(await c.query('select clock_timestamp() observed_at')).rows[0]?.observed_at;
     if(!(observed instanceof Date)||!Number.isFinite(observed.getTime())||inner.aborted||signal.aborted)return false;
     stamp=observed.toISOString();return true;
    });
   }});
   const result=await runtime(request,signal);
   if(result.status!=='READY'||!stamp||!result.result.results.length||signal.aborted)return null;
   return createWebLeads(plan,result.result.results,proof,stamp);
  }catch{return null;}
 };
}

/** A real leased Student job is required before any usage/search HTTP. No public request grants this capability. */
export function createStudentWebFallback(pool:Pool,key:string,source:AISnapshot,options:OwnedWebOptions={}):OwnedWebFallback|undefined{
 const config=configured(options);if(!config)return undefined;
 const before=snapshotCopy(source),ownerId=before?.leaseToken??'',operationId=before?.jobId??'';
 const read:SourceRead=work=>transaction(async c=>{
  if(!before||!z.uuid().safeParse(ownerId).success)throw new Error('WEB_CONTEXT_CHANGED');
  await c.query("set local statement_timeout='4s';set local lock_timeout='2s'");
  await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  await lockConversation(c,before.conversationId);
  const located=(await c.query("select * from private.ai_jobs where id=$1 and status='PROCESSING' and lease_token=$2 and lease_until>clock_timestamp()",
   [operationId,ownerId])).rows[0] as AIJob|undefined;
  if(!located||located.conversation_id!==before.conversationId||located.line_session_id!==before.sessionId||located.message_id!==before.messageId||
   located.expected_conversation_revision!==before.revision)throw new Error('WEB_CONTEXT_CHANGED');
  const job=await lockedAIJob(c,located);if(!await eligibleAIJob(c,job))throw new Error('WEB_CONTEXT_CHANGED');
  const current=await readAIKnowledgeSnapshot(c,job,key,!!before.support);if(!current)throw new Error('WEB_CONTEXT_CHANGED');
  return work(c,current);
 },pool);
 return callback(pool,key,'STUDENT',operationId,ownerId,before,read,config,options.adapter);
}
function staffOperation(key:string,input:unknown):string{
 const master=Buffer.from(key,'base64');if(master.length!==32||master.toString('base64')!==key)throw new Error('WEB_CONTEXT_CHANGED');
 const derived=Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','staff-web-operation',32));
 const bytes=createHmac('sha256',derived).update(canonicalDigest('staff-web-operation-v1',input)).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** Staff lookup remains a scoped HUMAN read/draft and never borrows Student execution/send authority. */
export function createStaffWebFallback(pool:Pool,key:string,actorId:string,ticketId:string,revision:number,
 source:StaffAssistanceSnapshot,options:OwnedWebOptions={}):OwnedWebFallback|undefined{
 const config=configured(options);if(!config)return undefined;
 const before=source.knowledge?snapshotCopy(source.knowledge):undefined,digest=source.digest;
 let operationId='';try{operationId=staffOperation(key,{actorId,ticketId,revision,digest});}catch{/* Callback remains closed. */}
 const read:SourceRead=work=>withStaffAssistanceSnapshot(actorId,ticketId,revision,pool,async(c,current)=>{
  if(current.digest!==digest||!current.knowledge||!before||before.jobId!==ticketId)throw new Error('WEB_CONTEXT_CHANGED');
  return work(c,current.knowledge);
 },{knowledgeCatalog:true});
 return callback(pool,key,'STAFF',operationId,actorId,before,read,config,options.adapter);
}
