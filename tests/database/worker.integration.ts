import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { runInboxCycle } from '../../lib/queue/run-inbox';

const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';

test('a real worker cycle backs off failures, fences retries, and stops after five attempts',async()=>{
 const pool=new Pool({connectionString:localUrl,max:2});
 const eventId=`worker-failure-${randomUUID()}`,key=randomBytes(32).toString('base64');
 try {
  await pool.query("insert into private.webhook_inbox(channel,event_id,payload_encrypted) values ('STUDENT',$1,'invalid-encrypted-fixture')",[eventId]);
  for(let attempt=1;attempt<=5;attempt++) {
   const result=await runInboxCycle(pool,key);
   assert.equal(result.claimed,1);
   assert.equal(result.failed,1);
   const row=(await pool.query('select attempts,status,lease_token,lease_until,available_at>clock_timestamp() as backed_off from private.webhook_inbox where event_id=$1',[eventId])).rows[0];
   assert.equal(row.attempts,attempt);
   assert.equal(row.status,attempt===5?'DEAD':'PENDING');
   assert.equal(row.lease_token,null);
   assert.equal(row.lease_until,null);
   assert.equal(row.backed_off,true);
   // Advance only this fixture's availability; do not wait on real backoff time.
   await pool.query('update private.webhook_inbox set available_at=clock_timestamp() where event_id=$1',[eventId]);
  }
  assert.equal((await runInboxCycle(pool,key)).claimed,0,'dead-letter does not loop indefinitely');
 } finally {
  await pool.query('delete from private.webhook_inbox where event_id=$1',[eventId]);
  await pool.end();
 }
});
