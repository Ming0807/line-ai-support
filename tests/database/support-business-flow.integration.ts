import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {transaction} from '../../lib/database/pool';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import type {SemanticClassifier} from '../../lib/conversation/semantic-routing-contracts';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {runAICycle} from '../../lib/ai/run-worker';
import {createSupportProducer} from '../../lib/ai/support-producer';
import type {GenerateInput} from '../../lib/ai/gateway';
import type {KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import type {EmbedInput,EmbedResult} from '../../lib/ai/embedding-gateway';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
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
 const owner=randomUUID(),appName=`support-flow-${owner}`,pool=new Pool({...databaseOptions,max:8,application_name:appName});
 const familyCode=`WIFI_${owner.replaceAll('-','').slice(0,20).toUpperCase()}`;
 const sessionIds:string[]=[],inboxIds:string[]=[],jobIds:string[]=[],staffIds:string[]=[];
 let documentId:string|undefined;
 const actor=randomUUID(),staff=randomUUID(),staffLineId=`U${randomUUID().replaceAll('-','')}`;
 const studentLineId=`U${randomUUID().replaceAll('-','')}`;
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  countPassageTokens:async texts=>{await assertOutsideSql();return texts.map(()=>40);},
  embedPassages:async texts=>{await assertOutsideSql();return texts.map(()=>unitVector);},
  embedQuery:async()=>{throw new Error('QUERY_MUST_USE_CONTROLLED_KNOWLEDGE_PRODUCER');},
  healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const importOptions={pool,key,originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
 async function assertOutsideSql(){
  const {rows:[row]}=await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[appName]);
  assert.equal(row.n,0,'PROVIDER_OR_LINE_HTTP_MUST_RUN_OUTSIDE_SQL');
 }
 async function cleanup(){
  try{
   if(sessionIds.length){
    await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[inboxIds]);
    await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[sessionIds]);
    await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where (line_session_id=any($1::uuid[]) or ticket_id in(select id from public.tickets where line_session_id=any($1::uuid[]))) and status in ('PENDING','PROCESSING')",[sessionIds]);
   }
   if(staffIds.length)await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])', [staffIds]);
  }finally{await pool.end();}
 }
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']] as const){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Support flow fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  staffIds.push(staff);
  await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [staff,hashStaffLineUserId(staffLineId,key),encryptValue(staffLineId,key)]);

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
  return {pool,appName,familyCode,documentId,chunkId:guide.id,session,studentLineId,
   staff,sessionIds,inboxIds,jobIds,staffIds,assertOutsideSql,cleanup};
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

async function inbound(f:Flow,text:string){
 const eventId=randomUUID(),lineMessageId=randomUUID();
 const event={type:'message' as const,source:{type:'user' as const,userId:f.studentLineId},replyToken:`reply-${eventId}`,
  message:{type:'text' as const,id:lineMessageId,text}};
 const inboxJob=(await f.pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts) values('STUDENT',$1,$2,$3,'MESSAGE','PROCESSING',$4,clock_timestamp()+interval '60 seconds',1) returning *",
  [eventId,hashLineUserId(f.studentLineId,key),encryptValue(JSON.stringify(event),key),randomUUID()])).rows[0] as InboxJob;f.inboxIds.push(inboxJob.id);
 let classifierCalls=0;
 const classify:SemanticClassifier=async input=>{
  await f.assertOutsideSql();classifierCalls++;
  assert.equal(input.question,text);
  assert.deepEqual(input.contexts.map(context=>context.code),['C1'],'CONTROLLED_CLASSIFIER_MUST_RECEIVE_REAL_SERVER_CONTEXT');
  assert.equal(input.contexts[0].mode,'AI');
  assert(input.contexts[0].previousUserMessages.includes('Wi-Fi ต่อไม่ได้'),'CLASSIFIER_MUST_RECEIVE_PRIOR_USER_CONTEXT');
  return {decision:'CONTINUE',candidateCode:'C1',confidence:.99};
 };
 const advice=await classifyStudentInboxContext(f.pool,inboxJob,key,classify);
 if(text==='Wi-Fi ต่อไม่ได้')assert.equal(advice,null,'FIRST_MESSAGE_HAS_NO_CONTEXT_TO_CLASSIFY');
 else assert(advice,'FOLLOW_UP_REQUIRES_PRODUCTION_SEMANTIC_ROUTING_ADVICE');
 if(text==='Wi-Fi ต่อไม่ได้')assert.equal(classifierCalls,0);
 else assert.equal(classifierCalls,1);
 await transaction(client=>processInboxEvent(client,inboxJob,key,{aiEnabled:true,routingAdvice:advice??undefined}),f.pool);
 const message=(await f.pool.query("select id,conversation_id from public.messages where line_message_id=$1 and sender_type='USER'",[lineMessageId])).rows[0];
 assert(message,'ACTUAL_USER_MESSAGE_MUST_BE_STORED');
 const job=(await f.pool.query('select id from private.ai_jobs where message_id=$1',[message.id])).rows[0];assert(job,'CANONICAL_AI_JOB_MUST_BE_CREATED');
 f.jobIds.push(job.id);return {messageId:message.id,conversationId:message.conversation_id,jobId:job.id};
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

for(const branch of ['SOLVED','ESCALATE'] as const)test(`controlled Wi-Fi troubleshooting flow consumes owned ${branch} action against a reviewed public guide`,async()=>{
 const f=await createFlow();try{
  const capture:{bodies:unknown[]}={bodies:[]};
  const first=await inbound(f,'Wi-Fi ต่อไม่ได้');
  const initial=await runAICycle(f.pool,key,{supportEnabled:true,produce:producer(f,'CLARIFY').produce});assert.equal(initial.completed,1);
  const firstOut=(await f.pool.query('select payload_encrypted,status from private.message_outbox where idempotency_key=$1',[
   `ai-job:${first.jobId}`])).rows[0];assert.equal(firstOut.status,'PENDING');
  await runOutboxCycle(f.pool,key,{accessTokens:{STUDENT:'controlled-student-token',STAFF:'controlled-staff-token'},fetchImpl:async(_url,init)=>{
   await f.assertOutsideSql();capture.bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status:200});
  }});
  const clarification=JSON.parse(decryptValue(firstOut.payload_encrypted,key)).messages[0].text;
  assert.match(clarification,/อุปกรณ์|ระบบปฏิบัติการ/u,'FIRST RESPONSE MUST_USE_FIXED_DEVICE_CLARIFICATION');
  assert.equal((await f.pool.query("select status from private.message_outbox where idempotency_key=$1",[`ai-job:${first.jobId}`])).rows[0].status,'SENT');

  const followup=await inbound(f,'ใช้ Android แล้วขึ้นข้อความ ไม่สามารถเชื่อมต่อ Wi-Fi ได้');assert.equal(followup.conversationId,first.conversationId);
  const delivered=await runAndDeliver(f,'GUIDANCE',capture);
  assert(delivered.model.taskCalls.includes('SUPPORT_INTENT'));assert(delivered.model.taskCalls.includes('KNOWLEDGE_SCOPE'));
  assert(delivered.model.taskCalls.includes('KNOWLEDGE_ANSWER'));
  assert.equal(delivered.model.taskCalls.includes('KNOWLEDGE_METHOD'),false,'RAG_ONLY_PRODUCER_DOES_NOT_NEED_STRUCTURED_SELECTOR');
  const answer=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI' and metadata->>'ai_job_id'=$2",[followup.conversationId,followup.jobId])).rows[0];
  assert.match(answer.content,/YRU-Student/u);assert.equal(answer.metadata.citations.length,1);
  assert.equal(answer.metadata.citations[0].documentId,f.documentId,'CITATION_MUST_REFERENCE_APPROVED_CANONICAL_DOCUMENT');

  let escalation=delivered;
  if(branch==='ESCALATE'){
   const unresolved=await inbound(f,'ยังแก้ไม่ได้ครับ');assert.equal(unresolved.conversationId,followup.conversationId);
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
