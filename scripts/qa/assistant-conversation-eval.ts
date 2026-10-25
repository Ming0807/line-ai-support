import 'dotenv/config';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {z} from 'zod';
import {databaseConnection} from '../../lib/database/connection';
import {createAIStore} from '../../lib/ai/store';
import {createProviderRegistry} from '../../lib/ai/provider-registry';
import {generate} from '../../lib/ai/gateway';
import {createTurnBudget} from '../../lib/ai/turn-budget';
import {createAssistantDecision} from '../../lib/ai/assistant-decision';
import {createAssistantOrchestrator} from '../../lib/ai/assistant-orchestrator';
import {AIProviderError} from '../../lib/ai/types';
import type {AISnapshot} from '../../lib/ai/run-worker';

// This probe never reads real conversations, sends LINE or executes knowledge/ticket tools.
// Official/ownership scenarios require the separate owned workflow evaluation.
const fixtureSchema=z.object({schemaVersion:z.literal(1),scenarioCount:z.literal(30),scenarios:z.array(z.object({
 id:z.string(),cohort:z.enum(['ANSWERABLE','BOUNDARY_REQUIRED']),turns:z.array(z.string()).min(1),evidenceState:z.string(),needsOfficialEvidence:z.boolean(),
})).length(30)});
const fixtures=fixtureSchema.parse(JSON.parse(await readFile(resolve('tests/fixtures/assistant-conversations.json'),'utf8')));
const sampleArgument=process.argv.find(value=>value.startsWith('--cases='));
const tag=process.argv.find(value=>value.startsWith('--output-tag='))?.slice('--output-tag='.length);
if(tag!==undefined&&!/^[a-z0-9-]{1,50}$/.test(tag))throw Error('EVALUATION_OUTPUT_TAG_INVALID');
if(!process.argv.includes('--synthetic')||!sampleArgument)throw Error('EXPLICIT_SYNTHETIC_CASES_REQUIRED');
const ids=sampleArgument.slice('--cases='.length).split(',');
if(!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw Error('EVALUATION_CASE_LIST_INVALID');
const samples=ids.map(id=>{const sample=fixtures.scenarios.find(s=>s.id===id);if(!sample||sample.cohort!=='ANSWERABLE'||sample.needsOfficialEvidence||!['NOT_NEEDED','EMPTY'].includes(sample.evidenceState))throw Error('OWNED_WORKFLOW_REQUIRED_FOR_CASE');return sample;});
const key=process.env.ENCRYPTION_KEY,connection=process.env.DIRECT_URL??process.env.DATABASE_URL;
if(!key||!connection)throw Error('EVALUATION_GATEWAY_NOT_CONFIGURED');
const pool=new Pool({...databaseConnection(connection),max:1,connectionTimeoutMillis:10000});
const original=createAIStore(pool),adapters=createProviderRegistry(),records:unknown[]=[];
const sourceHashes=Object.fromEntries(await Promise.all(['lib/ai/assistant-decision.ts','lib/ai/assistant-orchestrator.ts','lib/ai/conversation-reply.ts','tests/fixtures/assistant-conversations.json'].map(async path=>[path,createHash('sha256').update(await readFile(resolve(path))).digest('hex')])));
try{
 for(const sample of samples){
  const history:AISnapshot['history']=[],turns:unknown[]=[],sessionId=randomUUID(),conversationId=randomUUID();
  for(const question of sample.turns){
   const attempts:{http:number|null;error:string|null;latencyMs:number;providerId:string;modelId:string;providerRevision:number;modelRevision:number}[]=[],turnBudget=createTurnBudget({limit:4});
   let requestedWorkflow:string|null=null;
   const store={...original,loadModels:async()=>(await original.loadModels()).filter(model=>model.costMode==='FREE_ONLY'),
    recordAttempt:async(record:Parameters<typeof original.recordAttempt>[0])=>{
     attempts.push({http:record.httpStatus??null,error:record.errorCode??null,latencyMs:record.latencyMs,providerId:record.providerId,modelId:record.modelId,providerRevision:record.providerRevision,modelRevision:record.modelRevision});await original.recordAttempt(record);
    }};
   const decide=createAssistantDecision({generate:input=>generate(input,{store,key,adapters,turnBudget})});
   const produce=createAssistantOrchestrator({decide,
    lookup:async()=>{requestedWorkflow='LOOKUP';return {kind:'CLARIFY',text:'การประเมินนี้ยังไม่ได้เชื่อมชุดเอกสารทดสอบ'};},
    handoff:async()=>{requestedWorkflow='HANDOFF';return {kind:'CLARIFY',text:'การประเมินนี้ยังไม่ได้เชื่อมชุดยืนยันส่งต่อทดสอบ'};}});
   const snapshot:AISnapshot={jobId:randomUUID(),sessionId,conversationId,messageId:randomUUID(),revision:0,question,history:[...history]};
   const start=Date.now();
   try{
    const result=await produce(snapshot,AbortSignal.timeout(30000));
    // Preserve a MIXED general segment for prose review while making the fixture-only
    // official limitation explicit. A branch requiring an unconnected workflow is
    // never a completed knowledge/ownership evaluation.
    const text=result.kind==='CONVERSATION'||result.kind==='CLARIFY'?result.text:
     result.kind==='MIXED'?result.general.text:null;
    const row={question,resultKind:result.kind,text,requestedWorkflow,workflowConnected:requestedWorkflow===null,
     ...(result.kind==='MIXED'?{officialResultKind:result.official.kind,officialWorkflowEvaluated:false}:{}),
     attempts,elapsedMs:Date.now()-start,syntheticHistoryOnly:true};turns.push(row);
    if(text){history.push({role:'user',content:question},{role:'assistant',content:text});}
    console.log(JSON.stringify({caseId:sample.id,resultKind:result.kind,requestedWorkflow,elapsedMs:row.elapsedMs,attempts}));
   }catch(error){const row={question,status:'BLOCKED',code:error instanceof AIProviderError?error.code:'EVALUATION_UNAVAILABLE',attempts,elapsedMs:Date.now()-start};turns.push(row);console.log(JSON.stringify({caseId:sample.id,status:row.status,code:row.code,attempts}));break;}
  }
  records.push({caseId:sample.id,cohort:sample.cohort,semanticStatus:'NOT_EVALUATED',turns});
 }
}finally{
 await mkdir(resolve('.superpowers/staging'),{recursive:true});
 await writeFile(resolve(`.superpowers/staging/assistant-general-eval${tag?'-'+tag:''}.json`),JSON.stringify({schemaVersion:1,scope:'MODEL_GENERAL_COMPONENT_ONLY',syntheticOnly:true,productionActivated:false,semanticReviewRequired:true,sourceHashes,records},null,2));
 await pool.end();
}
