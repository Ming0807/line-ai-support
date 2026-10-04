import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';

// This suite intentionally targets only the dedicated local development database.
const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';

test('concurrent claims preserve same-user order while another user progresses',async()=>{
 const setup=new Client({connectionString:localUrl});
 const a=new Client({connectionString:localUrl}),b=new Client({connectionString:localUrl});
 const suffix=randomUUID(),firstId=`queue-first-${suffix}`,secondId=`queue-second-${suffix}`,otherId=`queue-other-${suffix}`;
 const user=`queue-user-${suffix}`,otherUser=`queue-other-user-${suffix}`;
 await Promise.all([setup.connect(),a.connect(),b.connect()]);
 try {
  await setup.query('begin');
  await setup.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STUDENT',$1,$3,'encrypted'),('STUDENT',$2,$3,'encrypted'),('STUDENT',$4,$5,'encrypted')",[firstId,secondId,user,otherId,otherUser]);
  await setup.query('commit');

  const raced=await Promise.all([a.query("select * from private.claim_inbox('STUDENT')"),b.query("select * from private.claim_inbox('STUDENT')")]);
  const leases=raced.flatMap(result=>result.rows);
  assert.equal(leases.length,2,'two workers should each lease one available user');
  const first=leases.find(job=>job.event_id===firstId);
  const unrelated=leases.find(job=>job.event_id===otherId);
  assert.ok(first,'only the first event for a user may be leased');
  assert.ok(unrelated,'a different user must make progress concurrently');
  assert.equal(leases.some(job=>job.event_id===secondId),false,'a later same-user event must wait');

  assert.equal((await a.query("select * from private.claim_inbox('STUDENT')")).rowCount,0,'leased first event keeps its user lane blocked');
  assert.equal((await setup.query('update private.webhook_inbox set lease_until=clock_timestamp()+interval \'45 seconds\' where id=$1 and lease_token=$2',[first.id,first.lease_token])).rowCount,1,'owner may renew its lease');
  assert.equal((await b.query("select * from private.claim_inbox('STUDENT')")).rowCount,0,'renewed lease cannot be reclaimed');

  await setup.query('update private.webhook_inbox set lease_until=clock_timestamp()-interval \'1 millisecond\' where id=$1',[first.id]);
  const reclaimed=(await a.query("select * from private.claim_inbox('STUDENT')")).rows[0];
  assert.equal(reclaimed.id,first.id,'expired lease is reclaimed before later events');
  assert.notEqual(reclaimed.lease_token,first.lease_token,'reclaim fences the old worker');
  assert.equal(reclaimed.attempts,2);
  assert.equal((await setup.query("update private.webhook_inbox set status='DONE' where id=$1 and lease_token=$2 and lease_until>clock_timestamp()",[first.id,first.lease_token])).rowCount,0,'old lease token cannot acknowledge');
  await setup.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null where id=$1 and lease_token=$2",[reclaimed.id,reclaimed.lease_token]);
  const second=(await b.query("select * from private.claim_inbox('STUDENT')")).rows[0];
  assert.equal(second.event_id,secondId,'next same-user event proceeds after earlier completion');
  assert.ok(BigInt(second.event_seq)>BigInt(first.event_seq),'arrival order is stable within a batch');
 } finally {
  await setup.query('delete from private.webhook_inbox where event_id=any($1::text[])',[ [firstId,secondId,otherId] ]);
  await Promise.all([setup.end(),a.end(),b.end()]);
 }
});

test('concurrent workers cannot lease the same event',async()=>{
 const setup=new Client({connectionString:localUrl});
 const a=new Client({connectionString:localUrl}),b=new Client({connectionString:localUrl});
 const id=`queue-race-${randomUUID()}`;
 await Promise.all([setup.connect(),a.connect(),b.connect()]);
 try {
  await setup.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STAFF',$1,$1,'encrypted')",[id]);
  const results=await Promise.all([a.query("select * from private.claim_inbox('STAFF')"),b.query("select * from private.claim_inbox('STAFF')")]);
  assert.equal(results.reduce((sum,r)=>sum+(r.rowCount??0),0),1,'one lease winner');
 } finally {
  await setup.query('delete from private.webhook_inbox where event_id=$1',[id]);
  await Promise.all([setup.end(),a.end(),b.end()]);
 }
});

test('expired fifth attempt is marked dead and never leased again',async()=>{
 const client=new Client({connectionString:localUrl});
 const id=`queue-exhaust-${randomUUID()}`;
 await client.connect();
 try {
  await client.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted) values ('STAFF',$1,$1,'encrypted')",[id]);
  for(let attempt=1;attempt<=5;attempt++) {
   const job=(await client.query("select * from private.claim_inbox('STAFF')")).rows.find(row=>row.event_id===id);
   assert.ok(job,`attempt ${attempt} should be leased`);
   assert.equal(job.attempts,attempt);
   await client.query('update private.webhook_inbox set lease_until=clock_timestamp()-interval \'1 millisecond\' where id=$1',[job.id]);
  }
  const extra=await client.query("select * from private.claim_inbox('STAFF')");
  assert.equal(extra.rows.some(row=>row.event_id===id),false,'exhausted event is not re-leased');
  const final=(await client.query('select status,attempts,last_error_code from private.webhook_inbox where event_id=$1',[id])).rows[0];
  assert.deepEqual(final,{status:'DEAD',attempts:5,last_error_code:'LEASE_EXHAUSTED'});
 } finally {
  await client.query('delete from private.webhook_inbox where event_id=$1',[id]);
  await client.end();
 }
});
