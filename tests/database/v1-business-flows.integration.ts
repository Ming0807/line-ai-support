import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {approveImport} from '../../lib/imports/import-publication';
import {getImportVersionResolution} from '../../lib/imports/version-resolver';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import type {ImportReviewDraft} from '../../lib/imports/review-schema';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {transaction} from '../../lib/database/pool';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import type {SemanticClassifier} from '../../lib/conversation/semantic-routing-contracts';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {runAICycle} from '../../lib/ai/run-worker';
import {createKnowledgeProducer} from '../../lib/knowledge/answer-producer';
import {createSupportProducer} from '../../lib/ai/support-producer';
import type {GenerateInput} from '../../lib/ai/gateway';
import type {KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import type {EmbedInput,EmbedResult} from '../../lib/ai/embedding-gateway';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {applyTicketAction} from '../../lib/tickets/ticket-service';
import type {StaffTicketAction,TicketActionInput} from '../../types/tickets';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const key=Buffer.alloc(32,83).toString('base64');
const databaseOptions={host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'};
const unitVector=[1,...Array(383).fill(0)];
const scopeFor=(familyCode:string):KnowledgeScope=>({historical:false,academicYear:null,asOfDate:null,familyCodes:[familyCode],
 departmentCode:'IT',audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null});

type Flow=Awaited<ReturnType<typeof createFlow>>;
async function createFlow(){
 const owner=randomUUID(),appName=`final-flow-${owner}`,pool=new Pool({...databaseOptions,max:8,application_name:appName});
 const familyCode=`WIFI_${owner.replaceAll('-','').slice(0,20).toUpperCase()}`;
 const sessionIds:string[]=[],inboxIds:string[]=[],jobIds:string[]=[],staffIds:string[]=[],importJobIds:string[]=[];
 let documentId:string|undefined;
 const actor=randomUUID(),staff=randomUUID(),foreignStaff=randomUUID(),unboundStaff=randomUUID(),staffLineId=`U${randomUUID().replaceAll('-','')}`,
  foreignStaffLineId=`U${randomUUID().replaceAll('-','')}`;
 const studentLineId=`U${randomUUID().replaceAll('-','')}`;
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  countPassageTokens:async texts=>{await assertOutsideSql();return texts.map(()=>40);},
  embedPassages:async texts=>{await assertOutsideSql();return texts.map(()=>unitVector);},
  embedQuery:async()=>{throw new Error('QUERY_MUST_USE_CONTROLLED_KNOWLEDGE_PRODUCER');},
  healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const importOptions={pool,key,originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
 async function assertOutsideSql(){
  const {rows:[row]}=await pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and pid<>pg_backend_pid() and xact_start is not null',[appName]);
  assert.equal(row.n,0,'PROVIDER_OR_LINE_HTTP_MUST_RUN_OUTSIDE_SQL');
 }
 async function cleanup(){
  try{
   if(sessionIds.length){
    await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[inboxIds]);
    await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[sessionIds]);
    await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id in(select id from public.tickets where line_session_id=any($1::uuid[]))) and status in ('PENDING','PROCESSING')",[sessionIds]);
   }
   const tickets=(await pool.query("select id,status,revision from public.tickets where line_session_id=any($1::uuid[]) and status not in('RESOLVED','CLOSED','CANCELLED')",[sessionIds])).rows;
   for(const ticket of tickets){
    let status=ticket.status as string,revision=Number(ticket.revision);
    if(status==='WAITING_STAFF'){
     const accepted=await transaction(client=>applyTicketAction(client,staff,ticket.id,'ACCEPT',{revision,requestId:randomUUID()},key),pool);
     status=accepted.status;revision=accepted.revision;
    }
    if(status==='STAFF_HANDLING'){
     const resolved=await transaction(client=>applyTicketAction(client,staff,ticket.id,'RESOLVE',{revision,requestId:randomUUID()},key),pool);
     status=resolved.status;revision=resolved.revision;
    }
    if(status==='RESOLVED')await transaction(client=>applyTicketAction(client,staff,ticket.id,'CLOSE',{revision,requestId:randomUUID()},key),pool);
   }
   if(staffIds.length)await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])', [staffIds]);
  }finally{await pool.end();}
 }
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF'],[foreignStaff,'STAFF'],[unboundStaff,'STAFF']] as const){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1::uuid,$2::text,'Final flow fixture',true,case when $1::uuid=$3::uuid then (select id from public.departments where code='FINANCE') when $2::text='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role,foreignStaff]);
  }
  staffIds.push(staff,foreignStaff,unboundStaff);
  await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [staff,hashStaffLineUserId(staffLineId,key),encryptValue(staffLineId,key)]);
  await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [foreignStaff,hashStaffLineUserId(foreignStaffLineId,key),encryptValue(foreignStaffLineId,key)]);

  const today=(await pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text today")).rows[0].today as string;
  const source=createImportSource({bytes:new TextEncoder().encode(`<html><body><h1>Reviewed campus Wi-Fi guide ${owner}</h1><p>For Android, open Settings and choose Wi-Fi. Select the YRU-Student network and connect using the network instructions shown by the university.</p><p>If connection still fails, forget the saved YRU-Student network, reconnect, and contact the IT service desk with the displayed error.</p></body></html>`),
   filename:'controlled-wifi-guide.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
  const {job}=await createImportJob(actor,source,importOptions);
  const preview=await analyzeImportJob(actor,job.id,0,importOptions),state=await getImportReview(actor,job.id,importOptions),base=unfinishedReviewDraft();
  let draft:ImportReviewDraft={...base,schemaVersion:2,metadata:{...base.metadata,title:`Reviewed campus Wi-Fi guide ${owner}`,familyCode,
   newFamily:{name:`Controlled Wi-Fi family ${owner}`,category:'Support guide'},departmentCode:'IT',documentType:'GUIDE',versionName:'2569',versionStream:'DEFAULT',academicYear:2569,
   scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:today,effectiveFrom:today,effectiveTo:null,
   authorityLevel:90,visibility:'PUBLIC',sourceUrl:'https://fixture.yru.ac.th/controlled-wifi-guide',storageMode:'RAG'},
   action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},
   warningDispositions:state.warnings.map(w=>({warningKey:w.key,status:'CORRECTED',reason:'Reviewed controlled integration source'})),chunkPlan:null};
  const first=await saveImportReview(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft},importOptions);
  const snapshot=await getImportChunkPlan(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},importOptions);
  draft={...draft,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:snapshot.plan.chunkerVersion}};
  const saved=await saveImportReview(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision,draft},importOptions);
  const publication=await approveImport(actor,{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,
   expectedReviewRevision:saved.reviewRevision,confirmPublication:true},importOptions);
  assert.equal(publication.receipt.storageMode,'RAG');documentId=publication.receipt.documentId;
  const chunks=(await pool.query('select id,content from public.knowledge_chunks where document_id=$1 order by chunk_index',[documentId])).rows;
  const guide=chunks.find(chunk=>chunk.content.includes('YRU-Student'));assert(guide,'REVIEWED_GUIDE_MUST_PUBLISH_CANONICAL_GUIDANCE_CHUNK');

  const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`SUPPORT_${owner}`])).rows[0].id;sessionIds.push(session);
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [session,hashLineUserId(studentLineId,key),encryptValue(studentLineId,key)]);
  return {pool,appName,owner,actor,familyCode,documentId,chunkId:guide.id,session,studentLineId,staffLineId,foreignStaffLineId,
   staff,foreignStaff,unboundStaff,sessionIds,inboxIds,jobIds,staffIds,importJobIds,importOptions,assertOutsideSql,cleanup};
 }catch(error){await cleanup().catch(()=>undefined);throw error;}
}

function proposalFor(stage:'CLARIFY'|'GUIDANCE'|'ESCALATE'){
 if(stage==='CLARIFY')return {intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium' as const,
  needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:'DEVICE' as const,impact:'SINGLE_USER' as const,sensitivity:'GENERAL' as const,
  facts:[{field:'PROBLEM' as const,source:'U0',quote:'Wi-Fi ต่อไม่ได้'}]};
 if(stage==='GUIDANCE')return {intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium' as const,
  needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER' as const,sensitivity:'GENERAL' as const,
  facts:[{field:'PROBLEM' as const,source:'U1',quote:'Wi-Fi ต่อไม่ได้'},{field:'DEVICE' as const,source:'U0',quote:'Android'},
   {field:'ERROR' as const,source:'U0',quote:'ไม่สามารถเชื่อมต่อ Wi-Fi ได้'}]};
 return {intent:'ESCALATE',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:true,department:'IT',urgency:'medium' as const,
  needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER' as const,sensitivity:'GENERAL' as const,
  facts:[{field:'PROBLEM' as const,source:'U1',quote:'Wi-Fi ต่อไม่ได้'},{field:'DEVICE' as const,source:'U2',quote:'Android'},
   {field:'ERROR' as const,source:'U2',quote:'ไม่สามารถเชื่อมต่อ Wi-Fi ได้'}]};
}

function producer(f:Flow,phase:'CLARIFY'|'GUIDANCE'|'ESCALATE'){
 let supportCalls=0;const taskCalls:string[]=[];
 const scope=scopeFor(f.familyCode);
 const generate=async(input:GenerateInput<unknown>)=>{
  await f.assertOutsideSql();taskCalls.push(input.taskType);let output:unknown;
  if(input.taskType==='SUPPORT_INTENT'){
   supportCalls++;const prompt=JSON.parse(input.messages.at(-1)!.content) as {sources:{code:string;text:string}[]};
   if(phase==='CLARIFY'){
    assert.equal(supportCalls,1);assert.equal(prompt.sources[0]?.text,'Wi-Fi ต่อไม่ได้');output=proposalFor('CLARIFY');
   }else if(phase==='GUIDANCE'){
    assert.equal(supportCalls,1);
    assert.equal(prompt.sources[0]?.text,'ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้');
    assert.deepEqual(prompt.sources.slice(1).map(s=>[s.code,s.text]),[['U1','Wi-Fi ต่อไม่ได้']]);output=proposalFor('GUIDANCE');
   }else{
    assert.equal(supportCalls,1);assert.equal(prompt.sources[0]?.text,'ยังแก้ไม่ได้ครับ');
    assert.deepEqual(prompt.sources.slice(1).map(s=>[s.code,s.text]),[['U1','Wi-Fi ต่อไม่ได้'],['U2','ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้']]);
    output=proposalFor('ESCALATE');
   }
  }else if(input.taskType==='KNOWLEDGE_SCOPE')output=scope;
  else if(input.taskType==='KNOWLEDGE_METHOD')output={method:'RAG',query:null};
  else if(input.taskType==='KNOWLEDGE_ANSWER'){
   const request=JSON.parse(input.messages.at(-1)!.content) as {evidence:{chunkId:string;content:string}[]};
   assert(request.evidence.some(item=>item.chunkId===f.chunkId&&item.content.includes('YRU-Student')),'MODEL_MUST_RECEIVE_REAL_PUBLISHED_GUIDE');
   output={answer:'เปิด Wi-Fi ใน Settings แล้วเลือกเครือข่าย YRU-Student ตามคู่มือ หากยังผิดพลาดให้ลืมเครือข่ายแล้วเชื่อมต่อใหม่',citationChunkIds:[f.chunkId]};
  }else throw new Error(`UNEXPECTED_GENERATION_TASK:${input.taskType}`);
  const parsed=input.responseSchema.safeParse(output);assert(parsed.success,`CONTROLLED_OUTPUT_INVALID:${input.taskType}`);
  return {output:parsed.data,toolCalls:[],providerId:'controlled-free-fixture',modelId:'controlled-free-fixture',fallbackUsed:false};
  };
 const embed=async(input:EmbedInput):Promise<EmbedResult>=>{
  await f.assertOutsideSql();assert.equal(input.requestType,'EMBEDDING_QUERY');assert.equal(input.input[0],'Wi-Fi ต่อไม่ได้\nAndroid\nไม่สามารถเชื่อมต่อ Wi-Fi ได้');
  return {vectors:[unitVector],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimensions:384,providerId:'LOCAL_E5',modelId:LOCAL_EMBEDDING_MODEL,fallbackUsed:false};
 };
 const search:KnowledgeProducerOptions['search']=request=>transaction(client=>searchKnowledge(client,request),f.pool);
 const knowledgeOptions:KnowledgeProducerOptions={generate:generate as KnowledgeProducerOptions['generate'],embed,search};
 return {produce:createSupportProducer(knowledgeOptions),taskCalls};
}

type InboundWithAiJob={messageId:string;conversationId:string;jobId:string;eventId:string;sourceEventId:string};
type InboundWithoutAiJob={messageId:string;conversationId:string;eventId:string;sourceEventId:string};
async function inbound(f:Flow,text:string,routing?:'CONTINUE'|'NEW',expectedMode?:'AI'|'HUMAN'):Promise<InboundWithAiJob>;
async function inbound(f:Flow,text:string,routing:'CONTINUE'|'NEW',expectedMode:'AI'|'HUMAN',expectAIJob:false):Promise<InboundWithoutAiJob>;
async function inbound(f:Flow,text:string,routing?:'CONTINUE'|'NEW',expectedMode?:'AI'|'HUMAN',expectAIJob=true):Promise<InboundWithAiJob|InboundWithoutAiJob>{
 const eventId=randomUUID(),lineMessageId=randomUUID();
 const event={type:'message' as const,source:{type:'user' as const,userId:f.studentLineId},replyToken:`reply-${eventId}`,
  message:{type:'text' as const,id:lineMessageId,text}};
 const inboxJob=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,'MESSAGE','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
  [eventId,hashLineUserId(f.studentLineId,key),encryptValue(JSON.stringify(event),key),randomUUID()])).rows[0] as InboxJob;f.inboxIds.push(inboxJob.id);
 let classifierCalls=0,advice:Awaited<ReturnType<typeof classifyStudentInboxContext>>=null;
 if(routing){
  const classify:SemanticClassifier=async input=>{
   await f.assertOutsideSql();classifierCalls++;
   assert.equal(input.question,text);
   assert.deepEqual(input.contexts.map(context=>context.code),['C1'],'CONTROLLED_CLASSIFIER_MUST_RECEIVE_REAL_SERVER_CONTEXT');
   if(expectedMode)assert.equal(input.contexts[0].mode,expectedMode,'CLASSIFIER_MUST_RECEIVE_THE_LIVE_SERVER_CONTEXT');
   assert(input.contexts[0].previousUserMessages.length>0,'CLASSIFIER_MUST_RECEIVE_PRIOR_USER_CONTEXT');
   return routing==='NEW'?{decision:'NEW',candidateCode:null,confidence:.99}:{decision:'CONTINUE',candidateCode:'C1',confidence:.99};
  };
  advice=await classifyStudentInboxContext(f.pool,inboxJob,key,classify);
  assert(advice,'EXISTING_CONTEXT_REQUIRES_PRODUCTION_SEMANTIC_ROUTING_ADVICE');
 }
 assert.equal(classifierCalls,routing?1:0);
 await transaction(client=>processInboxEvent(client,inboxJob,key,{aiEnabled:true,routingAdvice:advice??undefined}),f.pool);
 const message=(await f.pool.query("select id,conversation_id from public.messages where line_message_id=$1 and sender_type='USER'",[lineMessageId])).rows[0];
 assert(message,'ACTUAL_USER_MESSAGE_MUST_BE_STORED');
 const job=(await f.pool.query('select id from private.ai_jobs where message_id=$1',[message.id])).rows[0];
 if(expectAIJob){assert(job,'CANONICAL_AI_JOB_MUST_BE_CREATED');f.jobIds.push(job.id);return {messageId:message.id,conversationId:message.conversation_id,jobId:job.id,eventId,sourceEventId:inboxJob.id};}
 assert.equal(job,undefined,'HUMAN_CONTINUATION_MUST_NOT_CREATE_AN_AI_JOB');
 return {messageId:message.id,conversationId:message.conversation_id,eventId,sourceEventId:inboxJob.id};
}

async function runAndDeliver(f:Flow,phase:'GUIDANCE'|'ESCALATE',capture:{bodies:unknown[]}){
 const model=producer(f,phase);
 const stats=await runAICycle(f.pool,key,{supportEnabled:true,produce:model.produce});assert.equal(stats.completed,1,'ACTUAL_AI_WORKER_MUST_FINALIZE');
 const completed=(await f.pool.query('select last_error_code from private.ai_jobs where id=$1',[f.jobIds.at(-1)])).rows[0];
 assert.equal(completed.last_error_code,null,`SUPPORT_FLOW_RESULT_${completed.last_error_code}`);
 const delivery=await runOutboxCycle(f.pool,key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
  await f.assertOutsideSql();const body=JSON.parse(String(init?.body));capture.bodies.push(body);return new Response(null,{status:200});
 }});
 assert(delivery.sent>=1,'CONTROLLED_LINE_TRANSPORT_MUST_ACCEPT_GUIDANCE');assert.equal(delivery.failed,0);
 const ai=(await f.pool.query("select o.id,o.payload_encrypted,o.status from private.message_outbox o where o.idempotency_key=$1",[`ai-job:${f.jobIds.at(-1)}`])).rows[0];
 assert(ai);assert.equal(ai.status,'SENT');const payload=JSON.parse(decryptValue(ai.payload_encrypted,key));
 assert(payload.messages[0].quickReply?.items?.length,'DELIVERED_SUPPORT_ACTIONS_REQUIRED');
 const choices:{label:string;data:string}[]=payload.messages[0].quickReply.items.map((item:{action:{label:string;data:string}})=>item.action);
 return {model,ai,choices};
}

async function confirm(f:Flow,choice:{label:string;data:string}){
 const eventId=randomUUID(),event={type:'postback' as const,source:{type:'user' as const,userId:f.studentLineId},
  postback:{data:choice.data},replyToken:`reply-${eventId}`};
 const inboxJob=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,'OTHER','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
  [eventId,hashLineUserId(f.studentLineId,key),encryptValue(JSON.stringify(event),key),randomUUID()])).rows[0] as InboxJob;f.inboxIds.push(inboxJob.id);
 await transaction(client=>processInboxEvent(client,inboxJob,key,{aiEnabled:true}),f.pool);
}

type RagAction='NEW_FAMILY'|'REPLACE_CURRENT';
interface RagSpec {
 familyCode:string;title:string;content:string;academicYear:number;versionName:string;documentType:'GUIDE'|'CALENDAR';
 action:RagAction;replaceDocumentId?:string;departmentCode?:string;effectiveFrom:string;effectiveTo?:string|null;versionStream?:string;
}
interface ReadyRag {jobId:string;documentId?:string;familyCode:string;resolution:Awaited<ReturnType<typeof getImportVersionResolution>>;
 input:{id:string;expectedJobRevision:number;expectedExtractionRevision:number;expectedReviewRevision:number;confirmPublication:true};}

/** Create a real private import, reviewed chunk plan and version-resolution preview; publication remains a separate explicit call. */
async function prepareRagImport(f:Flow,spec:RagSpec):Promise<ReadyRag>{
 const slug=spec.familyCode.toLowerCase().replaceAll('_','-');
 const source=createImportSource({bytes:new TextEncoder().encode(`<html><body><h1>${spec.title}</h1><p>${spec.content}</p></body></html>`),
  filename:`${slug}.html`,mimeType:'text/html',sourceUrl:`https://fixture.yru.ac.th/${slug}.html`,acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(f.actor,source,f.importOptions);f.importJobIds.push(job.id);
 const preview=await analyzeImportJob(f.actor,job.id,0,f.importOptions),state=await getImportReview(f.actor,job.id,f.importOptions),base=unfinishedReviewDraft();
 const metadata={...base.metadata,title:spec.title,familyCode:spec.familyCode,newFamily:null,departmentCode:spec.departmentCode===undefined?'IT':spec.departmentCode,
  documentType:spec.documentType,versionName:spec.versionName,versionStream:spec.versionStream??'DEFAULT',academicYear:spec.academicYear,
  scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:(await f.pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text today")).rows[0].today as string,
  effectiveFrom:spec.effectiveFrom,effectiveTo:spec.effectiveTo??null,authorityLevel:90,visibility:'PUBLIC' as const,
  sourceUrl:`https://fixture.yru.ac.th/${slug}.html`,storageMode:'RAG' as const};
 const attestations={sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true};
 const warningDispositions=state.warnings.map(w=>({warningKey:w.key,status:'CORRECTED' as const,reason:'Reviewed synthetic controlled-flow source'}));
 const initial:ImportReviewDraft={...base,schemaVersion:2,metadata,action:null,target:null,attestations,warningDispositions,chunkPlan:null};
 const first=await saveImportReview(f.actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft:initial},f.importOptions);
 const resolution=await getImportVersionResolution(f.actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},f.importOptions);
 let target:ImportReviewDraft['target']=null,newFamily:ImportReviewDraft['metadata']['newFamily']=null;
 if(spec.action==='NEW_FAMILY'){
  assert(resolution.availableActions.includes('NEW_FAMILY'),'NEW_FAMILY_REQUIRES_EXPLICIT_REVIEWED_ACTION');
  newFamily={name:spec.title,category:spec.documentType==='CALENDAR'?'Academic calendar':'Controlled integration'};
 }else{
  const candidate=resolution.candidates.find(row=>row.documentId===spec.replaceDocumentId);
  assert(candidate&&candidate.targetActions.includes('REPLACE_CURRENT'),'REPLACEMENT_TARGET_MUST_COME_FROM_CURRENT_VERSION_PREVIEW');
  target={documentId:candidate.documentId,revision:candidate.revision};
 }
 const reviewed:ImportReviewDraft={...initial,metadata:{...metadata,newFamily},action:spec.action,target};
 const saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,
  expectedReviewRevision:first.reviewRevision,draft:reviewed},f.importOptions);
 const plan=await getImportChunkPlan(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},f.importOptions);
 const finalDraft:ImportReviewDraft={...reviewed,chunkPlan:{digest:plan.plan.digest,chunkerVersion:plan.plan.chunkerVersion}};
 const final=await saveImportReview(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,
  expectedReviewRevision:saved.reviewRevision,draft:finalDraft},f.importOptions);
 return {jobId:job.id,familyCode:spec.familyCode,resolution,input:{id:job.id,expectedJobRevision:final.jobRevision,
  expectedExtractionRevision:final.extractionRevision,expectedReviewRevision:final.reviewRevision,confirmPublication:true}};
}

async function publishRagImport(f:Flow,ready:ReadyRag){
 const result=await approveImport(f.actor,ready.input,f.importOptions);ready.documentId=result.receipt.documentId;return result;
}

function baseScope(familyCode:string,options:Partial<KnowledgeScope>={}):KnowledgeScope{return {historical:false,academicYear:null,asOfDate:null,familyCodes:[familyCode],
 departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null,...options};}

type ControlledEvidence={chunkId:string;title:string;familyCode:string;academicYear:number|null;content:string};
function controlledKnowledgeProducer(f:Flow,options:{scope:(question:string)=>KnowledgeScope;beforeAnswer?:(question:string,evidence:ControlledEvidence[])=>Promise<void>;answer?:(evidence:ControlledEvidence[])=>string|{answer:string;citationChunkId:string}}){
 const taskCalls:string[]=[],generatorErrors:string[]=[],answerEvidence:ControlledEvidence[][]=[];
 const generate=async(input:GenerateInput<unknown>)=>{
  await f.assertOutsideSql();taskCalls.push(input.taskType);assert.equal(input.tools?.length??0,0,'CONTROLLED_INFORMATION_ANSWER_HAS_NO_MUTATION_TOOLS');
  let output:unknown;
  if(input.taskType==='KNOWLEDGE_SCOPE'){
   const request=JSON.parse(input.messages.at(-1)!.content) as {question:string};output=options.scope(request.question);
  }else if(input.taskType==='KNOWLEDGE_METHOD')output={method:'RAG',query:null};
  else if(input.taskType==='KNOWLEDGE_ANSWER'){
   const request=JSON.parse(input.messages.at(-1)!.content) as {question:string;evidence:ControlledEvidence[]};
   assert(request.evidence.length>0,'CONTROLLED_ANSWER_REQUIRES_REAL_RETRIEVED_EVIDENCE');
   answerEvidence.push(request.evidence);
   try{
    await options.beforeAnswer?.(request.question,request.evidence);
    const generated=options.answer?.(request.evidence)??'ข้อมูลตามเอกสารที่ผ่านการทบทวนครับ';
    const citationChunkId=typeof generated==='string'?request.evidence[0].chunkId:generated.citationChunkId;
    assert(request.evidence.some(item=>item.chunkId===citationChunkId),'CONTROLLED_CITATION_MUST_COME_FROM_ACTUAL_RETRIEVED_EVIDENCE');
    output={answer:typeof generated==='string'?generated:generated.answer,citationChunkIds:[citationChunkId]};
   }catch(error){generatorErrors.push(error instanceof Error?`${error.name}: ${error.message}`:String(error));throw error;}
  }else throw new Error(`UNEXPECTED_GENERATION_TASK:${input.taskType}`);
  const parsed=input.responseSchema.safeParse(output);
  if(!parsed.success){generatorErrors.push(`CONTROLLED_OUTPUT_INVALID:${input.taskType}:${parsed.error.message}`);throw new Error(`CONTROLLED_OUTPUT_INVALID:${input.taskType}`);}
  return {output:parsed.data,toolCalls:[],providerId:'controlled-free-fixture',modelId:'controlled-free-fixture',fallbackUsed:false};
 };
 const embed=async(input:EmbedInput):Promise<EmbedResult>=>{
  await f.assertOutsideSql();assert.equal(input.requestType,'EMBEDDING_QUERY');
  return {vectors:[unitVector],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimensions:384,providerId:'LOCAL_E5',modelId:LOCAL_EMBEDDING_MODEL,fallbackUsed:false};
 };
 const search:KnowledgeProducerOptions['search']=request=>transaction(client=>searchKnowledge(client,request),f.pool);
 const baseProducer=createKnowledgeProducer({generate:generate as KnowledgeProducerOptions['generate'],embed,search});
 const resultKinds:string[]=[];
 const produce:ReturnType<typeof createKnowledgeProducer>=async(snapshot,signal)=>{
  const result=await baseProducer(snapshot,signal);resultKinds.push(result.kind);return result;
 };
 return {produce,taskCalls,resultKinds,generatorErrors,answerEvidence};
}

async function deliverAll(f:Flow,capture:{bodies:unknown[]}={bodies:[]}):Promise<number>{
 let sent=0;
 for(let turn=0;turn<12;turn++){
  const result=await runOutboxCycle(f.pool,key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
   await f.assertOutsideSql();capture.bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200});
  }});
  sent+=result.sent;if(result.claimed===0)break;
 }
 return sent;
}

async function createEscalatedWifiTicket(f:Flow){
 const first=await inbound(f,'Wi-Fi ต่อไม่ได้');
 const clarification=await runAICycle(f.pool,key,{supportEnabled:true,produce:producer(f,'CLARIFY').produce});assert.equal(clarification.completed,1);
 const clarificationOut=(await f.pool.query("select id,status from private.message_outbox where idempotency_key=$1",[`ai-job:${first.jobId}`])).rows[0];assert(clarificationOut);
 assert.equal((await deliverAll(f)),1,'THE_CLARIFICATION_IS_DELIVERED_BEFORE_THE_USER_CONTINUES');
 assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[clarificationOut.id])).rows[0].status,'SENT');
 const followup=await inbound(f,'ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้','CONTINUE','AI');assert.equal(followup.conversationId,first.conversationId);
 const guidance=await runAndDeliver(f,'GUIDANCE',{bodies:[]});
 const canonicalAnswer=(await f.pool.query("select id,status,payload_encrypted from private.message_outbox where idempotency_key=$1",[`ai-job:${followup.jobId}`])).rows[0];assert(canonicalAnswer);
 assert.equal(canonicalAnswer.status,'SENT');
 const answer=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[followup.conversationId,followup.jobId])).rows[0];
 assert.match(answer.content,/YRU-Student/u);assert.equal(answer.metadata.citations[0].documentId,f.documentId);
 assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0].n,0);
 assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows[0].n,0,
  'A_SENT_GUIDANCE_MESSAGE_IS_NOT_A_USER_CONFIRMED_OUTCOME');
 const unresolved=await inbound(f,'ยังแก้ไม่ได้ครับ','CONTINUE','AI');assert.equal(unresolved.conversationId,followup.conversationId);
 const escalation=await runAndDeliver(f,'ESCALATE',{bodies:[]});
 assert.deepEqual(escalation.model.taskCalls,['SUPPORT_INTENT'],'UNRESOLVED_FOLLOWUP_DOES_NOT_REUSE_OR_REGENERATE_GUIDANCE');
 assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0].n,0,
  'A_DELIVERED_ESCALATION_OFFER_IS_NOT_YET_A_TICKET');
 assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows[0].n,0);
 const target=escalation.choices.find(choice=>/ส่งต่อ IT/u.test(choice.label));assert(target,'OWNED_IT_ESCALATION_CHOICE_MUST_BE_DELIVERED');await confirm(f,target);
 const ticket=(await f.pool.query('select * from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0];assert(ticket,'EXPLICIT_OWNED_CONFIRMATION_CREATES_CANONICAL_TICKET');
 const outcome=(await f.pool.query('select * from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows[0];assert(outcome);
 assert.equal(outcome.kind,'USER_CONFIRMED_ESCALATED');assert.equal(outcome.ticket_id,ticket.id);
 return {first,followup,unresolved,ticket,escalation,guidance};
}

async function staffInbox(f:Flow,event:unknown){
 const row=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STAFF',$1,$2,$3,'OTHER','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
  [randomUUID(),hashLineUserId(f.staffLineId,key),encryptValue(JSON.stringify(event),key),randomUUID()])).rows[0] as InboxJob;
 f.inboxIds.push(row.id);await transaction(client=>processInboxEvent(client,row,key),f.pool);
 return (await f.pool.query('select status,last_error_code from private.webhook_inbox where id=$1',[row.id])).rows[0];
}

async function acceptEscalatedTicket(f:Flow,ticketId:string){
 const notice=(await f.pool.query("select id,payload_encrypted,status from private.message_outbox where ticket_id=$1 and channel='STAFF' and kind='NOTIFICATION' and recipient_staff_id=$2",[ticketId,f.staff])).rows[0];
 assert(notice,'BOUND_IT_STAFF_NOTIFICATION_MUST_BE_QUEUED');
 const payload=JSON.parse(decryptValue(notice.payload_encrypted,key));const accept=payload.messages[0].quickReply.items[0].action.data as string;
 assert.match(accept,/^yru:staff:accept:/u);
 assert((await deliverAll(f))>=1,'BOUND_STAFF_ALERT_IS_SENT_THROUGH_THE_CONTROLLED_LINE_TRANSPORT');
 assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[notice.id])).rows[0].status,'SENT');
 const accepted=await staffInbox(f,{type:'postback',source:{type:'user',userId:f.staffLineId},postback:{data:accept}});
 assert.equal(accepted.last_error_code,null,'ACTUAL_BOUND_STAFF_ACCEPT_COMMAND_SUCCEEDS');
 return {accept,noticeId:notice.id};
}

async function ticketAction(f:Flow,ticketId:string,action:StaffTicketAction,input:TicketActionInput){
 return transaction(client=>applyTicketAction(client,f.staff,ticketId,action,input,key),f.pool);
}

for(const branch of ['SOLVED','ESCALATE'] as const)test(`controlled Wi-Fi troubleshooting flow consumes owned ${branch} action against a reviewed public guide`,async()=>{
 const f=await createFlow();try{
  const capture:{bodies:unknown[]}={bodies:[]};
  const first=await inbound(f,'Wi-Fi ต่อไม่ได้');
  const initial=await runAICycle(f.pool,key,{supportEnabled:true,produce:producer(f,'CLARIFY').produce});assert.equal(initial.completed,1,`INITIAL_SUPPORT_WORKER:${JSON.stringify(initial)}`);
  const firstOut=(await f.pool.query('select payload_encrypted,status from private.message_outbox where idempotency_key=$1',[
   `ai-job:${first.jobId}`])).rows[0];assert.equal(firstOut.status,'PENDING');
  await runOutboxCycle(f.pool,key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
   await f.assertOutsideSql();capture.bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200});
  }});
  const clarification=JSON.parse(decryptValue(firstOut.payload_encrypted,key)).messages[0].text;
  assert.match(clarification,/อุปกรณ์|ระบบปฏิบัติการ/u,'FIRST RESPONSE MUST_USE_FIXED_DEVICE_CLARIFICATION');
  assert.equal((await f.pool.query("select status from private.message_outbox where idempotency_key=$1",[`ai-job:${first.jobId}`])).rows[0].status,'SENT');

  const followup=await inbound(f,'ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้','CONTINUE','AI');assert.equal(followup.conversationId,first.conversationId);
  const delivered=await runAndDeliver(f,'GUIDANCE',capture);
  assert(delivered.model.taskCalls.includes('SUPPORT_INTENT'));assert(delivered.model.taskCalls.includes('KNOWLEDGE_SCOPE'));
  assert(delivered.model.taskCalls.includes('KNOWLEDGE_ANSWER'));
  assert.equal(delivered.model.taskCalls.includes('KNOWLEDGE_METHOD'),false,'RAG_ONLY_PRODUCER_DOES_NOT_NEED_STRUCTURED_SELECTOR');
  const answer=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[followup.conversationId,followup.jobId])).rows[0];
  assert.match(answer.content,/YRU-Student/u);assert.equal(answer.metadata.citations.length,1);
  assert.equal(answer.metadata.citations[0].documentId,f.documentId,'CITATION_MUST_REFERENCE_APPROVED_CANONICAL_DOCUMENT');

  let escalation=delivered;
  if(branch==='ESCALATE'){
   const unresolved=await inbound(f,'ยังแก้ไม่ได้ครับ','CONTINUE','AI');assert.equal(unresolved.conversationId,followup.conversationId);
   escalation=await runAndDeliver(f,'ESCALATE',capture);
   assert.deepEqual(escalation.model.taskCalls,['SUPPORT_INTENT'],'UNRESOLVED_FOLLOWUP_MUST_NOT_GENERATE_ANOTHER_GUIDE');
  }
  const target=branch==='SOLVED'?delivered.choices.find(c=>/แก้ได้แล้ว/u.test(c.label)):escalation.choices.find(c=>/ส่งต่อ IT/u.test(c.label));
  assert(target,`OWNED_${branch}_CHOICE_MUST_BE_DELIVERED`);await confirm(f,target);
  const outcomes=(await f.pool.query('select * from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows;
  assert.equal(outcomes.length,1);assert.equal(outcomes[0].kind,branch==='SOLVED'?'USER_CONFIRMED_SOLVED':'USER_CONFIRMED_ESCALATED');
  if(branch==='SOLVED'){
   assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0].n,0);
   assert.equal(outcomes[0].ticket_id,null);
   assert.equal((await f.pool.query('select status from public.conversations where id=$1',[followup.conversationId])).rows[0].status,'RESOLVED');
  }else{
   const ticket=(await f.pool.query('select * from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0];assert(ticket);
   assert.equal(ticket.category,'IT_SUPPORT');assert.equal(ticket.subcategory,'NETWORK_ACCESS');
   assert.equal(ticket.problem_summary,'Wi-Fi ต่อไม่ได้');assert.equal(ticket.priority,'MEDIUM');assert.equal(ticket.sensitive_level,'GENERAL');
   assert.equal(outcomes[0].ticket_id,ticket.id);
   const context=(await f.pool.query('select context_encrypted from private.ticket_support_contexts where ticket_id=$1',[ticket.id])).rows[0];assert(context);
   assert(!context.context_encrypted.includes('Android'));const decoded=JSON.parse(decryptValue(context.context_encrypted,key));
   assert.equal(decoded.support.interpreted.problemText,'Wi-Fi ต่อไม่ได้');
   assert(decoded.support.interpreted.collectedContext.some((item:{field:string;quote:string})=>item.field==='DEVICE'&&item.quote==='Android'));
   assert(decoded.support.interpreted.collectedContext.some((item:{field:string;quote:string})=>item.field==='ERROR'&&item.quote==='ไม่สามารถเชื่อมต่อ Wi-Fi ได้'));
   const scoped=(await f.pool.query("select recipient_staff_id from private.message_outbox where ticket_id=$1 and channel='STAFF' and kind='NOTIFICATION'",[ticket.id])).rows;
   assert.deepEqual(scoped.map(row=>row.recipient_staff_id),[f.staff],'ONLY_BOUND_CURRENT_IT_STAFF_RECEIVES_TICKET_NOTIFICATION');
   const response=await runOutboxCycle(f.pool,key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
    await f.assertOutsideSql();capture.bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200});
   }});assert.equal(response.failed,0);
   const notification=(await f.pool.query("select o.id,o.payload_encrypted,o.status from private.message_outbox o where o.ticket_id=$1 and o.channel='STAFF' and o.kind='NOTIFICATION' and o.recipient_staff_id=$2",[ticket.id,f.staff])).rows[0];
   assert(notification);assert.equal(notification.status,'SENT');
   const notificationPayload=JSON.parse(decryptValue(notification.payload_encrypted,key));
   assert(!JSON.stringify(notificationPayload).includes('Android'));assert(!JSON.stringify(notificationPayload).includes('ไม่สามารถเชื่อมต่อ Wi-Fi ได้'));
  }
 }finally{await f.cleanup();}
});

test('FLOW-A runs an actual FAQ through reviewed RAG, canonical citations and SENT outbox, then suppresses stale current evidence',async()=>{
 const f=await createFlow();try{
  const today=(await f.pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text today")).rows[0].today as string;
  const familyCode=`TRANSFER_GUIDE_${f.owner.replaceAll('-','').slice(0,16).toUpperCase()}`;
  const content='ผู้ยื่นต้องส่งแบบคำร้องพร้อมเอกสารรายวิชาให้กองบริการการศึกษาตรวจสอบการเทียบโอนก่อนสมัครรายวิชา';
  const firstReady=await prepareRagImport(f,{familyCode,title:`ขั้นตอนเทียบโอน ${f.owner}`,content,academicYear:2569,versionName:'2569',documentType:'GUIDE',
   action:'NEW_FAMILY',effectiveFrom:today});
  assert.equal((await f.pool.query('select count(*)::int n from public.documents d join public.document_families f on f.id=d.document_family_id where f.code=$1',[familyCode])).rows[0].n,0,
   'IMPORT_ANALYSIS_AND_REVIEW_DO_NOT_PUBLISH_KNOWLEDGE');
  const firstPublication=await publishRagImport(f,firstReady);assert.equal(firstPublication.receipt.storageMode,'RAG');assert(firstReady.documentId);
  const faq=await inbound(f,'เทียบโอนต้องทำอย่างไร');assert(faq.jobId);
  const scope=()=>baseScope(familyCode);
  const answerProducer=controlledKnowledgeProducer(f,{scope,answer:evidence=>{
   const passage=evidence.find(item=>item.familyCode===familyCode&&item.content.includes('เอกสารรายวิชา'));
   assert(passage,'FAQ_ANSWER_PROMPT_MUST_CONTAIN_THE_APPROVED_INTERNAL_SOURCE');
   return {answer:'ให้ส่งแบบคำร้องพร้อมเอกสารรายวิชาให้กองบริการการศึกษาตรวจสอบก่อนสมัครรายวิชาครับ',citationChunkId:passage.chunkId};
  }});
  assert.equal((await runAICycle(f.pool,key,{produce:answerProducer.produce})).completed,1);
  const canonical=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[faq.conversationId,faq.jobId])).rows[0];assert(canonical);
  assert.match(canonical.content,/เอกสารรายวิชา/u);assert.equal(canonical.metadata.citations.length,1);
  assert.equal(canonical.metadata.citations[0].documentId,firstReady.documentId);
  const firstOut=(await f.pool.query('select id,status from private.message_outbox where idempotency_key=$1',[`ai-job:${faq.jobId}`])).rows[0];assert(firstOut);
  assert.equal(await deliverAll(f),1);assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[firstOut.id])).rows[0].status,'SENT');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,0);
  assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[faq.conversationId])).rows[0].n,0);

  const repeated=await inbound(f,'เทียบโอนต้องทำอย่างไร','NEW','AI');assert.notEqual(repeated.conversationId,faq.conversationId);
  let replacement:ReadyRag|undefined;
  const staleProducer=controlledKnowledgeProducer(f,{scope,answer:()=> 'คำตอบจากเอกสารเดิมต้องถูกเพิกถอนครับ',beforeAnswer:async(_question,evidence)=>{
   assert(evidence.some(item=>item.familyCode===familyCode&&item.content.includes(content)),'STALE_CONTROL_STARTS_WITH_THE_PREVIOUS_APPROVED_EVIDENCE');
   replacement=await prepareRagImport(f,{familyCode,title:`ขั้นตอนเทียบโอนฉบับปรับปรุง ${f.owner}`,
    content:'ฉบับใหม่ระบุให้ตรวจสอบชุดเอกสารเทียบโอนกับประกาศปีการศึกษา 2569 ก่อนดำเนินการ',academicYear:2569,versionName:'2569-revised',
    documentType:'GUIDE',action:'REPLACE_CURRENT',replaceDocumentId:firstReady.documentId,effectiveFrom:today});
   assert.equal((await f.pool.query('select count(*)::int n from public.documents where document_family_id=(select document_family_id from public.documents where id=$1)',
    [firstReady.documentId])).rows[0].n,1,'REVIEWED_REPLACEMENT_REMAINS_UNPUBLISHED_DURING_PREPARATION');
   await publishRagImport(f,replacement);
  }});
  assert.equal((await runAICycle(f.pool,key,{produce:staleProducer.produce})).completed,1);
  const staleRow=(await f.pool.query("select last_error_code from private.ai_jobs where id=$1",[repeated.jobId])).rows[0];assert.equal(staleRow.last_error_code,'EVIDENCE_CHANGED');
  const staleMessage=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",
   [repeated.conversationId,repeated.jobId])).rows[0];assert(staleMessage);assert.deepEqual(staleMessage.metadata.citations,[]);
  assert(!staleMessage.content.includes('เอกสารเดิม'),'A_STALE_CITATION_NEVER_ESCAPES_FINALIZATION');
  const staleOut=(await f.pool.query('select id,status from private.message_outbox where idempotency_key=$1',[`ai-job:${repeated.jobId}`])).rows[0];assert(staleOut);
  assert.equal(await deliverAll(f),1);assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[staleOut.id])).rows[0].status,'SENT');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,0);
 }finally{await f.cleanup();}
});

test('FLOW-B requires delivered troubleshooting guidance and the owned USER confirmation before SOLVED with no ticket',async()=>{
 const f=await createFlow();try{
  const first=await inbound(f,'Wi-Fi ต่อไม่ได้');
  const initial=await runAICycle(f.pool,key,{supportEnabled:true,produce:producer(f,'CLARIFY').produce});assert.equal(initial.completed,1);
  const clarification=(await f.pool.query('select id,payload_encrypted,status from private.message_outbox where idempotency_key=$1',[`ai-job:${first.jobId}`])).rows[0];assert(clarification);
  assert.equal(await deliverAll(f),1);assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[clarification.id])).rows[0].status,'SENT');
  assert.match(JSON.parse(decryptValue(clarification.payload_encrypted,key)).messages[0].text,/อุปกรณ์|ระบบปฏิบัติการ/u);
  const followup=await inbound(f,'ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้','CONTINUE','AI');assert.equal(followup.conversationId,first.conversationId);
  const delivered=await runAndDeliver(f,'GUIDANCE',{bodies:[]});assert(delivered.model.taskCalls.includes('KNOWLEDGE_ANSWER'));
  const canonical=(await f.pool.query("select metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",
   [followup.conversationId,followup.jobId])).rows[0];assert.equal(canonical.metadata.citations[0].documentId,f.documentId);
  const answerOut=(await f.pool.query('select id,status from private.message_outbox where idempotency_key=$1',[`ai-job:${followup.jobId}`])).rows[0];assert.equal(answerOut.status,'SENT');
  assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows[0].n,0,
   'SENT_GUIDANCE_ALONE_DOES_NOT_CREATE_A_SOLVED_OUTCOME');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0].n,0);
  const solved=delivered.choices.find(choice=>/แก้ได้แล้ว/u.test(choice.label));assert(solved);await confirm(f,solved);
  const outcome=(await f.pool.query('select kind,ticket_id from private.ai_support_outcomes where conversation_id=$1',[followup.conversationId])).rows[0];
  assert.deepEqual(outcome,{kind:'USER_CONFIRMED_SOLVED',ticket_id:null});
  assert.equal((await f.pool.query('select status,mode from public.conversations where id=$1',[followup.conversationId])).rows[0].status,'RESOLVED');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where conversation_id=$1',[followup.conversationId])).rows[0].n,0);
 }finally{await f.cleanup();}
});

test('FLOW-C requires an explicit unresolved escalation and retains encrypted context for only bound scoped Staff',async()=>{
 const f=await createFlow();try{
  const result=await createEscalatedWifiTicket(f),ticket=result.ticket;
  assert.deepEqual((await f.pool.query('select s.id,d.code,s.active from public.staff_profiles s join public.departments d on d.id=s.department_id where s.id=$1',[f.unboundStaff])).rows[0],
   {id:f.unboundStaff,code:'IT',active:true},'AN_ACTIVE_UNBOUND_IT_STAFF_PROFILE_IS_PRESENT_FOR_RECIPIENT_FILTERING');
  assert.equal((await f.pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[f.unboundStaff])).rows[0].n,0,
   'UNBOUND_IT_STAFF_HAS_NO_STAFF_LINE_IDENTITY');
  assert.equal(ticket.department_id,(await f.pool.query("select id from public.departments where code='IT'")).rows[0].id);
  assert.equal(ticket.category,'IT_SUPPORT');assert.equal(ticket.subcategory,'NETWORK_ACCESS');assert.equal(ticket.problem_summary,'Wi-Fi ต่อไม่ได้');
  assert.equal(ticket.status,'WAITING_STAFF');assert.equal(ticket.mode,'HUMAN');
  const copied=(await f.pool.query('select context_encrypted from private.ticket_support_contexts where ticket_id=$1',[ticket.id])).rows[0];assert(copied);
  assert(!copied.context_encrypted.includes('Android'));const decoded=JSON.parse(decryptValue(copied.context_encrypted,key));
  assert.equal(decoded.support.interpreted.problemText,'Wi-Fi ต่อไม่ได้');
  assert(decoded.support.interpreted.collectedContext.some((item:{field:string;quote:string})=>item.field==='DEVICE'&&item.quote==='Android'));
  assert(decoded.support.interpreted.collectedContext.some((item:{field:string;quote:string})=>item.field==='ERROR'&&item.quote==='ไม่สามารถเชื่อมต่อ Wi-Fi ได้'));
  const outcome=(await f.pool.query('select kind,ticket_id,department_id from private.ai_support_outcomes where conversation_id=$1',[result.followup.conversationId])).rows[0];
  assert.equal(outcome.kind,'USER_CONFIRMED_ESCALATED');assert.equal(outcome.ticket_id,ticket.id);assert.equal(outcome.department_id,ticket.department_id);
  const alerts=(await f.pool.query("select id,recipient_staff_id,payload_encrypted,status from private.message_outbox where ticket_id=$1 and channel='STAFF' and kind='NOTIFICATION' order by recipient_staff_id",[ticket.id])).rows;
  assert.deepEqual(alerts.map(row=>row.recipient_staff_id),[f.staff],'NO_UNBOUND_OR_FOREIGN_DEPARTMENT_STAFF_IS_ALERTED');
  assert((await deliverAll(f))>=2,'STUDENT_RECEIPT_AND_BOUND_STAFF_ALERT_USE_THE_CONTROLLED_LINE_TRANSPORT');
  assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[alerts[0].id])).rows[0].status,'SENT');
  const notice=JSON.parse(decryptValue(alerts[0].payload_encrypted,key));
  assert(!JSON.stringify(notice).includes('Android'));assert(!JSON.stringify(notice).includes('ไม่สามารถเชื่อมต่อ Wi-Fi ได้'));
 }finally{await f.cleanup();}
});

test('FLOW-D uses Staff ACCEPT, manual reply, exact HUMAN continuation, RESOLVE and CLOSE with stale replay suppressed',async()=>{
 const f=await createFlow();try{
  const {ticket}=await createEscalatedWifiTicket(f);
  const beforeAI=(await f.pool.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_type='AI'",[ticket.conversation_id])).rows[0].n;
  const accepted=await acceptEscalatedTicket(f,ticket.id);
  const live=(await f.pool.query('select mode,status,revision,assigned_staff_id from public.tickets where id=$1',[ticket.id])).rows[0];
  assert.deepEqual(live,{mode:'HUMAN',status:'STAFF_HANDLING',revision:1,assigned_staff_id:f.staff});
  const afterAccept={messages:(await f.pool.query('select count(*)::int n from public.messages where conversation_id=$1',[ticket.conversation_id])).rows[0].n,
   outbox:(await f.pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[ticket.id])).rows[0].n,history:(await f.pool.query('select count(*)::int n from public.ticket_history where ticket_id=$1',[ticket.id])).rows[0].n};
  const replay=await staffInbox(f,{type:'postback',source:{type:'user',userId:f.staffLineId},postback:{data:accepted.accept}});
  assert.equal(replay.last_error_code,'INVALID_STAFF_COMMAND');
  assert.deepEqual({messages:(await f.pool.query('select count(*)::int n from public.messages where conversation_id=$1',[ticket.conversation_id])).rows[0].n,
   outbox:(await f.pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[ticket.id])).rows[0].n,
   history:(await f.pool.query('select count(*)::int n from public.ticket_history where ticket_id=$1',[ticket.id])).rows[0].n},afterAccept,
   'REPLAY_OF_CONSUMED_ACCEPT_COMMAND_HAS_NO_MESSAGE_OR_BUSINESS_EFFECT');

  const replyInput={revision:live.revision,requestId:randomUUID(),text:'กรุณาส่งภาพข้อความผิดพลาดในช่องนี้ครับ'};
  const reply=await ticketAction(f,ticket.id,'STAFF_REPLY',replyInput);assert.equal(reply.status,'WAITING_USER');
  const staffMessage=(await f.pool.query("select ticket_id,conversation_id,sender_type,sender_staff_id,content from public.messages where ticket_id=$1 and sender_type='STAFF'",[ticket.id])).rows[0];
  assert.deepEqual(staffMessage,{ticket_id:ticket.id,conversation_id:ticket.conversation_id,sender_type:'STAFF',sender_staff_id:f.staff,content:replyInput.text});
  assert.equal((await deliverAll(f)),1,'MANUAL_STAFF_REPLY_IS_DELIVERED_TO_THE_STUDENT');
  const beforeAIOutbox=(await f.pool.query("select count(*)::int n from private.message_outbox where conversation_id=$1 and kind='AI'",[ticket.conversation_id])).rows[0].n;
  const continuation=await inbound(f,'ได้ส่งภาพข้อความผิดพลาดตามที่ขอแล้ว','CONTINUE','HUMAN',false);
  const routed=(await f.pool.query('select conversation_id,ticket_id,sender_type,content from public.messages where source_event_id=$1',[continuation.sourceEventId])).rows[0];
  assert.deepEqual(routed,{conversation_id:ticket.conversation_id,ticket_id:ticket.id,sender_type:'USER',content:'ได้ส่งภาพข้อความผิดพลาดตามที่ขอแล้ว'});
  assert.equal((await f.pool.query('select status from public.tickets where id=$1',[ticket.id])).rows[0].status,'STAFF_HANDLING');
  assert.equal((await f.pool.query('select count(*)::int n from private.ai_jobs where message_id=$1',[continuation.messageId])).rows[0].n,0);
  assert.equal((await f.pool.query("select count(*)::int n from private.message_outbox where conversation_id=$1 and kind='AI'",[ticket.conversation_id])).rows[0].n,beforeAIOutbox,
   'HUMAN_CONTINUATION_DOES_NOT_QUEUE_AN_AI_REPLY');
  assert.equal((await f.pool.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_type='AI'",[ticket.conversation_id])).rows[0].n,beforeAI,
   'AI_ADDS_NO_MESSAGE_AFTER_HUMAN_TAKEOVER');

  const beforeReplay={messages:(await f.pool.query('select count(*)::int n from public.messages where conversation_id=$1',[ticket.conversation_id])).rows[0].n,
   outbox:(await f.pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[ticket.id])).rows[0].n,
   history:(await f.pool.query('select count(*)::int n from public.ticket_history where ticket_id=$1',[ticket.id])).rows[0].n};
  const duplicate=await ticketAction(f,ticket.id,'STAFF_REPLY',replyInput);assert.equal(duplicate.status,'WAITING_USER');
  assert.deepEqual({messages:(await f.pool.query('select count(*)::int n from public.messages where conversation_id=$1',[ticket.conversation_id])).rows[0].n,
   outbox:(await f.pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[ticket.id])).rows[0].n,
   history:(await f.pool.query('select count(*)::int n from public.ticket_history where ticket_id=$1',[ticket.id])).rows[0].n},beforeReplay,
   'STALE_IDEMPOTENT_REPLY_REPLAY_ADDS_NO_MESSAGE_OR_DELIVERY');
  const current=Number((await f.pool.query('select revision from public.tickets where id=$1',[ticket.id])).rows[0].revision);
  const resolved=await ticketAction(f,ticket.id,'RESOLVE',{revision:current,requestId:randomUUID()});assert.equal(resolved.status,'RESOLVED');
  const closed=await ticketAction(f,ticket.id,'CLOSE',{revision:resolved.revision,requestId:randomUUID()});assert.equal(closed.status,'CLOSED');
  assert.deepEqual((await f.pool.query('select mode,status from public.tickets where id=$1',[ticket.id])).rows[0],{mode:'HUMAN',status:'CLOSED'});
  assert.deepEqual((await f.pool.query('select mode,status from public.conversations where id=$1',[ticket.conversation_id])).rows[0],{mode:'HUMAN',status:'CLOSED'});
 }finally{await f.cleanup();}
});

test('FLOW-E semantic NEW during an open HUMAN ticket answers a separate library conversation and preserves the old case',async()=>{
 const f=await createFlow();try{
  const {ticket}=await createEscalatedWifiTicket(f);
  const before=(await f.pool.query('select mode,status,revision,problem_summary from public.tickets where id=$1',[ticket.id])).rows[0];
  const today=(await f.pool.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text today")).rows[0].today as string;
  const libraryFamily=`LIBRARY_GUIDE_${f.owner.replaceAll('-','').slice(0,16).toUpperCase()}`;
  const libraryContent='ห้องสมุดมหาวิทยาลัยปิดให้บริการเวลา 18:00 น. ในวันทำการ';
  const ready=await prepareRagImport(f,{familyCode:libraryFamily,title:`เวลาบริการห้องสมุด ${f.owner}`,content:libraryContent,academicYear:2569,
   versionName:'2569',documentType:'GUIDE',action:'NEW_FAMILY',departmentCode:'LIBRARY',effectiveFrom:today});
  const publication=await publishRagImport(f,ready);assert(ready.documentId);
  const newTopic=await inbound(f,'ห้องสมุดปิดกี่โมง','NEW','HUMAN');assert(newTopic.jobId);assert.notEqual(newTopic.conversationId,ticket.conversation_id);
  const model=controlledKnowledgeProducer(f,{scope:()=>baseScope(libraryFamily),answer:evidence=>{
   const passage=evidence.find(item=>item.familyCode===libraryFamily&&item.content.includes('18:00'));
   assert(passage,'NEW_TOPIC_MUST_RETRIEVE_APPROVED_LIBRARY_GUIDE');
   return {answer:'ห้องสมุดปิดเวลา 18:00 น. ในวันทำการครับ',citationChunkId:passage.chunkId};
  }});
  assert.equal((await runAICycle(f.pool,key,{produce:model.produce})).completed,1);
  const message=(await f.pool.query("select conversation_id,ticket_id,content,metadata from public.messages where metadata->>'ai_job_id'=$1 and sender_type='AI'",[newTopic.jobId])).rows[0];assert(message);
  assert.equal(message.conversation_id,newTopic.conversationId);assert.equal(message.ticket_id,null);assert.match(message.content,/18:00/u);
  assert.equal(message.metadata.citations[0].documentId,publication.receipt.documentId);
  assert((await deliverAll(f))>=1,'NEW_TOPIC_ANSWER_IS_SENT_THROUGH_THE_OUTBOX');
  const newOut=(await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${newTopic.jobId}`])).rows[0];assert.equal(newOut.status,'SENT');
  assert.deepEqual((await f.pool.query('select mode,status,revision,problem_summary from public.tickets where id=$1',[ticket.id])).rows[0],before,
   'NEW_LIBRARY_TOPIC_DOES_NOT_TOUCH_THE_ACTIVE_REGISTRATION_OR_SUPPORT_TICKET');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[newTopic.conversationId])).rows[0].n,0);
 }finally{await f.cleanup();}
});

test('FLOW-F imports reviewed calendar versions without auto-publication or deletion and cites current and explicit history',async()=>{
 const f=await createFlow();try{
  const familyCode=`ACADEMIC_CALENDAR_${f.owner.replaceAll('-','').slice(0,16).toUpperCase()}`;
  const oldReady=await prepareRagImport(f,{familyCode,title:`ปฏิทินการศึกษา 2568 ${f.owner}`,
   content:'ปีการศึกษา 2568 เปิดภาคเรียนวันที่ 2 มิถุนายน 2568 และสิ้นสุดภาคเรียนวันที่ 30 กันยายน 2568',academicYear:2568,
   versionName:'2568',documentType:'CALENDAR',action:'NEW_FAMILY',departmentCode:'ACADEMIC_AFFAIRS',effectiveFrom:'2025-01-01',effectiveTo:'2025-12-31'});
  assert.equal((await f.pool.query('select count(*)::int n from public.documents where document_family_id in(select id from public.document_families where code=$1)',[familyCode])).rows[0].n,0,
   'ANALYZE_AND_REVIEW_DO_NOT_AUTO_PUBLISH_2568');
  await publishRagImport(f,oldReady);assert(oldReady.documentId);
  const currentReady=await prepareRagImport(f,{familyCode,title:`ปฏิทินการศึกษา 2569 ${f.owner}`,
   content:'ปีการศึกษา 2569 เปิดภาคเรียนวันที่ 1 มิถุนายน 2569 และสิ้นสุดภาคเรียนวันที่ 29 กันยายน 2569',academicYear:2569,
   versionName:'2569',documentType:'CALENDAR',action:'REPLACE_CURRENT',replaceDocumentId:oldReady.documentId,departmentCode:'ACADEMIC_AFFAIRS',effectiveFrom:'2026-01-01'});
  assert.equal(currentReady.resolution.currentStreamOccupied,true);
  assert(currentReady.resolution.candidates.find(candidate=>candidate.documentId===oldReady.documentId)?.targetActions.includes('REPLACE_CURRENT'),
   'VERSION_PREVIEW_MUST_BIND_THE_REPLACEMENT_TO_THE_CURRENT_2568_DOCUMENT');
  assert.equal((await f.pool.query('select count(*)::int n from public.documents where document_family_id in(select id from public.document_families where code=$1)',[familyCode])).rows[0].n,1,
   'SAVED_2569_REVIEW_IS_NOT_PUBLICATION');
  assert.equal((await f.pool.query('select count(*)::int n from private.knowledge_import_publications where job_id=$1',[currentReady.jobId])).rows[0].n,0);
  await publishRagImport(f,currentReady);assert(currentReady.documentId);
  const versions=(await f.pool.query('select id,academic_year,status,is_current from public.documents where id=any($1::uuid[]) order by academic_year',
   [[oldReady.documentId,currentReady.documentId]])).rows;
  assert.deepEqual(versions,[{id:oldReady.documentId,academic_year:2568,status:'SUPERSEDED',is_current:false},
   {id:currentReady.documentId,academic_year:2569,status:'ACTIVE',is_current:true}]);
  assert.equal((await f.pool.query('select count(*)::int n from public.documents where id=any($1::uuid[])',[[oldReady.documentId,currentReady.documentId]])).rows[0].n,2,
   'REPLACEMENT_RETAINS_THE_2568_DOCUMENT');

  const producerForYear=controlledKnowledgeProducer(f,{scope:question=>question.includes('2568')?
   baseScope(familyCode,{historical:true,academicYear:2568}):baseScope(familyCode),answer:evidence=>{
    // Equal fixture vectors give heading/body chunks equal scores; the model must read all evidence.
    const row=evidence.find(item=>item.familyCode===familyCode&&
     ((item.academicYear===2568&&item.content.includes('2 มิถุนายน 2568'))||
      (item.academicYear===2569&&item.content.includes('1 มิถุนายน 2569'))));
    assert(row,'CALENDAR_ANSWER_REQUIRES_THE_ACTUAL_DATED_PASSAGE');
    return {answer:row.academicYear===2568?'ปฏิทินย้อนหลังปี 2568 เปิดภาคเรียนวันที่ 2 มิถุนายนครับ':
     'ปฏิทินปัจจุบันปี 2569 เปิดภาคเรียนวันที่ 1 มิถุนายนครับ',citationChunkId:row.chunkId};
   }});
  const now=await inbound(f,'ปฏิทินการศึกษาปัจจุบัน');assert(now.jobId);
  assert.equal((await runAICycle(f.pool,key,{produce:producerForYear.produce})).completed,1);
  const currentAnswer=(await f.pool.query("select metadata,content from public.messages where sender_type='AI' and metadata->>'ai_job_id'=$1",[now.jobId])).rows[0];assert(currentAnswer);
  const currentJob=(await f.pool.query('select status,last_error_code from private.ai_jobs where id=$1',[now.jobId])).rows[0];assert(currentJob);
  const currentDiagnostic=`resultKinds=${JSON.stringify(producerForYear.resultKinds)} taskCalls=${JSON.stringify(producerForYear.taskCalls)} generatorErrors=${JSON.stringify(producerForYear.generatorErrors)} answerEvidence=${JSON.stringify(producerForYear.answerEvidence)} job=${JSON.stringify(currentJob)} content=${currentAnswer.content} metadata=${JSON.stringify(currentAnswer.metadata)}`;
  assert.equal(producerForYear.generatorErrors.length,0,`CONTROLLED_CURRENT_CALENDAR_CALLBACK_MUST_MATCH_THE_PUBLIC_PROMPT; ${currentDiagnostic}`);
  assert.deepEqual(producerForYear.resultKinds,['ANSWER'],`CURRENT_CALENDAR_MUST_PRODUCE_A_GROUNDED_KNOWLEDGE_ANSWER; ${currentDiagnostic}`);
  assert.equal(currentJob.last_error_code,null,`CURRENT_CALENDAR_FINALIZATION_MUST_KEEP_CURRENT_EVIDENCE; ${currentDiagnostic}`);
  const currentCitations=currentAnswer.metadata?.citations;
  assert(Array.isArray(currentCitations)&&currentCitations.length===1,`CURRENT_CALENDAR_ANSWER_MUST_HAVE_ONE_CANONICAL_CITATION; ${currentDiagnostic}`);
  assert.equal(currentCitations[0].documentId,currentReady.documentId);assert.equal(currentCitations[0].academicYear,2569);
  assert.match(currentAnswer.content,/1 มิถุนายน/u);assert((await deliverAll(f))>=1);
  assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${now.jobId}`])).rows[0].status,'SENT');

  const history=await inbound(f,'ขอข้อมูลย้อนหลัง ปีการศึกษา 2568','NEW','AI');assert(history.jobId);assert.notEqual(history.conversationId,now.conversationId);
  assert.equal((await runAICycle(f.pool,key,{produce:producerForYear.produce})).completed,1);
  const oldAnswer=(await f.pool.query("select metadata,content from public.messages where sender_type='AI' and metadata->>'ai_job_id'=$1",[history.jobId])).rows[0];assert(oldAnswer);
  const historyJob=(await f.pool.query('select status,last_error_code from private.ai_jobs where id=$1',[history.jobId])).rows[0];assert(historyJob);
  const historyDiagnostic=`resultKinds=${JSON.stringify(producerForYear.resultKinds)} taskCalls=${JSON.stringify(producerForYear.taskCalls)} generatorErrors=${JSON.stringify(producerForYear.generatorErrors)} answerEvidence=${JSON.stringify(producerForYear.answerEvidence)} job=${JSON.stringify(historyJob)} content=${oldAnswer.content} metadata=${JSON.stringify(oldAnswer.metadata)}`;
  assert.equal(producerForYear.generatorErrors.length,0,`CONTROLLED_HISTORICAL_CALENDAR_CALLBACK_MUST_MATCH_THE_PUBLIC_PROMPT; ${historyDiagnostic}`);
  assert.deepEqual(producerForYear.resultKinds,['ANSWER','ANSWER'],`HISTORICAL_CALENDAR_MUST_PRODUCE_A_GROUNDED_KNOWLEDGE_ANSWER; ${historyDiagnostic}`);
  assert.equal(historyJob.last_error_code,null,`HISTORICAL_CALENDAR_FINALIZATION_MUST_KEEP_SELECTED_EVIDENCE; ${historyDiagnostic}`);
  const historicalCitations=oldAnswer.metadata?.citations;
  assert(Array.isArray(historicalCitations)&&historicalCitations.length===1,`HISTORICAL_CALENDAR_ANSWER_MUST_HAVE_ONE_CANONICAL_CITATION; ${historyDiagnostic}`);
  assert.equal(historicalCitations[0].documentId,oldReady.documentId);assert.equal(historicalCitations[0].academicYear,2568);
  assert.match(oldAnswer.content,/2 มิถุนายน/u);assert((await deliverAll(f))>=1);
  assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${history.jobId}`])).rows[0].status,'SENT');
  assert.equal((await f.pool.query('select count(*)::int n from public.tickets where line_session_id=$1',[f.session])).rows[0].n,0);
 }finally{await f.cleanup();}
});
