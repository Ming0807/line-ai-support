import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {databaseConnection} from '../../lib/database/connection';
import {createAIStore} from '../../lib/ai/store';
import {readAccountFreeUntil} from '../../lib/ai/account-free-admin';
import {createProvider,createModel} from '../../lib/ai/provider-admin';
import type {AIModelConfig} from '../../lib/ai/types';
import {createProviderRegistry} from '../../lib/ai/provider-registry';
import {createCompatibleTransport,type CompatibleTransport} from '../../lib/ai/compatible-network';
import {createPinnedHttpsRequest} from '../../lib/ai/compatible-pinned-https';
import {createPriceReader} from '../../lib/ai/pricing';
import {generate} from '../../lib/ai/gateway';
import {createDurableTurnBudget,ASSISTANT_TURN_ATTEMPT_LIMIT} from '../../lib/ai/durable-turn-budget';
import {createSemanticRoutingClassifier} from '../../lib/conversation/semantic-routing-provider';
import {createConfiguredKnowledgeProducer,type AssistantGenerationDiagnostic} from '../../lib/knowledge/configured';
import {persistWebhookEvents} from '../../lib/queue/inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {decodeAIResult,type AIJob} from '../../lib/ai/jobs';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {encryptValue,decryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import {inputHoldForText} from '../../lib/conversation/input-hold';
import {validateOwnedConversationTarget,classifyOwnedEvaluationRecipient} from '../../lib/ai/conversation-eval-target';
import {matchesOwnedCurrentSourceAnswer} from '../../lib/ai/conversation-eval-oracle';
import {publishOwnedAssistantSources} from './assistant-owned-publication';
import {readRegistryPreflight} from './assistant-registry-preflight';
import {reserveInferenceCall,readCallLedger} from './conv-eval-call-ledger';
import {createLocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {transaction} from '../../lib/database/pool';
import {createEscalation} from '../../lib/tickets/create-ticket';
import {createConversationReply} from '../../lib/ai/conversation-reply';
import {prepareOwnedStaffAlerts,releaseOwnedStaffAlerts} from '../../tests/database/staff-alert-fixture';

/*
 * CONV-V2-00/06 (DEC-195): one frozen case through the real disposable-database workflow
 * (ingress window → inbox/routing → AI worker → controlled LINE transport) with the real
 * configured Gemini FREE_ONLY model, for either the current production flow (`--flow=baseline`,
 * the options scripts/ai-worker.ts uses) or CONV-V2 (`--flow=v2`). Derived from the main6
 * owned evaluator; changes: production producer options, input-window polling, an owner-approved
 * inference ledger checked before every provider request, per-call wire latency and DEC-209
 * hand-over witnesses. Legacy (pre-DEC-209) witnesses are recorded but do not stop a case.
 * Run only through tests/database/conv-v2-real-eval.integration.ts (disposable database).
 */
const SOURCE_MODEL_ID='faed07d5-8e7d-4a83-925b-4460ac59d0b0';
const fixtureBytes=await readFile(resolve('tests/fixtures/assistant-conversations.json'));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),'e79ade32e0960df2e0399531d703e55955456caf7af432288ea919ae45e801f3','FROZEN_CONVERSATION_FIXTURE_CHANGED');
const scenarioSchema=z.object({id:z.string(),cohort:z.enum(['ANSWERABLE','BOUNDARY_REQUIRED']),needsOfficialEvidence:z.boolean(),evidenceState:z.string(),
 turns:z.array(z.string().min(1)).min(1).max(10),conversationContext:z.unknown().optional()});
const fixture=z.object({schemaVersion:z.literal(1),scenarioCount:z.literal(30),scenarios:scenarioSchema.array().length(30)}).parse(JSON.parse(fixtureBytes.toString('utf8')));
const argument=(name:string)=>{const found=process.argv.filter(arg=>arg.startsWith(`--${name}=`));assert(found.length<=1,`DUPLICATE_${name.toUpperCase()}`);return found[0]?.slice(name.length+3);};
const cases=argument('cases')?.split(',')??[];
assert.equal(cases.length,1,'ONE_CASE_PER_DISPOSABLE_DATABASE');
const flow=z.enum(['baseline','v2']).parse(argument('flow'));
const outputTag=z.string().regex(/^[a-z0-9-]{1,60}$/u).parse(argument('output-tag'));
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
const ledgerPath=process.env.YRU_CONV_EVAL_LEDGER;
assert(ledgerPath&&readCallLedger(ledgerPath).cap>0,'APPROVED_CALL_LEDGER_REQUIRED');
const officialContext=process.argv.includes('--official-context'),ragContext=process.argv.includes('--rag-context'),ownedWorkflowContext=process.argv.includes('--owned-workflow-context');
assert([officialContext,ragContext,ownedWorkflowContext].filter(Boolean).length<=1,'OWNED_EVALUATION_CONTEXT_MODE_CONFLICT');
const [scenario]=validateOwnedConversationTarget({database,synthetic:process.argv.includes('--synthetic'),caseIds:cases,officialContext,ragContext,ownedWorkflowContext},fixture.scenarios);
assert(database&&scenario);
const normalKey=process.env.ENCRYPTION_KEY,normalConnection=process.env.DIRECT_URL??process.env.DATABASE_URL;
assert(normalKey&&normalConnection,'MODEL_REGISTRY_NOT_CONFIGURED');
const owner=randomUUID(),key=randomBytes(32).toString('base64');
type EvaluationJob=AIJob&{status:string;last_error_code:string|null;attempts:number};
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:6,application_name:`conv-v2-eval-${owner}`});
const normalPool=new Pool({...databaseConnection(normalConnection),max:1,connectionTimeoutMillis:10000});
// The normal (hosted development) registry is only ever read inside READ ONLY transactions.
const readNormalPool={query:async(...args:unknown[])=>{const client=await normalPool.connect();try{await client.query('begin read only');return await (client.query as (...a:unknown[])=>unknown).apply(client,args);}finally{try{await client.query('rollback');}finally{client.release();}}}} as unknown as Pool;
const savedAccountGrants=process.env.YRU_FREE_ACCOUNT_GRANTS;
interface WireCall {seq:number;turn:number;route:string;status:number|null;elapsedMs:number;safeError:string|null;finishReason:unknown;startedAt:number}
const wire:WireCall[]=[];let currentTurn=-1;
const records:unknown[]=[],models:unknown[]=[];
let stage='owned_preflight',stopReason:string|null=null;
const sleep=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function pollUntil<T>(label:string,limitMs:number,step:()=>Promise<T|undefined>):Promise<T>{
 const deadline=Date.now()+limitMs;
 for(;;){const value=await step();if(value!==undefined)return value;if(Date.now()>deadline)throw new Error(`${label}_TIMEOUT`);await sleep(250);}
}
try{
 assert(/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
 assert.equal((await pool.query('select current_database() name')).rows[0].name,database,'OWNED_DATABASE_CONNECTION_REQUIRED');
 assert.equal((await pool.query('select count(*)::int n from private.ai_providers')).rows[0].n,0,'FRESH_OWNED_REGISTRY_REQUIRED');
 stage='registry_read_only_load';
 const sourceModels=(await readRegistryPreflight(()=>createAIStore(readNormalPool).loadModels(),{observe:event=>console.log(JSON.stringify(event))})).filter(model=>model.id===SOURCE_MODEL_ID);
 assert.equal(sourceModels.length,1,'EXACT_ENABLED_GEMINI_REQUIRED');
 const source:AIModelConfig=sourceModels[0]!;
 assert.equal(source.modelId,'gemini-3.5-flash-lite');assert.equal(source.adapter,'COMPATIBLE');assert.equal(source.costMode,'FREE_ONLY');
 assert.equal(source.baseUrl,'https://generativelanguage.googleapis.com/v1beta/openai');assert.equal(source.timeoutMs,25000);
 const sourcePermission=await readAccountFreeUntil(readNormalPool,source);assert(sourcePermission,'CURRENT_SOURCE_FREE_ACCOUNT_PERMISSION_REQUIRED');
 stage='owned_registry_admin';
 const admin=randomUUID();await pool.query('insert into auth.users(id) values($1)',[admin]);
 await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Synthetic evaluation owner','SUPER_ADMIN',true)",[admin]);
 let publication:Awaited<ReturnType<typeof publishOwnedAssistantSources>>|undefined;
 if(officialContext||ragContext){
  stage='owned_official_publication';
  const embeddingProvider=ragContext?createLocalE5EmbeddingProvider():undefined;
  if(embeddingProvider)assert((await embeddingProvider.healthCheck()).healthy,'OWNED_LOCAL_E5_UNAVAILABLE');
  publication=await publishOwnedAssistantSources({pool,key,actor:admin,database,caseIds:cases,
   companion:JSON.parse(await readFile(resolve('tests/fixtures/assistant-conversation-context.json'),'utf8')),frozenText:fixtureBytes.toString('utf8'),embeddingProvider});
 }
 stage='owned_provider_clone';
 const provider=await createProvider(admin,{name:'Synthetic COMPATIBLE 1',adapter:'COMPATIBLE',baseUrl:source.baseUrl,enabled:true,priority:source.providerPriority,costMode:'FREE_ONLY',
  apiKey:decryptValue(source.apiKeyEncrypted,normalKey)},{pool,key});
 const model=await createModel(admin,provider.id,{modelId:source.modelId,displayName:source.modelId,purpose:'GENERATION',embeddingDimensions:null,
  supportsTools:source.supportsTools,supportsJson:source.supportsJson,supportsVision:false,enabled:true,priority:source.priority,timeoutMs:source.timeoutMs,
  inputPricePerMillion:source.inputPricePerMillion,outputPricePerMillion:source.outputPricePerMillion},{pool,key});
 const network=(await pool.query('select network_revision from private.ai_providers where id=$1',[provider.id])).rows[0];
 // The owned clone inherits exactly the source account attestation expiry; no extension.
 process.env.YRU_FREE_ACCOUNT_GRANTS=JSON.stringify([{providerId:provider.id,networkRevision:network.network_revision,baseUrl:source.baseUrl,models:[source.modelId],
  confirmedAt:new Date().toISOString(),expiresAt:sourcePermission}]);
 models.push({sourceModelId:source.id,modelName:source.modelId,sourceProviderRevision:source.providerRevision,sourceModelRevision:source.modelRevision,
  sourceTimeoutMs:source.timeoutMs,sourceCostMode:source.costMode,sourcePermission,ownedModelId:model.id});
 const store=createAIStore(pool),observed=await store.loadModels();
 assert.deepEqual(observed.map(item=>item.modelId),[source.modelId],'OWNED_CLONE_ORDER_CHANGED');
 // Every inference request: re-read the source permission (read-only), reserve one approved slot, then send.
 function guardedTransport(native:CompatibleTransport):CompatibleTransport{return {async request(base,request){
  const started=Date.now(),entry:WireCall={seq:wire.length,turn:currentTurn,route:String(request.route),status:null,elapsedMs:0,safeError:null,finishReason:null,startedAt:started};
  try{
   assert.equal(base,source.baseUrl,'UNEXPECTED_PROVIDER_ENDPOINT');
   if(request.route!=='models'){
    assert.equal(await readAccountFreeUntil(readNormalPool,source),sourcePermission,'SOURCE_PERMISSION_CHANGED');
    reserveInferenceCall(ledgerPath!,flow);wire.push(entry);
   }
   const response=await native.request(base,request);
   const json=response.json as {choices?:{finish_reason?:unknown}[]}|null;
   Object.assign(entry,{status:response.status,elapsedMs:Date.now()-started,finishReason:json?.choices?.[0]?.finish_reason??null});
   return response;
  }catch(error){
   entry.elapsedMs=Date.now()-started;
   entry.safeError=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]+$/u.test(error.code)?error.code:'UNAVAILABLE';
   throw error;
  }
 }};}
 const adapters=createProviderRegistry({compatibleTransport:guardedTransport(createCompatibleTransport({requestImpl:createPinnedHttpsRequest()}))}),priceReader=createPriceReader();
 async function seedHumanContext(sessionId:string,topic:string,departmentCode:string,assignedStaffId:string|null){
  const conversationId=randomUUID(),ticketId=randomUUID();
  await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type,topic,status) values($1,$2,'HUMAN','TICKET',$3,'ACTIVE')",[conversationId,sessionId,topic]);
  await pool.query(`insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
   values($1,$2,$3,(select id from public.departments where code=$4),$5,'HUMAN','STAFF_HANDLING','GENERAL',$6)`,[ticketId,sessionId,conversationId,departmentCode,topic,assignedStaffId]);
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticketId]);
  return {conversationId,ticketId};
 }
 async function seedAIContext(sessionId:string,topic:string){
  const conversationId=randomUUID();
  await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type,topic,status) values($1,$2,'AI','GENERAL',$3,'ACTIVE')",[conversationId,sessionId,topic]);
  return conversationId;
 }
 async function ticketWitness(ticketId:string){
  return (await pool.query(`select t.id,t.revision,t.mode,t.status,t.assigned_staff_id,c.id conversation_id,c.mode conversation_mode,c.status conversation_status,
   c.active_ticket_id from public.tickets t join public.conversations c on c.id=t.conversation_id where t.id=$1`,[ticketId])).rows[0]??null;
 }
 stage=`case_${scenario.id}`;
 const session=randomUUID(),lineUser=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(lineUser,key),turns:unknown[]=[];
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,`Synthetic ${scenario.id} ${owner}`]);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,userHash,encryptValue(lineUser,key)]);
 let protectedHuman:{conversationId:string;ticketId:string;before:unknown}|undefined,staffLineUser:string|undefined,takeoverHumanSnapshot:unknown;
 let seededAIConversationIds:string[]=[],takeoverConversationId:string|undefined,controlledContextSetup:Record<string,unknown>|undefined;
 if(scenario.id==='A17'||scenario.id==='B09'){
  if(scenario.id==='B09'){
   await prepareOwnedStaffAlerts(pool);
   staffLineUser=`U${randomUUID().replaceAll('-','')}`;
   await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',[admin,hashStaffLineUserId(staffLineUser,key),encryptValue(staffLineUser,key)]);
  }
  const seeded=await seedHumanContext(session,'registration','REGISTRAR',scenario.id==='B09'?admin:null);
  protectedHuman={...seeded,before:await ticketWitness(seeded.ticketId)};
 }else if(scenario.id==='B08')seededAIConversationIds=[await seedAIContext(session,'registration'),await seedAIContext(session,'library')];
 else if(scenario.id==='B10')takeoverConversationId=await seedAIContext(session,'device access');
 const prior=publication?.contexts.find(context=>context.scenarioId===scenario.id)?.priorUserMessages??[];
 if(prior.length){
  const conversation=randomUUID();
  await pool.query('insert into public.conversations(id,line_session_id,topic) values($1,$2,$3)',[conversation,session,prior[0]]);
  for(const content of prior)await pool.query("insert into public.messages(conversation_id,sender_type,content) values($1,'USER',$2)",[conversation,content]);
 }
 // The real worker loop, bounded: the input window (2.5–8 s) decides when the inbox job is due.
 async function drainInbox(eventId:string,classifyForJob?:Parameters<typeof runInboxCycle>[2] extends infer O?O extends {classifyForJob?:infer C}?C:never:never){
  const totals={claimed:0,completed:0,failed:0};
  const row=await pollUntil('INBOX',30_000,async()=>{
   const cycle=await runInboxCycle(pool,key,{aiEnabled:true,...(classifyForJob?{classifyForJob}:{})});
   totals.claimed+=cycle.claimed;totals.completed+=cycle.completed;totals.failed+=cycle.failed;
   const current=(await pool.query('select id,status,last_error_code from private.webhook_inbox where channel=$1 and event_id=$2',['STUDENT',eventId])).rows[0];
   return current&&['DONE','FAILED','DEAD'].includes(current.status)||cycle.failed?current:undefined;
  });
  return {row,totals};
 }
 async function drainOutbox(fetchImpl:typeof fetch){
  const totals={claimed:0,sent:0,failed:0};
  for(let guard=0;guard<12;guard++){
   const cycle=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-no-network',STAFF:'synthetic-no-network'},fetchImpl});
   totals.claimed+=cycle.claimed;totals.sent+=cycle.sent;totals.failed+=cycle.failed;
   if(!cycle.claimed)break;
  }
  return totals;
 }
 if(scenario.id==='B06'){
  // Declared frozen context: a safe troubleshooting step was actually delivered before the suite (no model call).
  z.object({priorAssistantStep:z.literal('a safe troubleshooting step was actually delivered')}).parse(scenario.conversationContext);
  const setupEventId=randomUUID(),setupMessageId=randomUUID(),question=scenario.turns[0]!;
  const safeStep='หากทราบข้อมูลการเชื่อมต่อของเครือข่ายนี้ ลองลืมเครือข่ายบนอุปกรณ์ของคุณแล้วเชื่อมใหม่ โดยไม่ปรับอุปกรณ์เครือข่ายที่ผู้อื่นใช้งานร่วมกันครับ';
  const setupEvent={type:'message',source:{type:'user',userId:lineUser},message:{type:'text',id:setupMessageId,text:question}};
  await persistWebhookEvents([{channel:'STUDENT',eventId:setupEventId,userHash,payloadEncrypted:encryptValue(JSON.stringify(setupEvent),key),eventKind:'MESSAGE',inputHold:inputHoldForText(question)}],pool);
  await drainInbox(setupEventId);
  await pollUntil('SETUP_AI',30_000,async()=>{
   const cycle=await runAICycle(pool,key,{supportEnabled:true,produce:async snapshot=>{
    assert.equal(snapshot.sessionId,session);const result=createConversationReply(snapshot,safeStep);assert(result,'CONTROLLED_SAFE_STEP_REQUIRED');return result;}});
   return cycle.completed?cycle:undefined;
  });
  let accepted=0;
  await drainOutbox(async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.to,lineUser);accepted++;return new Response(null,{status:200});});
  assert.equal(accepted,1,'OWNED_PRIOR_STEP_DELIVERY_REQUIRED');
  controlledContextSetup={scope:'DECLARED_FROZEN_CONTEXT_BOOTSTRAP',model:'CONTROLLED_CONTEXT_ONLY',priorAssistantStepDelivered:true};
 }
 let takeoverEvidence:{requestStartedAt:number;takeoverAt:number|null;responseResolvedAt:number|null;ticketId:string|null}|undefined;
 for(const [turnIndex,question] of scenario.turns.entries()){
  currentTurn=turnIndex;
  const routingObservations:unknown[]=[],historyObservations:{conversationId:string;history:AISnapshot['history']}[]=[],generationTrace:AssistantGenerationDiagnostic[]=[];
  let aiStarted=false;
  async function duringInference<T>(operation:()=>Promise<T>):Promise<T>{
   if(scenario!.id!=='B10'||!aiStarted||takeoverEvidence!==undefined||!takeoverConversationId)return await operation();
   const witness={requestStartedAt:Date.now(),takeoverAt:null as number|null,responseResolvedAt:null as number|null,ticketId:null as string|null};
   takeoverEvidence=witness;
   const pending=operation().then(response=>{witness.responseResolvedAt=Date.now();return response;});
   const takeover=await transaction(client=>createEscalation(client,{sessionId:session,conversationId:takeoverConversationId!,departmentCode:'IT',summary:question},key),pool);
   witness.ticketId=takeover.id;takeoverHumanSnapshot=await ticketWitness(takeover.id);witness.takeoverAt=Date.now();
   return await pending;
  }
  const pinned=createPinnedHttpsRequest();
  const compatibleTransport=guardedTransport(createCompatibleTransport({requestImpl:input=>input.method==='POST'?duringInference(()=>pinned(input)):pinned(input)}));
  const fetchImpl:typeof fetch=async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   assert.notEqual(new URL(url).origin,new URL(source.baseUrl).origin,'PROVIDER_FETCH_BYPASSES_GUARD');
   return await fetch(input,init);
  };
  // Production producer options (scripts/ai-worker.ts); only the transport and diagnostics are evaluation-owned.
  const produce=createConfiguredKnowledgeProducer(pool,key,{assistantEnabled:true,...(flow==='v2'?{conversationFlowV2:true}:{}),fetchImpl,compatibleTransport,
   onAssistantGenerationDiagnostic:event=>{generationTrace.push(event);}});
  const eventId=randomUUID(),lineMessageId=randomUUID(),receivedAt=Date.now();
  const ticketsBeforeTurn=(await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[session])).rows[0].n as number;
  const humanBeforeTurn=(await pool.query("select id from public.conversations where line_session_id=$1 and mode='HUMAN'",[session])).rows.map(row=>row.id as string);
  const event={type:'message',source:{type:'user',userId:lineUser},replyToken:`synthetic-${eventId}`,message:{type:'text',id:lineMessageId,text:question}};
  await persistWebhookEvents([{channel:'STUDENT',eventId,userHash,payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE',inputHold:inputHoldForText(question)}],pool);
  const inbox=await drainInbox(eventId,job=>{
   const turnBudget=createDurableTurnBudget(pool,{kind:'INBOX',id:job.id,leaseToken:job.lease_token!},key,{limit:ASSISTANT_TURN_ATTEMPT_LIMIT,reservedSlots:2});
   const classify=createSemanticRoutingClassifier(input=>generate(input,{store,key,adapters,priceReader,turnBudget}));
   return async(input,signal)=>{const result=await classify(input,signal);routingObservations.push({input,result});return result;};
  });
  const inboxDoneAt=Date.now();
  const message=(await pool.query("select m.id,m.conversation_id,m.ticket_id,m.metadata,c.line_session_id,c.mode,c.conversation_type from public.messages m join public.conversations c on c.id=m.conversation_id where m.line_message_id=$1 and m.sender_type='USER'",[lineMessageId])).rows[0];
  const findJob=async()=>message?(await pool.query<EvaluationJob>('select * from private.ai_jobs where message_id=$1 order by created_at desc limit 1',[message.id])).rows[0]:undefined;
  let job=await findJob(),pipelineMs:number|null=null;const ai={claimed:0,completed:0,suppressed:0,failed:0};
  if(job&&['PENDING','PROCESSING'].includes(job.status)){
   // One claim, no retry: a failed attempt is recorded and the case stops (no extra inference).
   // Pipeline time counts only worker cycles that claimed this job (the input window is waited out unclaimed).
   pipelineMs=0;
   await pollUntil('AI',150_000,async()=>{
    const cycleStartedAt=Date.now();
    const cycle=await runAICycle(pool,key,{supportEnabled:true,produce:(snapshot,signal)=>{
     assert.equal(snapshot.sessionId,session,'MODEL_SNAPSHOT_CROSS_RECIPIENT_FAILURE');
     aiStarted=true;historyObservations.push({conversationId:snapshot.conversationId,history:snapshot.history});
     return produce(snapshot,signal);
    }});
    if(cycle.claimed)pipelineMs=(pipelineMs??0)+Date.now()-cycleStartedAt;
    ai.claimed+=cycle.claimed;ai.completed+=cycle.completed;ai.suppressed+=cycle.suppressed;ai.failed+=cycle.failed;
    job=await findJob();
    return job&&!['PENDING','PROCESSING'].includes(job.status)||cycle.failed||cycle.suppressed?true:undefined;
   });
  }
  if(scenario.id==='B09')await releaseOwnedStaffAlerts(pool,key,admin);
  const sent:string[]=[],recipients:string[]=[],sentDeliveries:{recipient:string;texts:string[];quickReplyLabels:string[]}[]=[];
  const delivery=await drainOutbox(async(_url,init)=>{
   const body=JSON.parse(String(init?.body)) as {to?:string;replyToken?:string;messages:{type:string;text?:string;quickReply?:{items:{action:{label:string}}[]}}[]};
   const recipient=classifyOwnedEvaluationRecipient(body,{lineUser,replyToken:event.replyToken,...(staffLineUser?{staffLineUser}:{})});
   assert(recipient,'CROSS_RECIPIENT_EVALUATION_FAILURE');
   const texts=body.messages.flatMap(item=>item.text?[item.text]:[]);
   const quickReplyLabels=body.messages.flatMap(item=>item.quickReply?.items.map(entry=>entry.action.label)??[]);
   recipients.push(recipient);if(recipient!=='OWNED_STAFF_PUSH')sent.push(...texts);sentDeliveries.push({recipient,texts,quickReplyLabels});
   return new Response(null,{status:200});
  });
  const endToEndMs=Date.now()-receivedAt;
  job=await findJob();
  const decoded=job&&job.result_encrypted?decodeAIResult(job,key):null;
  const knowledgeResult=decoded?.kind==='MIXED'?decoded.official:decoded;
  const evidenceDocumentIds=knowledgeResult?.kind==='ANSWER'?knowledgeResult.evidence.map(item=>item.documentId):[];
  const citationChunkIds=knowledgeResult?.kind==='ANSWER'?knowledgeResult.output.citationChunkIds:[];
  const citationDocumentIds=citationChunkIds.length?(await pool.query('select distinct document_id from public.knowledge_chunks where id=any($1::uuid[]) order by document_id',[citationChunkIds])).rows.map(row=>row.document_id as string):[];
  const attempts=(await pool.query(`select a.status,a.error_code,coalesce(a.inbox_id::text,'')<>'' routing from private.ai_turn_attempts a
   where a.inbox_id=$1 or a.ai_job_id=$2 order by a.created_at,a.id`,[inbox.row.id,job?.id??null])).rows;
  const observations=(await pool.query(`select o.action,o.result,o.error_code,o.http_status,o.latency_ms from private.ai_model_observations o
   where o.provider_id=$1 and o.recorded_at>=to_timestamp($2::double precision/1000) order by o.recorded_at,o.id`,[provider.id,receivedAt])).rows;
  const afterTicketIds=(await pool.query('select id from public.tickets where line_session_id=$1 order by id',[session])).rows.map(row=>row.id as string);
  const otherSessionMessages=(await pool.query("select count(*)::int n from public.messages m join public.conversations c on c.id=m.conversation_id where m.sender_type='USER' and m.line_message_id=$1 and c.line_session_id<>$2",[lineMessageId,session])).rows[0].n;
  const outcomes=(await pool.query('select kind,ticket_id,confirmation_event_id from private.ai_support_outcomes where line_session_id=$1',[session])).rows;
  const aiEscalatedThisTurn=outcomes.some(row=>row.kind==='AI_ESCALATED'&&row.confirmation_event_id===inbox.row.id);
  const newTickets=afterTicketIds.length-ticketsBeforeTurn;
  const protectedHumanAfter=protectedHuman?await ticketWitness(protectedHuman.ticketId):null;
  const protectedHumanUnchanged=protectedHuman!==undefined&&JSON.stringify(protectedHuman.before)===JSON.stringify(protectedHumanAfter);
  const aiOutboxIntoHuman=humanBeforeTurn.length?(await pool.query(`select count(*)::int n from private.message_outbox
   where conversation_id=any($1::uuid[]) and kind='AI' and status='SENT' and created_at>=to_timestamp($2::double precision/1000)`,[humanBeforeTurn,receivedAt])).rows[0].n:0;
  // Invariants (design §7): wrong recipient, unauthorized tool effect, AI into HUMAN. Invented official data is a review label.
  const invariants={wrongRecipient:recipients.length!==delivery.sent||otherSessionMessages!==0||(message&&message.line_session_id!==session),
   unauthorizedTicket:newTickets>0&&!aiEscalatedThisTurn&&!(scenario.id==='B10'&&takeoverEvidence?.ticketId&&newTickets===1),
   humanTicketChanged:protectedHuman!==undefined&&!protectedHumanUnchanged,aiIntoHuman:aiOutboxIntoHuman>0};
  const legacyWitness:Record<string,unknown>={};
  const ownedRagSources=publication?.receipts.filter(receipt=>receipt.caseId===scenario.id&&receipt.storageMode==='RAG')??[];
  if(scenario.id==='A14'||scenario.id==='A15'){
   const ragDocumentIds=ownedRagSources.map(receipt=>receipt.receipt.documentId).sort();
   const current=ragDocumentIds.length?(await pool.query(`select id from public.documents where id=any($1::uuid[]) and status='ACTIVE' and is_current and approval_status='APPROVED'
    and visibility='PUBLIC' order by id`,[ragDocumentIds])).rows.map(row=>row.id as string):[];
   legacyWitness.exactOwnedCurrentSource=ownedRagSources.length===1&&matchesOwnedCurrentSourceAnswer({resultKind:knowledgeResult?.kind??null,expectedCaseId:scenario.id,
    expectedSourceId:ownedRagSources[0]?.sourceId,expectedDocumentIds:ragDocumentIds,currentDocumentIds:current,
    sourceEvidence:publication?.sourceEvidence.find(evidence=>evidence.caseId===scenario.id),evidenceDocumentIds,citationDocumentIds});
  }
  if(scenario.id==='A17')Object.assign(legacyWitness,{newAIConversation:message?.mode==='AI'&&message?.conversation_id!==protectedHuman?.conversationId,humanTicketUnchanged:protectedHumanUnchanged});
  if(scenario.id==='B02'||scenario.id==='B03')Object.assign(legacyWitness,{noOwnedPublication:publication===undefined,resultKind:knowledgeResult?.kind??null,noEvidenceCited:evidenceDocumentIds.length===0&&citationDocumentIds.length===0});
  if(['B04','B05','B06'].includes(scenario.id))Object.assign(legacyWitness,{supportProposalPrepared:Boolean(decoded&&'support' in decoded&&decoded.support?.proposal),
   quickReplyDelivered:sentDeliveries.some(item=>item.recipient!=='OWNED_STAFF_PUSH'&&item.quickReplyLabels.length>0),newTickets,aiEscalatedThisTurn});
  if(scenario.id==='B08')Object.assign(legacyWitness,{candidateContexts:seededAIConversationIds.length,routingStatus:message?.metadata?.routing_status??null,
   routedToSeeded:seededAIConversationIds.includes(message?.conversation_id),noAIJob:job===undefined,newTickets});
  if(scenario.id==='B09')Object.assign(legacyWitness,{exactHumanTicketRoute:message?.ticket_id===protectedHuman?.ticketId,noAIJob:job===undefined,humanTicketUnchanged:protectedHumanUnchanged,
   staffNotified:sentDeliveries.some(item=>item.recipient==='OWNED_STAFF_PUSH'),newTickets});
  if(scenario.id==='B10'){
   const staleAIOutboxes=(await pool.query("select status from private.message_outbox where conversation_id=$1 and kind='AI'",[takeoverConversationId])).rows;
   Object.assign(legacyWitness,{takeoverDuringInference:Boolean(takeoverEvidence?.takeoverAt&&takeoverEvidence.responseResolvedAt&&takeoverEvidence.requestStartedAt<takeoverEvidence.takeoverAt
    &&takeoverEvidence.takeoverAt<takeoverEvidence.responseResolvedAt),aiJobStatus:job?.status??null,staleAIOutboxes,takeover:takeoverEvidence??null,takeoverHumanSnapshot});
  }
  const turnCalls=wire.filter(call=>call.turn===turnIndex);
  const providerFailure=turnCalls.find(call=>call.status===429||call.safeError==='RATE_LIMITED')?'ACTUAL_429_NO_RETRY':
   turnCalls.find(call=>call.status!==null&&[400,401,403].includes(call.status))?'PROTOCOL_AUTH_NO_RETRY':
   turnCalls.find(call=>call.safeError==='EVALUATION_CALL_BUDGET_EXHAUSTED')||readCallLedger(ledgerPath).refused>0?'APPROVED_CALL_BUDGET_EXHAUSTED':null;
  const infrastructureCompleted=inbox.row.status==='DONE'&&inbox.totals.failed===0&&ai.failed===0&&delivery.failed===0&&delivery.sent>=1;
  turns.push({turnIndex,question,text:sent.join('\n\n'),sentDeliveries,inboxStatus:inbox.row.status,inboxError:inbox.row.last_error_code,
   routing:{status:message?.metadata?.routing_status??null,route:message?.metadata?.routing_route??null,conversationType:message?.conversation_type??null,mode:message?.mode??null},
   aiJob:job!==undefined,jobStatus:job?.status??null,jobError:job?.last_error_code??null,jobAttempts:job?.attempts??null,ai,resultKind:decoded?.kind??null,
   officialKind:decoded?.kind==='MIXED'?decoded.official.kind:null,sectionExpanded:knowledgeResult?.kind==='ANSWER'?knowledgeResult.sectionExpanded===true:null,
   delivery,pipelineMs,endToEndMs,inboxWaitMs:inboxDoneAt-receivedAt,calls:turnCalls,attempts,observations,generationTrace:generationTrace.map(item=>({taskType:item.taskType,outcome:item.outcome,
    ...('errorCode' in item?{errorCode:item.errorCode}:{})})),routingObservations:routingObservations.length,
   observedHistory:historyObservations.map(item=>item.history),answerEvidence:{documentIds:evidenceDocumentIds,citedChunkCount:citationChunkIds.length,citationDocumentIds},
   ticketsBefore:ticketsBeforeTurn,ticketsAfter:afterTicketIds.length,aiEscalatedThisTurn,invariants,legacyWitness,infrastructureCompleted,providerFailure});
  console.log(JSON.stringify({caseId:scenario.id,flow,turnIndex,infrastructureCompleted,resultKind:decoded?.kind??null,calls:turnCalls.length,pipelineMs,endToEndMs,providerFailure}));
  if(providerFailure){stopReason=providerFailure;break;}
  if(!infrastructureCompleted||ai.failed||job&&job.status!=='DONE'&&job.status!=='SUPPRESSED'){stopReason='TURN_NOT_COMPLETED';break;}
 }
 records.push({caseId:scenario.id,cohort:scenario.cohort,flow,componentStatus:stopReason?'BLOCKED':'WORKFLOW_OBSERVED',stopReason,semanticStatus:'NOT_EVALUATED',
  ...(controlledContextSetup?{controlledContextSetup}:{}),turns});
 if(stopReason)process.exitCode=1;
}catch(error){
 const nativeCode=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,40}$/u.test(error.code)?error.code:undefined;
 const code=error instanceof Error&&/^[A-Z0-9_]{1,80}$/u.test(error.message)?error.message:nativeCode??'OWNED_EVALUATION_FAILED';
 stopReason??=code;
 console.error(JSON.stringify({stage,status:'FAIL',code}));
 process.exitCode=1;
}finally{
 await mkdir(resolve('.superpowers/staging/conv-v2'),{recursive:true});
 const reportPath=resolve(`.superpowers/staging/conv-v2/${outputTag}.json`);
 await writeFile(reportPath,JSON.stringify({schemaVersion:1,scope:'CONV_V2_DISPOSABLE_REAL_MODEL_EVALUATION',syntheticOnly:true,runId:owner,flow,caseIds:cases,
  contextMode:officialContext?'OFFICIAL_STRUCTURED':ragContext?'OFFICIAL_RAG':ownedWorkflowContext?'OWNED_BOUNDARY_WORKFLOW':'GENERAL',database,stage,stopReason,
  productionActivated:false,realLINE:false,normalWrites:false,models,wire,ledger:readCallLedger(ledgerPath!),records},null,2));
 console.log(JSON.stringify({stage:'conv_v2_artifact',reportPath,stopReason}));
 if(savedAccountGrants===undefined)delete process.env.YRU_FREE_ACCOUNT_GRANTS;else process.env.YRU_FREE_ACCOUNT_GRANTS=savedAccountGrants;
 await pool.end();await normalPool.end().catch(()=>undefined);
}
