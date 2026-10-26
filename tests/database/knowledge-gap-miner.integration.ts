import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,test} from 'node:test';
import {Pool} from 'pg';
import {mineKnowledgeGaps,aggregateGaps} from '../../scripts/qa/knowledge-gap-miner';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:1});
const ownedOutboxIds:string[]=[];
afterEach(async()=>{
 // Pending negative-case rows contain inert ciphertext. Retire only this suite's
 // exact fixtures before a later registered suite runs the real outbox consumer.
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=any($1::uuid[]) and status in ('PENDING','PROCESSING')",[ownedOutboxIds]);
});
after(()=>pool.end());
const key='synthetic-gap-report-key-at-least-32-characters';
async function actor(role='SUPER_ADMIN'){
 const id=randomUUID();await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query("insert into public.staff_profiles(id,display_name,role,active,department_id) values($1,$2,$3,true,case when $3='STAFF' then (select id from public.departments where code='IT') else null end)",[id,'Synthetic gap report owner',role]);return id;
}
async function delivered(question:string,status='SENT'){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['GAP_'+randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode) values($1,'AI') returning id",[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,created_at) values($1,'USER','TEXT',$2,clock_timestamp()-interval '10minutes') returning id",[conversation,question])).rows[0].id;
 // This later USER message precedes the answer but is NOT the source of its job.
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,created_at) values($1,'USER','TEXT','WRONG newer private question',clock_timestamp()-interval '5minutes')",[conversation]);
 const job=(await pool.query("insert into private.ai_jobs(line_session_id,conversation_id,message_id,expected_conversation_revision,request_encrypted,status) values($1,$2,$3,0,$4,'DONE') returning id",[session,conversation,message,'v1.'+'s'.repeat(60)])).rows[0].id;
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,metadata) values($1,'AI','TEXT','ตอนนี้ยังไม่พบเอกสารทางการที่ยืนยันคำตอบได้',$2)",[conversation,JSON.stringify({ai_job_id:job})]);
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,line_session_id,conversation_id,kind,payload_encrypted,status,completed_at) values($1,$2,$3,'AI',$4,$5,case when $5='SENT' then clock_timestamp() else null end) returning id",['ai-job:'+job,session,conversation,'v1.'+'s'.repeat(60),status])).rows[0].id;
 ownedOutboxIds.push(outbox);
 return {conversation,outbox};
}
test('actual report uses exact delivered source job, never the latest question, and releases read-only state',async()=>{
 const admin=await actor(),question='PRIVATE synthetic student 1234567890123 exact triggering question';
 await delivered(question);
 const report=await mineKnowledgeGaps(pool,{actorId:admin,hashKey:key});
 const expected=aggregateGaps([{conversationId:'',question,answeredAt:'2026-10-25T00:00:00Z'}],key)[0].topicId;
 assert.equal(report.sampledAnswers,1);assert.equal(report.items[0].topicId,expected);
 assert(!JSON.stringify(report).includes('PRIVATE'));assert(!JSON.stringify(report).includes('1234567890123'));
 assert.equal((await pool.query('show transaction_read_only')).rows[0].transaction_read_only,'off');
});
test('unbound, pending and suppressed answers are not delivered gap candidates',async()=>{
 const admin=await actor(),before=await mineKnowledgeGaps(pool,{actorId:admin,hashKey:key});
 const f=await delivered('Pending must not count','PENDING');await delivered('Suppressed must not count','SUPPRESSED');
 await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content,metadata) values($1,'AI','TEXT','ยังไม่พบเอกสารทางการ',$2)",[f.conversation,JSON.stringify({ai_job_id:'not-a-uuid'})]);
 const after=await mineKnowledgeGaps(pool,{actorId:admin,hashKey:key});assert.equal(after.sampledAnswers,before.sampledAnswers);
});
test('inactive and non-super-admin identities cannot read the global report',async()=>{
 for(const role of ['STAFF','ADMIN'])await assert.rejects(mineKnowledgeGaps(pool,{actorId:await actor(role),hashKey:key}),/GAP_REPORT_FORBIDDEN/u);
 const inactive=await actor();await pool.query('update public.staff_profiles set active=false where id=$1',[inactive]);
 await assert.rejects(mineKnowledgeGaps(pool,{actorId:inactive,hashKey:key}),/GAP_REPORT_FORBIDDEN/u);
 assert.equal((await pool.query('show transaction_read_only')).rows[0].transaction_read_only,'off');
});
test('report marks a bounded sample as truncated instead of implying complete coverage',async()=>{
 const admin=await actor();await delivered('another missing-document question');
 const report=await mineKnowledgeGaps(pool,{actorId:admin,hashKey:key,limit:1});assert.equal(report.sampledAnswers,1);assert.equal(report.truncated,true);
});
test('completed gap-report fixtures retain their history but leave no pending transport work for following suites',async()=>{
 assert(ownedOutboxIds.length>0);
 const states=(await pool.query('select status from private.message_outbox where id=any($1::uuid[])',[ownedOutboxIds])).rows;
 assert.equal(states.length,ownedOutboxIds.length,'FIXTURE_HISTORY_MUST_BE_RETAINED');
 assert(states.some(row=>row.status==='SENT'),'DELIVERED_GAP_HISTORY_MUST_REMAIN');
 assert.equal(states.filter(row=>['PENDING','PROCESSING'].includes(row.status)).length,0,'GAP_FIXTURE_MUST_NOT_POISON_LATER_OUTBOX_SUITE');
});
