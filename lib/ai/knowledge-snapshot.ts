import type {PoolClient} from 'pg';
import type {AIJob} from './jobs';
import type {AISnapshot} from './run-worker';
import {loadSupportSnapshot} from './support-state';

/** Caller has freshly authorized and locked the job/conversation. This read does no network. */
export async function readAIKnowledgeSnapshot(client:PoolClient,job:AIJob,key:string,supportEnabled=false):Promise<AISnapshot|null>{
 const support=supportEnabled?await loadSupportSnapshot(client,{sessionId:job.line_session_id,conversationId:job.conversation_id,
  messageId:job.message_id,revision:job.expected_conversation_revision},key):undefined;
 if(supportEnabled&&!support)return null;
 const message=(await client.query("select content,created_at from public.messages where id=$1 and conversation_id=$2 and sender_type='USER' and message_type='TEXT'",[job.message_id,job.conversation_id])).rows[0];
 if(!message)return null;
 const previous=(await client.query(`select m.sender_type,m.content from public.messages m where m.conversation_id=$1 and m.id<>$2
  and m.created_at<$3 and m.sender_type in ('USER','AI') and m.message_type='TEXT'
  and (m.sender_type='USER' or exists(select 1 from private.message_outbox o where o.conversation_id=m.conversation_id
   and o.idempotency_key='ai-job:'||(m.metadata->>'ai_job_id') and o.kind='AI' and o.status='SENT'))
  order by m.created_at desc,m.id desc limit 8`,[job.conversation_id,job.message_id,message.created_at])).rows.reverse();
 return {jobId:job.id,sessionId:job.line_session_id,conversationId:job.conversation_id,messageId:job.message_id,
  revision:job.expected_conversation_revision,question:message.content,
  history:previous.map(m=>({role:m.sender_type==='USER'?'user' as const:'assistant' as const,content:m.content.slice(0,3000)})),
  ...(job.lease_token?{leaseToken:job.lease_token}:{}),...(support?{support}:{})};
}
