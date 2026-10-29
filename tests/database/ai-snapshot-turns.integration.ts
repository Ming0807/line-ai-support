import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob,claimAIJob,type AIJob} from '../../lib/ai/jobs';
import {readAIKnowledgeSnapshot} from '../../lib/ai/knowledge-snapshot';
import {createConversationReply,verifyConversationReply} from '../../lib/ai/conversation-reply';
import {encryptValue,decryptValue,hashLineUserId} from '../../lib/security/identity';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {runAICycle} from '../../lib/ai/run-worker';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {flushDegradedInputNotices} from '../../lib/conversation/input-windows';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
const sessions:string[]=[];
afterEach(async()=>{
 await pool.query("update private.ai_jobs set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
});
after(()=>pool.end());
async function fixture(){
 const key=randomBytes(32).toString('base64'),lineUser='U'+randomUUID().replaceAll('-',''),userHash=hashLineUserId(lineUser,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['SNAPSHOT_'+randomUUID()])).rows[0].id as string;
 sessions.push(session);
 // Use the same webhook lane and verified dispatch identity.
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,userHash,encryptValue(lineUser,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id as string;
 const epoch=Date.now()-30000;
 async function event(offset:number,kind='MESSAGE'){
  return (await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,received_at,completed_at)
   values('STUDENT',$1,$2,$3,$4,'DONE',$5,clock_timestamp()) returning id,received_at`,
  [randomUUID(),userHash,encryptValue('{}',key),kind,new Date(epoch+offset)])).rows[0] as {id:string;received_at:Date};
 }
 async function message(text:string,offset:number,metadata:Record<string,string>={routing_status:'ROUTED',routing_route:'AI_EXISTING'},target=conversation){
  const source=await event(offset);
  const id=(await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,source_event_id,metadata,created_at)
   values($1,'USER','TEXT',$2,$3,$4,$5) returning id`,[target,text,source.id,metadata,new Date(epoch+offset)])).rows[0].id as string;
  return {id,source};
 }
 async function job(messageId:string){
  const id=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId,receivedAt:new Date()},key),pool);assert(id);
  return (await pool.query('select * from private.ai_jobs where id=$1',[id])).rows[0] as AIJob;
 }
 return {key,session,conversation,epoch,event,message,job,lineUser,userHash};
}
test('the complete routed current burst survives twenty fragments without another topic or control text',async()=>{
 const f=await fixture(),parts=Array.from({length:20},(_,i)=>i===0?'เครื่องของผมต่อเครือข่ายไม่ได้':`รายละเอียดเพิ่มเติม ${i}`);
 const other=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[f.session])).rows[0].id as string;
 const first=await f.message(parts[0],0);let latest=first;
 await f.message('PRIVATE_PENDING_MUST_NOT_BECOME_INPUT',5,{routing_status:'PENDING'});
 await f.message('PRIVATE_CONTROL_MUST_NOT_BECOME_INPUT',6,{routing_status:'ROUTE_CONTROL'});
 for(let i=1;i<parts.length;i++)latest=await f.message(parts[i],i*10);
 await f.message('OTHER_TOPIC_MUST_NOT_JOIN',195,undefined,other);
 const job=await f.job(latest.id);
 const before=await transaction(c=>readAIKnowledgeSnapshot(c,job,f.key,true),pool);assert(before);
 assert.equal(before.question,parts.join('\n'),'ALL_CURRENT_FRAGMENTS_ARE_ONE_COMPLETE_OWNED_QUESTION');
 assert.deepEqual(before.history,[],'CURRENT_FRAGMENTS_ARE_NOT_REPEATED_AS_PRIOR_TURNS');
 assert.equal(before.support?.input.sources[0].text,before.question,'SUPPORT_AND_ANSWER_USE_IDENTICAL_CURRENT_TURN');
 const reply=createConversationReply(before,'ลองตรวจสอบการเชื่อมต่ออีกครั้งครับ');assert(reply);
 await pool.query('update public.messages set content=$2 where id=$1',[first.id,'แก้ไขรายละเอียดต้นเรื่อง']);
 const after=await transaction(c=>readAIKnowledgeSnapshot(c,job,f.key,true),pool);assert(after);
 assert.equal(verifyConversationReply(reply,after),false,'EARLY_FRAGMENT_CHANGES_INVALIDATE_THE_ANSWER');
 assert.notEqual(before.support?.sourceDigest,after.support?.sourceDigest);
});

test('individually valid large fragments get one explicit limit notice instead of silent suppression',async()=>{
 const f=await fixture();await f.message('ก'.repeat(11000),0);const last=await f.message('ข'.repeat(11000),100);
 await f.job(last.id);let calls=0;
 const result=await runAICycle(pool,f.key,{supportEnabled:true,produce:async()=>{calls++;throw Error('NO_MODEL_FOR_OVERSIZE');}});
 assert.equal(result.completed,1,'VALID_COLLECTED_INPUT_MUST_NOT_DISAPPEAR');assert.equal(calls,0);
 const outbox=(await pool.query('select payload_encrypted from private.message_outbox where line_session_id=$1',[f.session])).rows;
 assert.equal(outbox.length,1);const packet=JSON.parse(decryptValue(outbox[0].payload_encrypted,f.key));
 assert.match(packet.messages[0].text,/เกินขนาด/u);assert.match(packet.messages[0].text,/แยกคำถาม/u);assert(!packet.messages[0].text.includes('ก'.repeat(100)));
});

test('quiet extension stops at three seconds and duplicate insertion never extends collection',async()=>{
 const f=await fixture(),first=await f.event(0);
 for(const ms of [1000,2000,2900])await f.event(ms);
 const window=(await pool.query(`select w.* from private.student_input_windows w join private.webhook_inbox i on i.input_window_id=w.id where i.id=$1`,[first.id])).rows[0];
 assert.equal(window.ready_at.getTime()-window.first_received_at.getTime(),3000);
 const count=(await pool.query('select count(*)::int n from private.student_input_windows')).rows[0].n;
 const inserted=await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,received_at)
  select channel,event_id,user_hash,payload_encrypted,event_kind,received_at+interval '1 second' from private.webhook_inbox where id=$1
  on conflict(channel,event_id) do nothing returning id`,[first.id]);assert.equal(inserted.rowCount,0);
 assert.equal((await pool.query('select count(*)::int n from private.student_input_windows')).rows[0].n,count);
 assert.equal((await pool.query('select ready_at from private.student_input_windows where id=$1',[window.id])).rows[0].ready_at.getTime(),window.ready_at.getTime());
 const next=await f.event(3001);
 assert.notEqual((await pool.query('select input_window_id from private.webhook_inbox where id=$1',[next.id])).rows[0].input_window_id,window.id);
});

test('sealing cannot cross an ingress lane held by an append captured before its quiet deadline',async()=>{
 const f=await fixture(),first=await f.event(0),ingress=await pool.connect();
 const windowId=(await pool.query('select input_window_id from private.webhook_inbox where id=$1',[first.id])).rows[0].input_window_id;
 try{
  await ingress.query('begin');
  await ingress.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`inbox:STUDENT:${f.userHash}`]);
  // Both clients run the production SQL. The owned timestamp represents an
  // event captured before the deadline while the insertion lane is still held.
  await pool.query('select private.seal_student_input_windows()');
  assert.equal((await pool.query('select sealed_at from private.student_input_windows where id=$1',[windowId])).rows[0].sealed_at,null,
   'SEAL_MUST_SHARE_THE_INGRESS_LINEARIZATION_LANE');
  const next=(await ingress.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,received_at)
   values('STUDENT',$1,$2,$3,'MESSAGE','PENDING',$4) returning id,input_window_id`,
  [randomUUID(),f.userHash,encryptValue('{}',f.key),new Date(f.epoch+500)])).rows[0];
  await ingress.query('commit');
  assert.equal((await pool.query('select input_window_id from private.webhook_inbox where id=$1',[next.id])).rows[0].input_window_id,windowId);
  await pool.query('select private.seal_student_input_windows()');
  assert.equal((await pool.query('select sealed_at from private.student_input_windows where id=$1',[windowId])).rows[0].sealed_at,null);
  await pool.query("update private.webhook_inbox set status='DONE',completed_at=clock_timestamp() where id=$1",[next.id]);
  await pool.query('select private.seal_student_input_windows()');
  assert((await pool.query('select sealed_at from private.student_input_windows where id=$1',[windowId])).rows[0].sealed_at instanceof Date);
 }finally{await ingress.query('rollback');ingress.release();}
});

for(const active of [true,false])test(`degraded windows seal only after terminal membership; notice once and later input proceeds; active=${active}`,async()=>{
 const f=await fixture(),first=await f.message('รายละเอียดแรก',0),last=await f.message('รายละเอียดท้าย',100);
 const oldJob=await f.job(last.id);
 await pool.query("update private.webhook_inbox set status='PENDING',completed_at=null where id=$1",[first.source.id]);
 await pool.query('select private.seal_student_input_windows()');
 const windowId=(await pool.query('select input_window_id from private.webhook_inbox where id=$1',[first.source.id])).rows[0].input_window_id;
 assert.equal((await pool.query('select sealed_at from private.student_input_windows where id=$1',[windowId])).rows[0].sealed_at,null);
 await pool.query("update private.webhook_inbox set status='DEAD',completed_at=clock_timestamp() where id=$1",[first.source.id]);
 if(!active)await pool.query('update public.line_sessions set active=false where id=$1',[f.session]);
 assert.equal(await flushDegradedInputNotices(pool,f.key),active?1:0);
 assert.equal(await flushDegradedInputNotices(pool,f.key),0);
 const state=(await pool.query('select degraded,notice_state,notice_outbox_id from private.student_input_windows where id=$1',[windowId])).rows[0];
 assert.equal(state.degraded,true);assert.equal(state.notice_state,active?'QUEUED':'UNDELIVERABLE');
 assert.equal((await pool.query('select status from private.ai_jobs where id=$1',[oldJob.id])).rows[0].status,'SUPPRESSED');
 const notices=(await pool.query('select id from private.message_outbox where idempotency_key=$1',[`input-window:${windowId}:failure`])).rows;
 assert.equal(notices.length,active?1:0);
 if(active){
  const fresh=await f.message('คำถามในช่วงถัดไป',5000),newJob=await f.job(fresh.id);
  assert.notEqual((await pool.query('select input_window_id from private.webhook_inbox where id=$1',[fresh.source.id])).rows[0].input_window_id,windowId);
  assert.equal((await claimAIJob(pool))?.id,newJob.id,'DEGRADED_WINDOW_MUST_NOT_BLOCK_A_LATER_TURN');
 }
});

for(const sameTopic of [true,false])test(`pending durable input defers old delivery without guessing its topic; sameTopic=${sameTopic}`,async()=>{
 const f=await fixture(),source=await f.message('ขอคำอธิบายทั่วไป',0);await f.job(source.id);
 assert.equal((await runAICycle(pool,f.key,{produce:async()=>({kind:'CLARIFY',text:'คำตอบของเรื่องเดิมครับ'})})).completed,1);
 const pending=await f.event(5000);await pool.query("update private.webhook_inbox set status='PENDING',completed_at=null where id=$1",[pending.id]);
 let calls=0;const options={accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async()=>{calls++;return new Response(null,{status:200});}};
 await runOutboxCycle(pool,f.key,options);
 assert.equal(calls,0,'DURABLE_UNROUTED_INPUT_MUST_BE_CLASSIFIED_BEFORE_OLD_AI_DELIVERY');
 const deferred=(await pool.query('select status,attempts from private.message_outbox where line_session_id=$1',[f.session])).rows[0];
 assert.deepEqual(deferred,{status:'PENDING',attempts:0},'DEFERRAL_IS_NOT_FAILURE_OR_CANCELLATION');
 const target=sameTopic?f.conversation:(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[f.session])).rows[0].id;
 await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,source_event_id,metadata)
  values($1,'USER','TEXT','รายละเอียดที่เพิ่งส่ง',$2,'{"routing_status":"ROUTED"}'::jsonb)`,[target,pending.id]);
 await pool.query("update private.webhook_inbox set status='DONE',completed_at=clock_timestamp() where id=$1",[pending.id]);
 await pool.query('update private.message_outbox set available_at=clock_timestamp() where line_session_id=$1',[f.session]);
 await runOutboxCycle(pool,f.key,options);
 assert.equal(calls,sameTopic?0:1,'A_DIFFERENT_TOPIC_MUST_NOT_CANCEL_THE_OLD_TOPIC');
 assert.equal((await pool.query('select status from private.message_outbox where line_session_id=$1',[f.session])).rows[0].status,sameTopic?'SUPPRESSED':'SENT');
});
test('explicit current intent for an older pending question retains delivered context and excludes unsent replies',async()=>{
 const f=await fixture(),old=await f.message('คำถามที่รอเลือกบริบท',0,{routing_status:'PENDING'});
 await f.message('ผมใช้อุปกรณ์เดิมครับ',5000);
 const aiJobId=randomUUID(),sentText='ก่อนหน้านี้แนะนำให้ตรวจสอบอุปกรณ์ครับ';
 await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,metadata,created_at)
  values($1,'AI','TEXT',$2,$3,$4),($1,'AI','TEXT','UNSENT_MUST_NOT_APPEAR','{}',$4)`,
 [f.conversation,sentText,{ai_job_id:aiJobId},new Date(f.epoch+6000)]);
 const outbox=await transaction(c=>enqueueOutbound(c,{idempotencyKey:'ai-job:'+aiJobId,channel:'STUDENT',kind:'AI',
  lineSessionId:f.session,conversationId:f.conversation,conversationRevision:0,messages:[{type:'text',text:sentText}]},f.key),pool);
 await pool.query("update private.message_outbox set status='SENT',completed_at=$2 where id=$1",[outbox,new Date(f.epoch+6500)]);
 const intent=await f.event(8000,'OTHER');
 await pool.query("update public.messages set metadata=$2 where id=$1",[old.id,{routing_status:'ROUTED',routing_route:'AI_EXISTING',routing_input_event_id:intent.id}]);
 const job=await f.job(old.id),snapshot=await transaction(c=>readAIKnowledgeSnapshot(c,job,f.key,true),pool);assert(snapshot);
 assert.equal(snapshot.question,'คำถามที่รอเลือกบริบท');
 assert.deepEqual(snapshot.history,[{role:'user',content:'ผมใช้อุปกรณ์เดิมครับ'},{role:'assistant',content:sentText}]);
 assert.equal(snapshot.support?.input.sources[0].text,snapshot.question);
 assert(snapshot.support?.input.sources.some(s=>s.text==='ผมใช้อุปกรณ์เดิมครับ'));
});
