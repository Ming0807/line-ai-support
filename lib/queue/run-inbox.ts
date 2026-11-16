import type { Pool } from 'pg';
import { transaction } from '../database/pool';
import { processInboxEvent, type InboxJob } from './process-inbox';
import type {StudentProcessingOptions} from '../conversation/student-processing';
import {classifyStudentInboxContext} from '../conversation/semantic-routing';
import {recordRoutingObservation,type RoutingDecisionObservation} from '../conversation/routing-telemetry';
import type {SemanticClassifier} from '../conversation/semantic-routing-contracts';
import {flushDegradedInputNotices} from '../conversation/input-windows';
import {decryptValue} from '../security/identity';
import {startLineLoading,type LineLoadingSeconds} from '../line/loading';

export interface InboxLoadingOptions {accessToken?:string;fetchImpl?:typeof fetch;seconds?:LineLoadingSeconds}

/**
 * CONV-BURST-01 (DEC-206): the Student sees the loading animation as soon as a new input window opens with
 * an AI job, instead of only after the (now longer) collection window. Runs after commit, outside SQL;
 * only the first event of a still-open window qualifies, so later fragments never restart it. Best effort.
 */
async function showWindowLoading(pool:Pool,key:string,eventId:string,options:InboxLoadingOptions):Promise<void>{
 if(!options.accessToken)return;
 try{
  const row=(await pool.query(`select i.user_id_encrypted from private.webhook_inbox e
   join private.student_input_windows w on w.id=e.input_window_id and w.first_event_seq=e.event_seq and w.sealed_at is null
   join public.messages m on m.source_event_id=e.id and m.sender_type='USER'
   join private.ai_jobs j on j.message_id=m.id and j.status='PENDING' and j.attempts=0
   join private.line_identities i on i.line_session_id=j.line_session_id and i.user_hash=e.user_hash
   join public.line_sessions s on s.id=i.line_session_id and s.active
   where e.id=$1 and e.channel='STUDENT' and e.event_kind='MESSAGE' and e.received_at>clock_timestamp()-interval '20 seconds' limit 1`,[eventId])).rows[0];
  if(!row)return;
  await startLineLoading({recipientId:decryptValue(row.user_id_encrypted,key),loadingSeconds:options.seconds??20},
   {accessToken:options.accessToken,fetchImpl:options.fetchImpl,timeoutMs:1000});
 }catch{console.warn('LINE_LOADING_UNAVAILABLE');}
}

/** Service one job per fixed channel so a busy Student lane cannot starve Staff. */
export async function runInboxCycle(pool:Pool,key:string,options:StudentProcessingOptions&{classify?:SemanticClassifier;classifyForJob?:(job:InboxJob)=>SemanticClassifier;loading?:InboxLoadingOptions}={}):Promise<{claimed:number;completed:number;failed:number}> {
 const result={claimed:0,completed:0,failed:0};
 for(const channel of ['STUDENT','STAFF'] as const) {
  let job:InboxJob|undefined;
  try {
   job=(await pool.query('select * from private.claim_inbox($1)',[channel])).rows[0];
   if(!job) continue;
   result.claimed++;
   const claimed=job;
   const classify=options.aiEnabled&&channel==='STUDENT'?(options.classifyForJob?.(claimed)??options.classify):undefined;
   let routingUnavailable=false;
   const routingAdvice=classify?await classifyStudentInboxContext(pool,claimed,key,classify,reason=>{
    routingUnavailable=true;console.warn('INBOX_ROUTING_UNAVAILABLE',{channel,reason});
   }):null;
   const processing:StudentProcessingOptions={aiEnabled:options.aiEnabled,routingAdvice:routingAdvice??undefined,routingUnavailable,
    routingObservation:(observation:RoutingDecisionObservation)=>recordRoutingObservation(pool,{...observation,inboxEventId:claimed.id})};
   await transaction(client=>processInboxEvent(client,claimed,key,processing),pool);
   result.completed++;
   console.info('INBOX_PROCESSED',{channel});
   if(channel==='STUDENT'&&options.aiEnabled&&options.loading)await showWindowLoading(pool,key,claimed.id,options.loading);
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
 await flushDegradedInputNotices(pool,key);
 return result;
}
