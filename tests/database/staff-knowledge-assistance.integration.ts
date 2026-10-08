import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {createStaffKnowledgeAssistance} from '../../lib/staff/knowledge-assistance';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {AIResult} from '../../lib/ai/jobs';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database));
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'staff-knowledge-owned-qa'});after(()=>pool.end());
async function fixture(question=true){
 const staff=randomUUID(),department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id;
 await pool.query('insert into auth.users(id) values($1)',[staff]);await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$2,'STAFF','Private staff')",[staff,department]);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['KNOWLEDGE_PRIVATE_'+randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,'Summary is not user scope 2567','IT_NETWORK','HUMAN','STAFF_HANDLING') returning id",[session,conversation,department])).rows[0].id;
 if(question)await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,sender_staff_id) values($1,$2,'USER','TEXT','Wi-Fi เชื่อมต่อไม่ได้',null),($1,$2,'STAFF','TEXT','Do not infer cohort 2567',$3)",[conversation,ticket,staff]);
 return {staff,session,conversation,ticket};
}
test('no actual USER question means no provider and no invented search result',async()=>{
 const f=await fixture(false);let calls=0;
 assert.deepEqual(await createStaffKnowledgeAssistance(f.staff,f.ticket,{revision:0},{pool,produce:async()=>{calls++;return {kind:'CLARIFY',text:'test'};}}),{revision:0,status:'NO_USER_QUESTION',answer:null,draftText:null,sources:[]});assert.equal(calls,0);
});
test('pure knowledge production runs outside SQL with actual USER context, never staff/AI inferred scope or a send',async()=>{
 const f=await fixture();const view=await createStaffKnowledgeAssistance(f.staff,f.ticket,{revision:0},{pool,produce:async snapshot=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='staff-knowledge-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n,0);
  assert.equal(snapshot.question,'Wi-Fi เชื่อมต่อไม่ได้');assert(!JSON.stringify(snapshot.history).includes('2567'));return {kind:'CLARIFY',text:'ยังยืนยันเอกสารไม่ได้'};
 }});assert.equal(view.status,'NOT_VERIFIED');assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[f.ticket])).rows[0].n,0);assert.equal((await pool.query('select revision from public.tickets where id=$1',[f.ticket])).rows[0].revision,0);
});
test('lost actor scope or changed HUMAN case/message during lookup discards the result',async()=>{
 for(const change of ['scope','mode','message'] as const){const f=await fixture();await assert.rejects(createStaffKnowledgeAssistance(f.staff,f.ticket,{revision:0},{pool,produce:async()=>{
  if(change==='scope')await pool.query("update public.staff_profiles set role='ADMIN',department_id=null where id=$1",[f.staff]);
  if(change==='mode')await pool.query("update public.conversations set mode='AI' where id=$1",[f.conversation]);
  if(change==='message')await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ข้อมูลใหม่')",[f.conversation,f.ticket]);
  return {kind:'CLARIFY',text:'late result'};
 }}),{code:change==='scope'?'NOT_FOUND':'CONFLICT'});}
});
async function evidence(){
 const code='STAFF_KB_'+randomUUID().replaceAll('-','').toUpperCase(),vector=[1,...Array<number>(383).fill(0)];
 const family=(await pool.query("insert into public.document_families(code,name,category) values($1,'Owned source','GUIDE') returning id",[code])).rows[0].id;
 const doc=(await pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,checksum)
  values($1,'Reviewed source','2569','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
 await pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,content,embedding,embedding_dimensions,embedding_fingerprint) values($1,0,2,'ข้อมูล fixture ที่ตรวจแล้ว',$2::extensions.vector,384,$3)`,[doc,JSON.stringify(vector),LOCAL_EMBEDDING_FINGERPRINT]);
 const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[code],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 const client=await pool.connect();let rows;try{await client.query('begin');rows=await searchKnowledge(client,{scope,vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,limit:12});await client.query('commit');}finally{client.release();}
 assert.equal(rows.length,1);const answer:AIResult={kind:'ANSWER',scope,queryVector:vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,evidence:rows,output:{answer:'คำตอบตามเอกสารที่ตรวจแล้ว',citationChunkIds:[rows[0].chunkId]}};return {doc,answer};
}
test('actual approved/current PUBLIC evidence is reselected before returning canonical citations',async()=>{
 const f=await fixture(),e=await evidence();const view=await createStaffKnowledgeAssistance(f.staff,f.ticket,{revision:0},{pool,produce:async()=>e.answer});assert.equal(view.status,'VERIFIED');assert.equal(view.sources[0].title,'Reviewed source');assert(view.draftText?.includes('แหล่งอ้างอิง'));assert(!JSON.stringify(view).includes(e.doc));
});
test('a source becoming internal during production invalidates the whole cited advice',async()=>{
 const f=await fixture(),e=await evidence();await assert.rejects(createStaffKnowledgeAssistance(f.staff,f.ticket,{revision:0},{pool,produce:async()=>{await pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[e.doc]);return e.answer;}}),{code:'CONFLICT'});
});
