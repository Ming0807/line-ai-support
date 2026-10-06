import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {decryptValue,encryptValue,hashLineUserId} from '../../lib/security/identity';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {setTimeout as delay} from 'node:timers/promises';

async function fixture(){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4,
  application_name:'m6-controlled-ai-worker'}),key=randomBytes(32).toString('base64');
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 const user='U'+randomUUID().replaceAll('-','');
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content)
  values($1,'USER','TEXT','Controlled worker question') returning id`,[conversation])).rows[0].id;
 const job=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,replyToken:'private-token',receivedAt:new Date()},key),pool);
 async function cleanup(){
  await pool.query('delete from private.delivery_attempts where outbox_id in(select id from private.message_outbox where line_session_id=$1)',[session]);
  await pool.query('delete from private.message_outbox where line_session_id=$1',[session]);
  await pool.query('delete from private.ai_jobs where line_session_id=$1',[session]);
  await pool.query('delete from public.messages where conversation_id=$1',[conversation]);
  await pool.query('delete from public.conversations where id=$1',[conversation]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
 return {pool,key,session,conversation,message,job,cleanup};
}
test('AI worker commits before provider HTTP, stores result, finalizes once and suppresses a takeover race',async()=>{
 const f=await fixture();let calls=0;
 try{
  const stats=await runAICycle(f.pool,f.key,{produce:async snapshot=>{
   calls++;assert.equal(snapshot.question,'Controlled worker question');
   const open=(await f.pool.query(`select count(*)::int n from pg_stat_activity
    where application_name='m6-controlled-ai-worker' and pid<>pg_backend_pid() and xact_start is not null`)).rows[0].n;
   assert.equal(open,0,'no worker transaction spans provider HTTP');
   const other=await f.pool.connect();try{
    await other.query('begin');await other.query("set local lock_timeout='100ms'");
    await other.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`conversation:${f.conversation}`]);
    await other.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);
    await other.query('commit');
   }finally{await other.query('rollback');other.release();}
   return {kind:'CLARIFY',text:'Controlled obsolete AI response'};
  }});
  assert.equal(calls,1);assert.equal(stats.suppressed,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,0);
  assert.equal((await f.pool.query('select status from private.ai_jobs where id=$1',[f.job])).rows[0].status,'SUPPRESSED');
  assert.equal((await runAICycle(f.pool,f.key,{produce:async()=>{throw new Error('MUST_NOT_REPEAT');}})).claimed,0);
 }finally{await f.cleanup();}
});

test('a cited AI result is revalidated before LINE enqueue; supersession during HTTP yields a safe clarification',async()=>{
 const f=await fixture();let family='',document='';
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
  studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 const fingerprint='f'.repeat(64),vector=[1,0];
 try{
  family=(await f.pool.query(`insert into public.document_families(code,name,category) values($1,'Controlled citation','REGULATION') returning id`,
   ['FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase()])).rows[0].id;
  scope.familyCodes=[(await f.pool.query('select code from public.document_families where id=$1',[family])).rows[0].code];
  document=(await f.pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,
   approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,'Controlled YRU source','2569','controlled','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
   'https://fixture.yru.ac.th/controlled.pdf',$2) returning id`,[family,'a'.repeat(64)])).rows[0].id;
  await f.pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,12,'ข้อ 5','Controlled source evidence','[1,0]',2,$2)`,[document,fingerprint]);
  const producer=async()=>{
   const evidence=await transaction(c=>searchKnowledge(c,{scope,vector,fingerprint}),f.pool);
   return {kind:'ANSWER' as const,output:{answer:'คำตอบจากเอกสารที่ตรวจแล้ว',citationChunkIds:[evidence[0].chunkId]},scope,evidence,queryVector:vector,fingerprint};
  };
  const first=await runAICycle(f.pool,f.key,{produce:producer});assert.equal(first.completed,1);
  const payload=JSON.parse(decryptValue((await f.pool.query('select payload_encrypted from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].payload_encrypted,f.key));
  assert(payload.messages[0].text.includes('หน้า 12'));assert(payload.messages[0].text.includes('https://fixture.yru.ac.th/controlled.pdf'));
  const next=(await f.pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Second citation question') returning id`,[f.conversation])).rows[0].id;
  await transaction(c=>prepareAIJob(c,{sessionId:f.session,conversationId:f.conversation,messageId:next,receivedAt:new Date()},f.key),f.pool);
  const second=await runAICycle(f.pool,f.key,{produce:async()=>{
   const result=await producer();
   await f.pool.query("update public.documents set status='SUPERSEDED',is_current=false,revision=revision+1 where id=$1",[document]);return result;
  }});
  assert.equal(second.completed,1);
  const replies=(await f.pool.query('select payload_encrypted from private.message_outbox where conversation_id=$1 order by created_at,id',[f.conversation])).rows;
  const changed=JSON.parse(decryptValue(replies[1].payload_encrypted,f.key));
  assert(changed.messages[0].text.includes('เอกสารอ้างอิงเปลี่ยนแปลง'));assert(!changed.messages[0].text.includes('คำตอบจากเอกสารที่ตรวจแล้ว'));
  let sends=0;
  await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'controlled-fixture',STAFF:'controlled-fixture'},fetchImpl:async()=>{sends++;return new Response(null,{status:200});}});
  assert.equal(sends,0,'the earlier cited answer is suppressed if its source changes after finalization but before dispatch');
  assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${f.job}`])).rows[0].status,'SUPPRESSED');
  // A legacy source URL cannot turn a committed result into five silent finalization retries.
  await f.pool.query("update public.documents set status='ACTIVE',is_current=true,source_url='http://fixture.yru.ac.th/legacy.pdf',revision=revision+1 where id=$1",[document]);
  const legacy=(await f.pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Legacy source URL') returning id`,[f.conversation])).rows[0].id;
  await transaction(c=>prepareAIJob(c,{sessionId:f.session,conversationId:f.conversation,messageId:legacy,receivedAt:new Date()},f.key),f.pool);
  assert.equal((await runAICycle(f.pool,f.key,{produce:producer})).completed,1,'invalid citation metadata yields a bounded neutral reply');
 }finally{
  if(document)await f.pool.query('delete from public.knowledge_chunks where document_id=$1',[document]);
  if(document)await f.pool.query('delete from public.documents where id=$1',[document]);
  if(family)await f.pool.query('delete from public.document_families where id=$1',[family]);await f.cleanup();
 }
});

test('a committed generation result resumes finalization without paying for a second generation after rollback',async()=>{
 const f=await fixture();let calls=0;
 try{
  // Trigger affects this controlled job's outbox only and is removed in finally.
  await f.pool.query(`create function private.fixture_ai_finalize_failure() returns trigger language plpgsql as $$
   begin if new.idempotency_key='ai-job:${f.job}' then raise exception 'CONTROLLED_FINALIZE_ROLLBACK'; end if;return new;end $$`);
  await f.pool.query('create trigger fixture_ai_finalize_failure before insert on private.message_outbox for each row execute function private.fixture_ai_finalize_failure()');
  const produce=async()=>{calls++;return {kind:'CLARIFY' as const,text:'กรุณาระบุปีการศึกษาครับ'};};
  const first=await runAICycle(f.pool,f.key,{produce});assert.equal(first.failed,1);assert.equal(calls,1);
  const state=(await f.pool.query('select status,result_encrypted from private.ai_jobs where id=$1',[f.job])).rows[0];
  assert.equal(state.status,'PENDING');assert(state.result_encrypted);
  await f.pool.query('drop trigger fixture_ai_finalize_failure on private.message_outbox');
  await f.pool.query('drop function private.fixture_ai_finalize_failure()');
  await f.pool.query('update private.ai_jobs set available_at=clock_timestamp() where id=$1',[f.job]);
  const second=await runAICycle(f.pool,f.key,{produce});assert.equal(second.completed,1);assert.equal(calls,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,1);
  assert.equal((await f.pool.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversation])).rows[0].n,1);
 }finally{
  await f.pool.query('drop trigger if exists fixture_ai_finalize_failure on private.message_outbox');
  await f.pool.query('drop function if exists private.fixture_ai_finalize_failure()');await f.cleanup();
 }
});

test('historical ambiguity at dispatch suppresses the stale answer without delivery retries',async()=>{
 const f=await fixture();let family='';const documents:string[]=[];
 const fingerprint='b'.repeat(64),vector=[1,0];
 const scope:KnowledgeScope={historical:true,academicYear:2567,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
  studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 try{
  const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();scope.familyCodes=[code];
  family=(await f.pool.query("insert into public.document_families(code,name,category) values($1,'Historical fixture','REGULATION') returning id",[code])).rows[0].id;
  const addVersion=async(date:string)=>{
   const id=(await f.pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,status,is_current,
    approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
    values($1,'Historical official source','2567','history',2567,'SUPERSEDED',false,'APPROVED',clock_timestamp(),true,true,false,$2,
    'https://fixture.yru.ac.th/history.pdf',$3) returning id`,[family,date,randomBytes(32).toString('hex')])).rows[0].id;
   documents.push(id);
   await f.pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
    values($1,0,'Historical evidence','[1,0]',2,$2)`,[id,fingerprint]);
  };
  await addVersion('2024-01-01');
  const producer=async()=>{
   const evidence=await transaction(c=>searchKnowledge(c,{scope,vector,fingerprint}),f.pool);
   return {kind:'ANSWER' as const,output:{answer:'คำตอบย้อนหลังจากเอกสาร',citationChunkIds:[evidence[0].chunkId]},scope,evidence,queryVector:vector,fingerprint};
  };
  const captured=await producer();
  assert.equal((await runAICycle(f.pool,f.key,{produce:producer})).completed,1);
  await addVersion('2024-06-01');
  let sends=0;
  const dispatched=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fixture',STAFF:'fixture'},fetchImpl:async()=>{sends++;return new Response(null,{status:200});}});
  assert.equal(sends,0);
  assert.equal(dispatched.failed,0,'semantic invalidation is suppressed, not retried');
  assert.equal((await f.pool.query('select status,last_error_code from private.message_outbox where idempotency_key=$1',[`ai-job:${f.job}`])).rows[0].status,'SUPPRESSED');
  const next=(await f.pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Historical follow-up') returning id",[f.conversation])).rows[0].id;
  const nextJob=await transaction(c=>prepareAIJob(c,{sessionId:f.session,conversationId:f.conversation,messageId:next,receivedAt:new Date()},f.key),f.pool);
  assert.equal((await runAICycle(f.pool,f.key,{produce:async()=>captured})).completed,1,'saved historical output invalidated before finalization becomes a bounded clarification');
  const neutral=(await f.pool.query('select payload_encrypted from private.message_outbox where idempotency_key=$1',[`ai-job:${nextJob}`])).rows[0];
  assert(JSON.parse(decryptValue(neutral.payload_encrypted,f.key)).messages[0].text.includes('เอกสารอ้างอิงเปลี่ยนแปลง'));
 }finally{
  if(documents.length)await f.pool.query('delete from public.knowledge_chunks where document_id=any($1::uuid[])',[documents]);
  if(documents.length)await f.pool.query('delete from public.documents where id=any($1::uuid[])',[documents]);
  if(family)await f.pool.query('delete from public.document_families where id=$1',[family]);await f.cleanup();
 }
});

test('assistant history contains delivered answers and excludes pending or suppressed answers',async()=>{
 const f=await fixture();
 const addQuestion=async(text:string)=>{
  const message=(await f.pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT',$2) returning id",[f.conversation,text])).rows[0].id;
  return transaction(c=>prepareAIJob(c,{sessionId:f.session,conversationId:f.conversation,messageId:message,receivedAt:new Date()},f.key),f.pool);
 };
 try{
  assert.equal((await runAICycle(f.pool,f.key,{produce:async()=>({kind:'CLARIFY',text:'Controlled answer A'})})).completed,1);
  const second=await addQuestion('Second question');
  let sawPending=false;
  assert.equal((await runAICycle(f.pool,f.key,{produce:async snapshot=>{
   sawPending=snapshot.history.some(item=>item.role==='assistant'&&item.content==='Controlled answer A');
   return {kind:'CLARIFY',text:'Controlled answer B'};
  }})).completed,1);
  assert.equal(sawPending,false,'pending answer is not user-visible history');
  assert.equal((await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fixture',STAFF:'fixture'},fetchImpl:async()=>new Response(null,{status:200})})).sent,1);
  await f.pool.query("update private.message_outbox set status='SUPPRESSED',last_error_code='EVIDENCE_CHANGED',completed_at=clock_timestamp() where idempotency_key=$1",[`ai-job:${second}`]);
  await addQuestion('Third question');
  assert.equal((await runAICycle(f.pool,f.key,{produce:async snapshot=>{
   assert(snapshot.history.some(item=>item.role==='assistant'&&item.content==='Controlled answer A'),'accepted LINE answer remains history');
   assert(!snapshot.history.some(item=>item.role==='assistant'&&item.content==='Controlled answer B'),'suppressed answer is excluded');
   return {kind:'CLARIFY',text:'Controlled answer C'};
  }})).completed,1);
 }finally{await f.cleanup();}
});

test('publication in a cited family waits for LINE dispatch without an open worker transaction',async()=>{
 const f=await fixture();let family='',document='';const publisher=await f.pool.connect();
 const fingerprint='d'.repeat(64),vector=[1,0];
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
  studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 let pendingPublication:Promise<unknown>|undefined;
 try{
  const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();scope.familyCodes=[code];
  family=(await f.pool.query("insert into public.document_families(code,name,category) values($1,'Publication fixture','REGULATION') returning id",[code])).rows[0].id;
  document=(await f.pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,
   approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,'Publication source','2569','publish','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
   'https://fixture.yru.ac.th/publish.pdf',$2) returning id`,[family,randomBytes(32).toString('hex')])).rows[0].id;
  await f.pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,'Reviewed publication evidence','[1,0]',2,$2)`,[document,fingerprint]);
  await runAICycle(f.pool,f.key,{produce:async()=>{
   const evidence=await transaction(c=>searchKnowledge(c,{scope,vector,fingerprint}),f.pool);
   return {kind:'ANSWER',output:{answer:'คำตอบที่ยืนยันแล้ว',citationChunkIds:[evidence[0].chunkId]},scope,evidence,queryVector:vector,fingerprint};
  }});
  const publisherPid=(await publisher.query('select pg_backend_pid() pid')).rows[0].pid;
  let sawPublicationWaiting=false,sawOpenWorkerTransaction=false;
  const result=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fixture',STAFF:'fixture'},fetchImpl:async()=>{
   await publisher.query('begin');
   pendingPublication=publisher.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`knowledge-family:${family}`]);
   const deadline=Date.now()+1000;
   while(Date.now()<deadline){
    sawPublicationWaiting=(await f.pool.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",[publisherPid])).rows[0].waiting;
    if(sawPublicationWaiting)break;await delay(10);
   }
   sawOpenWorkerTransaction=(await f.pool.query(`select exists(select 1 from pg_stat_activity where application_name='m6-controlled-ai-worker'
    and pid not in(pg_backend_pid(),$1) and xact_start is not null) open`,[publisherPid])).rows[0].open;
   return new Response(null,{status:200});
  }});
  assert.equal(result.sent,1);assert.equal(sawOpenWorkerTransaction,false);
  assert.equal(sawPublicationWaiting,true,'the family publication cannot invalidate eligibility during LINE HTTP');
  await pendingPublication;await publisher.query('update public.documents set revision=revision+1 where id=$1',[document]);await publisher.query('commit');
 }finally{
  await pendingPublication?.catch(()=>undefined);await publisher.query('rollback');publisher.release();
  if(document)await f.pool.query('delete from public.knowledge_chunks where document_id=$1',[document]);
  if(document)await f.pool.query('delete from public.documents where id=$1',[document]);
  if(family)await f.pool.query('delete from public.document_families where id=$1',[family]);await f.cleanup();
 }
});

for(const stage of ['GENERATION','DISPATCH'] as const)for(const change of ['EPOCH','UNCITED_AMENDMENT','LEGACY','DATE'] as const)
test(`${stage} rejects ${change} rule-context drift while the cited base chunk stays intact`,async()=>{
 const f=await fixture();const documents:string[]=[];let family='';
 const fingerprint='d'.repeat(64),vector=[1,0];
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 try{
  const code='RULE_'+randomUUID().replaceAll('-','').toUpperCase();scope.familyCodes=[code];
  family=(await f.pool.query("insert into public.document_families(code,name,category) values($1,'Controlled stale rule','REGULATION') returning id",[code])).rows[0].id;
  async function document(current:boolean){
   const id=(await f.pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
    values($1,'Controlled rule source','v1','main','ACTIVE',$2,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01','https://fixture.yru.ac.th/rules.pdf',$3) returning id`,[family,current,randomBytes(32).toString('hex')])).rows[0].id;
   documents.push(id);await f.pool.query("insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint) values($1,0,'Unchanged controlled passage','[1,0]',2,$2)",[id,fingerprint]);return id as string;
  }
  const base=await document(true);const amendment=change==='UNCITED_AMENDMENT'?await document(false):null;
  if(amendment)await f.pool.query("insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,'AMENDS')",[amendment,base]);
  const mutate=async()=>{
   if(change==='EPOCH')await f.pool.query('update public.document_families set rule_revision=rule_revision+1 where id=$1',[family]);
   if(change==='UNCITED_AMENDMENT')await f.pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[amendment]);
  };
  await runAICycle(f.pool,f.key,{produce:async()=>{
   let evidence=await transaction(c=>searchKnowledge(c,{scope,vector,fingerprint,limit:12}),f.pool);
   const cited=evidence.find(e=>e.documentId===base)!;
   if(change==='LEGACY'&&stage==='GENERATION')evidence=evidence.map(row=>{const copy={...row};delete copy.ruleProof;return copy;});
   if(change==='DATE'&&stage==='GENERATION')evidence=evidence.map(row=>({...row,ruleProof:{...row.ruleProof!,evaluationDate:'2026-01-01'}}));
   if(stage==='GENERATION')await mutate();
   return {kind:'ANSWER',output:{answer:'STALE_RULE_MUST_NOT_DELIVER',citationChunkIds:[cited.chunkId]},scope,evidence,queryVector:vector,fingerprint};
  }});
  if(stage==='DISPATCH'){
   await mutate();
   if(change==='DATE'||change==='LEGACY'){
    // Old encrypted records stay parseable; they must not acquire current proof implicitly.
    const job=(await f.pool.query('select result_encrypted from private.ai_jobs where id=$1',[f.job])).rows[0];
    const result=JSON.parse(decryptValue(job.result_encrypted,f.key));
    result.evidence=result.evidence.map((row:Record<string,unknown>)=>{
     if(change==='LEGACY'){delete row.ruleProof;return row;}
     return {...row,ruleProof:{...(row.ruleProof as Record<string,unknown>),evaluationDate:'2026-01-01'}};
    });
    await f.pool.query('update private.ai_jobs set result_encrypted=$2 where id=$1',[f.job,encryptValue(JSON.stringify(result),f.key)]);
   }
  }
  let sends=0,staleSends=0;
  const stats=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fixture',STAFF:'fixture'},fetchImpl:async(_url,init)=>{sends++;if(String(init?.body).includes('STALE_RULE_MUST_NOT_DELIVER'))staleSends++;return new Response(null,{status:200});}});
  assert.equal(staleSends,0);assert.equal(stats.failed,0);
  assert.equal((await f.pool.query('select revision,status,is_current from public.documents where id=$1',[base])).rows[0].revision,0);
  if(stage==='GENERATION'){
   const message=(await f.pool.query("select content,metadata from public.messages where conversation_id=$1 and sender_type='AI'",[f.conversation])).rows[0];
   assert(message.content.includes('เอกสารอ้างอิงเปลี่ยนแปลง'));assert.deepEqual(message.metadata.citations,[]);
  }else{
   assert.equal(sends,0);assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${f.job}`])).rows[0].status,'SUPPRESSED');
  }
 }finally{
  await f.pool.query('delete from public.document_relationships where source_document_id=any($1::uuid[])',[documents]);
  await f.pool.query('delete from public.knowledge_chunks where document_id=any($1::uuid[])',[documents]);
  await f.pool.query('delete from public.documents where id=any($1::uuid[])',[documents]);
  if(family)await f.pool.query('delete from public.document_families where id=$1',[family]);await f.cleanup();
 }
});
