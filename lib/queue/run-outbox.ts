import type {Pool} from 'pg';
import {z} from 'zod';
import {decryptValue,hashLineUserId,hashStaffLineUserId} from '../security/identity';
import {deliverLine,type LineMessage} from '../line/delivery';
import {eligibleScopeSql} from '../tickets/authorization';
import {validateOutboxTarget} from './outbox-target';

export interface OutboxOptions {accessTokens?:{STUDENT:string;STAFF:string};fetchImpl?:typeof fetch}
interface OutboxJob {id:string;channel:'STUDENT'|'STAFF';lease_token:string;line_session_id:string|null;recipient_staff_id:string|null;recipient_user_id_encrypted:string|null;conversation_id:string|null;ticket_id:string|null;kind:string;expected_conversation_revision:number|null;payload_encrypted:string;delivery_mode:'REPLY'|'PUSH';reply_deadline_at:Date|null;line_retry_key:string;attempts:number;first_attempt_at:Date|null}
const payloadSchema=z.object({messages:z.array(z.object({type:z.literal('text'),text:z.string().min(1).max(5000),quickReply:z.object({items:z.array(z.object({type:z.literal('action'),action:z.object({type:z.literal('postback'),label:z.string().min(1).max(20),data:z.string().max(300),displayText:z.string().max(300).optional()}).strict()}).strict()).min(1).max(13)}).strict().optional()}).strict()).min(1).max(5),replyToken:z.string().min(1).max(512).optional()}).strict();

/** Pool must be a dedicated session-mode pool, never a transaction-mode PgBouncer pool. */
export async function runOutboxCycle(pool:Pool,key:string,options:OutboxOptions={}):Promise<{claimed:number;sent:number;failed:number}> {
 const result={claimed:0,sent:0,failed:0};
 for(const channel of ['STUDENT','STAFF'] as const){
  let job:OutboxJob|undefined;
  try{
   job=(await pool.query('select * from private.claim_outbox($1)',[channel])).rows[0];if(!job)continue;result.claimed++;
   const client=await pool.connect(),locks:string[]=[];let discard=false;
   try{
    if(job.conversation_id)locks.push(`conversation:${job.conversation_id}`);
    locks.push(`delivery:${channel}:${job.line_session_id??job.recipient_staff_id}`);
    for(const lock of locks)await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);
    const current=(await client.query("select * from private.message_outbox where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()",[job.id,job.lease_token])).rows[0] as OutboxJob|undefined;
    if(!current)continue;job=current;
    validateOutboxTarget({channel:job.channel,kind:job.kind,lineSessionId:job.line_session_id,
     recipientStaffId:job.recipient_staff_id,conversationId:job.conversation_id,ticketId:job.ticket_id,deliveryMode:job.delivery_mode});
    let suppress:string|null=null;
    if(job.kind==='AI'){
     const allowed=(await client.query(`select c.id from public.conversations c where c.id=$1 and c.mode='AI' and c.revision=$2 and c.status in ('ACTIVE','WAITING')
      and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in ('CLOSED','CANCELLED'))`,[job.conversation_id,job.expected_conversation_revision])).rowCount===1;
     if(!allowed)suppress='HUMAN_OR_STALE_AI';
    }
    let identity:{user_id_encrypted:string;user_hash:string}|undefined;
    if(channel==='STUDENT'){
     identity=(await client.query('select i.user_id_encrypted,i.user_hash from private.line_identities i join public.line_sessions s on s.id=i.line_session_id and s.active where i.line_session_id=$1',[job.line_session_id])).rows[0];
    }else{
     const ticket=(await client.query('select department_id,sensitive_level from public.tickets where id=$1',[job.ticket_id])).rows[0];
     if(ticket){
      identity=(await client.query(`select i.user_id_encrypted,i.user_hash from private.staff_line_identities i join public.staff_profiles s on s.id=i.staff_id where i.staff_id=$3 and i.active and ${eligibleScopeSql}`,[ticket.department_id,ticket.sensitive_level,job.recipient_staff_id])).rows[0];
     }
    }
    if(!identity)suppress='RECIPIENT_INACTIVE_OR_DENIED';
    if(suppress){await client.query("update private.message_outbox set status='SUPPRESSED',last_error_code=$3,lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=$1 and lease_token=$2 and lease_until>clock_timestamp()",[job.id,job.lease_token,suppress]);continue;}
    const currentRecipient=decryptValue(identity!.user_id_encrypted,key);
    const recipientId=job.recipient_user_id_encrypted?decryptValue(job.recipient_user_id_encrypted,key):currentRecipient;
    if(recipientId!==currentRecipient){await client.query("update private.message_outbox set status='SUPPRESSED',last_error_code='RECIPIENT_CHANGED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=$1 and lease_token=$2 and lease_until>clock_timestamp()",[job.id,job.lease_token]);continue;}
    if(identity!.user_hash!==(channel==='STUDENT'?hashLineUserId(recipientId,key):hashStaffLineUserId(recipientId,key)))throw new Error('RECIPIENT_IDENTITY_MISMATCH');
    const payload=payloadSchema.parse(JSON.parse(decryptValue(job.payload_encrypted,key)));
    const now=new Date();
    const validToken=typeof payload.replyToken==='string'&&payload.replyToken.trim()===payload.replyToken;
    const remaining=job.reply_deadline_at?job.reply_deadline_at.getTime()-now.getTime():0;
    const mode=job.delivery_mode==='REPLY'&&job.attempts===0&&(!validToken||remaining<=0||remaining>60_000)?'PUSH':job.delivery_mode;
    // Persist a committed attempt before HTTP. Network runs with session advisory locks but no open SQL transaction.
    const begun=await client.query(`update private.message_outbox set delivery_mode=$3,recipient_user_id_encrypted=coalesce(recipient_user_id_encrypted,$4),attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_until=clock_timestamp()+interval '60 seconds'
     where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp() returning id`,[job.id,job.lease_token,mode,identity!.user_id_encrypted]);
    if(begun.rowCount!==1)continue;
    const delivery=await deliverLine({channel,mode,recipientId,replyToken:payload.replyToken,messages:payload.messages as LineMessage[],retryKey:job.line_retry_key,firstAttemptAt:job.first_attempt_at,replyDeadlineAt:job.reply_deadline_at,attempts:job.attempts},
     {accessToken:options.accessTokens?.[channel]??process.env[`LINE_${channel}_CHANNEL_ACCESS_TOKEN`]??'',fetchImpl:options.fetchImpl,timeoutMs:5000,now:()=>now});
    const errorCode='errorCode' in delivery?delivery.errorCode:null;
    const finalStatus=delivery.status==='RETRY'?(job.attempts+1>=5?'DEAD':'PENDING'):delivery.status;
    await client.query('begin');
    try{
     const finished=await client.query(`update private.message_outbox set status=$3,last_error_code=$4,lease_token=null,lease_until=null,
      available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempts)::int)),completed_at=case when $3='PENDING' then null else clock_timestamp() end
      where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp() returning id`,[job.id,job.lease_token,finalStatus,errorCode]);
     if(finished.rowCount!==1)throw new Error('STALE_OUTBOX_LEASE');
     await client.query('insert into private.delivery_attempts(outbox_id,http_status,request_id,error_code,accepted) values($1,$2,$3,$4,$5)',[job.id,delivery.httpStatus??null,delivery.requestId??null,errorCode,delivery.status==='SENT']);
     await client.query('commit');
    }catch(error){await client.query('rollback');throw error;}
    if(delivery.status==='SENT')result.sent++;else result.failed++;
    console.info('OUTBOX_DELIVERY',{channel,status:finalStatus});
   }finally{
    try{for(const lock of [...locks].reverse())await client.query('select pg_advisory_unlock(hashtextextended($1,0))',[lock]);}
    catch{discard=true;console.error('OUTBOX_UNLOCK_FAILED',{channel});}
    client.release(discard);
   }
  }catch(error){
   result.failed++;console.error('OUTBOX_PROCESSING_FAILED',{channel});
   const permanent=error instanceof SyntaxError||error instanceof z.ZodError||
    (error instanceof Error&&['INVALID_ENCRYPTED_VALUE','INVALID_ENCRYPTION_KEY','RECIPIENT_IDENTITY_MISMATCH','INVALID_OUTBOX_CHANNEL_KIND','INVALID_OUTBOX_TARGET'].includes(error.message));
   if(job)await pool.query(`update private.message_outbox set processing_failures=processing_failures+1,
     status=case when delivery_mode='REPLY' and attempts>0 then 'UNKNOWN'
      when $3 or processing_failures+1>=5 or attempts>=5 or first_attempt_at<=clock_timestamp()-interval '24 hours' then 'DEAD' else 'PENDING' end,
     last_error_code='DELIVERY_PROCESSING_FAILED',lease_token=null,lease_until=null,
     completed_at=case when (delivery_mode='REPLY' and attempts>0) or $3 or processing_failures+1>=5 or attempts>=5 or first_attempt_at<=clock_timestamp()-interval '24 hours' then clock_timestamp() else null end,
     available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,processing_failures+1)::int))
    where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()`,
    [job.id,job.lease_token,permanent]).catch(()=>console.error('OUTBOX_FAILURE_UPDATE_FAILED',{channel}));
  }
 }
 return result;
}
