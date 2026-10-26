import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {createStaffCopilotAssistance,createCopilotAdmission} from '../../lib/staff/staff-copilot';
import {createStaffKnowledgeAssistance} from '../../lib/staff/knowledge-assistance';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {AIResult} from '../../lib/ai/jobs';
import type {KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import type {runHermesStaffRuntime} from '../../lib/ai/hermes-staff-runtime';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'staff-copilot-owned-qa'});
const priorGate=process.env.YRU_AI_ENABLED;process.env.YRU_AI_ENABLED='true';
after(async()=>{await pool.end();if(priorGate===undefined)delete process.env.YRU_AI_ENABLED;else process.env.YRU_AI_ENABLED=priorGate;});
async function fixture(){
 const staff=randomUUID(),other=randomUUID(),department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id;
 await pool.query('insert into auth.users(id) values($1),($2)',[staff,other]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$3,'STAFF','Owned staff'),($2,$3,'STAFF','Other staff')",[staff,other,department]);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['COPILOT_'+randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,assigned_staff_id) values($1,$2,$3,'Summary is not the question','IT_NETWORK','HUMAN','STAFF_HANDLING',$4) returning id",[session,conversation,department,staff])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','คำถามจริงที่ใช้ร่างคำตอบ')",[conversation,ticket]);
 return {staff,other,session,conversation,ticket};
}
async function evidence(){
 const code='COPILOT_'+randomUUID().replaceAll('-','').toUpperCase(),vector=[1,...Array<number>(383).fill(0)];
 const family=(await pool.query("insert into public.document_families(code,name,category) values($1,'Owned source','GUIDE') returning id",[code])).rows[0].id;
 const doc=(await pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,checksum)
  values($1,'Owned reviewed source','2569','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
 await pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,content,embedding,embedding_dimensions,embedding_fingerprint) values($1,0,2,'หลักฐาน fixture ที่ผ่านการอนุมัติ',$2::extensions.vector,384,$3)`,[doc,JSON.stringify(vector),LOCAL_EMBEDDING_FINGERPRINT]);
 const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[code],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 const c=await pool.connect();let rows;try{await c.query('begin');rows=await searchKnowledge(c,{scope,vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,limit:12});await c.query('commit');}finally{c.release();}
 assert.equal(rows.length,1);
 const answer:AIResult={kind:'ANSWER',scope,queryVector:vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,evidence:rows,output:{answer:'คำตอบจากหลักฐานที่อนุมัติแล้ว',citationChunkIds:[rows[0].chunkId]}};
 return {doc,answer};
}
const generate:KnowledgeProducerOptions['generate']=async()=>{throw new Error('NO_REAL_GENERATION_ALLOWED');};
function config(answer:AIResult,runAgent:typeof runHermesStaffRuntime){
 return {pool,key:'controlled-test-only',generate,runAgent,admission:createCopilotAdmission(),
  assist:(...args:Parameters<typeof createStaffKnowledgeAssistance>)=>createStaffKnowledgeAssistance(args[0],args[1],args[2],{...args[3],produce:async()=>answer})};
}
async function counts(ticket:string){
 return (await pool.query(`select t.revision,(select count(*)::int from public.messages where ticket_id=t.id) messages,
  (select count(*)::int from private.message_outbox where ticket_id=t.id) outbox,
  (select count(*)::int from public.ticket_history where ticket_id=t.id) history from public.tickets t where id=$1`,[ticket])).rows[0];
}
test('a scoped unassigned staff member cannot bypass the disabled UI to start Hermes',async()=>{
 const f=await fixture(),e=await evidence();let started=0;
 await assert.rejects(createStaffCopilotAssistance(f.other,f.ticket,{revision:0},config(e.answer,async()=>{started++;return {draftText:'unused'};})),{code:'NOT_FOUND'});
 assert.equal(started,0);assert.equal((await counts(f.ticket)).outbox,0);
});
test('authorized native drafting uses real approved-source revalidation outside SQL and performs zero delivery/case writes',async()=>{
 const f=await fixture(),e=await evidence(),before=await counts(f.ticket);
 const result=await createStaffCopilotAssistance(f.staff,f.ticket,{revision:0},config(e.answer,async o=>{
  assert.equal(o.question,'คำถามจริงที่ใช้ร่างคำตอบ');
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='staff-copilot-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n,0);
  const lookup=await o.lookup('คำค้นที่ไม่เปลี่ยนคำถามผู้แจ้ง',o.signal);
  assert(JSON.stringify(lookup).includes('คำตอบจากหลักฐานที่อนุมัติแล้ว'));
  return {draftText:'ร่างฉบับเต็มที่เจ้าหน้าที่ต้องตรวจ'};
 }));
 assert.equal(result.status,'DRAFT');assert(result.draftText?.includes('Owned reviewed source'));
 assert.deepEqual(await counts(f.ticket),before);
});
test('ownership, actor, question, HUMAN mode and source changes during a draft all suppress stale results',async()=>{
 for(const change of ['owner','actor','question','mode','source'] as const){
  const f=await fixture(),e=await evidence();
  await assert.rejects(createStaffCopilotAssistance(f.staff,f.ticket,{revision:0},config(e.answer,async o=>{
   await o.lookup('คำค้น',o.signal);
   if(change==='owner')await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1',[f.ticket,f.other]);
   if(change==='actor')await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);
   if(change==='question')await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','คำถามเพิ่มหลังค้น')",[f.conversation,f.ticket]);
   if(change==='mode')await pool.query("update public.conversations set mode='AI' where id=$1",[f.conversation]);
   if(change==='source')await pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[e.doc]);
   return {draftText:'ต้องไม่เห็นร่างนี้'};
  })),{code:change==='actor'?'NOT_FOUND':'CONFLICT'});
  const after=await counts(f.ticket);assert.equal(after.outbox,0);assert.equal(after.history,0);assert.equal(after.revision,0);
 }
});
test('a scoped supervisor can draft for a managed case while WAITING_STAFF still requires acceptance first',async()=>{
 const f=await fixture(),e=await evidence();await pool.query("update public.staff_profiles set role='SUPERVISOR' where id=$1",[f.other]);
 const runner:typeof runHermesStaffRuntime=async o=>{await o.lookup('คำค้น',o.signal);return {draftText:'ร่างสำหรับหัวหน้างาน'};};
 assert.equal((await createStaffCopilotAssistance(f.other,f.ticket,{revision:0},config(e.answer,runner))).status,'DRAFT');
 await pool.query("update public.tickets set status='WAITING_STAFF',assigned_staff_id=null where id=$1",[f.ticket]);
 await assert.rejects(createStaffCopilotAssistance(f.other,f.ticket,{revision:0},config(e.answer,runner)),{code:'NOT_FOUND'});
});
