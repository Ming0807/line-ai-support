import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {createStudentWebFallback,createStaffWebFallback} from '../../lib/knowledge/owned-web-fallback';
import {readAIKnowledgeSnapshot} from '../../lib/ai/knowledge-snapshot';
import {prepareAIJob,claimAIJob,lockedAIJob} from '../../lib/ai/jobs';
import {decodeAIResult} from '../../lib/ai/jobs';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {loadSupportActionState} from '../../lib/ai/support-state';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {searchStructured} from '../../lib/knowledge/structured-search';
import {knowledgeStructuredCatalogLock} from '../../lib/knowledge/delivery-fence';
import {createStaffKnowledgeAssistance} from '../../lib/staff/knowledge-assistance';
import {lockConversation} from '../../lib/tickets/authorization';
import {withStaffAssistanceSnapshot} from '../../lib/staff/ai-assistance-snapshot';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import type {TavilySearchAdapter} from '../../lib/knowledge/tavily-search';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const app='owned-web-'+randomUUID(),pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:6,application_name:app});
const key=Buffer.alloc(32,104).toString('base64'),question='ขอบริการห้องสมุด',sessions:string[]=[],staffIds:string[]=[];
after(async()=>{
 try{
 if(sessions.length){await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[sessions]);
  await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[sessions]);}
 if(staffIds.length)await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])',[staffIds]);
 }finally{await pool.end();}
});
function input(){const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:['WEB_'+randomUUID().replaceAll('-','').toUpperCase()],departmentCode:null,
 audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 return {question,scope,structuredQuery:{version:1 as const,dataset:'university_services' as const,filters:{name:'ห้องสมุด'},limit:20},
  queryVector:[1,...Array<number>(383).fill(0)],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  proposal:{version:1,purpose:'YRU_INFORMATION',topic:'LIBRARY_SERVICES',academicYear:null,quote:'ห้องสมุด'}};
}
async function outsideSql(){assert.equal((await pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and pid<>pg_backend_pid() and xact_start is not null',[app])).rows[0].n,0,'NO_HTTP_INSIDE_SQL');}
function connector(){
 const apiKey='synthetic-owned-web-key',config={enabled:true,apiKey,attestation:{mode:'RESEARCHER_NO_PAYG',keySha256:createHash('sha256').update(apiKey).digest('hex'),attestedAt:new Date(Date.now()-1000).toISOString()}};
 const counts={usage:0,search:0};
 const adapter:TavilySearchAdapter={usage:async()=>{await outsideSql();counts.usage++;return {currentPlan:'Researcher',keyUsage:0,keyLimit:1000,planUsage:0,planLimit:1000,paygoUsage:0,paygoLimit:0};},
  search:async request=>{await outsideSql();counts.search++;assert.deepEqual(request,{version:1,purpose:'YRU_INFORMATION',topic:'LIBRARY_SERVICES',academicYear:null});
   return {requestId:randomUUID(),credits:1,results:[{title:'Library services',url:'https://www.yru.ac.th/library',content:'Do not retain this external snippet',score:.9}]};}};
 return {config,adapter,counts};
}
async function enqueueStudent(){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['WEB_'+randomUUID()])).rows[0].id;sessions.push(session);
 const lineId='U'+randomUUID().replaceAll('-','');await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(lineId,key),encryptValue(lineId,key)]);
 const conversation=(await pool.query("insert into public.conversations(line_session_id) values($1) returning id",[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT',$2) returning id",[conversation,question])).rows[0].id;
 const jobId=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);assert(jobId);
 const cleanup=()=>pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=$1 and status in ('PENDING','PROCESSING')",[jobId]);
 return {session,conversation,message,jobId,lineId,cleanup};
}
async function student(){
 const f=await enqueueStudent(),job=await claimAIJob(pool);assert(job&&job.id===f.jobId);
 const before=await transaction(async c=>{await lockConversation(c,f.conversation);await lockedAIJob(c,job);return readAIKnowledgeSnapshot(c,job,key);},pool);assert(before);
 return {...f,job,before};
}
async function staff(){
 const actor=randomUUID();staffIds.push(actor);await pool.query('insert into auth.users(id) values($1)',[actor]);
 const department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id;
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$2,'STAFF','Owned web fixture')",[actor,department]);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['WEB_STAFF_'+randomUUID()])).rows[0].id;sessions.push(session);
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,'Private summary','IT_SUPPORT','HUMAN','STAFF_HANDLING') returning id",[session,conversation,department])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT',$3)",[conversation,ticket,question]);
 const before=await withStaffAssistanceSnapshot(actor,ticket,0,pool,async(_c,current)=>current,{knowledgeCatalog:true});assert(before.knowledge);
 return {actor,session,conversation,ticket,before};
}

test('owned Student fallback rechecks actual source and lease outside HTTP, commits one attempt, strips snippets and fences replay',async()=>{
 const f=await student(),c=connector();try{
  const run=createStudentWebFallback(pool,key,f.before,c);assert(run);
  const result=await run(input(),new AbortController().signal);assert(result);assert.equal(result.kind,'WEB_LEADS');
  assert.equal(c.counts.usage,1);assert.equal(c.counts.search,1);
  assert(!JSON.stringify(result).includes('Do not retain'));assert(!JSON.stringify(result).includes(f.lineId));
  assert.equal(await run(input(),new AbortController().signal),null);assert.equal(c.counts.search,1);
 }finally{await f.cleanup();}
});
test('missing/wrong actual lease, HUMAN takeover and source-text changes grant no usage HTTP',async()=>{
 for(const change of ['missing','lease','human','message'] as const){const f=await student(),c=connector();try{
  if(change==='human')await pool.query("update public.conversations set mode='HUMAN' where id=$1",[f.conversation]);
  if(change==='message')await pool.query("update public.messages set content='คำถามใหม่' where id=$1",[f.message]);
  const source=change==='missing'?{...f.before,leaseToken:undefined}:change==='lease'?{...f.before,leaseToken:randomUUID()}:f.before;
  const run=createStudentWebFallback(pool,key,source,c);assert(run);
  assert.equal(await run(input(),new AbortController().signal),null);assert.deepEqual(c.counts,{usage:0,search:0});
 }finally{await f.cleanup();}}
});
test('a changed owner during usage is rejected before admission/search',async()=>{
 const f=await student(),c=connector(),usage=c.adapter.usage;try{
  c.adapter.usage=async(...args)=>{const value=await usage(...args);await pool.query('update public.conversations set revision=revision+1 where id=$1',[f.conversation]);return value;};
  const run=createStudentWebFallback(pool,key,f.before,c);assert(run);assert.equal(await run(input(),new AbortController().signal),null);
  assert.deepEqual(c.counts,{usage:1,search:0});
 }finally{await f.cleanup();}
});
test('a changed owner during search discards leads while retaining the consumed attempt',async()=>{
 const f=await student(),c=connector(),search=c.adapter.search;try{
  const before=(await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
  c.adapter.search=async(...args)=>{const value=await search(...args);await pool.query('update public.conversations set revision=revision+1 where id=$1',[f.conversation]);return value;};
  const run=createStudentWebFallback(pool,key,f.before,c);assert(run);assert.equal(await run(input(),new AbortController().signal),null);
  assert.deepEqual(c.counts,{usage:1,search:1});assert.equal((await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,before+1);
 }finally{await f.cleanup();}
});
test('private arbitrary context/proposal and malformed vector cannot authorize a search',async()=>{
 const f=await student(),c=connector();try{const run=createStudentWebFallback(pool,key,f.before,c);assert(run);
  for(const value of [{...input(),question:'คำถามส่วนตัวที่ไม่ได้ส่งจริง'}, {...input(),proposal:{...input().proposal,purpose:'GENERAL_PUBLIC'}},
   {...input(),queryVector:[1,0]},{...input(),structuredQuery:null}])assert.equal(await run(value,new AbortController().signal),null);
  assert.deepEqual(c.counts,{usage:0,search:0});
 }finally{await f.cleanup();}
});
test('explicitly disabled configuration returns no production callback',async()=>{
 const f=await student();try{assert.equal(createStudentWebFallback(pool,key,f.before,{config:{enabled:false}}),undefined);}finally{await f.cleanup();}
});
test('owned Staff HUMAN lookup shares quota, derives replay identity and never sends or mutates the ticket',async()=>{
 const f=await staff(),c=connector(),run=createStaffWebFallback(pool,key,f.actor,f.ticket,0,f.before,c);assert(run);
 const result=await run(input(),new AbortController().signal);assert(result&&result.kind==='WEB_LEADS');
 assert.equal(await run(input(),new AbortController().signal),null);assert.equal(c.counts.search,1);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[f.ticket])).rows[0].n,0);
 assert.deepEqual((await pool.query('select mode,revision from public.tickets where id=$1',[f.ticket])).rows,[{mode:'HUMAN',revision:0}]);
});
test('Staff role/scope revocation during usage prevents search',async()=>{
 const f=await staff(),c=connector(),usage=c.adapter.usage;
 c.adapter.usage=async(...args)=>{const value=await usage(...args);await pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);return value;};
 const run=createStaffWebFallback(pool,key,f.actor,f.ticket,0,f.before,c);assert(run);
 assert.equal(await run(input(),new AbortController().signal),null);assert.deepEqual(c.counts,{usage:1,search:0});
});

async function publishPublicSource(){
 return transaction(async c=>{
  const family=(await c.query("insert into public.document_families(code,name,category) values($1,'Synthetic independent public source','GUIDE') returning id",['WEB_SOURCE_'+randomUUID().replaceAll('-','').toUpperCase()])).rows[0].id;
  const department=(await c.query("select id from public.departments where active and code<>'IT' order by code limit 1")).rows[0]?.id;assert(department);
  const id=(await c.query(`insert into public.documents(document_family_id,department_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,
   official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,$2,'Synthetic independent public source','2569','DEFAULT','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
   'https://fixture.yru.ac.th/owned-web.pdf',$3) returning id`,[family,department,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
  await c.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,'Synthetic internal answer across families and departments',$2::extensions.vector,384,$3)`,[id,JSON.stringify(input().queryVector),LOCAL_EMBEDDING_FINGERPRINT]);
  return id;
 },pool);
}
const retireSource=(id:string)=>pool.query("update public.documents set status='ARCHIVED',is_current=false where id=$1",[id]);
test('arbitrary model family and case department cannot hide another eligible PUBLIC internal answer',async()=>{
 const f=await student(),c=connector(),id=await publishPublicSource();try{
  const run=createStudentWebFallback(pool,key,f.before,c);assert(run);
  assert.equal(await run({...input(),scope:{...input().scope,departmentCode:'IT'}},new AbortController().signal),null);
  assert.deepEqual(c.counts,{usage:0,search:0});
 }finally{await retireSource(id);await f.cleanup();}
});
test('a newly published eligible public source during search discards leads and retains the attempt',async()=>{
 const f=await student(),c=connector(),search=c.adapter.search;let id:string|undefined;
 try{
  const count=(await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
  c.adapter.search=async(...args)=>{const result=await search(...args);id=await publishPublicSource();return result;};
  const run=createStudentWebFallback(pool,key,f.before,c);assert(run);assert.equal(await run(input(),new AbortController().signal),null);
  assert.deepEqual(c.counts,{usage:1,search:1});assert.equal((await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,count+1);
 }finally{if(id)await retireSource(id);await f.cleanup();}
});

function producer(source:AISnapshot,c:ReturnType<typeof connector>,web=createStudentWebFallback(pool,key,source,c)){
 const value=input();
 return createKnowledgeProducer({
  generate:(async(call)=>{await outsideSql();return {output:call.taskType==='KNOWLEDGE_SCOPE'?value.scope:call.taskType==='KNOWLEDGE_METHOD'?{method:'STRUCTURED',query:value.structuredQuery}:value.proposal,
   toolCalls:[],providerId:randomUUID(),modelId:randomUUID(),fallbackUsed:false};}) as KnowledgeProducerOptions['generate'],
  embed:async()=>{await outsideSql();return {vectors:[value.queryVector],fingerprint:value.fingerprint,dimensions:384,providerId:randomUUID(),modelId:randomUUID(),fallbackUsed:false};},
  search:request=>transaction(c=>searchKnowledge(c,request),pool),
  structuredSearch:request=>transaction(async c=>{await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);return searchStructured(c,request,key);},pool),
  webFallback:web,
 });
}
async function runPending(f:Awaited<ReturnType<typeof enqueueStudent>>,c:ReturnType<typeof connector>,afterProduce?:(result:unknown)=>Promise<void>){
 const stats=await runAICycle(pool,key,{produce:async(source,signal)=>{assert.equal(source.jobId,f.jobId);const result=await producer(source,c)(source,signal);await afterProduce?.(result);return result;}});
 assert.deepEqual(stats,{claimed:1,completed:1,suppressed:0,failed:0});
 return (await pool.query('select * from private.ai_jobs where id=$1',[f.jobId])).rows[0];
}
function line(){const calls:string[]=[];const fetchImpl:typeof fetch=async(_url,options)=>{await outsideSql();calls.push(String(options?.body));return new Response('{}',{status:200,headers:{'x-line-request-id':randomUUID()}});};
 return {calls,fetchImpl};}
async function drain(f:Awaited<ReturnType<typeof enqueueStudent>>,l:ReturnType<typeof line>){
 const stats=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic-line',STAFF:'synthetic-line'},fetchImpl:l.fetchImpl});
 const row=(await pool.query('select status,last_error_code,payload_encrypted from private.message_outbox where idempotency_key=$1',['ai-job:'+f.jobId])).rows[0];assert(row);return {stats,row};
}
test('production producer, worker and LINE outbox deliver canonical unverified links with private encrypted proof',async()=>{
 const f=await enqueueStudent(),c=connector(),l=line();try{
  const saved=await runPending(f,c),result=decodeAIResult(saved,key);assert(result&&result.kind==='WEB_LEADS');
  assert(!saved.result_encrypted.includes('Library services'));assert(!saved.result_encrypted.includes('signature'));
  const publicMessage=(await pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversation])).rows[0];
  assert.equal(publicMessage.metadata.citations[0].verification,'NOT_VERIFIED');assert(!JSON.stringify(publicMessage).includes('queryVector'));
  const sent=await drain(f,l);assert.equal(sent.stats.sent,1);assert.equal(sent.row.status,'SENT');assert.equal(l.calls.length,1);
  const body=JSON.parse(l.calls[0]);assert.equal(body.to,f.lineId);assert.equal(body.messages.length,2);assert(body.messages[0].text.includes('ยังไม่ได้ยืนยัน'));
  assert.equal(body.messages[1].text,'[1] Library services\nhttps://www.yru.ac.th/library');assert(!l.calls[0].includes('Do not retain'));
 }finally{await f.cleanup();}
});
test('late internal publication between search and finalization yields only a fixed limitation',async()=>{
 const f=await enqueueStudent(),c=connector(),l=line();let id:string|undefined;
 try{
  const saved=await runPending(f,c,async result=>{assert.equal((result as {kind:string}).kind,'WEB_LEADS');id=await publishPublicSource();});
  assert.equal(saved.last_error_code,'EVIDENCE_CHANGED');const sent=await drain(f,l);assert.equal(sent.row.status,'SENT');
  assert.equal(l.calls.length,1);assert(!l.calls[0].includes('https://www.yru.ac.th/library'));assert(l.calls[0].includes('เอกสารอ้างอิงเปลี่ยนแปลง'));
 }finally{if(id)await retireSource(id);await f.cleanup();}
});
for(const change of ['publication','question','expiry','key'] as const)test(`actual dispatch suppresses ${change} changes before any LINE HTTP`,async()=>{
 const f=await enqueueStudent(),c=connector(),l=line();let id:string|undefined;
 try{
  const saved=await runPending(f,c);
  if(change==='publication')id=await publishPublicSource();
  if(change==='question')await pool.query("update public.messages set content='คำถามเปลี่ยนแล้ว' where id=$1",[f.message]);
  if(change==='expiry'||change==='key'){
   const result=decodeAIResult(saved,key);assert(result&&result.kind==='WEB_LEADS');
   const changed=change==='key'?{...result,internalMiss:{...result.internalMiss,signature:'0'.repeat(64)}}:
    {...result,observedAt:new Date(Date.now()-301000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString()};
   await pool.query('update private.ai_jobs set result_encrypted=$2 where id=$1',[f.jobId,encryptValue(JSON.stringify(changed),key)]);
  }
  const sent=await drain(f,l);assert.equal(sent.row.status,'SUPPRESSED');assert.equal(sent.row.last_error_code,'EVIDENCE_CHANGED');assert.equal(l.calls.length,0);
 }finally{if(id)await retireSource(id);await f.cleanup();}
});
test('actual Staff service projects unverified links and preserves explicit HUMAN sending',async()=>{
 const f=await staff(),c=connector();
 const advice=await createStaffKnowledgeAssistance(f.actor,f.ticket,{revision:0},{pool,key,produce:async(source,signal)=>
  producer(source,c,createStaffWebFallback(pool,key,f.actor,f.ticket,0,f.before,c))(source,signal)});
 assert.equal(advice.status,'WEB_LEADS');assert(advice.draftText?.includes('https://www.yru.ac.th/library'));
 assert(!JSON.stringify(advice).includes('signature'));assert.equal(c.counts.search,1);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[f.ticket])).rows[0].n,0);
 assert.deepEqual((await pool.query('select mode,revision from public.tickets where id=$1',[f.ticket])).rows,[{mode:'HUMAN',revision:0}]);
});
test('Staff final projection refuses source publication after the successful owned search',async()=>{
 const f=await staff(),c=connector();let id:string|undefined;
 try{
  await assert.rejects(createStaffKnowledgeAssistance(f.actor,f.ticket,{revision:0},{pool,key,produce:async(source,signal)=>{
   const result=await producer(source,c,createStaffWebFallback(pool,key,f.actor,f.ticket,0,f.before,c))(source,signal);
   assert.equal(result.kind,'WEB_LEADS');id=await publishPublicSource();return result;
  }}),{code:'CONFLICT'});
 }finally{if(id)await retireSource(id);}
});
test('combined actual USER support context keeps the original receipt and unverified leads never authorize solved confirmation',async()=>{
 const f=await enqueueStudent(),c=connector(),l=line(),prior='บริการห้องสมุดเข้าไม่ได้';
 try{
  await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,created_at) values($1,'USER','TEXT',$2,clock_timestamp()-interval '1 minute')",[f.conversation,prior]);
  const stats=await runAICycle(pool,key,{supportEnabled:true,produce:async(source,signal)=>{
   assert(source.support);assert(source.support.input.sources.some(s=>s.code==='U1'&&s.text===prior));
   const result=await producer(source,c)({...source,question:prior+'\n'+source.question},signal);assert.equal(result.kind,'WEB_LEADS');
   return {...result,support:{version:1,sourceDigest:source.support.sourceDigest,directoryDigest:source.support.directoryDigest,minimumSensitivity:source.support.minimumSensitivity,
    deliveredGuidance:false,proposal:{intent:'TROUBLESHOOT',category:'LIBRARY',subcategory:'SERVICE',needsTicket:false,department:'LIBRARY',urgency:'medium',confidence:.95,
     needsKnowledgeSearch:true,needsStructuredSearch:true,needsWebSearch:true,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U1',quote:prior}]}}};
  }});
  assert.deepEqual(stats,{claimed:1,completed:1,suppressed:0,failed:0});
  assert.equal((await pool.query('select guidance_outbox_id from private.ai_support_state where conversation_id=$1',[f.conversation])).rows[0].guidance_outbox_id,null);
  assert.equal((await drain(f,l)).row.status,'SENT');
  const action=await transaction(c=>loadSupportActionState(c,f.session,f.conversation,key),pool);assert(action);assert.equal(action.canConfirmSolved,false);assert.equal(action.snapshot.input.deliveredGuidance,false);
  const body=JSON.parse(l.calls[0]);assert(body.messages[0].text.includes('ยังไม่ได้ยืนยัน'));assert(!JSON.stringify(body.messages).includes('แก้ได้แล้ว'));
 }finally{await f.cleanup();}
});
