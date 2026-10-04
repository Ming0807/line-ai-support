import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { getDatabasePool, transaction } from '../lib/database/pool';
import { processInboxEvent, type InboxJob } from '../lib/queue/process-inbox';

const key=process.env.ENCRYPTION_KEY;
if(!key || !process.env.DATABASE_URL) throw new Error('WORKER_NOT_CONFIGURED');
const pool=getDatabasePool();
let stopped=false;
process.on('SIGINT',()=>{stopped=true;});
process.on('SIGTERM',()=>{stopped=true;});

try {
 while(!stopped) {
  let job:InboxJob|undefined;
  try {
   job=(await pool.query("select * from private.claim_inbox('STUDENT')")).rows[0];
   if(!job){await delay(1000);continue;}
   const claimed=job;
   await transaction(client=>processInboxEvent(client,claimed,key),pool);
  } catch {
   // Log only bounded operational codes; event bodies and identifiers stay encrypted.
   console.error('INBOX_PROCESSING_FAILED');
   if(job) await pool.query(
    `update private.webhook_inbox set status=case when attempts>=5 then 'DEAD' else 'PENDING' end,
     available_at=now()+make_interval(secs=>least(300,power(2,attempts)::int)),
     lease_token=null,lease_until=null,last_error_code='PROCESSING_FAILED'
     where id=$1 and lease_token=$2 and status='PROCESSING'`,[job.id,job.lease_token]).catch(()=>{});
   await delay(1000);
  }
 }
} finally {await pool.end();}
