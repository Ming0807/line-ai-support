import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runInboxCycle } from '../../lib/queue/run-inbox';
import { runOutboxCycle } from '../../lib/queue/run-outbox';
import { decryptValue, hashLineUserId } from '../../lib/security/identity';

// Only a separately launched local-database Next server may be exercised here.
const base=new URL(process.env.LINE_TEST_BASE_URL ?? 'http://127.0.0.1:3001');
assert(['127.0.0.1','localhost'].includes(base.hostname) && base.port==='3001','ISOLATED_LOCAL_HTTP_SERVER_REQUIRED');
const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2});
const key=process.env.ENCRYPTION_KEY;
assert(key,'TEST_ENCRYPTION_KEY_REQUIRED');
const suffix=randomUUID(),userId=`U${suffix.replaceAll('-','')}`,hash=hashLineUserId(userId,key);
const eventId=`http-durable-${suffix}`,messageId=`http-message-${suffix}`,text='ทดสอบฐานข้อมูล';
let stage='start';
async function post(channel:'STUDENT'|'STAFF',valid=true) {
 const secret=process.env[`LINE_${channel}_CHANNEL_SECRET`];
 assert(secret,'TEST_CHANNEL_SECRET_REQUIRED');
 const body=JSON.stringify({events:[{type:'message',webhookEventId:eventId,source:{type:'user',userId},
  message:{type:'text',id:messageId,text},timestamp:Date.now()}]});
 const response=await fetch(new URL(`/api/line/${channel.toLowerCase()}/webhook`,base),{method:'POST',body,
  headers:{'x-line-signature':valid?createHmac('sha256',secret).update(body).digest('base64'):'invalid'}});
 assert.equal(response.status,valid?200:401);
}
try {
 stage='signed_http_ingress';
 await post('STUDENT'); await post('STUDENT'); await post('STAFF'); await post('STAFF');
 await post('STUDENT',false); await post('STAFF',false);
 const persisted=await pool.query('select id,channel,status,payload_encrypted from private.webhook_inbox where event_id=$1 order by channel',[eventId]);
 assert.equal(persisted.rowCount,2,'commit exists before HTTP acknowledgement and channel dedup holds');
 assert(persisted.rows.every(row=>row.status==='PENDING' && !row.payload_encrypted.includes(userId)));
 stage='actual_worker_cycle';
 const cycle=await runInboxCycle(pool,key);
 assert.equal(cycle.completed,2); assert.equal(cycle.failed,0);
 assert.equal((await runInboxCycle(pool,key)).claimed,0);
 await post('STUDENT'); await post('STAFF');
 assert.equal((await runInboxCycle(pool,key)).claimed,0,'redelivery after completion has no second processing effect');
 const staff=await pool.query('select content_encrypted from private.staff_inbound_messages where line_message_id=$1',[messageId]);
 const student=await pool.query('select content from public.messages where line_message_id=$1',[messageId]);
 assert.equal(staff.rowCount,1); assert.equal(student.rowCount,1);
 assert.equal(student.rows[0].content,text); assert.equal(decryptValue(staff.rows[0].content_encrypted,key),text);
 const identity=await pool.query('select count(*)::int as count from private.line_identities where user_hash=$1',[hash]);
 assert.equal(identity.rows[0].count,1,'only the Student event creates an anonymous identity');
 const done=await pool.query("select count(*)::int as count from private.webhook_inbox where event_id=$1 and status='DONE'",[eventId]);
 assert.equal(done.rows[0].count,2);
  let sent=0;
  const delivery=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl:async()=>{sent++;return new Response(null,{status:200});}});
  assert.equal(delivery.sent,1);assert.equal(sent,1,'one worker response only through controlled transport');
  assert.equal((await runOutboxCycle(pool,key,{fetchImpl:async()=>{throw new Error('UNEXPECTED_SECOND_SEND');}})).claimed,0);
 console.log(JSON.stringify({stage:'durable_http_verified',signedIngress:true,commitBefore200:true,
  inboxRows:2,studentMessages:1,privateStaffMessages:1,studentIdentities:1,redeliveryIdempotent:true,channelIsolation:true,controlledOutboxSends:1}));
} catch {
 console.error(JSON.stringify({code:'DURABLE_HTTP_CHECK_FAILED',stage}));process.exitCode=1;
} finally {
 // Fixed dedicated local URL above; every cleanup predicate is this fixture only.
 const sessions=(await pool.query('select line_session_id from private.line_identities where user_hash=$1',[hash])).rows.map(row=>row.line_session_id);
 await pool.query('delete from private.delivery_attempts where outbox_id in(select id from private.message_outbox where line_session_id=any($1::uuid[]))',[sessions]);
 await pool.query('delete from private.message_outbox where line_session_id=any($1::uuid[])',[sessions]);
 await pool.query('delete from private.pending_route_choices where line_session_id=any($1::uuid[])',[sessions]);
 await pool.query('delete from private.staff_inbound_messages where source_event_id in (select id from private.webhook_inbox where event_id=$1)',[eventId]);
 await pool.query('delete from public.messages where source_event_id in (select id from private.webhook_inbox where event_id=$1)',[eventId]);
 await pool.query('delete from public.conversations where line_session_id=any($1::uuid[])',[sessions]);
 await pool.query('delete from private.line_identities where user_hash=$1',[hash]);
 await pool.query('delete from public.line_sessions where id=any($1::uuid[])',[sessions]);
 await pool.query('delete from private.webhook_inbox where event_id=$1',[eventId]);
 await pool.end();
}
