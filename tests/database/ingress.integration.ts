import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, Pool, type PoolClient } from 'pg';
import { encryptValue, hashLineUserId } from '../../lib/security/identity';
import { processInboxEvent } from '../../lib/queue/process-inbox';
import { persistWebhookEvents } from '../../lib/queue/inbox';
import type { IngressEvent } from '../../lib/line/receive-webhook';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyEventKind } from '../../lib/line/events';

const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';

async function processedFixture(makeEvents:(userId:string)=>unknown[],ageSeconds=0) {
 const client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const hash=hashLineUserId(userId,key),events=makeEvents(userId);
 await client.connect();
 try {
  await client.query('begin');
  for(const event of events) await client.query(
   "insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,received_at) values ('STUDENT',$1,$2,$3,$4,clock_timestamp()-make_interval(secs=>$5))",
   [randomUUID(),hash,encryptValue(JSON.stringify(event),key),classifyEventKind(event),ageSeconds]);
  for(const event of events) {
   void event;
   const job=(await client.query("select * from private.claim_inbox('STUDENT')")).rows[0];
   assert.ok(job);
   await processInboxEvent(client,job,key);
  }
  const messages=(await client.query('select count(*)::int as count from public.messages m join public.conversations c on c.id=m.conversation_id join private.line_identities i on i.line_session_id=c.line_session_id where i.user_hash=$1',[hash])).rows[0].count;
  const errors=(await client.query('select last_error_code from private.webhook_inbox where user_hash=$1',[hash])).rows.map(row=>row.last_error_code);
  return {messages,errors};
 } finally {await client.query('rollback');await client.end();}
}

test('follow events do not consume the twenty-message arrival budget',async()=>{
 const result=await processedFixture(userId=>[
  ...Array.from({length:20},()=>({type:'follow',source:{type:'user',userId}})),
  {type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID(),text:'ทดสอบหลัง follow'}},
 ]);
 assert.equal(result.messages,1);
 assert.equal(result.errors.filter(code=>code==='RATE_LIMITED').length,0);
});

test('a delayed message backlog is still limited by receipt time',async()=>{
 const result=await processedFixture(userId=>Array.from({length:21},()=>({
  type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID(),text:'ข้อความเก่ารอ worker'},
 })),120);
 assert.equal(result.messages,20);
 assert.equal(result.errors.filter(code=>code==='RATE_LIMITED').length,1);
});

test('missing or empty text is marked unsupported and never stored as a user message',async()=>{
 const result=await processedFixture(userId=>[
  {type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID()}},
  {type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID(),text:''}},
 ]);
 assert.equal(result.messages,0);
 assert.deepEqual(result.errors,['UNSUPPORTED_EVENT','UNSUPPORTED_EVENT']);
});

test('concurrent same-user enqueue waits for the earlier transaction while another user commits',async()=>{
 const first=new Client({connectionString:localUrl});
 const observer=new Client({connectionString:localUrl});
 const nextPool=new Pool({connectionString:localUrl,max:1});
 const unrelatedPool=new Pool({connectionString:localUrl,max:1});
 const suffix=randomUUID(),hash=`enqueue-${suffix}`;
 const firstId=`enqueue-first-${suffix}`,nextId=`enqueue-next-${suffix}`,otherId=`enqueue-other-${suffix}`;
 let completion:Promise<void>|undefined;
 let state:'pending'|'committed'|'failed'='pending';
 await Promise.all([first.connect(),observer.connect()]);
 try {
  const pid=(await nextPool.query('select pg_backend_pid() as pid')).rows[0].pid;
  await first.query('begin');
  await first.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`inbox:STUDENT:${hash}`]);
  await first.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STUDENT',$1,$2,'encrypted')",[firstId,hash]);
  completion=persistWebhookEvents([{channel:'STUDENT',eventId:nextId,userHash:hash,payloadEncrypted:'encrypted'}],nextPool)
   .then(()=>{state='committed';},()=>{state='failed';});
  let waiting=false;
  for(let attempt=0;attempt<300;attempt++) {
   const activity=(await observer.query('select wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
   if(activity?.wait_event==='advisory'){waiting=true;break;}
   if(String(state)!=='pending') break;
   await delay(10);
  }
  assert.ok(waiting,'the real persistence helper must wait on the earlier enqueue lane before allocating a sequence');
  assert.equal((await observer.query('select count(*)::int as count from private.webhook_inbox where event_id=$1',[nextId])).rows[0].count,0);
  await persistWebhookEvents([{channel:'STUDENT',eventId:otherId,userHash:`other-${suffix}`,payloadEncrypted:'encrypted'}],unrelatedPool);
  assert.equal((await observer.query('select count(*)::int as count from private.webhook_inbox where event_id=$1',[otherId])).rows[0].count,1,'unrelated user commits while the first lane is blocked');
  await first.query('commit');
  await completion;
  assert.equal(String(state),'committed');
  const stored=(await observer.query('select event_id,event_seq from private.webhook_inbox where event_id=any($1::text[]) order by event_seq',[[firstId,nextId]])).rows;
  assert.deepEqual(stored.map(row=>row.event_id),[firstId,nextId]);
 } finally {
  await first.query('rollback');
  await completion;
  await observer.query('delete from private.webhook_inbox where event_id=any($1::text[])',[[firstId,nextId,otherId]]);
  await Promise.all([first.end(),observer.end(),nextPool.end(),unrelatedPool.end()]);
 }
});

test('persistence commits batches, deduplicates by channel, and rolls back a failing batch',async()=>{
 const pool=new Pool({connectionString:localUrl,max:2});
 const suffix=randomUUID(),sameId=`ingress-${suffix}`,rollbackId=`ingress-rollback-${suffix}`;
 const event=(channel:'STUDENT'|'STAFF',eventId:string)=>({channel,eventId,userHash:`hash-${suffix}`,payloadEncrypted:'encrypted'});
 try {
  await persistWebhookEvents([event('STUDENT',sameId),event('STUDENT',sameId),event('STAFF',sameId)],pool);
  await persistWebhookEvents([event('STUDENT',sameId)],pool);
  const rows=(await pool.query('select channel,event_id from private.webhook_inbox where event_id=$1 order by channel',[sameId])).rows;
  assert.deepEqual(rows,[{channel:'STAFF',event_id:sameId},{channel:'STUDENT',event_id:sameId}], 'redelivery is deduplicated within a channel, while another channel remains distinct');

  const invalid={...event('STAFF',`invalid-${suffix}`),channel:'INVALID'} as unknown as IngressEvent;
  await assert.rejects(persistWebhookEvents([event('STUDENT',rollbackId),invalid],pool),'invalid channel must fail the batch');
  assert.equal((await pool.query('select count(*)::int as count from private.webhook_inbox where event_id=$1',[rollbackId])).rows[0].count,0,'the first insert rolls back with the failing second item');
 } finally {
  await pool.query('delete from private.webhook_inbox where event_id=any($1::text[])',[[sameId,rollbackId,`invalid-${suffix}`]]);
  await pool.end();
 }
});

test('oppositely ordered multi-user batches finish without deadlock or interleaved commits',async()=>{
 const leftPool=new Pool({connectionString:localUrl,max:1,statement_timeout:2000});
 const rightPool=new Pool({connectionString:localUrl,max:1,statement_timeout:2000});
 const suffix=randomUUID(),a=`batch-a-${suffix}`,b=`batch-b-${suffix}`;
 const entry=(side:string,userHash:string):IngressEvent=>({channel:'STUDENT',eventId:`${side}-${userHash}`,userHash,payloadEncrypted:'encrypted'});
 const left=[entry('left',a),entry('left',b)],right=[entry('right',b),entry('right',a)];
 const ids=[...left,...right].map(event=>event.eventId);
 try {
  await Promise.all([persistWebhookEvents(left,leftPool),persistWebhookEvents(right,rightPool)]);
  const rows=(await leftPool.query('select event_id from private.webhook_inbox where event_id=any($1::text[]) order by event_seq',[ids])).rows;
  assert.equal(rows.length,4);
  const sides=rows.map(row=>row.event_id.startsWith('left-')?'left':'right');
  assert.equal(sides[0],sides[1],'the first committed batch is contiguous');
  assert.equal(sides[2],sides[3],'the second committed batch is contiguous');
  assert.notEqual(sides[0],sides[2]);
 } finally {
  await leftPool.query('delete from private.webhook_inbox where event_id=any($1::text[])',[ids]);
  await Promise.all([leftPool.end(),rightPool.end()]);
 }
});

test('a lease expiring during processing prevents completion and rolls back effects',async()=>{
 const setup=new Client({connectionString:localUrl}),client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,eventId=`lease-expiry-${randomUUID()}`;
 const userHash=hashLineUserId(userId,key),event={type:'follow',source:{type:'user',userId}};
 await Promise.all([setup.connect(),client.connect()]);
 try {
  await setup.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STUDENT',$1,$2,$3)",[eventId,userHash,encryptValue(JSON.stringify(event),key)]);
  const job=(await setup.query("select * from private.claim_inbox('STUDENT')")).rows.find(row=>row.event_id===eventId);
  assert.ok(job);
  await setup.query("update private.webhook_inbox set lease_until=clock_timestamp()+interval '400 milliseconds' where id=$1 and lease_token=$2",[job.id,job.lease_token]);
  await client.query('begin');
  const delayedClient={query:async(sql:string,values:(string|number|boolean|null)[] = [])=>{
   if(sql.includes('pg_advisory_xact_lock')) await client.query('select pg_sleep(0.6)');
   return client.query(sql,values);
  }} as unknown as Pick<PoolClient,'query'>;
  await assert.rejects(processInboxEvent(delayedClient,job,key),/STALE_LEASE/);
  await client.query('rollback');
  assert.equal((await setup.query('select status from private.webhook_inbox where id=$1',[job.id])).rows[0].status,'PROCESSING','expired work remains available for reclaim');
  assert.equal((await setup.query('select count(*)::int as count from private.line_identities where user_hash=$1',[userHash])).rows[0].count,0,'effects before lease validation roll back');
 } finally {
  try { await client.query('rollback'); } catch { /* no open transaction */ }
  await setup.query('delete from private.webhook_inbox where event_id=$1',[eventId]);
  await Promise.all([setup.end(),client.end()]);
 }
});

test('processing an encrypted event stores an anonymous message once and fences old leases',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,eventId=randomUUID(),messageId=randomUUID();
 const event={type:'message',webhookEventId:eventId,source:{type:'user',userId},message:{type:'text',id:messageId,text:'เครือข่ายเข้าไม่ได้'},timestamp:Date.now()};
 await client.connect();
 try {
  await client.query('begin');
  await client.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STUDENT',$1,$2,$3)",[eventId,hashLineUserId(userId,key),encryptValue(JSON.stringify(event),key)]);
  const job=(await client.query("select * from private.claim_inbox('STUDENT')")).rows[0];
  await processInboxEvent(client,job,key);
  const stored=(await client.query('select m.content,s.anonymous_code,i.user_id_encrypted from public.messages m join public.conversations c on c.id=m.conversation_id join public.line_sessions s on s.id=c.line_session_id join private.line_identities i on i.line_session_id=s.id where m.line_message_id=$1',[messageId])).rows[0];
  assert.equal(stored.content,event.message.text);
  assert.match(stored.anonymous_code,/^Anonymous #/);
  assert.ok(!stored.user_id_encrypted.includes(userId));
  const done=(await client.query('select status from private.webhook_inbox where id=$1',[job.id])).rows[0];
  assert.equal(done.status,'DONE');
  await assert.rejects(processInboxEvent(client,job,key),/STALE_LEASE/);
  assert.equal((await client.query('select count(*)::int as count from public.messages where line_message_id=$1',[messageId])).rows[0].count,1);
 } finally {await client.query('rollback');await client.end();}
});

test('a student user burst is throttled at 20 persisted messages',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const hash=hashLineUserId(userId,key);
 await client.connect();
 try {
  await client.query('begin');
  for(let index=0;index<21;index++) {
   const event={type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID(),text:'ข้อความทดสอบ'}};
   await client.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind) values ('STUDENT',$1,$2,$3,'MESSAGE')",[randomUUID(),hash,encryptValue(JSON.stringify(event),key)]);
  }
  for(let index=0;index<21;index++) {
   const job=(await client.query("select * from private.claim_inbox('STUDENT')")).rows[0];
   await processInboxEvent(client,job,key);
  }
  const count=(await client.query('select count(*)::int as count from public.messages m join public.conversations c on c.id=m.conversation_id join private.line_identities i on i.line_session_id=c.line_session_id where i.user_hash=$1',[hash])).rows[0].count;
  assert.equal(count,20);
  assert.equal((await client.query("select count(*)::int as count from private.webhook_inbox where user_hash=$1 and last_error_code='RATE_LIMITED'",[hash])).rows[0].count,1);
 } finally {await client.query('rollback');await client.end();}
});
