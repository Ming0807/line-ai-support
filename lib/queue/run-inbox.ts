import type { Pool } from 'pg';
import { transaction } from '../database/pool';
import { processInboxEvent, type InboxJob } from './process-inbox';
import type {StudentProcessingOptions} from '../conversation/student-processing';

/** Service one job per fixed channel so a busy Student lane cannot starve Staff. */
export async function runInboxCycle(pool:Pool,key:string,options:StudentProcessingOptions={}):Promise<{claimed:number;completed:number;failed:number}> {
 const result={claimed:0,completed:0,failed:0};
 for(const channel of ['STUDENT','STAFF'] as const) {
  let job:InboxJob|undefined;
  try {
   job=(await pool.query('select * from private.claim_inbox($1)',[channel])).rows[0];
   if(!job) continue;
   result.claimed++;
   const claimed=job;
   await transaction(client=>processInboxEvent(client,claimed,key,options),pool);
   result.completed++;
   console.info('INBOX_PROCESSED',{channel});
  } catch {
   result.failed++;
   console.error(job?'INBOX_PROCESSING_FAILED':'INBOX_CLAIM_FAILED',{channel});
   if(job) await pool.query(`update private.webhook_inbox
    set status=case when attempts>=5 then 'DEAD' else 'PENDING' end,
     available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempts)::int)),
     lease_token=null,lease_until=null,last_error_code='PROCESSING_FAILED'
    where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()`,
   [job.id,job.lease_token]).catch(()=>{console.error('INBOX_RETRY_UPDATE_FAILED',{channel});});
  }
 }
 return result;
}
