import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {claimAIJob,prepareAIJob,type AIJob} from '../../lib/ai/jobs';
import {eligibleAIJob} from '../../lib/ai/run-worker';
import {persistWebhookEvents} from '../../lib/queue/inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {flushDegradedInputNotices} from '../../lib/conversation/input-windows';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,
 application_name:'conversation-turns-owned-test'});
after(()=>pool.end());

async function fixture(){
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',
  [`TURN_FIXTURE_${randomUUID()}`])).rows[0].id as string;
 const userHash=hashLineUserId(userId,key);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [session,userHash,encryptValue(userId,key)]);
 const topicA=(await pool.query('insert into public.conversations(line_session_id,topic) values($1,$2) returning id',
  [session,'Burst topic A'])).rows[0].id as string;
 const topicB=(await pool.query('insert into public.conversations(line_session_id,topic) values($1,$2) returning id',
  [session,'Independent topic B'])).rows[0].id as string;
 const conversations=[topicA,topicB];
 const eventIds:string[]=[];

 async function routedText(conversationId:string,text:string){
  const lineMessageId=randomUUID();
  const event={type:'message',source:{type:'user',userId},message:{type:'text',id:lineMessageId,text}};
  const inbox=(await pool.query(`insert into private.webhook_inbox
   (channel,event_id,user_hash,payload_encrypted,event_kind,status,completed_at)
   values('STUDENT',$1,$2,$3,'MESSAGE','DONE',clock_timestamp()) returning id,event_seq,received_at`,
   [randomUUID(),userHash,encryptValue(JSON.stringify(event),key)])).rows[0];
  eventIds.push(inbox.id as string);
  const messageId=(await pool.query(`insert into public.messages
   (conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata)
   values($1,'USER','TEXT',$2,$3,$4,'{"routing_status":"ROUTED","routing_route":"AI_EXISTING"}'::jsonb)
   returning id`,[conversationId,text,lineMessageId,inbox.id])).rows[0].id as string;
  return {messageId,eventId:inbox.id as string,eventSeq:inbox.event_seq as string,receivedAt:inbox.received_at as Date};
 }

 async function jobFor(conversationId:string,source:Awaited<ReturnType<typeof routedText>>){
  const id=await transaction(client=>prepareAIJob(client,{sessionId:session,conversationId,messageId:source.messageId,
   receivedAt:source.receivedAt},key),pool);
  assert(id,'AI_JOB_CREATED');
  const job=(await pool.query('select * from private.ai_jobs where id=$1',[id])).rows[0] as AIJob|undefined;
  assert(job,'AI_JOB_PERSISTED');
  return job;
 }

 async function cleanup(){
  await pool.query('delete from private.delivery_attempts where outbox_id in(select id from private.message_outbox where line_session_id=$1)',[session]);
  await pool.query('delete from private.message_outbox where line_session_id=$1',[session]);
  await pool.query('delete from private.ai_jobs where line_session_id=$1',[session]);
  await pool.query('delete from public.messages where conversation_id=any($1::uuid[])',[conversations]);
  if(eventIds.length)await pool.query('delete from private.webhook_inbox where id=any($1::uuid[])',[eventIds]);
  await pool.query('delete from public.conversations where id=any($1::uuid[])',[conversations]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);
  await pool.query('delete from public.line_sessions where id=$1',[session]);
 }

 return {key,session,conversations,routedText,jobFor,cleanup};
}

interface WindowIngressOptions {eventId?:string;receivedAt?:Date}
async function windowFixture({active=true}:{active?:boolean}={}){
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code,active) values($1,$2) returning id',
  [`WINDOW_FIXTURE_${randomUUID()}`,active])).rows[0].id as string;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [session,userHash,encryptValue(userId,key)]);
 const events:string[]=[];

 async function addEvent(text:string,options:WindowIngressOptions={}){
  const eventId=options.eventId??randomUUID(),lineMessageId=randomUUID();
  const event={type:'message',source:{type:'user',userId},message:{type:'text',id:lineMessageId,text}};
  if(options.receivedAt){
   await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,received_at)
    values('STUDENT',$1,$2,$3,'MESSAGE',$4) on conflict(channel,event_id) do nothing`,
    [eventId,userHash,encryptValue(JSON.stringify(event),key),options.receivedAt]);
  }else{
   await persistWebhookEvents([{channel:'STUDENT',eventId,userHash,
    payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
  }
  const row=(await pool.query(`select id,event_seq,received_at,input_window_id from private.webhook_inbox
   where channel='STUDENT' and event_id=$1`,[eventId])).rows[0];
  assert(row,'WINDOW_INGRESS_PERSISTED');events.push(row.id as string);
  return {id:row.id as string,eventId,eventSeq:row.event_seq as string,receivedAt:row.received_at as Date,
   windowId:row.input_window_id as string};
 }

 async function routeNext(){
  const result=await runInboxCycle(pool,key,{aiEnabled:true,classify:async input=>input.contexts.length
   ?{decision:'CONTINUE',candidateCode:input.contexts[0]!.code,confidence:.99}
   :{decision:'NEW',candidateCode:null,confidence:.99}});
  assert.deepEqual(result,{claimed:1,completed:1,failed:0},'the real inbox worker routes one message without an external classifier');
 }

 async function makeWindowDue(windowId:string){
  await pool.query(`update private.student_input_windows set
   first_received_at=now()-interval '4 seconds',last_received_at=now()-interval '2 seconds',
   ready_at=now()-interval '1 second' where id=$1`,[windowId]);
 }

 async function cleanup(){
  await pool.query(`delete from private.delivery_attempts where outbox_id in
   (select id from private.message_outbox where line_session_id=$1)`,[session]);
  await pool.query('delete from private.pending_route_choices where line_session_id=$1',[session]);
  await pool.query('delete from private.message_outbox where line_session_id=$1',[session]);
  await pool.query('delete from private.ai_jobs where line_session_id=$1',[session]);
  await pool.query('delete from public.messages where conversation_id in(select id from public.conversations where line_session_id=$1)',[session]);
  await pool.query('delete from public.conversations where line_session_id=$1',[session]);
  if(events.length)await pool.query('delete from private.webhook_inbox where id=any($1::uuid[])',[events]);
  await pool.query('delete from private.student_input_windows where user_hash=$1',[userHash]);
  await pool.query('delete from private.line_identities where user_hash=$1',[userHash]);
  await pool.query('delete from public.line_sessions where id=$1',[session]);
 }

 return {key,userId,userHash,session,addEvent,routeNext,makeWindowDue,cleanup};
}

test('a newer routed USER source stales only the earlier job in that conversation',async()=>{
 const f=await fixture();
 try{
  const [topicA,topicB]=f.conversations;
  const firstA=await f.routedText(topicA,'First burst message on topic A');
  const jobA=await f.jobFor(topicA,firstA);
  const sourceB=await f.routedText(topicB,'Independent question on topic B');
  const jobB=await f.jobFor(topicB,sourceB);

  const client=await pool.connect();
  try{
   assert.equal(await eligibleAIJob(client,jobA),true,'each job is initially current for its own topic');
   assert.equal(await eligibleAIJob(client,jobB),true,'the independent topic is initially current');
  }finally{client.release();}

  const newerA=await f.routedText(topicA,'Follow-up message on topic A');
  assert(BigInt(newerA.eventSeq)>BigInt(firstA.eventSeq),'source event sequence reflects the later routed input');
  const revisions=(await pool.query('select id,revision from public.conversations where id=any($1::uuid[]) order by id',[f.conversations])).rows;
  assert(revisions.every(row=>row.revision===0),'message appends do not advance conversation state revision');

  const verify=await pool.connect();
  try{
   assert.equal(await eligibleAIJob(verify,jobA),false,
    'a routed newer USER input in the same conversation must stale the earlier AI source');
   assert.equal(await eligibleAIJob(verify,jobB),true,
    'a newer input in topic A must not cancel an unchanged topic B job');
  }finally{verify.release();}
 }finally{await f.cleanup();}
});

test('actual Student ingress does not create a claimable AI job before the 1200ms quiet window',async()=>{
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key),eventId=`TURN_WINDOW_${randomUUID()}`;
 const lineMessageId=randomUUID();
 const event={type:'message',source:{type:'user',userId},message:{type:'text',id:lineMessageId,text:'A new question that should wait for the quiet window'}};
 let sessionId:string|undefined,inboxId:string|undefined;
 try{
  await persistWebhookEvents([{channel:'STUDENT',eventId,userHash,
   payloadEncrypted:encryptValue(JSON.stringify(event),key),eventKind:'MESSAGE'}],pool);
  inboxId=(await pool.query('select id from private.webhook_inbox where channel=\'STUDENT\' and event_id=$1',[eventId])).rows[0]?.id as string|undefined;
  assert(inboxId,'DURABLE_INGRESS_ROW');

  const processed=await runInboxCycle(pool,key,{aiEnabled:true});
  assert.deepEqual(processed,{claimed:1,completed:1,failed:0},'the real inbox worker routes and prepares the AI job without model calls');
  sessionId=(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[userHash])).rows[0]?.line_session_id as string|undefined;
  assert(sessionId,'ANONYMOUS_SESSION_CREATED');
  const row=(await pool.query(`select j.id,w.received_at from private.ai_jobs j
   join public.messages m on m.id=j.message_id join private.webhook_inbox w on w.id=m.source_event_id
   where w.id=$1 and j.line_session_id=$2`,[inboxId,sessionId])).rows[0];
  assert(row,'AI_JOB_PREPARED_FROM_INGRESS');
  const age=(await pool.query('select extract(epoch from(clock_timestamp()-received_at))*1000 ms from private.webhook_inbox where id=$1',[inboxId])).rows[0].ms;
  assert(Number(age)<1200,`fixture must reach claim inside the quiet window; observed ${age}ms`);

  const claim=await claimAIJob(pool);
  assert.equal(claim,null,'AI generation must wait until the 1200ms quiet period closes');
 }finally{
  if(sessionId){
   await pool.query('delete from private.delivery_attempts where outbox_id in(select id from private.message_outbox where line_session_id=$1)',[sessionId]);
   await pool.query('delete from private.message_outbox where line_session_id=$1',[sessionId]);
   await pool.query('delete from private.ai_jobs where line_session_id=$1',[sessionId]);
   await pool.query('delete from private.pending_route_choices where line_session_id=$1',[sessionId]);
   await pool.query('delete from public.messages where conversation_id in(select id from public.conversations where line_session_id=$1)',[sessionId]);
   await pool.query('delete from public.conversations where line_session_id=$1',[sessionId]);
   await pool.query('delete from private.line_identities where line_session_id=$1',[sessionId]);
   await pool.query('delete from public.line_sessions where id=$1',[sessionId]);
  }
  if(inboxId)await pool.query('delete from private.webhook_inbox where id=$1',[inboxId]);
  const windowTable=(await pool.query("select to_regclass('private.student_input_windows') as name")).rows[0].name;
  if(windowTable)await pool.query('delete from private.student_input_windows where user_hash=$1',[userHash]);
 }
});

test('a multi-message input window stops collecting at the three-second hard cap without charging an early AI attempt',async()=>{
 const f=await windowFixture();
 try{
  const firstAt=new Date(Date.now()+10000);
  const first=await f.addEvent('First short message',{receivedAt:firstAt});await f.routeNext();
  const second=await f.addEvent('Second short message',{receivedAt:new Date(firstAt.getTime()+1100)});await f.routeNext();
  const third=await f.addEvent('Third short message',{receivedAt:new Date(firstAt.getTime()+2200)});await f.routeNext();
  assert.equal(second.windowId,first.windowId,'the second message joins the open window inside the quiet period');
  assert.equal(third.windowId,first.windowId,'the third message joins before the hard cap');
  const schedule=(await pool.query(`select w.first_received_at,w.last_received_at,w.ready_at,
    w.ready_at=w.first_received_at+interval '3 seconds' capped,
    w.ready_at<w.last_received_at+interval '1200 milliseconds' cut_short
   from private.student_input_windows w where w.id=$1`,[first.windowId])).rows[0];
  assert.equal(schedule.capped,true,'ready_at is fixed by the first message plus three seconds');
  assert.equal(schedule.cut_short,true,'the final message would otherwise extend the quiet period beyond the hard cap');
  const jobs=(await pool.query(`select j.id,j.message_id,j.attempts,j.status,m.source_event_id
   from private.ai_jobs j join public.messages m on m.id=j.message_id where j.line_session_id=$1 order by j.job_seq`,[f.session])).rows;
  assert(jobs.length>=1,'the worker prepared an AI job for the routed messages');
  assert(jobs.every(job=>job.attempts===0),'pre-ready claims do not consume generation attempts');
  assert.equal(await claimAIJob(pool),null,'no job is claimable while the hard-capped collection window is still open');

  await f.makeWindowDue(first.windowId);
  const claimed=await claimAIJob(pool);
  assert(claimed,'the job becomes claimable once the bounded window is due');
  assert.equal(claimed.message_id,jobs.at(-1)!.message_id,'the latest same-topic message supplies the single generation turn');
  const sealed=(await pool.query('select sealed_at,degraded from private.student_input_windows where id=$1',[first.windowId])).rows[0];
  assert(sealed.sealed_at,'claim seals the due input window');
  assert.equal(sealed.degraded,false,'all successfully routed members seal without degradation');
 }finally{await f.cleanup();}
});

test('a duplicate Student webhook replay does not extend its input window',async()=>{
 const f=await windowFixture();
 try{
  const eventId=randomUUID(),first=await f.addEvent('Original webhook payload',{eventId});
  const before=(await pool.query(`select first_event_seq,last_event_seq,first_received_at,last_received_at,ready_at
   from private.student_input_windows where id=$1`,[first.windowId])).rows[0];
  const replay=await f.addEvent('Different replay payload is ignored',{eventId});
  const after=(await pool.query(`select first_event_seq,last_event_seq,first_received_at,last_received_at,ready_at
   from private.student_input_windows where id=$1`,[first.windowId])).rows[0];
  assert.equal(replay.id,first.id,'the unique channel/event key preserves the first durable inbox row');
  assert.equal(replay.windowId,first.windowId);
  assert.deepEqual(after,before,'replaying the same webhook key leaves all window watermarks unchanged');
  assert.equal((await pool.query(`select count(*)::int n from private.webhook_inbox where channel='STUDENT' and event_id=$1`,[eventId])).rows[0].n,1);
 }finally{await f.cleanup();}
});

test('a due window waits for every member inbox event to become terminal before sealing',async()=>{
 const f=await windowFixture();
 try{
  const firstAt=new Date(Date.now()+10000);
  const first=await f.addEvent('First routed member',{receivedAt:firstAt});await f.routeNext();
  const second=await f.addEvent('Second pending member',{receivedAt:new Date(firstAt.getTime()+500)});
  assert.equal(second.windowId,first.windowId);
  await f.makeWindowDue(first.windowId);
  assert.equal(await claimAIJob(pool),null,'a pending member keeps the entire window unclaimable');
  const open=(await pool.query(`select sealed_at,degraded from private.student_input_windows where id=$1`,[first.windowId])).rows[0];
  assert.equal(open.sealed_at,null,'a due timestamp alone does not seal while an inbox member is pending');
  assert.equal((await pool.query(`select attempts from private.ai_jobs where line_session_id=$1`,[f.session])).rows[0].attempts,0,
   'the blocked claim does not charge an AI attempt');

  await f.routeNext();
  const sealed=(await pool.query(`select sealed_at,degraded from private.student_input_windows where id=$1`,[first.windowId])).rows[0];
  assert(sealed.sealed_at,'the inbox cycle seals after the last member becomes DONE');
  assert.equal(sealed.degraded,false);
  const claimed=await claimAIJob(pool);
  assert(claimed,'the latest routed job becomes claimable after all window members are terminal');
 }finally{await f.cleanup();}
});

test('a sealed window is immutable and a later Student message starts a new window',async()=>{
 const f=await windowFixture();
 try{
  const first=await f.addEvent('First independently sealed topic');await f.routeNext();
  await f.makeWindowDue(first.windowId);
  assert(await claimAIJob(pool),'the due first window claims its generation job');
  const oldSequence=(await pool.query('select last_event_seq from private.student_input_windows where id=$1',[first.windowId])).rows[0].last_event_seq;
  const later=await f.addEvent('A later message after sealing');
  assert.notEqual(later.windowId,first.windowId,'new ingress cannot join a sealed window');
  const old=(await pool.query('select sealed_at,last_event_seq from private.student_input_windows where id=$1',[first.windowId])).rows[0];
  assert(old.sealed_at,'the original window remains sealed');
  assert.equal(old.last_event_seq,oldSequence,'new ingress does not mutate the sealed watermark');
 }finally{await f.cleanup();}
});

test('a DEAD member suppresses its whole window, sends one notice, and does not block a later window',async()=>{
 const f=await windowFixture();
 try{
  const firstAt=new Date(Date.now()+10000);
  const first=await f.addEvent('Successful member in a degraded burst',{receivedAt:firstAt});await f.routeNext();
  const dead=await f.addEvent('Member that exhausted inbox processing',{receivedAt:new Date(firstAt.getTime()+500)});
  assert.equal(dead.windowId,first.windowId);
  await pool.query(`update private.webhook_inbox set status='DEAD',attempts=5,last_error_code='PROCESSING_FAILED',
   lease_token=null,lease_until=null where id=$1`,[dead.id]);
  await f.makeWindowDue(first.windowId);
  assert.equal(await claimAIJob(pool),null,'a degraded window never produces a partial AI answer');
  const suppressed=(await pool.query(`select status,attempts,last_error_code from private.ai_jobs where line_session_id=$1`,[f.session])).rows[0];
  assert.equal(suppressed.status,'SUPPRESSED');
  assert.equal(suppressed.attempts,0);
  assert.equal(suppressed.last_error_code,'CONTEXT_CHANGED');
  const degraded=(await pool.query('select sealed_at,degraded from private.student_input_windows where id=$1',[first.windowId])).rows[0];
  assert(degraded.sealed_at);assert.equal(degraded.degraded,true);

  assert.equal(await flushDegradedInputNotices(pool,f.key),1,'a verified active anonymous identity receives one queued system notice');
  assert.equal(await flushDegradedInputNotices(pool,f.key),0,'a queued notice is not enqueued a second time');
  const notice=(await pool.query(`select w.notice_state,w.notice_outbox_id,o.idempotency_key
   from private.student_input_windows w left join private.message_outbox o on o.id=w.notice_outbox_id where w.id=$1`,[first.windowId])).rows[0];
  assert.equal(notice.notice_state,'QUEUED');
  assert.equal(notice.idempotency_key,`input-window:${first.windowId}:failure`);

  const later=await f.addEvent('A new independent message after the degraded window');
  assert.notEqual(later.windowId,first.windowId);
  await f.routeNext();
  await f.makeWindowDue(later.windowId);
  const laterJob=await claimAIJob(pool);
  assert(laterJob,'the later sealed window can generate despite the earlier degraded window');
  assert.equal((await pool.query(`select source_event_id from public.messages where id=$1`,[laterJob.message_id])).rows[0].source_event_id,later.id);
  assert.equal(await flushDegradedInputNotices(pool,f.key),0);
  assert.equal((await pool.query(`select count(*)::int n from private.message_outbox where idempotency_key=$1`,
   [`input-window:${first.windowId}:failure`])).rows[0].n,1,'notice idempotency remains stable after later inbox work');
 }finally{await f.cleanup();}
});

test('a degraded window with an inactive identity is marked undeliverable without inventing a recipient',async()=>{
 const f=await windowFixture({active:false});
 try{
  const event=await f.addEvent('A failed message for an inactive session');
  await pool.query(`update private.webhook_inbox set status='DEAD',attempts=5,last_error_code='PROCESSING_FAILED' where id=$1`,[event.id]);
  await f.makeWindowDue(event.windowId);
  assert.equal(await claimAIJob(pool),null);
  assert.equal(await flushDegradedInputNotices(pool,f.key),0);
  const state=(await pool.query('select notice_state,notice_outbox_id from private.student_input_windows where id=$1',[event.windowId])).rows[0];
  assert.equal(state.notice_state,'UNDELIVERABLE');
  assert.equal(state.notice_outbox_id,null);
  assert.equal((await pool.query('select count(*)::int n from private.message_outbox where line_session_id=$1',[f.session])).rows[0].n,0);
 }finally{await f.cleanup();}
});

test('a degraded notice with a mismatched encrypted identity retries without sending',async()=>{
 const f=await windowFixture();
 try{
  const event=await f.addEvent('A failed message with an invalid identity binding');
  const wrongUserId=`U${randomUUID().replaceAll('-','')}`;
  await pool.query('update private.line_identities set user_id_encrypted=$2 where user_hash=$1',
   [f.userHash,encryptValue(wrongUserId,f.key)]);
  await pool.query(`update private.webhook_inbox set status='DEAD',attempts=5,last_error_code='PROCESSING_FAILED' where id=$1`,[event.id]);
  await f.makeWindowDue(event.windowId);
  assert.equal(await claimAIJob(pool),null);
  assert.equal(await flushDegradedInputNotices(pool,f.key),0);
  const state=(await pool.query(`select notice_state,notice_outbox_id,notice_retry_at>clock_timestamp()+interval '4 minutes' retry_scheduled
   from private.student_input_windows where id=$1`,[event.windowId])).rows[0];
  assert.equal(state.notice_state,'PENDING','a temporary decryption/identity mismatch stays retryable');
  assert.equal(state.notice_outbox_id,null);
  assert.equal(state.retry_scheduled,true,'the next send attempt is delayed after the failed identity proof');
  assert.equal((await pool.query('select count(*)::int n from private.message_outbox where line_session_id=$1',[f.session])).rows[0].n,0);
 }finally{await f.cleanup();}
});
