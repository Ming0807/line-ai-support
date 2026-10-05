import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob,claimAIJob,saveAIResult} from '../../lib/ai/jobs';

async function fixture(){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4});
 const key=randomBytes(32).toString('base64');
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 async function message(text:string){return (await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content)
  values($1,'USER','TEXT',$2) returning id`,[conversation,text])).rows[0].id;}
 const input=(messageId:string)=>({sessionId:session,conversationId:conversation,messageId,replyToken:'private-fixture-reply',receivedAt:new Date(),quickReply:undefined});
 async function cleanup(){
  await pool.query('delete from private.ai_jobs where line_session_id=$1',[session]);
  await pool.query('delete from public.messages where conversation_id=$1',[conversation]);
  await pool.query('delete from public.conversations where id=$1',[conversation]);
  await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
 return {pool,key,session,conversation,message,input,cleanup};
}
test('durable AI job enqueue is transactional/idempotent/private and denies HUMAN or foreign ownership',async()=>{
 const f=await fixture();
 try{
  const message=await f.message('Controlled question');
  const a=await transaction(c=>prepareAIJob(c,f.input(message),f.key),f.pool);
  const b=await transaction(c=>prepareAIJob(c,f.input(message),f.key),f.pool);
  assert.equal(a,b);assert(a);
  const saved=(await f.pool.query('select request_encrypted,result_encrypted,attempts from private.ai_jobs where id=$1',[a])).rows[0];
  assert(!saved.request_encrypted.includes('private-fixture-reply'));assert.equal(saved.result_encrypted,null);assert.equal(saved.attempts,0);
  const client=await f.pool.connect();try{
   await client.query('begin');const next=await f.message('Rolled back question');
   const provisional=await prepareAIJob(client,f.input(next),f.key);await client.query('rollback');
   assert.equal((await f.pool.query('select id from private.ai_jobs where id=$1',[provisional])).rowCount,0);
  }finally{await client.query('rollback');client.release();}
  await assert.rejects(transaction(c=>prepareAIJob(c,{...f.input(message),sessionId:randomUUID()},f.key),f.pool),{message:'AI_JOB_CONTEXT_INVALID'});
  await f.pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[f.conversation]);
  const humanMessage=await f.message('Human reply');
  assert.equal(await transaction(c=>prepareAIJob(c,f.input(humanMessage),f.key),f.pool),null);
  const privacy=(await f.pool.query(`select relrowsecurity,has_table_privilege('authenticated','private.ai_jobs','SELECT,INSERT,UPDATE,DELETE') browser,
   has_table_privilege('anon','private.ai_jobs','SELECT,INSERT,UPDATE,DELETE') anon from pg_class where oid='private.ai_jobs'::regclass`)).rows[0];
  assert(privacy.relrowsecurity&&!privacy.browser&&!privacy.anon);
 }finally{await f.cleanup();}
});

test('AI claim has one winner, preserves conversation order, expires using database time and retries saved results',async()=>{
 const f=await fixture();
 try{
  const firstMessage=await f.message('First'),secondMessage=await f.message('Second');
  const first=await transaction(c=>prepareAIJob(c,f.input(firstMessage),f.key),f.pool);
  const second=await transaction(c=>prepareAIJob(c,f.input(secondMessage),f.key),f.pool);
  const claims=await Promise.all([claimAIJob(f.pool),claimAIJob(f.pool)]);
  assert.equal(claims.filter(Boolean).length,1);
  const claim=claims.find(Boolean)!;assert.equal(claim.id,first);
  await saveAIResult(f.pool,claim,{kind:'CLARIFY',text:'กรุณาระบุปีการศึกษาครับ'},f.key);
  await f.pool.query("update private.ai_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[first]);
  const retry=await claimAIJob(f.pool);assert(retry&&retry.id===first&&retry.result_encrypted);
  assert.notEqual(retry.lease_token,claim.lease_token);
  await assert.rejects(saveAIResult(f.pool,claim,{kind:'CLARIFY',text:'stale result'},f.key),{message:'AI_JOB_LEASE_LOST'});
  await f.pool.query("update private.ai_jobs set status='DONE',lease_token=null,lease_until=null where id=$1",[first]);
  assert.equal((await claimAIJob(f.pool))?.id,second);
  await f.pool.query("update private.ai_jobs set attempts=5,lease_until=clock_timestamp()-interval '1 second' where id=$1",[second]);
  assert.equal(await claimAIJob(f.pool),null);
  assert.equal((await f.pool.query('select status from private.ai_jobs where id=$1',[second])).rows[0].status,'DEAD');
 }finally{await f.cleanup();}
});
