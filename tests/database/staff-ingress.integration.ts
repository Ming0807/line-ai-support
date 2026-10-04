import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { decryptValue, encryptValue, hashLineUserId } from '../../lib/security/identity';
import { processInboxEvent } from '../../lib/queue/process-inbox';
import { classifyEventKind, type DirectUserEvent } from '../../lib/line/events';
import { persistStaffInboxEvent } from '../../lib/queue/staff-inbox';

// Deliberately isolated to the dedicated local Supabase database.
const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';

async function assertReadyQueuesEmpty(client:Client,channels:('STUDENT'|'STAFF')[]):Promise<void> {
 const ready=(await client.query(
  `select count(*)::int as count from private.webhook_inbox
    where channel=any($1::text[]) and ((status='PENDING' and available_at<=clock_timestamp())
      or (status='PROCESSING' and lease_until<=clock_timestamp()))`,
  [channels],
 )).rows[0].count;
 assert.equal(ready,0,'the dedicated queue channels must have no ready jobs before this focused fixture');
}

async function enqueue(client:Client,channel:'STUDENT'|'STAFF',eventId:string,userHash:string,event:unknown,key:string):Promise<string> {
 const result=await client.query(
  `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
   values ($1,$2,$3,$4,$5) returning id`,
  [channel,eventId,userHash,encryptValue(JSON.stringify(event),key),classifyEventKind(event)],
 );
 return result.rows[0].id as string;
}

async function claimAndProcess(client:Client,channel:'STUDENT'|'STAFF',id:string,key:string) {
 const job=(await client.query(`select * from private.claim_inbox($1) where id=$2`,[channel,id])).rows[0];
 assert.ok(job,'the fixture inbox event is claimable');
 await processInboxEvent(client,job,key);
 return job;
}

test('processing a claimed STAFF text event stores only encrypted private intake',async()=>{
 const client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64');
 const userId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key);
 const eventId=randomUUID(),messageId=randomUUID();
 const plaintext='Staff-only test message',replyToken='reply-token-private-marker';
 const event:DirectUserEvent & {replyToken:string}={type:'message',source:{type:'user',userId},message:{type:'text',id:messageId,text:plaintext},replyToken};
 await client.connect();
 try {
  await client.query('begin');
  await assertReadyQueuesEmpty(client,['STAFF']);
  const queued=(await client.query(
   `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
    values ('STAFF',$1,$2,$3,$4) returning id`,
   [eventId,userHash,encryptValue(JSON.stringify(event),key),classifyEventKind(event)],
  )).rows[0];
  const job=(await client.query("select * from private.claim_inbox('STAFF') where id=$1",[queued.id])).rows[0];
  assert.ok(job,'the STAFF inbox event is claimable');

  await assert.rejects(processInboxEvent(client,{...job,channel:'STUDENT'},key),/INVALID_CLAIM_CHANNEL/);
  assert.equal((await client.query('select count(*)::int as count from private.line_identities where user_hash=$1',[userHash])).rows[0].count,0,'a forged channel cannot trigger Student identity creation');

  const logLines:string[]=[];
  const originalLog=console.log,originalError=console.error;
  console.log=(...values:unknown[])=>{logLines.push(values.map(String).join(' '));};
  console.error=(...values:unknown[])=>{logLines.push(values.map(String).join(' '));};
  try { await processInboxEvent(client,job,key); }
  finally { console.log=originalLog; console.error=originalError; }
  const logs=logLines.join('\n');
  assert.equal(logs.includes(userId),false,'worker logs must not expose a raw LINE user ID');
  assert.equal(logs.includes(replyToken),false,'worker logs must not expose a reply token');
  assert.equal(logs.includes(plaintext),false,'worker logs must not expose message text');

  const identityCount=(await client.query('select count(*)::int as count from private.line_identities where user_hash=$1',[userHash])).rows[0].count;
  assert.equal(identityCount,0,'STAFF intake must never create a Student LINE identity');
  const studentRows=(await client.query(
   `select
      (select count(*)::int from public.line_sessions s join private.line_identities i on i.line_session_id=s.id where i.user_hash=$1)
      +(select count(*)::int from public.conversations c join public.line_sessions s on s.id=c.line_session_id join private.line_identities i on i.line_session_id=s.id where i.user_hash=$1)
      +(select count(*)::int from public.messages m where m.source_event_id=$2) as count`,
   [userHash,job.id],
  )).rows[0].count;
  assert.equal(studentRows,0,'STAFF intake must not create Student sessions, conversations, or messages');
  const stored=(await client.query('select user_hash,line_message_id,content_encrypted from private.staff_inbound_messages where source_event_id=$1',[job.id])).rows[0];
  assert.ok(stored,'encrypted Staff intake should be stored for the source event');
  assert.equal(stored.user_hash,userHash);
  assert.equal(stored.line_message_id,messageId);
  assert.notEqual(stored.content_encrypted,plaintext,'Staff text must not be stored in plaintext');
  assert.match(stored.content_encrypted,/^v1\./,'Staff text uses the versioned authenticated-encryption format');
  assert.equal(decryptValue(stored.content_encrypted,key),plaintext,'stored Staff intake decrypts with the server key');

  const duplicateResult=await persistStaffInboxEvent(client,{id:job.id,user_hash:userHash},event,key);
  assert.equal(duplicateResult,null,'duplicate processing is an accepted no-op');
  assert.equal((await client.query('select count(*)::int as count from private.staff_inbound_messages where source_event_id=$1',[job.id])).rows[0].count,1,'replay keeps one Staff intake row');
  const inboxState=(await client.query('select status,last_error_code from private.webhook_inbox where id=$1',[job.id])).rows[0];
  assert.deepEqual(inboxState,{status:'DONE',last_error_code:null});

  const columns=(await client.query(`select column_name from information_schema.columns
    where table_schema='private' and table_name='staff_inbound_messages'`)).rows.map(row=>row.column_name);
  assert.ok(columns.includes('content_encrypted'));
  assert.equal(columns.includes('content'),false,'private intake has no plaintext content column');
  assert.equal(columns.includes('user_id'),false,'private intake has no raw LINE user ID column');
 } finally {
  await client.query('rollback').catch(()=>undefined);
  await client.end();
 }
});

test('the same user, event ID, and message ID stay isolated between STUDENT and STAFF channels',async()=>{
 const client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key),eventId=`shared-event-${randomUUID()}`,messageId=randomUUID();
 const event={type:'message',source:{type:'user',userId},message:{type:'text',id:messageId,text:'same source message in two channels'}};
 await client.connect();
 try {
  await client.query('begin');
  await assertReadyQueuesEmpty(client,['STUDENT','STAFF']);
  const studentId=await enqueue(client,'STUDENT',eventId,userHash,event,key);
  const staffId=await enqueue(client,'STAFF',eventId,userHash,event,key);

  const studentJob=await claimAndProcess(client,'STUDENT',studentId,key);
  const staffJob=await claimAndProcess(client,'STAFF',staffId,key);

  assert.equal((await client.query('select count(*)::int as count from private.webhook_inbox where event_id=$1',[eventId])).rows[0].count,2,'event uniqueness is per channel');
  assert.equal((await client.query('select count(*)::int as count from private.line_identities where user_hash=$1',[userHash])).rows[0].count,1,'only the Student channel owns an anonymous identity');
  assert.equal((await client.query('select count(*)::int as count from public.messages where source_event_id=$1',[studentJob.id])).rows[0].count,1,'Student message processing remains available');
  assert.equal((await client.query('select count(*)::int as count from public.messages where source_event_id=$1',[staffJob.id])).rows[0].count,0,'Staff processing creates no Student message');
  assert.equal((await client.query('select count(*)::int as count from private.staff_inbound_messages where source_event_id=$1',[staffJob.id])).rows[0].count,1,'Staff event is stored in its isolated private table');
  const state=(await client.query('select channel,status,last_error_code from private.webhook_inbox where event_id=$1 order by channel',[eventId])).rows;
  assert.deepEqual(state,[
   {channel:'STAFF',status:'DONE',last_error_code:null},
   {channel:'STUDENT',status:'DONE',last_error_code:null},
  ]);
 } finally {
  await client.query('rollback').catch(()=>undefined);
  await client.end();
 }
});

test('Staff follow and non-text events are completed unsupported without Student rows',async()=>{
 const client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key),followId=`unsupported-follow-${randomUUID()}`,imageId=`unsupported-image-${randomUUID()}`;
 const events:DirectUserEvent[]=[
  {type:'follow',source:{type:'user',userId}},
  {type:'message',source:{type:'user',userId},message:{type:'image',id:randomUUID()}},
 ];
 await client.connect();
 try {
  await client.query('begin');
  await assertReadyQueuesEmpty(client,['STAFF']);
  const ids=[
   await enqueue(client,'STAFF',followId,userHash,events[0],key),
   await enqueue(client,'STAFF',imageId,userHash,events[1],key),
  ];
  for(const id of ids) await claimAndProcess(client,'STAFF',id,key);

  const statuses=(await client.query('select last_error_code from private.webhook_inbox where id=any($1::uuid[]) order by event_seq', [ids])).rows.map(row=>row.last_error_code);
  assert.deepEqual(statuses,['UNSUPPORTED_EVENT','UNSUPPORTED_EVENT']);
  assert.equal((await client.query('select count(*)::int as count from private.line_identities where user_hash=$1',[userHash])).rows[0].count,0);
  assert.equal((await client.query('select count(*)::int as count from public.line_sessions s join private.line_identities i on i.line_session_id=s.id where i.user_hash=$1',[userHash])).rows[0].count,0);
  assert.equal((await client.query('select count(*)::int as count from public.conversations c join public.line_sessions s on s.id=c.line_session_id join private.line_identities i on i.line_session_id=s.id where i.user_hash=$1',[userHash])).rows[0].count,0);
  assert.equal((await client.query('select count(*)::int as count from public.messages where source_event_id=any($1::uuid[])',[ids])).rows[0].count,0);
  assert.equal((await client.query('select count(*)::int as count from private.staff_inbound_messages where source_event_id=any($1::uuid[])',[ids])).rows[0].count,0);
 } finally {
  await client.query('rollback').catch(()=>undefined);
  await client.end();
 }
});

test('Staff rate limit uses inbox arrival order, excludes other channels and non-message events',async()=>{
 const client=new Client({connectionString:localUrl});
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,otherUserId=`U${randomUUID().replaceAll('-','')}`;
 const userHash=hashLineUserId(userId,key),otherHash=hashLineUserId(otherUserId,key);
 await client.connect();
 try {
  await client.query('begin');
  await assertReadyQueuesEmpty(client,['STUDENT','STAFF']);
  await enqueue(client,'STUDENT',`student-budget-${randomUUID()}`,userHash,
   {type:'message',source:{type:'user',userId},message:{type:'text',id:randomUUID(),text:'Other channel does not consume Staff budget'}},key);
  await enqueue(client,'STAFF',`staff-follow-budget-${randomUUID()}`,userHash,{type:'follow',source:{type:'user',userId}},key);
  await enqueue(client,'STAFF',`staff-other-budget-${randomUUID()}`,userHash,{type:'other',source:{type:'user',userId}},key);
  await enqueue(client,'STAFF',`staff-other-user-${randomUUID()}`,otherHash,
   {type:'message',source:{type:'user',userId:otherUserId},message:{type:'text',id:randomUUID(),text:'Other user does not consume budget'}},key);

  const messageEvents=Array.from({length:21},()=>({
   type:'message' as const,
   source:{type:'user' as const,userId},
   message:{type:'text' as const,id:randomUUID(),text:'Arrival-ordered Staff message'},
  }));
  const ids:string[]=[];
  for(const event of messageEvents) ids.push(await enqueue(client,'STAFF',`staff-rate-${randomUUID()}`,userHash,event,key));

  const outcomes:string[]=[];
  for(let index=0;index<messageEvents.length;index++) {
   const outcome=await persistStaffInboxEvent(client,{id:ids[index],user_hash:userHash},messageEvents[index],key);
   outcomes.push(outcome ?? 'STORED');
  }
  assert.equal(outcomes.filter((value)=>value==='STORED').length,20);
  assert.equal(outcomes.filter((value)=>value==='RATE_LIMITED').length,1);
  assert.equal((await client.query('select count(*)::int as count from private.staff_inbound_messages where source_event_id=any($1::uuid[])',[ids])).rows[0].count,20);
 } finally {
  await client.query('rollback').catch(()=>undefined);
  await client.end();
 }
});

test('private Staff intake denies browser roles and rejects a STUDENT source event',async()=>{
 const client=new Client({connectionString:localUrl});
 const userHash=Buffer.from(randomBytes(32)).toString('hex'),eventId=`student-fk-${randomUUID()}`;
 await client.connect();
 try {
  await client.query('begin');
  const privileges=(await client.query(`select
    has_schema_privilege('anon','private','USAGE') as anon_schema,
    has_schema_privilege('authenticated','private','USAGE') as authenticated_schema,
    has_table_privilege('anon','private.staff_inbound_messages','SELECT,INSERT,UPDATE,DELETE') as anon_table,
    has_table_privilege('authenticated','private.staff_inbound_messages','SELECT,INSERT,UPDATE,DELETE') as authenticated_table,
    has_table_privilege('service_role','private.staff_inbound_messages','SELECT,INSERT,UPDATE,DELETE') as server_table,
    c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='staff_inbound_messages'`)).rows[0];
  assert.deepEqual(privileges,{anon_schema:false,authenticated_schema:true,anon_table:false,authenticated_table:false,server_table:true,rls:true});

  const student=(await client.query(
   `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
    values ('STUDENT',$1,$2,'encrypted-fixture','MESSAGE') returning id`,[eventId,userHash],
  )).rows[0];
  await client.query('savepoint reject_student_source');
  await assert.rejects(
   client.query(`insert into private.staff_inbound_messages(source_event_id,user_hash,line_message_id,content_encrypted)
    values ($1,$2,$3,'v1.fixture')`,[student.id,userHash,randomUUID()]),
   (error:unknown)=>typeof error==='object' && error!==null && 'code' in error && error.code==='23503',
  );
  await client.query('rollback to savepoint reject_student_source');
  assert.equal((await client.query('select count(*)::int as count from private.staff_inbound_messages where source_event_id=$1',[student.id])).rows[0].count,0);
 } finally {
  await client.query('rollback').catch(()=>undefined);
  await client.end();
 }
});
