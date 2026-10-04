import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { userEventSchema } from '../line/events';
import { decryptValue, encryptValue, hashLineUserId } from '../security/identity';
import { persistStaffInboxEvent } from './staff-inbox';
export interface InboxJob { id:string; channel:'STUDENT'|'STAFF'; lease_token:string; payload_encrypted:string; user_hash:string|null; attempts:number; }

/** Caller owns the transaction. Every effect rolls back if the lease cannot be completed. */
export async function processInboxEvent(client:Pick<PoolClient,'query'>,job:InboxJob,key:string):Promise<void> {
 const lease=await client.query("select id,channel from private.webhook_inbox where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp() for update",[job.id,job.lease_token]);
 if(lease.rowCount!==1) throw new Error('STALE_LEASE');
 if(!['STUDENT','STAFF'].includes(job.channel) || lease.rows[0].channel!==job.channel) throw new Error('INVALID_CLAIM_CHANNEL');
 let errorCode:string|null=null;
 const parsed=userEventSchema.safeParse(JSON.parse(decryptValue(job.payload_encrypted,key)));
 if(!parsed.success){errorCode='UNSUPPORTED_EVENT';}
 else {
  const event=parsed.data,hash=hashLineUserId(event.source.userId,key);
  if(job.user_hash!==hash) throw new Error('IDENTITY_MISMATCH');
  if(job.channel==='STAFF') {
   errorCode=await persistStaffInboxEvent(client,job,event,key);
  } else {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`processing:${job.channel}:${hash}`]);
  let session=(await client.query('select line_session_id from private.line_identities where user_hash=$1',[hash])).rows[0];
  if(!session) {
   const created=await client.query('insert into public.line_sessions(anonymous_code) values ($1) returning id',[`Anonymous #${randomBytes(6).toString('hex').toUpperCase()}`]);
   session={line_session_id:created.rows[0].id};
   await client.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values ($1,$2,$3)',[session.line_session_id,hash,encryptValue(event.source.userId,key)]);
  }
  if(event.type==='follow' || event.type==='unfollow') {
   await client.query('update public.line_sessions set active=$2,updated_at=now() where id=$1',[session.line_session_id,event.type==='follow']);
  } else if(event.type==='message' && event.message) {
   const recent=await client.query(`select count(*)::int as count from private.webhook_inbox prior
    join private.webhook_inbox current_event on current_event.id=$2
    where prior.user_hash=$1 and prior.channel=current_event.channel and prior.event_kind='MESSAGE'
     and prior.received_at>current_event.received_at-interval '1 minute'
     and prior.received_at<=current_event.received_at and prior.event_seq<current_event.event_seq`,[hash,job.id]);
   if(recent.rows[0].count>=20){errorCode='RATE_LIMITED';}
   else {
    // Foundation storage; Phase 2 replaces this selection with the validated multi-topic router.
    let conversation=(await client.query("select id from public.conversations where line_session_id=$1 and mode='AI' and status in ('ACTIVE','WAITING') order by created_at desc limit 1",[session.line_session_id])).rows[0];
    if(!conversation) conversation=(await client.query('insert into public.conversations(line_session_id) values ($1) returning id',[session.line_session_id])).rows[0];
    const content=event.message.type==='text'?event.message.text:`[${event.message.type==='image'?'รูปภาพ':'ข้อความประเภทอื่น'}]`;
    await client.query("insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata) values ($1,'USER',$2,$3,$4,$5,'{\"routing_status\":\"PENDING\"}') on conflict do nothing",[conversation.id,event.message.type==='image'?'IMAGE':'TEXT',content,event.message.id,job.id]);
    await client.query('update public.line_sessions set last_message_at=now(),updated_at=now() where id=$1',[session.line_session_id]);
   }
  } else {errorCode='UNSUPPORTED_EVENT';}
  }
 }
 const completed=await client.query("update private.webhook_inbox set status='DONE',completed_at=now(),last_error_code=$3,lease_token=null,lease_until=null where id=$1 and lease_token=$2 and lease_until>clock_timestamp()",[job.id,job.lease_token,errorCode]);
 if(completed.rowCount!==1) throw new Error('STALE_LEASE');
}
