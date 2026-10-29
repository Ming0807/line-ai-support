import type {PoolClient} from 'pg';
import type {AIJob} from './jobs';
import type {AISnapshot} from './run-worker';
import {loadSupportSnapshot} from './support-state';
import {readConversationInput} from './conversation-input';
import {exceedsAIQuestionLimit} from './input-limits';

/** Caller has freshly authorized and locked the job/conversation. This read does no network. */
export async function readAIKnowledgeSnapshot(client:PoolClient,job:AIJob,key:string,supportEnabled=false):Promise<AISnapshot|null>{
 const input=await readConversationInput(client,job.conversation_id,job.message_id);
 if(!input)return null;
 const collectedInputTooLarge=exceedsAIQuestionLimit(input.question);
 const support=supportEnabled&&!collectedInputTooLarge?await loadSupportSnapshot(client,{sessionId:job.line_session_id,conversationId:job.conversation_id,
  messageId:job.message_id,revision:job.expected_conversation_revision},key):undefined;
 if(supportEnabled&&!support&&!collectedInputTooLarge)return null;
 return {jobId:job.id,sessionId:job.line_session_id,conversationId:job.conversation_id,messageId:job.message_id,
  revision:job.expected_conversation_revision,question:input.question,
  continuesOwnedConversation:input.metadata?.routing_status==='ROUTED'&&input.metadata?.routing_route==='AI_EXISTING',
  history:input.history,
  ...(collectedInputTooLarge?{collectedInputTooLarge:true}:{}),
  ...(job.lease_token?{leaseToken:job.lease_token}:{}),...(support?{support}:{})};
}
