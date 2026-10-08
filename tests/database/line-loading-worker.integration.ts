import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';

async function fixture(age=0){
 const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
 assert(database&&/^yru_(structured_schema|publication_ui_qa)_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
 const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'loading-worker-qa'});
 const key=randomBytes(32).toString('base64'),user='U'+randomUUID().replaceAll('-','');
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Loading test') returning id",[conversation])).rows[0].id;
 const receivedAt=new Date(Date.now()-age);
 const job=await transaction(c=>prepareAIJob(c,{sessionId:session,conversationId:conversation,messageId:message,replyToken:'synthetic-reply',receivedAt},key),pool);
 async function cleanup(){
  await pool.query('delete from private.message_outbox where line_session_id=$1',[session]);
  await pool.query('delete from private.ai_jobs where line_session_id=$1',[session]);
  await pool.query('delete from public.messages where conversation_id=$1',[conversation]);
  await pool.query('delete from public.conversations where id=$1',[conversation]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);
  await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
 return {pool,key,user,session,conversation,job,receivedAt,cleanup};
}

test('loading occurs outside SQL before generation; identity stays outside the producer snapshot and original reply deadline survives',async()=>{
 const f=await fixture();const calls:string[]=[];
 try{
  const result=await runAICycle(f.pool,f.key,{loading:{accessToken:'synthetic-token',fetchImpl:async(_url,init)=>{
   calls.push('loading');assert.deepEqual(JSON.parse(String(init?.body)),{chatId:f.user,loadingSeconds:20});
   const open=(await f.pool.query("select count(*)::int n from pg_stat_activity where application_name='loading-worker-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n;
   assert.equal(open,0);return new Response(null,{status:202});
  }},produce:async snapshot=>{calls.push('produce');assert(!JSON.stringify(snapshot).includes(f.user));return {kind:'CLARIFY',text:'Test result'};}});
  assert.equal(result.completed,1);assert.deepEqual(calls,['loading','produce']);
  const deadline=(await f.pool.query('select reply_deadline_at from private.message_outbox where idempotency_key=$1',[`ai-job:${f.job}`])).rows[0].reply_deadline_at;
  assert.equal(deadline.getTime(),f.receivedAt.getTime()+20_000);
 }finally{await f.cleanup();}
});
test('expired/future requests and retries skip the loading side effect but continue generation',async()=>{
 for(const [age,attempts] of [[25_000,0],[-5_000,0],[0,1]]){
  const f=await fixture(age);let calls=0;
  try{
   await f.pool.query('update private.ai_jobs set attempts=$2 where id=$1',[f.job,attempts]);
   const result=await runAICycle(f.pool,f.key,{loading:{accessToken:'synthetic-token',fetchImpl:async()=>{calls++;return new Response(null,{status:202});}},produce:async()=>({kind:'CLARIFY',text:'Test result'})});
   assert.equal(result.completed,1);assert.equal(calls,0);
  }finally{await f.cleanup();}
 }
});
test('loading failures are best effort and cannot prevent an AI result',async()=>{
 const f=await fixture();let calls=0;
 try{
  const result=await runAICycle(f.pool,f.key,{loading:{accessToken:'synthetic-token',fetchImpl:async()=>{calls++;throw new Error('private network details');}},produce:async()=>({kind:'CLARIFY',text:'Test result'})});
  assert.equal(result.completed,1);assert.equal(result.failed,0);assert.equal(calls,1);
 }finally{await f.cleanup();}
});
test('a HUMAN takeover during loading suppresses generation and delivery',async()=>{
 const f=await fixture();let generation=0;
 try{
  const result=await runAICycle(f.pool,f.key,{loading:{accessToken:'synthetic-token',fetchImpl:async()=>{
   await f.pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);return new Response(null,{status:202});
  }},produce:async()=>{generation++;return {kind:'CLARIFY',text:'Must not send'};}});
  assert.equal(generation,0);assert.equal(result.suppressed,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where line_session_id=$1',[f.session])).rows[0].n,0);
 }finally{await f.cleanup();}
});
