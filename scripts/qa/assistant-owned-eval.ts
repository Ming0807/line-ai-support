import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {databaseConnection} from '../../lib/database/connection';
import {createAIStore} from '../../lib/ai/store';
import {createProvider,createModel} from '../../lib/ai/provider-admin';
import {refreshModelPricing} from '../../lib/ai/provider-pricing';
import type {AIModelConfig} from '../../lib/ai/types';
import {createProviderRegistry} from '../../lib/ai/provider-registry';
import {createCompatibleTransport} from '../../lib/ai/compatible-network';
import {createPinnedHttpsRequest} from '../../lib/ai/compatible-pinned-https';
import {createPriceReader} from '../../lib/ai/pricing';
import {hasConfirmedFreeAccount,confirmedFreeAccountUntil} from '../../lib/ai/account-free';
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
import {validateOwnedConversationTarget,classifyOwnedEvaluationRecipient,matchesOwnedSentHistory,type OwnedConversationHistoryTurn} from '../../lib/ai/conversation-eval-target';
import {evaluateAssistantConversationCases} from '../../lib/ai/conversation-eval';
import {matchesOwnedCurrentSourceAnswer} from '../../lib/ai/conversation-eval-oracle';
import {REQUIRED_CONVERSATION_PROOF_PATHS} from '../../lib/ai/conversation-eval-evidence';
import {publishOwnedAssistantSources} from './assistant-owned-publication';
import {createLocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {transaction} from '../../lib/database/pool';
import {createEscalation} from '../../lib/tickets/create-ticket';
import {createConversationReply} from '../../lib/ai/conversation-reply';
import {prepareOwnedStaffAlerts,releaseOwnedStaffAlerts} from '../../tests/database/staff-alert-fixture';
import {readRegistryPreflight} from './assistant-registry-preflight';

// Disposable-only pilot, never a normal database or real LINE sender. The parent
// owns creation/replay/drop. Model prose and frozen-case scoring require review.
const fixtureBytes=await readFile(resolve('tests/fixtures/assistant-conversations.json'));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),'e79ade32e0960df2e0399531d703e55955456caf7af432288ea919ae45e801f3','FROZEN_CONVERSATION_FIXTURE_CHANGED');
const scenarioSchema=z.object({id:z.string(),cohort:z.enum(['ANSWERABLE','BOUNDARY_REQUIRED']),needsOfficialEvidence:z.boolean(),evidenceState:z.string(),
 turns:z.array(z.string().min(1)).min(1).max(10),conversationContext:z.unknown().optional()});
const fixture=z.object({schemaVersion:z.literal(1),scenarioCount:z.literal(30),scenarios:scenarioSchema.array().length(30)}).parse(JSON.parse(fixtureBytes.toString('utf8')));
const cases=process.argv.find(arg=>arg.startsWith('--cases='))?.slice('--cases='.length).split(',')??[];
const outputTagArguments=process.argv.filter(arg=>arg.startsWith('--output-tag='));
assert(outputTagArguments.length<=1,'DUPLICATE_EVALUATION_OUTPUT_TAG');
const outputTag=outputTagArguments.length?outputTagArguments[0].slice('--output-tag='.length):undefined;
if(outputTag!==undefined)assert(/^[a-z0-9-]{1,50}$/u.test(outputTag),'EVALUATION_OUTPUT_TAG_INVALID');
const timeoutArgument=process.argv.filter(arg=>arg.startsWith('--model-timeout-ms='));
assert(timeoutArgument.length<=1,'DUPLICATE_EVALUATION_TIMEOUT');
const experimentalTimeoutMs=timeoutArgument.length?z.coerce.number().int().min(1000).max(25000).parse(timeoutArgument[0].slice('--model-timeout-ms='.length)):undefined;
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
const officialContext=process.argv.includes('--official-context');
const ragContext=process.argv.includes('--rag-context');
const ownedWorkflowContext=process.argv.includes('--owned-workflow-context');
assert([officialContext,ragContext,ownedWorkflowContext].filter(Boolean).length<=1,'OWNED_EVALUATION_CONTEXT_MODE_CONFLICT');
const selected=validateOwnedConversationTarget({database,synthetic:process.argv.includes('--synthetic'),caseIds:cases,officialContext,ragContext,ownedWorkflowContext},fixture.scenarios);
assert(database);
const normalKey=process.env.ENCRYPTION_KEY,normalConnection=process.env.DIRECT_URL??process.env.DATABASE_URL;
assert(normalKey&&normalConnection,'MODEL_REGISTRY_NOT_CONFIGURED');
const owner=randomUUID(),key=randomBytes(32).toString('base64');
type EvaluationJob=AIJob&{status:string;last_error_code:string|null};
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:6,application_name:`assistant-eval-${owner}`});
const normalPool=new Pool({...databaseConnection(normalConnection),max:1,connectionTimeoutMillis:10000});
const sessions:string[]=[],providerIds:string[]=[],models:unknown[]=[],records:unknown[]=[];
const clones:{source:AIModelConfig;providerId:string;modelId:string}[]=[];
const ownedFreeGrants:{providerId:string;networkRevision:number;baseUrl:string;models:string[];confirmedAt:string;expiresAt:string}[]=[];
const originalHashes=Object.fromEntries(await Promise.all([...REQUIRED_CONVERSATION_PROOF_PATHS,...['lib/ai/assistant-decision.ts','lib/ai/assistant-orchestrator.ts','lib/ai/gateway.ts','lib/knowledge/configured.ts',
 'lib/knowledge/answer-producer.ts','lib/knowledge/lookup-plan.ts','lib/ai/conversation-reply.ts','lib/ai/account-free.ts','lib/ai/cost-policy.ts','lib/conversation/semantic-routing-provider.ts','lib/ai/knowledge-snapshot.ts','lib/ai/run-worker.ts','lib/conversation/student-processing.ts','scripts/qa/assistant-owned-publication.ts','scripts/qa/assistant-owned-source.ts','scripts/qa/assistant-owned-eval.ts']
 .concat(['lib/ai/conversation-eval-target.ts','lib/ai/conversation-eval.ts','lib/ai/conversation-eval-oracle.ts','lib/ai/backend-tools.ts','lib/ai/jobs.ts',
  'lib/knowledge/structured-discovery.ts','lib/knowledge/structured-search.ts','lib/knowledge/structured-query.ts','lib/knowledge/structured-citations.ts',
  'lib/knowledge/delivery-fence.ts','lib/queue/run-outbox.ts','lib/conversation/quick-reply.ts','lib/conversation/support-confirmation.ts','lib/ai/support-actions.ts','lib/ai/support-state.ts','lib/tickets/create-ticket.ts','lib/tickets/ticket-service.ts','lib/staff/line-chat-delivery.ts','tests/fixtures/assistant-conversations.json','tests/fixtures/assistant-conversation-context.json'])]
 .map(async path=>[path,createHash('sha256').update(await readFile(resolve(path))).digest('hex')])));
let stage='owned_preflight';
let publication:Awaited<ReturnType<typeof publishOwnedAssistantSources>>|undefined;
let embeddingProvider:ReturnType<typeof createLocalE5EmbeddingProvider>|undefined;
try{
 assert(/^yru_structured_schema_[a-f0-9]{12}$/u.test(database)&&selected.length>0,'OWNED_SYNTHETIC_DIAGNOSTIC_SCOPE_REQUIRED');
 assert.equal((await pool.query('select current_database() name')).rows[0].name,database,'OWNED_DATABASE_CONNECTION_REQUIRED');
 assert.equal((await pool.query('select count(*)::int n from private.ai_providers')).rows[0].n,0,'FRESH_OWNED_REGISTRY_REQUIRED');
 stage='registry_read_only_load';
 const sourceModels=(await readRegistryPreflight(()=>createAIStore(normalPool).loadModels(),{
  observe:event=>console.log(JSON.stringify(event)),
 })).filter(model=>model.costMode==='FREE_ONLY');
 assert(sourceModels.length>0&&sourceModels.length<=16,'BOUNDED_ENABLED_FREE_REGISTRY_REQUIRED');
 assert.equal(new Set(sourceModels.map(model=>`${model.providerPriority}:${model.priority}`)).size,sourceModels.length,'SOURCE_PRIORITY_TIE_REQUIRES_EXACT_CLONE');
 stage='owned_registry_admin';
 const admin=randomUUID();await pool.query('insert into auth.users(id) values($1)',[admin]);
 await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Synthetic evaluation owner','SUPER_ADMIN',true)",[admin]);
 if(officialContext||ragContext){
  stage='owned_official_publication';
  if(ragContext){
   stage='owned_local_embedding_preflight';
   embeddingProvider=createLocalE5EmbeddingProvider();
   assert((await embeddingProvider.healthCheck()).healthy,'OWNED_LOCAL_E5_UNAVAILABLE');
  }
  publication=await publishOwnedAssistantSources({pool,key,actor:admin,database,caseIds:cases,
   companion:JSON.parse(await readFile(resolve('tests/fixtures/assistant-conversation-context.json'),'utf8')),frozenText:fixtureBytes.toString('utf8'),embeddingProvider});
 }
 const mapped=new Map<string,string>();
 for(const source of sourceModels){
  stage='owned_provider_clone';
  let providerId=mapped.get(source.providerId);
  if(!providerId){
   const adapter=z.enum(['ZEN','OPENROUTER','OPENAI','COMPATIBLE']).parse(source.adapter);
   const provider=await createProvider(admin,{name:`Synthetic ${source.adapter} ${mapped.size+1}`,adapter,baseUrl:source.baseUrl,
    enabled:true,priority:source.providerPriority,costMode:'FREE_ONLY',apiKey:decryptValue(source.apiKeyEncrypted,normalKey)},{pool,key});
   providerId=provider.id;mapped.set(source.providerId,providerId);providerIds.push(providerId);
  }
  stage='owned_model_clone';
  const model=await createModel(admin,providerId,{modelId:source.modelId,displayName:source.modelId.slice(0,100),purpose:'GENERATION',embeddingDimensions:null,
   supportsTools:source.supportsTools,supportsJson:source.supportsJson,supportsVision:false,enabled:true,priority:source.priority,timeoutMs:experimentalTimeoutMs??source.timeoutMs,
   inputPricePerMillion:source.inputPricePerMillion,outputPricePerMillion:source.outputPricePerMillion},{pool,key});
  clones.push({source,providerId,modelId:model.id});
  if(hasConfirmedFreeAccount(source)){
   const network=(await pool.query('select network_revision from private.ai_providers where id=$1',[providerId])).rows[0];
   const existing=ownedFreeGrants.find(grant=>grant.providerId===providerId);
   if(existing)existing.models.push(source.modelId);
   else ownedFreeGrants.push({providerId,networkRevision:network.network_revision,baseUrl:source.baseUrl,models:[source.modelId],confirmedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()});
  }
  models.push({providerId,modelId:model.id,sourceProviderId:source.providerId,sourceModelId:source.id,modelName:source.modelId,
   sourceProviderRevision:source.providerRevision,sourceModelRevision:source.modelRevision,sourceProviderPriority:source.providerPriority,sourcePriority:source.priority,
   sourceCostMode:source.costMode,sourceAdapter:source.adapter,sourceBaseUrl:source.baseUrl,sourceNetworkRevision:source.providerNetworkRevision,
   sourceGrantExpiresAt:confirmedFreeAccountUntil(source),sourceApiFormat:source.apiFormat??null,sourceTimeoutMs:source.timeoutMs,targetTimeoutMs:experimentalTimeoutMs??source.timeoutMs});
 }
 await normalPool.end();
 // Disposable identity is re-attested only when its exact source was operator-confirmed.
 process.env.YRU_FREE_ACCOUNT_GRANTS=JSON.stringify(ownedFreeGrants);
 stage='owned_fresh_pricing_and_protocol';
 let verifiedFreeModels=0;
 for(const clone of clones){
  const current=(await pool.query('select p.revision provider_revision,m.revision model_revision from private.ai_models m join private.ai_providers p on p.id=m.provider_id where m.id=$1',[clone.modelId])).rows[0];
  const readPricing=createPriceReader();
  const fresh=await refreshModelPricing(admin,clone.providerId,clone.modelId,{providerRevision:current.provider_revision,modelRevision:current.model_revision},{pool,
   priceReader:async(query,signal)=>{
    try{const metadata=await readPricing(query,signal);console.log(JSON.stringify({stage:'owned_catalog',modelName:clone.source.modelId,status:metadata.status,apiFormat:metadata.apiFormat}));return metadata;}
    catch(error){console.log(JSON.stringify({stage:'owned_catalog',modelName:clone.source.modelId,status:'FAIL',code:error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z_]+$/u.test(error.code)?error.code:'CATALOG_UNAVAILABLE'}));throw error;}
   }});
  models.push({catalogModel:clone.source.modelId,catalogAdapter:clone.source.adapter,catalogStatus:fresh.pricing.status,catalogApiFormat:fresh.pricing.apiFormat??null});
  // Preserve every candidate and its order. The real FREE_ONLY gateway denies
  // unknown/paid candidates; an unavailable backup must not block eligible ones.
  if(fresh.pricing.status==='FREE'||ownedFreeGrants.some(g=>g.providerId===clone.providerId&&g.models.includes(clone.source.modelId))){
   verifiedFreeModels++;
   if(clone.source.adapter==='ZEN')assert.equal(fresh.pricing.apiFormat,clone.source.apiFormat,'SOURCE_PROTOCOL_CHANGED');
  }
 }
 assert(verifiedFreeModels>0,'VERIFIED_FREE_MODEL_REQUIRED_FOR_OWNED_EVALUATION');
 const store=createAIStore(pool),adapters=createProviderRegistry(),priceReader=createPriceReader();
 const observedModels=await store.loadModels();
 assert.deepEqual(observedModels.map(model=>model.modelId),sourceModels.map(model=>model.modelId),'OWNED_CLONE_ORDER_CHANGED');
 models.push({observedTargetOrder:observedModels.map(model=>({modelName:model.modelId,providerPriority:model.providerPriority,priority:model.priority,
  costMode:model.costMode,apiFormat:model.apiFormat??null,timeoutMs:model.timeoutMs,providerRevision:model.providerRevision,modelRevision:model.modelRevision}))});
 async function seedHumanContext(sessionId:string,topic:string,departmentCode:string,assignedStaffId:string|null){
  const conversationId=randomUUID(),ticketId=randomUUID();
  await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type,topic,status) values($1,$2,'HUMAN','TICKET',$3,'ACTIVE')",[conversationId,sessionId,topic]);
  await pool.query(`insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
   values($1,$2,$3,(select id from public.departments where code=$4),$5,'HUMAN','STAFF_HANDLING','GENERAL',$6)`
   ,[ticketId,sessionId,conversationId,departmentCode,topic,assignedStaffId]);
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
 for(const scenario of selected){
  stage=`case_${scenario.id}`;
  const session=randomUUID(),lineUser=`U${randomUUID().replaceAll('-','')}`,turns:unknown[]=[];
  sessions.push(session);
  await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,`Synthetic ${scenario.id} ${owner}`]);
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(lineUser,key),encryptValue(lineUser,key)]);
  let blocked=false;const expectedHistory:OwnedConversationHistoryTurn[]=[],caseEventIds:string[]=[],ticketCountsAfterTurns:number[]=[];
  let controlledContextSetup:Record<string,unknown>|undefined;
   let protectedHuman:{conversationId:string;ticketId:string;before:unknown}|undefined,staffLineUser:string|undefined,takeoverHumanSnapshot:unknown,priorSupportProposalDeliveredBeforeFinal=false;
  let seededAIConversationIds:string[]=[],takeoverConversationId:string|undefined;
  if(scenario.id==='A17'||scenario.id==='B09'){
   if(scenario.id==='B09'){
    await prepareOwnedStaffAlerts(pool);
    staffLineUser=`U${randomUUID().replaceAll('-','')}`;
    await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',[admin,hashStaffLineUserId(staffLineUser,key),encryptValue(staffLineUser,key)]);
   }
   const seeded=await seedHumanContext(session,'registration','REGISTRAR',scenario.id==='B09'?admin:null);
   protectedHuman={...seeded,before:await ticketWitness(seeded.ticketId)};
  }else if(scenario.id==='B08'){
   seededAIConversationIds=[await seedAIContext(session,'registration'),await seedAIContext(session,'library')];
  }else if(scenario.id==='B10'){
   takeoverConversationId=await seedAIContext(session,'device access');
  }
  let takeoverEvidence:{requestStartedAt:number;takeoverAt:number|null;responseResolvedAt:number|null;ticketId:string|null}|undefined;
  const prior=publication?.contexts.find(context=>context.scenarioId===scenario.id)?.priorUserMessages??[];
  if(prior.length){
   const conversation=randomUUID();
   await pool.query('insert into public.conversations(id,line_session_id,topic) values($1,$2,$3)',[conversation,session,prior[0]]);
   for(const content of prior){
    await pool.query("insert into public.messages(conversation_id,sender_type,content) values($1,'USER',$2)",[conversation,content]);
    expectedHistory.push({role:'USER',content});
   }
  }
  if(scenario.id==='B06'){
   const context=z.object({priorAssistantStep:z.literal('a safe troubleshooting step was actually delivered')}).parse(scenario.conversationContext);
   const setupEventId=randomUUID(),setupMessageId=randomUUID(),question=scenario.turns[0];
   const setupEvent={type:'message',source:{type:'user',userId:lineUser},message:{type:'text',id:setupMessageId,text:question}};
   const safeStep='หากทราบข้อมูลการเชื่อมต่อของเครือข่ายนี้ ลองลืมเครือข่ายบนอุปกรณ์ของคุณแล้วเชื่อมใหม่ โดยไม่ปรับอุปกรณ์เครือข่ายที่ผู้อื่นใช้งานร่วมกันครับ';
   await persistWebhookEvents([{channel:'STUDENT',eventId:setupEventId,userHash:hashLineUserId(lineUser,key),payloadEncrypted:encryptValue(JSON.stringify(setupEvent),key),eventKind:'MESSAGE'}],pool);
   const setupInbox=await runInboxCycle(pool,key,{aiEnabled:true});assert.equal(setupInbox.completed,1,'OWNED_PRIOR_STEP_INBOX_REQUIRED');
   const setupAI=await runAICycle(pool,key,{produce:async snapshot=>{
    assert.equal(snapshot.sessionId,session);assert.equal(snapshot.question,question);
    const result=createConversationReply(snapshot,safeStep);assert(result,'CONTROLLED_SAFE_STEP_MUST_PASS_NORMAL_DELIVERY_CONTRACT');return result;
   }});assert.equal(setupAI.completed,1,'OWNED_PRIOR_STEP_AI_REQUIRED');
   let accepted=0;
   const setupDelivery=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-no-network',STAFF:'synthetic-no-network'},fetchImpl:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.to,lineUser);assert.equal(body.messages.map((message:{text:string})=>message.text).join(''),safeStep);
    accepted++;return new Response(null,{status:200});
   }});
   const witness=(await pool.query(`select j.id job_id,o.id outbox_id,o.status from private.ai_jobs j
    join public.messages m on m.id=j.message_id join private.message_outbox o on o.idempotency_key='ai-job:'||j.id
    where m.line_message_id=$1 and j.line_session_id=$2`,[setupMessageId,session])).rows[0];
   assert(setupDelivery.sent===1&&accepted===1&&witness?.status==='SENT','OWNED_PRIOR_STEP_ACTUAL_CONTROLLED_DELIVERY_REQUIRED');
   controlledContextSetup={scope:'DECLARED_FROZEN_CONTEXT_BOOTSTRAP',model:'CONTROLLED_CONTEXT_ONLY',line:'CONTROLLED_FETCH',priorAssistantStep:context.priorAssistantStep,
    priorAssistantStepDeliveredBeforeFrozenSuite:true,jobId:witness.job_id,outboxId:witness.outbox_id};
   expectedHistory.push({role:'USER',content:question},{role:'AI',content:safeStep});
  }
  for(const question of scenario.turns){
   const routingObservations:unknown[]=[];
   const historyObservations:{conversationId:string;history:AISnapshot['history']}[]=[];
   const generationTrace:AssistantGenerationDiagnostic[]=[];
   async function duringInference<T>(operation:()=>Promise<T>):Promise<T>{
    if(scenario.id!=='B10'||historyObservations.length===0||takeoverEvidence!==undefined||!takeoverConversationId)return await operation();
    const witness={requestStartedAt:Date.now(),takeoverAt:null as number|null,responseResolvedAt:null as number|null,ticketId:null as string|null};
    takeoverEvidence=witness;
    const pending=operation().then(response=>{witness.responseResolvedAt=Date.now();return response;});
    const takeover=await transaction(client=>createEscalation(client,{sessionId:session,conversationId:takeoverConversationId!,departmentCode:'IT',summary:question},key),pool);
    witness.ticketId=takeover.id;takeoverHumanSnapshot=await ticketWitness(takeover.id);witness.takeoverAt=Date.now();
    return await pending;
   }
   const fetchImpl:typeof fetch=async(input,init)=>{
    const requestUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const method=init?.method??(input instanceof Request?input.method:'GET');
    const providerRequest=sourceModels.some(model=>{
     try{return new URL(requestUrl).origin===new URL(model.baseUrl).origin;}catch{return false;}
    });
    if(method==='POST'&&providerRequest)return await duringInference(()=>fetch(input,init));
    return await fetch(input,init);
   };
   const realPinnedRequest=createPinnedHttpsRequest();
   const compatibleTransport=createCompatibleTransport({requestImpl:input=>input.method==='POST'?duringInference(()=>realPinnedRequest(input)):realPinnedRequest(input)});
   const produce=createConfiguredKnowledgeProducer(pool,key,{assistantEnabled:true,fetchImpl,compatibleTransport,onAssistantGenerationDiagnostic:event=>{generationTrace.push(event);}});
   const eventId=randomUUID(),lineMessageId=randomUUID(),receivedAt=Date.now();
    const ticketsBeforeTurn=(await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[session])).rows[0].n;
   caseEventIds.push(eventId);
   const event={type:'message',source:{type:'user',userId:lineUser},replyToken:`synthetic-${eventId}`,message:{type:'text',id:lineMessageId,text:question}};
   await persistWebhookEvents([{channel:'STUDENT',eventId,userHash:hashLineUserId(lineUser,key),payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
   const inbox=await runInboxCycle(pool,key,{aiEnabled:true,classifyForJob:job=>{
    const turnBudget=createDurableTurnBudget(pool,{kind:'INBOX',id:job.id,leaseToken:job.lease_token},key,{limit:ASSISTANT_TURN_ATTEMPT_LIMIT,reservedSlots:2});
    const classify=createSemanticRoutingClassifier(input=>generate(input,{store,key,adapters,priceReader,turnBudget}));
    return async(input,signal)=>{const result=await classify(input,signal);routingObservations.push({input,result});return result;};
   }});
   const beforeAI=(await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[session])).rows[0].n;
   const ai=await runAICycle(pool,key,{supportEnabled:true,produce:(snapshot,signal)=>{
    assert.equal(snapshot.sessionId,session,'MODEL_SNAPSHOT_CROSS_RECIPIENT_FAILURE');
    historyObservations.push({conversationId:snapshot.conversationId,history:snapshot.history});
    return produce(snapshot,signal);
   }});
   const afterAI=(await pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[session])).rows[0].n;
   if(scenario.id==='B09')await releaseOwnedStaffAlerts(pool,key,admin);
   const sent:string[]=[],recipients:string[]=[],sentDeliveries:{recipient:string;texts:string[];quickReplyLabels:string[]}[]=[];
   const delivery=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-no-network',STAFF:'synthetic-no-network'},fetchImpl:async(_url,init)=>{
    const body=JSON.parse(String(init?.body)) as {to?:string;replyToken?:string;messages:{type:string;text?:string;quickReply?:{items:{action:{label:string}}[]}}[]};
    const recipient=classifyOwnedEvaluationRecipient(body,{lineUser,replyToken:event.replyToken,...(staffLineUser?{staffLineUser}:{})});
    assert(recipient,'CROSS_RECIPIENT_EVALUATION_FAILURE');
    const texts=body.messages.flatMap(message=>message.text?[message.text]:[]);
    const quickReplyLabels=body.messages.flatMap(message=>message.quickReply?.items.map(item=>item.action.label)??[]);
    recipients.push(recipient);sent.push(...texts);sentDeliveries.push({recipient,texts,quickReplyLabels});
    return new Response(null,{status:200});
   }});
   const message=(await pool.query("select m.id,m.conversation_id,m.ticket_id,m.metadata,c.line_session_id,c.mode,c.conversation_type from public.messages m join public.conversations c on c.id=m.conversation_id where m.line_message_id=$1 and m.sender_type='USER'",[lineMessageId])).rows[0];
   const job=message?(await pool.query<EvaluationJob>('select * from private.ai_jobs where message_id=$1',[message.id])).rows[0]:undefined;
   const decoded=job?decodeAIResult(job,key):null;
   const knowledgeResult=decoded?.kind==='MIXED'?decoded.official:decoded;
   const evidenceDocumentIds=knowledgeResult?.kind==='ANSWER'?knowledgeResult.evidence.map(item=>item.documentId):[];
   const citationChunkIds=knowledgeResult?.kind==='ANSWER'?knowledgeResult.output.citationChunkIds:[];
   const citationDocumentIds=citationChunkIds.length?(await pool.query('select distinct document_id from public.knowledge_chunks where id=any($1::uuid[]) order by document_id',[citationChunkIds])).rows.map(row=>row.document_id as string):[];
   const sourceInbox=(await pool.query('select id,status,last_error_code from private.webhook_inbox where channel=$1 and event_id=$2',['STUDENT',eventId])).rows[0];
   const attempts=(await pool.query(`select a.status,a.error_code,m.model_id from private.ai_turn_attempts a
    join private.ai_models m on m.id=a.model_id where a.inbox_id=$1 order by a.created_at,a.id`,[sourceInbox.id])).rows;
   const observations=(await pool.query(`select o.action,o.result,o.error_code,o.http_status,o.latency_ms,m.model_id from private.ai_model_observations o
    join private.ai_models m on m.id=o.model_id where o.provider_id=any($1::uuid[]) and o.recorded_at>=to_timestamp($2::double precision/1000)
    order by o.recorded_at,o.id`,[providerIds,receivedAt])).rows;
   const otherMessages=(await pool.query("select count(*)::int n from public.messages m join public.conversations c on c.id=m.conversation_id where m.sender_type='USER' and m.line_message_id=$1 and c.line_session_id<>$2",[lineMessageId,session])).rows[0].n;
   const afterTicketIds=(await pool.query('select id from public.tickets where line_session_id=$1 order by id',[session])).rows.map(row=>row.id as string);
   ticketCountsAfterTurns.push(afterTicketIds.length);
   const protectedHumanAfter=protectedHuman?await ticketWitness(protectedHuman.ticketId):null;
   const protectedHumanUnchanged=protectedHuman!==undefined&&JSON.stringify(protectedHuman.before)===JSON.stringify(protectedHumanAfter);
   let sentHistoryWitness=historyObservations.length===1&&matchesOwnedSentHistory(historyObservations[0]?.history.map(turn=>({role:turn.role==='user'?'USER':'AI',content:turn.content})),expectedHistory);
   for(const observation of historyObservations){
    for(const turn of observation.history){
     const actual=(await pool.query(`select count(*)::int n from public.messages m join public.conversations c on c.id=m.conversation_id
      where c.id=$1 and c.line_session_id=$2 and m.content=$3 and m.sender_type=$4 and m.id<>$5
      and (m.sender_type='USER' or exists(select 1 from private.message_outbox o where o.conversation_id=c.id and o.kind='AI'
       and o.idempotency_key='ai-job:'||(m.metadata->>'ai_job_id') and o.status='SENT'))`,
      [observation.conversationId,session,turn.content,turn.role==='user'?'USER':'AI',message?.id])).rows[0].n;
     if(actual<1)sentHistoryWitness=false;
    }
   }
   const ownershipSafe=beforeAI===afterAI&&otherMessages===0&&message?.line_session_id===session&&message?.mode==='AI'&&recipients.length===delivery.sent&&sentHistoryWitness;
   const aiOutboxState=message?(await pool.query("select count(*)::int total,count(*) filter(where status='SENT')::int sent from private.message_outbox where conversation_id=$1 and kind='AI'",[message.conversation_id])).rows[0]:{total:0,sent:0};
   const answerSupport=decoded&&'support' in decoded?decoded.support:undefined;
   const supportProposalPrepared=Boolean(answerSupport?.proposal);
   const editableProposalDelivered=sentDeliveries.some(delivery=>['OWNED_PUSH','OWNED_REPLY'].includes(delivery.recipient)&&delivery.quickReplyLabels.length>0);
    if(scenario.id==='B06'&&question!==scenario.turns.at(-1)&&supportProposalPrepared&&editableProposalDelivered)priorSupportProposalDeliveredBeforeFinal=true;
   const ownedRagSources=publication?.receipts.filter(receipt=>receipt.caseId===scenario.id&&receipt.storageMode==='RAG')??[];
   const ragDocumentIds=ownedRagSources.map(receipt=>receipt.receipt.documentId).sort();
   const currentRagDocumentIds=ragDocumentIds.length?(await pool.query(`select id from public.documents where id=any($1::uuid[]) and status='ACTIVE' and is_current
    and approval_status='APPROVED' and visibility='PUBLIC' and official_source and authority_level>0
    and effective_from<=(clock_timestamp() at time zone 'Asia/Bangkok')::date
    and (effective_to is null or effective_to>=(clock_timestamp() at time zone 'Asia/Bangkok')::date) order by id`,[ragDocumentIds])).rows.map(row=>row.id as string):[];
   const ragSourceEvidence=publication?.sourceEvidence.find(evidence=>evidence.caseId===scenario.id);
   const ragCitationWitness=ownedRagSources.length===1&&matchesOwnedCurrentSourceAnswer({resultKind:knowledgeResult?.kind??null,
    expectedCaseId:scenario.id,expectedSourceId:ownedRagSources[0]?.sourceId,expectedDocumentIds:ragDocumentIds,currentDocumentIds:currentRagDocumentIds,
    sourceEvidence:ragSourceEvidence,evidenceDocumentIds,citationDocumentIds});
   let caseSpecificWitness:Record<string,unknown>={};
   if(scenario.id==='A14'||scenario.id==='A15')caseSpecificWitness={kind:'RAG_CURRENT_SOURCE',reviewedCurrentRagSource:ragSourceEvidence??null,currentEligibleDocumentIds:currentRagDocumentIds,
    answerEvidence:{resultKind:knowledgeResult?.kind??null,evidenceDocumentIds,citationDocumentIds,exactOwnedCurrentSource:ragCitationWitness}};
   else if(scenario.id==='A17')caseSpecificWitness={kind:'SEPARATE_AI_CONVERSATION',newAIConversation:message?.mode==='AI'&&message?.conversation_type==='GENERAL'&&message?.conversation_id!==protectedHuman?.conversationId,
    humanTicketUnchanged:protectedHumanUnchanged,originalHumanConversationId:protectedHuman?.conversationId??null,routedConversationId:message?.conversation_id??null};
   else if(scenario.id==='B02'||scenario.id==='B03'){
    const availableDocuments=(await pool.query("select count(*)::int n from public.documents where status='ACTIVE' and is_current and approval_status='APPROVED' and visibility='PUBLIC' and effective_from<=(clock_timestamp() at time zone 'Asia/Bangkok')::date and (effective_to is null or effective_to>=(clock_timestamp() at time zone 'Asia/Bangkok')::date)")).rows[0].n;
    caseSpecificWitness={kind:'UNAVAILABLE_EVIDENCE',noOwnedPublication:publication===undefined,eligiblePublicDocumentCount:availableDocuments,resultKind:knowledgeResult?.kind??null,
     evidenceDocumentIds,citationDocumentIds,unavailableEvidenceObserved:knowledgeResult?.kind==='CLARIFY'&&evidenceDocumentIds.length===0&&citationDocumentIds.length===0};
   }else if(scenario.id==='B04'||scenario.id==='B05')caseSpecificWitness={kind:'SUPPORT_PROPOSAL',supportProposalPrepared,editableProposalDelivered,
    noPrematureTicket:ticketsBeforeTurn===0&&afterAI===0,ticketCountBefore:ticketsBeforeTurn,ticketCountAfter:afterAI,proposalIntent:answerSupport?.proposal.intent??null};
   else if(scenario.id==='B06'){
    const finalConfirmationEventId=sourceInbox.id;
    const confirmation=finalConfirmationEventId?(await pool.query(`select r.confirmation_event_id,e.event_kind,r.tool_name
     from private.ai_tool_receipts r join private.webhook_inbox e on e.id=r.confirmation_event_id
     where r.conversation_id=$1 and r.tool_name='create_ticket' and r.confirmation_event_id=$2`,[message?.conversation_id,finalConfirmationEventId])).rows[0]??null:null;
    const ownedConfirmationObserved=confirmation?.tool_name==='create_ticket'&&confirmation.confirmation_event_id===finalConfirmationEventId;
    const ticketReceiptDelivered=sentDeliveries.some(delivery=>['OWNED_PUSH','OWNED_REPLY'].includes(delivery.recipient)&&delivery.texts.some(text=>text.includes('รับเรื่องแล้ว')));
    caseSpecificWitness={kind:'OWNED_CONFIRMATION',priorAssistantStepDeliveredBeforeFrozenSuite:controlledContextSetup?.priorAssistantStepDeliveredBeforeFrozenSuite===true,
     priorProposalDeliveredBeforeFinal:priorSupportProposalDeliveredBeforeFinal,ticketCountBefore:beforeAI,ticketCountAfter:afterTicketIds.length,ticketIdsAfter:afterTicketIds,
     noTicketsBeforeFinalConfirmation:ticketCountsAfterTurns.slice(0,-1).every(count=>count===0),
     ticketCreatedOnlyAfterFinalTurn:question===scenario.turns.at(-1)&&ticketsBeforeTurn===0&&afterTicketIds.length===1,
     supportProposalPrepared,ownedConfirmationObserved:Boolean(ownedConfirmationObserved),confirmationEventId:confirmation?.confirmation_event_id??null,
     confirmationEventKind:confirmation?.event_kind??null,confirmationTool:confirmation?.tool_name??null,
     ticketReceiptDelivered,finalUserConfirmationTurn:question===scenario.turns.at(-1)};
   }
   else if(scenario.id==='B08')caseSpecificWitness={kind:'AMBIGUOUS_CONTEXT',candidateContexts:seededAIConversationIds.length,ambiguousChoiceRequested:message?.metadata?.routing_status==='PENDING'&&sent.some(text=>/(?:เลือก|เรื่องเดิม)/u.test(text)),
    noAIJob:job===undefined,noTicketCreated:afterTicketIds.length===0,routedConversationType:message?.conversation_type??null};
   else if(scenario.id==='B09'){
    const fixedReceiptRow=(await pool.query("select status from private.message_outbox where idempotency_key='student-response:'||$1 and channel='STUDENT' and kind='SYSTEM' and line_session_id=$2",[sourceInbox.id,session])).rows[0];
    const fixedReceiptObserved=fixedReceiptRow?.status==='SENT';
    const staffNotificationObserved=sentDeliveries.some(delivery=>delivery.recipient==='OWNED_STAFF_PUSH'&&delivery.texts.some(text=>text.includes(question)));
    caseSpecificWitness={kind:'HUMAN_CONTINUATION',exactHumanTicketRoute:message?.ticket_id===protectedHuman?.ticketId&&message?.conversation_id===protectedHuman?.conversationId,
     noAIJob:job===undefined,humanTicketUnchanged:protectedHumanUnchanged,fixedReceiptObserved,staffNotificationObserved,
     noAIDelivery:aiOutboxState.total===0,noNewTicket:ticketsBeforeTurn===1&&afterTicketIds.length===1,ticketCountBefore:ticketsBeforeTurn,ticketCountAfter:afterTicketIds.length};
   }else if(scenario.id==='B10'){
    const staleAIOutboxes=(await pool.query("select status,last_error_code from private.message_outbox where idempotency_key like 'ai-job:%' and conversation_id=$1 and kind='AI' order by created_at desc",[takeoverConversationId])).rows;
    const staleAIMessages=(await pool.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[takeoverConversationId,job?.id??''])).rows[0].n;
    const takeoverAfter=takeoverEvidence?.ticketId?await ticketWitness(takeoverEvidence.ticketId):null;
    const takeoverTimingObserved=Boolean(takeoverEvidence&&takeoverEvidence.takeoverAt!==null&&takeoverEvidence.responseResolvedAt!==null
     &&takeoverEvidence.requestStartedAt<takeoverEvidence.takeoverAt&&takeoverEvidence.takeoverAt<takeoverEvidence.responseResolvedAt);
    caseSpecificWitness={kind:'INFERENCE_TAKEOVER',takeoverDuringInference:takeoverTimingObserved,takeover:takeoverEvidence??null,aiJobSuppressed:job?.status==='SUPPRESSED',
     staleAIOutboxes,staleDispatchSuppressed:staleAIOutboxes.every(row=>row.status==='SUPPRESSED'),staleAIMessages,noAIDelivery:aiOutboxState.sent===0,
     singleTakeoverTicket:ticketsBeforeTurn===0&&afterTicketIds.length===1,
     takeoverTicketPreserved:takeoverEvidence?.ticketId!==null&&afterTicketIds.includes(takeoverEvidence?.ticketId??'')
      &&JSON.stringify(takeoverHumanSnapshot)===JSON.stringify(takeoverAfter)};
   }
   const normalCompleted=inbox.completed===1&&inbox.failed===0&&ai.failed===0&&delivery.sent>=1&&delivery.failed===0;
   const assistantTurnCompleted=ai.completed===1&&job?.status==='DONE';
   const caseWorkflowObserved=(scenario.id==='B09'?normalCompleted&&caseSpecificWitness.exactHumanTicketRoute===true&&caseSpecificWitness.noAIJob===true&&caseSpecificWitness.humanTicketUnchanged===true
     &&caseSpecificWitness.noAIDelivery===true&&caseSpecificWitness.noNewTicket===true&&caseSpecificWitness.fixedReceiptObserved===true&&caseSpecificWitness.staffNotificationObserved===true:
    scenario.id==='B10'?normalCompleted&&caseSpecificWitness.takeoverDuringInference===true&&caseSpecificWitness.aiJobSuppressed===true&&caseSpecificWitness.staleDispatchSuppressed===true&&caseSpecificWitness.staleAIMessages===0&&caseSpecificWitness.noAIDelivery===true&&caseSpecificWitness.singleTakeoverTicket===true&&caseSpecificWitness.takeoverTicketPreserved===true:
    scenario.id==='B08'?normalCompleted&&caseSpecificWitness.candidateContexts===2&&caseSpecificWitness.ambiguousChoiceRequested===true&&caseSpecificWitness.noAIJob===true&&caseSpecificWitness.noTicketCreated===true:
    scenario.id==='A17'?normalCompleted&&assistantTurnCompleted&&caseSpecificWitness.newAIConversation===true&&caseSpecificWitness.humanTicketUnchanged===true:
    scenario.id==='A14'||scenario.id==='A15'?normalCompleted&&assistantTurnCompleted&&ragCitationWitness:
    scenario.id==='B04'||scenario.id==='B05'?normalCompleted&&assistantTurnCompleted&&caseSpecificWitness.supportProposalPrepared===true&&caseSpecificWitness.editableProposalDelivered===true&&caseSpecificWitness.noPrematureTicket===true:
    scenario.id==='B02'||scenario.id==='B03'?normalCompleted&&assistantTurnCompleted&&caseSpecificWitness.eligiblePublicDocumentCount===0&&caseSpecificWitness.unavailableEvidenceObserved===true:
    scenario.id==='B06'?(question===scenario.turns.at(-1)?normalCompleted&&caseSpecificWitness.noTicketsBeforeFinalConfirmation===true&&caseSpecificWitness.ticketCreatedOnlyAfterFinalTurn===true
     &&caseSpecificWitness.priorProposalDeliveredBeforeFinal===true&&caseSpecificWitness.ownedConfirmationObserved===true&&caseSpecificWitness.ticketReceiptDelivered===true
     :normalCompleted&&assistantTurnCompleted&&ticketsBeforeTurn===0&&afterTicketIds.length===0&&ownershipSafe):
    normalCompleted&&ai.completed===1&&job?.status==='DONE'&&ownershipSafe);
   const completed=caseWorkflowObserved;
   const turn={question,text:sent.join('\n\n'),inbox,ai,delivery,jobStatus:job?.status??null,jobError:job?.last_error_code??null,
    inboxError:sourceInbox.last_error_code,resultKind:decoded?.kind??null,attempts,observations,ownershipSafe,completed,elapsedMs:Date.now()-receivedAt,
    controlledLineTransport:true,sentHistoryWitness,routingObservations,generationTrace,observedHistory:historyObservations.map(observation=>observation.history),
    caseSpecificWitness,ticketCountBefore:beforeAI,ticketCountAfter:afterAI,ticketIdsAfter:afterTicketIds,
    answerEvidence:{documentIds:evidenceDocumentIds,citedChunkCount:citationChunkIds.length,citationDocumentIds},sentDeliveries,
    successfulInferenceObserved:attempts.some(attempt=>attempt.status==='SUCCESS')};
   turns.push(turn);
   const finalTurn=question===scenario.turns.at(-1);
   const historyOwnershipRequired=!(scenario.id==='B08'||scenario.id==='B09'||scenario.id==='B10'||scenario.id==='B06'&&finalTurn);
   if(completed&&ownershipSafe)expectedHistory.push({role:'USER',content:question},{role:'AI',content:sent.join('')});
   console.log(JSON.stringify({caseId:scenario.id,completed,ownershipSafe,attempts:attempts.length,elapsedMs:turn.elapsedMs}));
   if(!completed||historyOwnershipRequired&&!ownershipSafe){blocked=true;break;}
  }
  records.push({caseId:scenario.id,cohort:scenario.cohort,componentStatus:blocked?'BLOCKED_OR_WORKFLOW_FAILED':'WORKFLOW_OBSERVED',
   semanticStatus:'NOT_EVALUATED',...(controlledContextSetup?{controlledContextSetup}:{}),turns});
  if(blocked)process.exitCode=1;
  await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=$1 and status in('PENDING','PROCESSING')",[session]);
  await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=$1 and status in('PENDING','PROCESSING')",[session]);
  await pool.query('update public.line_sessions set active=false where id=$1',[session]);
 }
}catch(error){
 const nativeCode=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,32}$/u.test(error.code)?error.code:undefined;
 console.error(JSON.stringify({stage,status:'FAIL',code:error instanceof Error&&/^[A-Z0-9_]{1,80}$/u.test(error.message)?error.message:nativeCode??'OWNED_EVALUATION_FAILED'}));
 process.exitCode=1;
}finally{
 await mkdir(resolve('.superpowers/staging'),{recursive:true});
 const finalSourceHashes=Object.fromEntries(await Promise.all(Object.keys(originalHashes).map(async path=>[path,createHash('sha256').update(await readFile(resolve(path))).digest('hex')])));
 const sourceUnchanged=JSON.stringify(finalSourceHashes)===JSON.stringify(originalHashes);
 if(!sourceUnchanged){console.error('OWNED_EVALUATION_SOURCE_CHANGED');process.exitCode=1;}
 const report=evaluateAssistantConversationCases(fixture.scenarios,[]);
 const humanReviewTemplate=selected.map(scenario=>({caseId:scenario.id,cohort:scenario.cohort,reviewer:null,rationale:null,reviewedAt:null,
  usefulAnswer:null,correctTrajectory:null,authoritySafe:null,ownershipSafe:null,status:'NOT_EVALUATED' as const}));
 const reportPath=resolve(`.superpowers/staging/assistant-owned-eval${outputTag?'-'+outputTag:''}.json`);
 await writeFile(reportPath,JSON.stringify({schemaVersion:1,scope:'DISPOSABLE_MODEL_WORKFLOW_PILOT',syntheticOnly:true,runId:owner,caseIds:cases,
  contextMode:officialContext?'OFFICIAL_STRUCTURED':ragContext?'OFFICIAL_RAG':ownedWorkflowContext?'OWNED_BOUNDARY_WORKFLOW':'GENERAL',
  productionActivated:false,officialWorkflowConnected:publication!==undefined,publicationReceipts:publication?.receipts??[],sourceEvidence:publication?.sourceEvidence??[],
  semanticReviewRequired:true,humanReviewTemplate,experimentalTimeoutMs:experimentalTimeoutMs??null,sourceHashes:originalHashes,finalSourceHashes,sourceUnchanged,models,records,report},null,2));
 await pool.end();await normalPool.end().catch(()=>undefined);
}
