import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {approveImport} from '../../lib/imports/import-publication';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import type {ImportReviewDraft} from '../../lib/imports/review-schema';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../../lib/knowledge/embedding-space';
import {transaction} from '../../lib/database/pool';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {runAICycle} from '../../lib/ai/run-worker';
import {createAssistantDecision,type AssistantDecision} from '../../lib/ai/assistant-decision';
import {createAssistantOrchestrator} from '../../lib/ai/assistant-orchestrator';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import {createConfiguredKnowledgeProducer} from '../../lib/knowledge/configured';
import {createSupportProducer} from '../../lib/ai/support-producer';
import type {GenerateInput} from '../../lib/ai/gateway';
import type {EmbedInput,EmbedResult} from '../../lib/ai/embedding-gateway';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {prepareOwnedStaffAlerts} from './staff-alert-fixture';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import {decodeAIResult,type AIJob} from '../../lib/ai/jobs';
import {createProvider,createModel} from '../../lib/ai/provider-admin';
import {refreshModelPricing} from '../../lib/ai/provider-pricing';
import {createPriceReader} from '../../lib/ai/pricing';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const databaseOptions={host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'};
// Other registered suites use the first unit axis for unrelated public fixtures.
// Keep their evidence eligible, but do not falsely make every source a semantic hit.
const unitVector=[0,1,...Array(382).fill(0)];
const generalText='Wi-Fi ส่งข้อมูลระหว่างอุปกรณ์ผ่านคลื่นวิทยุบนเครือข่ายไร้สายครับ';
const officialAnswer='เปิด Settings ของ Android แล้วเลือก Wi-Fi จากนั้นเลือก YRU-Student ตามคู่มือครับ';
const mixedQuestion='ช่วยอธิบายหลักการทำงานของ Wi-Fi และบอกวิธีเชื่อมต่อเครือข่าย YRU-Student ตามคู่มือมหาวิทยาลัย';
const personalQuestion='ขอให้เจ้าหน้าที่ตรวจสอบสถานะบัญชี YRU ของผมด้วยครับ';
const sensitiveQuestion='ถูกคุกคามจากผู้ใช้บัญชีอื่น ลองบล็อกแล้วแต่ยังเกิดปัญหา ขอส่งต่อเจ้าหน้าที่';
type Branch='MIXED'|'PERSONAL_HANDOFF'|'SENSITIVE_USER_REQUEST'|'SENSITIVE_UNRESOLVED';
const handoffReasonFor=(branch:Branch)=>branch==='PERSONAL_HANDOFF'?'PERSONAL_RECORD':branch==='SENSITIVE_USER_REQUEST'?'USER_REQUEST':'UNRESOLVED_CONFIRMED';

const scopeFor=(familyCode:string):KnowledgeScope=>({historical:false,academicYear:null,asOfDate:null,familyCodes:[familyCode],
 departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null});

type Flow=Awaited<ReturnType<typeof createFlow>>;
async function createFlow(){
 const owner=randomUUID(),appName=`assistant-grounding-${owner}`,key=randomBytes(32).toString('base64');
 const pool=new Pool({...databaseOptions,max:8,application_name:appName});
 const familyCode=`GROUND_${owner.replaceAll('-','').slice(0,20).toUpperCase()}`;
 const sessionIds:string[]=[],inboxIds:string[]=[],jobIds:string[]=[],ticketIds:string[]=[],staffIds:string[]=[];
 let documentId:string|undefined;
 const actor=randomUUID(),staff=randomUUID(),staffLineId=`U${randomUUID().replaceAll('-','')}`;
 const studentLineId=`U${randomUUID().replaceAll('-','')}`;

 async function assertOutsideSql(){
  const {rows:[row]}=await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[appName]);
  assert.equal(row.n,0,'PROVIDER_OR_LINE_HTTP_MUST_RUN_OUTSIDE_SQL');
 }
 async function cleanup(){
  try{
   if(inboxIds.length)await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[inboxIds]);
   if(sessionIds.length){
    await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessionIds]);
    await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id=any($2::uuid[])) and status in('PENDING','PROCESSING')",[sessionIds,ticketIds]);
    await pool.query('update public.line_sessions set active=false,updated_at=clock_timestamp() where id=any($1::uuid[])',[sessionIds]);
   }
   if(staffIds.length)await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])',[staffIds]);
   if(documentId)await pool.query("update public.documents set status='SUPERSEDED',is_current=false,revision=revision+1 where id=$1 and (status<>'SUPERSEDED' or is_current)",[documentId]);
  }finally{await pool.end();}
 }

 try{
  assert.equal((await pool.query('select current_database() name')).rows[0].name,database,'OWNED_DATABASE_CONNECTION_REQUIRED');
  await prepareOwnedStaffAlerts(pool);
  staffIds.push(actor,staff);
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']] as const){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,display_name,role,active,department_id) values($1,'Assistant grounding fixture',$2,true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [staff,hashStaffLineUserId(staffLineId,key),encryptValue(staffLineId,key)]);

  const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
   countPassageTokens:async texts=>{await assertOutsideSql();return texts.map(()=>40);},
   embedPassages:async texts=>{await assertOutsideSql();return texts.map(()=>unitVector);},
   embedQuery:async()=>{await assertOutsideSql();return unitVector;},
   healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
  const importOptions={pool,key,originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
  const sourceUrl=`https://fixture.yru.ac.th/assistant-grounding/${owner}`;
  // Keep checksum isolation without digit runs that can look like phone data.
  const sourceLabel=[...owner.replaceAll('-','')].map(part=>'abcdefghijklmnop'[parseInt(part,16)]).join('');
  const source=createImportSource({bytes:new TextEncoder().encode(`<html><body><h1>Controlled campus Wi-Fi connection guide ${sourceLabel}</h1><p>To connect an Android device to YRU-Student, open Settings and choose Wi-Fi. Select the YRU-Student network and follow the university instructions shown.</p><p>If connection still fails, forget the saved YRU-Student network, reconnect, and contact the IT service desk with the displayed error.</p></body></html>`),
   filename:'controlled-campus-wifi.html',mimeType:'text/html',sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null});
  const {job}=await createImportJob(actor,source,importOptions);
  const preview=await analyzeImportJob(actor,job.id,0,importOptions),state=await getImportReview(actor,job.id,importOptions),base=unfinishedReviewDraft();
  assert.equal(preview.analysis.sensitiveRisk,false,'SYNTHETIC_PUBLIC_GUIDE_MUST_CONTAIN_NO_PERSONAL_DATA');
  const today=(await pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text today")).rows[0].today;
  let draft:ImportReviewDraft={...base,schemaVersion:2,metadata:{...base.metadata,title:`Controlled synthetic campus Wi-Fi guide ${owner}`,familyCode,
   newFamily:{name:`Controlled synthetic Wi-Fi family ${owner}`,category:'Support guide'},departmentCode:'IT',documentType:'GUIDE',versionName:'2569',versionStream:'DEFAULT',academicYear:2569,
   scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:today,
   effectiveFrom:today,effectiveTo:null,
   authorityLevel:90,visibility:'PUBLIC',sourceUrl,storageMode:'RAG'},action:'NEW_FAMILY',
   attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},
   warningDispositions:state.warnings.map(w=>({warningKey:w.key,status:'CORRECTED',reason:'Reviewed controlled synthetic integration source'})),chunkPlan:null};
  const first=await saveImportReview(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft},importOptions);
  const snapshot=await getImportChunkPlan(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},importOptions);
  draft={...draft,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:snapshot.plan.chunkerVersion}};
  const saved=await saveImportReview(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision,draft},importOptions);
  const publication=await approveImport(actor,{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,
   expectedReviewRevision:saved.reviewRevision,confirmPublication:true},importOptions);
  assert.equal(publication.receipt.storageMode,'RAG');documentId=publication.receipt.documentId;
  const published=(await pool.query('select status,is_current,approval_status from public.documents where id=$1',[documentId])).rows[0];
  assert.deepEqual(published,{status:'ACTIVE',is_current:true,approval_status:'APPROVED'},'SYNTHETIC_SOURCE_MUST_USE_REAL_REVIEW_AND_PUBLICATION');
  const chunks=(await pool.query('select id,content from public.knowledge_chunks where document_id=$1 order by chunk_index',[documentId])).rows;
  const guide=chunks.find(chunk=>chunk.content.includes('YRU-Student'));assert(guide,'ACTUAL_PUBLICATION_MUST_CREATE_CANONICAL_RAG_CHUNK');

  const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`GROUND_${owner}`])).rows[0].id;sessionIds.push(session);
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [session,hashLineUserId(studentLineId,key),encryptValue(studentLineId,key)]);
  return {pool,key,owner,appName,familyCode,documentId,chunkId:guide.id,session,studentLineId,actor,staff,staffIds,sessionIds,inboxIds,jobIds,ticketIds,assertOutsideSql,cleanup};
 }catch(error){await cleanup().catch(()=>undefined);throw error;}
}

test('actual catalog optional reasoning and JSON output capability survive strict pricing refresh without changing free admission',async()=>{
 const f=await createFlow();let providerId:string|undefined;
 try{
  const provider=await createProvider(f.actor,{name:`Controlled metadata ${f.owner}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',
   apiKey:'controlled-synthetic-only',costMode:'FREE_ONLY',enabled:true,priority:1},{pool:f.pool,key:f.key});providerId=provider.id;
  const model=await createModel(f.actor,provider.id,{modelId:'fixture/metadata:free',displayName:'Controlled metadata',purpose:'GENERATION',embeddingDimensions:null,
   supportsJson:true,supportsTools:false,supportsVision:false,enabled:true,priority:1,timeoutMs:10000,inputPricePerMillion:null,outputPricePerMillion:null},{pool:f.pool,key:f.key});
  const revisions=(await f.pool.query('select p.revision provider_revision,m.revision model_revision from private.ai_models m join private.ai_providers p on p.id=m.provider_id where m.id=$1',[model.id])).rows[0];
  const priceReader=createPriceReader({fetchImpl:async()=>{
   await f.assertOutsideSql();return Response.json({data:[{id:'fixture/metadata:free',pricing:{prompt:'0',completion:'0'},
    reasoning:{mandatory:false},supported_parameters:['reasoning','response_format']}]});
  }});
  const result=await refreshModelPricing(f.actor,provider.id,model.id,{providerRevision:revisions.provider_revision,modelRevision:revisions.model_revision},
   {pool:f.pool,priceReader});
  assert.deepEqual({...result.pricing,checkedAt:'OBSERVED'}, {status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:'OBSERVED',apiFormat:'CHAT',canDisableReasoning:true,jsonOutputMode:'JSON_OBJECT'});
  const row=(await f.pool.query('select pricing_status,pricing_provider_revision,pricing_model_revision,api_format,revision from private.ai_models where id=$1',[model.id])).rows[0];
  assert.deepEqual(row,{pricing_status:'FREE',pricing_provider_revision:revisions.provider_revision,pricing_model_revision:revisions.model_revision,api_format:'CHAT',revision:revisions.model_revision});
  assert.equal((await f.pool.query('select cost_mode from private.ai_providers where id=$1',[provider.id])).rows[0].cost_mode,'FREE_ONLY');
 }finally{
  if(providerId)await f.pool.query('update private.ai_providers set enabled=false where id=$1',[providerId]);
  await f.cleanup();
 }
});

async function inbound(f:Flow,text:string){
 const eventId=randomUUID(),lineMessageId=randomUUID();
 const event={type:'message' as const,source:{type:'user' as const,userId:f.studentLineId},replyToken:`controlled-reply-${eventId}`,
  message:{type:'text' as const,id:lineMessageId,text}};
 const job=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,'MESSAGE','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
  [eventId,hashLineUserId(f.studentLineId,f.key),encryptValue(JSON.stringify(event),f.key),randomUUID()])).rows[0] as InboxJob;f.inboxIds.push(job.id);
 await transaction(client=>processInboxEvent(client,job,f.key,{aiEnabled:true}),f.pool);
 const message=(await f.pool.query("select id,conversation_id from public.messages where line_message_id=$1 and sender_type='USER'",[lineMessageId])).rows[0];
 assert(message,'ACTUAL_VERIFIED_INBOX_MUST_STORE_THE_USER_MESSAGE');
 const aiJob=(await f.pool.query('select id from private.ai_jobs where message_id=$1',[message.id])).rows[0];assert(aiJob,'ACTUAL_INBOX_MUST_CREATE_THE_AI_JOB');
 f.jobIds.push(aiJob.id);return {messageId:message.id,conversationId:message.conversation_id,jobId:aiJob.id};
}

function producer(f:Flow,branch:Branch){
 const taskCalls:string[]=[],lookup=createKnowledgeProducer(knowledgeOptions(f,taskCalls,branch));
 const decision:AssistantDecision=branch==='MIXED'?{action:'MIXED_REPLY',generalText,query:'YRU-Student connection instructions'}:
  {action:'HANDOFF',reason:handoffReasonFor(branch)};
 const decide=createAssistantDecision({generate:async input=>{
  await f.assertOutsideSql();taskCalls.push(input.taskType);assert.equal(input.taskType,'ASSISTANT_DECISION');
  const output={decision};const parsed=input.responseSchema.safeParse(output);assert(parsed.success,'CONTROLLED_ASSISTANT_DECISION_MUST_MATCH_INSTALLED_STRICT_SCHEMA');
  return {output:parsed.data,toolCalls:[]};
 }});
 const handoffOptions=knowledgeOptions(f,taskCalls,branch);
 const orchestrated=createAssistantOrchestrator({decide,lookup,handoff:async(snapshot,signal,reason)=>{
  assert.equal(reason,handoffReasonFor(branch),'HANDOFF_REASON_MUST_REACH_THE_SOURCE_VALIDATING_SUPPORT_PRODUCER');
  return createSupportProducer(handoffOptions,{handoffReason:reason})(snapshot,signal);
 }});
 return {produce:orchestrated,taskCalls};
}

function knowledgeOptions(f:Flow,taskCalls:string[],branch:Branch):KnowledgeProducerOptions{
 const generate=async(input:GenerateInput<unknown>)=>{
  await f.assertOutsideSql();taskCalls.push(input.taskType);let output:unknown;
  if(input.taskType==='KNOWLEDGE_PLAN'){
   output={scope:scopeFor(f.familyCode),selection:{method:'RAG',query:null,notApplicable:null}};
  }else if(input.taskType==='KNOWLEDGE_ANSWER'){
   const request=JSON.parse(input.messages.at(-1)!.content) as {question:string;evidence:{chunkId:string;content:string}[]};
   const actual=request.evidence.find(item=>item.chunkId===f.chunkId&&item.content.includes('YRU-Student'));
   assert(actual,'CONTROLLED_ANSWER_COMPOSITION_MUST_RECEIVE_REAL_APPROVED_RAG_EVIDENCE');
   output={answer:officialAnswer,citationChunkIds:[actual.chunkId]};
  }else if(input.taskType==='SUPPORT_INTENT'&&branch!=='MIXED'){
   const reason=handoffReasonFor(branch),question=branch==='PERSONAL_HANDOFF'?personalQuestion:sensitiveQuestion;
   const instructions=input.messages.find(message=>message.role==='system')?.content??'';
   assert(instructions.includes(`proposed ${reason};`),'SUPPORT_CLASSIFIER_MUST_RECEIVE_SELECTED_HANDOFF_REASON');
   const request=JSON.parse(input.messages.at(-1)!.content) as {sources:{code:string;text:string}[]};
   assert.deepEqual(request.sources,[{code:'U0',text:question}],'SUPPORT_CLASSIFIER_MUST_REVALIDATE_THE_ACTUAL_CURRENT_USER_SOURCE');
   output={handoff:{reason,departmentCode:'IT',confidence:.99,
    facts:[{field:'PROBLEM',source:'U0',quote:request.sources[0]!.text},
     ...(branch==='PERSONAL_HANDOFF'?[]:[{field:'SENSITIVE_DETAIL',source:'U0',quote:'ถูกคุกคามจากผู้ใช้บัญชีอื่น'}]),
     ...(branch==='SENSITIVE_UNRESOLVED'?[{field:'ATTEMPTS',source:'U0',quote:'ลองบล็อกแล้ว'}]:[])]}};
  }else throw new Error(`UNEXPECTED_CONTROLLED_TASK:${input.taskType}`);
  const parsed=input.responseSchema.safeParse(output);assert(parsed.success,`CONTROLLED_OUTPUT_INVALID:${input.taskType}`);
  return {output:parsed.data,toolCalls:[],providerId:'CONTROLLED_SYNTHETIC',modelId:'CONTROLLED_SYNTHETIC',fallbackUsed:false};
 };
 const embed=async(input:EmbedInput):Promise<EmbedResult>=>{
  await f.assertOutsideSql();assert.equal(input.requestType,'EMBEDDING_QUERY');
  assert.deepEqual(input.input,[mixedQuestion],'CONTROLLED_LOCAL_E5_QUERY_MUST_USE_THE_COMPLETE_CURRENT_USER_QUESTION');
  return {vectors:[unitVector],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimensions:384,providerId:'CONTROLLED_LOCAL_E5',modelId:LOCAL_EMBEDDING_MODEL,fallbackUsed:false};
 };
 const search:KnowledgeProducerOptions['search']=request=>transaction(client=>searchKnowledge(client,request),f.pool);
 return {generate:generate as KnowledgeProducerOptions['generate'],embed,search,compactPlanning:true,
  structuredSearch:async()=>{throw new Error('CONTROLLED_RAG_PLAN_MUST_NOT_EXECUTE_STRUCTURED_SEARCH');}};
}

async function runMixed(f:Flow){
 const received=await inbound(f,mixedQuestion),model=producer(f,'MIXED');
 const stats=await runAICycle(f.pool,f.key,{supportEnabled:true,produce:model.produce});assert.equal(stats.completed,1,'ACTUAL_AI_WORKER_MUST_FINALIZE_MIXED_RESULT');
 const job=(await f.pool.query('select * from private.ai_jobs where id=$1',[received.jobId])).rows[0] as AIJob;
 const result=decodeAIResult(job,f.key);assert(result&&result.kind==='MIXED','ORCHESTRATOR_MUST_PERSIST_TYPED_MIXED_RESULT');
 assert.equal(result.official.kind,'ANSWER','OFFICIAL_SEGMENT_MUST_BE_A_REAL_RAG_ANSWER');
 return {received,model,result};
}

async function dispatch(f:Flow,capture:{bodies:Record<string,unknown>[]}){
 return runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
  await f.assertOutsideSql();capture.bodies.push(JSON.parse(String(init?.body)) as Record<string,unknown>);return new Response(null,{status:200});
 }});
}

test('natural MIXED reply delivers independent general prose with actual reviewed RAG evidence and citations',async()=>{
 const f=await createFlow();try{
  const {received,model}=await runMixed(f);
  assert.deepEqual(model.taskCalls,['ASSISTANT_DECISION','KNOWLEDGE_PLAN','KNOWLEDGE_ANSWER']);
  assert.equal(model.taskCalls.includes('SUPPORT_INTENT'),false,'MIXED_RAG_LOOKUP_MUST_NOT_BECOME_A_SUPPORT_HANDOFF');
  const answer=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[received.conversationId,received.jobId])).rows[0];
  assert(answer,'AI_WORKER_MUST_PERSIST_THE_COMPOSED_MESSAGE');
  assert(answer.content.includes(generalText),'GENERAL_PART_MUST_SURVIVE_WORKER_COMPOSITION');assert(answer.content.includes(officialAnswer),'OFFICIAL_PART_MUST_SURVIVE_WORKER_COMPOSITION');
  assert.equal(answer.metadata.answer_basis,'MIXED');assert.equal(answer.metadata.citations.length,1);
  assert.equal(answer.metadata.citations[0].documentId,f.documentId,'CITATION_MUST_REFERENCE_THE_REAL_APPROVED_FIXTURE_DOCUMENT');
  assert.equal(answer.metadata.citations[0].chunkId,f.chunkId,'CITATION_MUST_REFERENCE_THE_RETRIEVED_FIXTURE_CHUNK');
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]},delivery=await dispatch(f,capture);
  assert.equal(delivery.sent,1);assert.equal(delivery.failed,0);
  const body=capture.bodies[0] as {messages:{text:string}[]};assert(body);
  const delivered=body.messages.map(message=>message.text).join('\n\n');
  assert(delivered.includes(generalText));assert(delivered.includes(officialAnswer));assert.match(delivered,/แหล่งอ้างอิง/u);
  const outbox=(await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${received.jobId}`])).rows[0];
  assert.equal(outbox.status,'SENT');
 }finally{await f.cleanup();}
});

test('unsupported mandatory personal fields are suppressed while the actual reviewed answer and owned delivery survive',async()=>{
 const f=await createFlow();try{
  const received=await inbound(f,mixedQuestion),taskCalls:string[]=[];
  const unsafe='ข้อมูลที่จำเป็น ได้แก่:\n- รหัสนักศึกษา\n- ชื่อ-นามสกุล\n- หลักสูตร\n- เบอร์ติดต่อ';
  const produce=createAssistantOrchestrator({decide:createAssistantDecision({generate:async()=>{
   await f.assertOutsideSql();taskCalls.push('ASSISTANT_DECISION');
   return {output:{decision:{action:'MIXED_REPLY',generalText:unsafe,query:'YRU-Student connection instructions'}},toolCalls:[]};
  }}),lookup:createKnowledgeProducer(knowledgeOptions(f,taskCalls,'MIXED')),handoff:async()=>{throw Error('UNEXPECTED_HANDOFF');}});
  assert.equal((await runAICycle(f.pool,f.key,{supportEnabled:true,produce})).completed,1);
  const job=(await f.pool.query('select * from private.ai_jobs where id=$1',[received.jobId])).rows[0] as AIJob;
  const result=decodeAIResult(job,f.key);assert(result?.kind==='MIXED');
  assert.match(result.general.text,/ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ/u,'REJECTED_GENERAL_PART_MUST_BE_DISCLOSED');
  assert.equal(result.official.kind,'ANSWER');assert(result.official.kind==='ANSWER');
  assert.equal(result.official.output.answer,officialAnswer);assert.equal(result.official.evidence[0]?.documentId,f.documentId);
  assert.deepEqual(result.official.output.citationChunkIds,[f.chunkId]);
  const persisted=(await f.pool.query("select metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[received.conversationId,received.jobId])).rows[0];
  assert.equal(persisted.metadata.citations.length,1);assert.equal(persisted.metadata.citations[0].documentId,f.documentId);assert.equal(persisted.metadata.citations[0].chunkId,f.chunkId);
  assert.deepEqual(taskCalls,['ASSISTANT_DECISION','KNOWLEDGE_PLAN','KNOWLEDGE_ANSWER']);
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]};assert.equal((await dispatch(f,capture)).sent,1);
  const delivered=(capture.bodies[0] as {messages:{text:string}[]}).messages.map(message=>message.text).join('\n\n');
  assert(delivered.includes(officialAnswer));assert.match(delivered,/แหล่งอ้างอิง/u);
  assert.match(delivered,/ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ/u);
  const citedDocument=(await f.pool.query('select title from public.documents where id=$1',[f.documentId])).rows[0];assert(delivered.includes(citedDocument.title),'CANONICAL_SOURCE_TITLE_MUST_REACH_DELIVERY');
  for(const field of ['รหัสนักศึกษา','ชื่อ-นามสกุล','หลักสูตร','เบอร์ติดต่อ'])assert(!delivered.includes(field),`UNSUPPORTED_FIELD_MUST_NOT_LEAK:${field}`);
  assert(!delivered.includes(unsafe));
  assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${received.jobId}`])).rows[0].status,'SENT');
 }finally{await f.cleanup();}
});

test('failed mixed repair retains the reviewed answer and partial disclosure through owned delivery',async()=>{
 const f=await createFlow();try{
  const received=await inbound(f,mixedQuestion),taskCalls:string[]=[];
  const unsafe='ข้อมูลที่จำเป็น ได้แก่ รหัสนักศึกษา ชื่อ-นามสกุล และเบอร์ติดต่อ';
  const decide=createAssistantDecision({generate:async input=>{
   await f.assertOutsideSql();taskCalls.push(input.taskType);
   if(input.taskType==='ASSISTANT_DECISION_REPAIR')throw new Error('controlled unavailable');
   assert.equal(input.taskType,'ASSISTANT_DECISION');
   return {output:{decision:{action:'MIXED_REPLY',generalText:unsafe,query:'YRU-Student connection instructions'}},toolCalls:[]};
  }});
  const produce=createAssistantOrchestrator({decide,repairRejectedGeneral:true,lookup:createKnowledgeProducer(knowledgeOptions(f,taskCalls,'MIXED')),handoff:async()=>{throw Error('UNEXPECTED_HANDOFF');}});
  assert.equal((await runAICycle(f.pool,f.key,{supportEnabled:true,produce})).completed,1);
  const job=(await f.pool.query('select * from private.ai_jobs where id=$1',[received.jobId])).rows[0] as AIJob;
  const result=decodeAIResult(job,f.key);assert(result?.kind==='MIXED');assert.equal(result.official.kind,'ANSWER');
  assert.match(result.general.text,/ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ/u);
  assert.deepEqual(taskCalls,['ASSISTANT_DECISION','ASSISTANT_DECISION_REPAIR','KNOWLEDGE_PLAN','KNOWLEDGE_ANSWER']);
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]};assert.equal((await dispatch(f,capture)).sent,1);
  const delivered=(capture.bodies[0] as {messages:{text:string}[]}).messages.map(message=>message.text).join('');
  assert(delivered.includes(officialAnswer));assert.match(delivered,/แหล่งอ้างอิง/u);assert.match(delivered,/ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ/u);
  assert(!delivered.includes('รหัสนักศึกษา'));assert(!delivered.includes('controlled unavailable'));
  const answer=(await f.pool.query("select metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[received.conversationId,received.jobId])).rows[0];
  assert.equal(answer.metadata.citations[0].documentId,f.documentId);assert.equal(answer.metadata.citations[0].chunkId,f.chunkId);
 }finally{await f.cleanup();}
});

for(const evidenceFirstMixed of [false,true])test(`configured retrieval hint preserves source authority${evidenceFirstMixed?' with evidence-first mixed composition':''}`,async()=>{
 const f=await createFlow();let providerId:string|undefined;
 const hint='YRU-Student connection instructions unverified programZZZ year2577',modelId='fixture/retrieval-hint:free';
 const inputs:{name:string;question:string;history:unknown}[]=[],embeddingInputs:string[]=[];
 try{
  const provider=await createProvider(f.actor,{name:`Controlled hint ${f.owner}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',
   apiKey:'controlled-synthetic-only',costMode:'FREE_ONLY',enabled:true,priority:1},{pool:f.pool,key:f.key});providerId=provider.id;
  await createModel(f.actor,provider.id,{modelId,displayName:'Controlled retrieval hint',purpose:'GENERATION',embeddingDimensions:null,
   supportsJson:true,supportsTools:false,supportsVision:false,enabled:true,priority:1,timeoutMs:10000,inputPricePerMillion:null,outputPricePerMillion:null},{pool:f.pool,key:f.key});
  const fetchImpl:typeof fetch=async(url,init)=>{
   await f.assertOutsideSql();const path=new URL(String(url)).pathname;
   if(path.endsWith('/models'))return Response.json({data:[{id:modelId,pricing:{prompt:'0',completion:'0'},supported_parameters:['structured_outputs','response_format']}]});
   const body=JSON.parse(String(init?.body)) as {text?:string;type?:string;response_format?:{json_schema?:{name?:string}};messages?:{role:string;content:string}[]};
   if(path.endsWith('/embed')){
    assert.equal(body.type,'query');embeddingInputs.push(body.text!);assert.equal(body.text,hint);
    return Response.json({model:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,embedding:unitVector});
   }
   assert(path.endsWith('/chat/completions'),'NO_OTHER_PROVIDER_OR_NETWORK_OPERATION');
   const name=body.response_format?.json_schema?.name;let output:unknown;
   if(name==='assistant_decision')output={decision:{action:'MIXED_REPLY',generalText:evidenceFirstMixed?'ควรแนบสำเนาบัตรนักศึกษาและผลการเรียนครับ':generalText,query:hint}};
   else{
    const input=JSON.parse(body.messages!.at(-1)!.content) as {question:string;history:unknown;evidence?:{chunkId:string;content:string}[]};
    inputs.push({name:name!,question:input.question,history:input.history});assert.equal(input.question,mixedQuestion);
    assert.deepEqual(input.history,[]);
    if(name==='assistant_general_compose'){
     const composed=JSON.parse(body.messages!.at(-1)!.content) as {officialOutcome:{kind:string;answerProvided:boolean;text:string}};
     assert.equal(composed.officialOutcome.kind,'ANSWER');assert.equal(composed.officialOutcome.answerProvided,true);
     assert(composed.officialOutcome.text.includes(officialAnswer));assert(composed.officialOutcome.text.includes('แหล่งอ้างอิง'));
     assert(!JSON.stringify(body.messages).includes('สำเนาบัตรนักศึกษา'),'UNSENT_INVENTED_PROSE_MUST_NOT_ENTER_COMPOSITION');
     output={generalText};
    }else if(name==='knowledge_plan')output={scope:scopeFor(f.familyCode),selection:{method:'RAG',query:null,notApplicable:null}};
    else{
     assert.equal(name,'knowledge_answer');assert(input.evidence?.some(item=>item.chunkId===f.chunkId&&item.content.includes('YRU-Student')));
     output={answer:officialAnswer,citationChunkIds:[f.chunkId]};
    }
   }
   return Response.json({choices:[{index:0,message:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}]});
  };
  const received=await inbound(f,mixedQuestion);
  const stats=await runAICycle(f.pool,f.key,{supportEnabled:true,produce:createConfiguredKnowledgeProducer(f.pool,f.key,{assistantEnabled:true,evidenceFirstMixed,fetchImpl})});
  assert.equal(stats.completed,1);assert.deepEqual(embeddingInputs,[hint]);
  assert.deepEqual(inputs.map(input=>input.name),['knowledge_plan','knowledge_answer',...(evidenceFirstMixed?['assistant_general_compose']:[])]);
  const job=(await f.pool.query('select * from private.ai_jobs where id=$1',[received.jobId])).rows[0] as AIJob;
  const result=decodeAIResult(job,f.key);assert(result?.kind==='MIXED');assert.equal(result.official.kind,'ANSWER');
  if(result.official.kind==='ANSWER'){
   assert.equal(result.official.scope.academicYear,null);assert.equal(result.official.scope.programCode,null);
   assert.deepEqual([...new Set(result.official.evidence.map(item=>item.documentId))],[f.documentId]);
   assert(result.official.evidence.every(item=>item.ruleProof),'ACTUAL_FILTERED_CURRENT_SOURCE_PROOF_REQUIRED');
  }
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]},delivery=await dispatch(f,capture);assert.equal(delivery.sent,1);assert.equal(delivery.failed,0);
  const delivered=JSON.stringify(capture.bodies);assert(delivered.includes(generalText)&&delivered.includes(officialAnswer));
  assert(!delivered.includes('programZZZ')&&!delivered.includes('2577'),'HINT_MUST_NOT_BECOME_AN_ANSWER_OR_SCOPE');
  assert(!delivered.includes('สำเนาบัตรนักศึกษา'),'UNSENT_UNSUPPORTED_PREPARATION_MUST_NOT_BE_DELIVERED');
  if(evidenceFirstMixed){
   // Durable attempts attach to the verified ingress source when one exists;
   // synthetic source-less jobs alone use ai_job_id directly.
   const ledger=(await f.pool.query(`select count(*)::int n from private.ai_turn_attempts a
    join private.ai_jobs j on j.id=$1 join public.messages m on m.id=j.message_id
    where a.ai_job_id=j.id or a.inbox_id=m.source_event_id`,[received.jobId])).rows[0];
   assert.equal(ledger.n,4,'COMPOSITION_MUST_USE_THE_EXISTING_DURABLE_TURN_BUDGET');
  }
 }finally{
  if(providerId)await f.pool.query('update private.ai_providers set enabled=false where id=$1',[providerId]);
  await f.cleanup();
 }
});

test('approved source changed after enqueue suppresses the complete mixed reply before LINE delivery',async()=>{
 const f=await createFlow();try{
  const {received}=await runMixed(f);
  await f.pool.query("update public.documents set status='SUPERSEDED',is_current=false,revision=revision+1 where id=$1",[f.documentId]);
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]},delivery=await dispatch(f,capture);
  assert.equal(delivery.sent,0);assert.equal(capture.bodies.length,0,'STALE_OFFICIAL_PROSE_AND_GENERAL_PART_MUST_NOT_REACH_LINE');
  const outbox=(await f.pool.query('select status,last_error_code from private.message_outbox where idempotency_key=$1',[`ai-job:${received.jobId}`])).rows[0];
  assert.deepEqual(outbox,{status:'SUPPRESSED',last_error_code:'EVIDENCE_CHANGED'});
 }finally{await f.cleanup();}
});

test('HUMAN takeover before dispatch suppresses both mixed segments',async()=>{
 const f=await createFlow();try{
  const {received}=await runMixed(f);
  await f.pool.query("update public.conversations set mode='HUMAN',revision=revision+1,updated_at=clock_timestamp() where id=$1",[received.conversationId]);
  const capture:{bodies:Record<string,unknown>[]}={bodies:[]},delivery=await dispatch(f,capture);
  assert.equal(delivery.sent,0);assert.equal(capture.bodies.length,0,'HUMAN_TAKEOVER_MUST_BLOCK_GENERAL_AND_OFFICIAL_TEXT');
  const outbox=(await f.pool.query('select status,last_error_code from private.message_outbox where idempotency_key=$1',[`ai-job:${received.jobId}`])).rows[0];
  assert.deepEqual(outbox,{status:'SUPPRESSED',last_error_code:'HUMAN_OR_STALE_AI'});
 }finally{await f.cleanup();}
});

for(const branch of ['PERSONAL_HANDOFF','SENSITIVE_USER_REQUEST','SENSITIVE_UNRESOLVED'] as const){
test(`source-bound ${branch} keeps sensitive scope and creates a ticket only after the existing owned confirmation`,async()=>{
 const f=await createFlow();try{
  const question=branch==='PERSONAL_HANDOFF'?personalQuestion:sensitiveQuestion;
  const received=await inbound(f,question),model=producer(f,branch);
  const stats=await runAICycle(f.pool,f.key,{supportEnabled:true,produce:model.produce});assert.equal(stats.completed,1,'SOURCE_VALIDATED_HANDOFF_MUST_FINALIZE');
  assert.deepEqual(model.taskCalls,['ASSISTANT_DECISION','SUPPORT_INTENT']);
  const job=(await f.pool.query('select * from private.ai_jobs where id=$1',[received.jobId])).rows[0] as AIJob;
  const result=decodeAIResult(job,f.key);assert(result&&result.kind==='CLARIFY'&&'support' in result&&result.support,'HANDOFF_RESULT_MUST_RETAIN_VALIDATED_PRIVATE_SUPPORT_METADATA');
  const state=(await f.pool.query('select * from private.ai_support_state where conversation_id=$1',[received.conversationId])).rows[0];assert(state);
  assert.equal(result.support.sourceDigest,state.source_digest);assert.equal(result.support.directoryDigest,state.directory_digest);
  assert.equal(result.support.minimumSensitivity,'GENERAL');assert.equal(result.support.proposal.intent,branch==='PERSONAL_HANDOFF'?'PERSONAL_CASE':'ESCALATE');
  assert.equal(state.sensitive_level,'SENSITIVE','SOURCE_BOUND_PRIVACY_FLOOR_MUST_BE_BACKEND_DERIVED');
  const privateState=JSON.parse(decryptValue(state.context_encrypted,f.key));
  assert.equal(privateState.context.messageId,received.messageId);assert.equal(privateState.proposal.facts[0].quote,question);
  assert.equal(privateState.interpreted.sensitiveLevel,'SENSITIVE');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[received.conversationId])).rows[0].n,0,
   'MODEL_SELECTED_HANDOFF_MUST_NOT_CREATE_A_TICKET');

  const capture:{bodies:Record<string,unknown>[]}={bodies:[]};assert.equal((await dispatch(f,capture)).sent,1);
  const body=capture.bodies[0] as {messages:{text:string;quickReply?:{items:{action:{label:string;data:string}}[]}}[]};assert(body);
  const reply=body.messages.find(message=>message.quickReply);assert(reply?.quickReply,'OWNED_ESCALATION_CONFIRMATION_MUST_BE_DELIVERED');
  const choice=reply.quickReply.items.map(item=>item.action).find(action=>action.label==='ส่งต่อ IT');assert(choice);
  assert.match(choice.data,/^yru:choice:[A-Za-z0-9_-]{43}$/u,'CONFIRMATION_MUST_USE_THE_EXISTING_OPAQUE_OWNED_CHOICE');
  assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${received.jobId}`])).rows[0].status,'SENT');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[received.conversationId])).rows[0].n,0,
   'DELIVERY_ALONE_MUST_NOT_CREATE_A_TICKET');

  const eventId=randomUUID(),event={type:'postback' as const,source:{type:'user' as const,userId:f.studentLineId},
   postback:{data:choice.data},replyToken:`controlled-confirm-${eventId}`};
  const inbox=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,'OTHER','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
   [eventId,hashLineUserId(f.studentLineId,f.key),encryptValue(JSON.stringify(event),f.key),randomUUID()])).rows[0] as InboxJob;f.inboxIds.push(inbox.id);
  await transaction(client=>processInboxEvent(client,inbox,f.key,{aiEnabled:true}),f.pool);
  const tickets=(await f.pool.query('select * from public.tickets where conversation_id=$1',[received.conversationId])).rows;
  assert.equal(tickets.length,1,'ONLY_THE_EXISTING_BACKEND_CONFIRMATION_PATH_MAY_CREATE_THE_TICKET');
  const ticket=tickets[0]!;f.ticketIds.push(ticket.id);
  assert.equal(ticket.mode,'HUMAN');assert.equal(ticket.sensitive_level,'SENSITIVE');assert.equal(ticket.problem_summary,question);
  const outcome=(await f.pool.query('select kind,ticket_id,sensitive_level from private.ai_support_outcomes where conversation_id=$1',[received.conversationId])).rows[0];
  assert.deepEqual(outcome,{kind:'USER_CONFIRMED_ESCALATED',ticket_id:ticket.id,sensitive_level:'SENSITIVE'});
 }finally{await f.cleanup();}
});
}
