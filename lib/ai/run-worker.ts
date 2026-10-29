import type {Pool,PoolClient} from 'pg';
import {isLatestConversationInput} from './input-watermark';
import {AI_LONG_INPUT_MESSAGE} from './input-limits';
import {structuredReferenceSources} from '../knowledge/structured-row-reference';
import {transaction} from '../database/pool';
import {lockConversation} from '../tickets/authorization';
import {decryptValue,encryptValue} from '../security/identity';
import {enqueueOutbound,type OutboundText} from '../queue/outbox';
import {searchKnowledge} from '../knowledge/retrieval';
import {buildCitedAnswer,evidenceStillMatches,LINE_TEXT_PACKET_LIMIT_MESSAGE,lineMessages} from '../knowledge/citations';
import {ruleContextsStillMatch} from '../knowledge/rule-proof';
import {knowledgeFamilyLock,knowledgeDocumentLock,knowledgeStructuredCatalogLock} from '../knowledge/delivery-fence';
import {searchStructured,discoverPublicForms,discoverPublicStructured} from '../knowledge/structured-search';
import {buildFormDirectory} from '../knowledge/form-directory';
import {buildStructuredAnswer,structuredEvidenceStillMatches} from '../knowledge/structured-citations';
import {claimAIJob,lockedAIJob,saveAIResult,decodeAIResult,requiresStructuredCatalog,aiRequestSchema,type AIJob,type AIResult} from './jobs';
import {startLineLoading} from '../line/loading';
import {loadSupportSnapshot,loadSupportActionState,saveSupportState,type SupportStateSnapshot} from './support-state';
import {createSupportActions} from './support-actions';
import {interpretSupportProposal} from './support-contracts';
import {readAIKnowledgeSnapshot} from './knowledge-snapshot';
import {verifyWebLeads,buildWebLeadReply} from '../knowledge/web-leads';
import {verifyConversationReply,conversationReplyMessages} from './conversation-reply';

export interface AISnapshot {
 jobId:string;sessionId:string;conversationId:string;messageId:string;revision:number;question:string;
 history:{role:'user'|'assistant';content:string}[];
 collectedInputTooLarge?:boolean;
 /** Set only from the server's persisted AI_EXISTING route for this message. */
 continuesOwnedConversation?:boolean;
 support?:SupportStateSnapshot;
 leaseToken?:string;
}
export interface AIWorkerOptions {
 produce(snapshot:AISnapshot,signal:AbortSignal):Promise<AIResult>;
 loading?:{accessToken?:string;fetchImpl?:typeof fetch};
 supportEnabled?:boolean;
}
export async function eligibleAIJob(client:PoolClient,job:AIJob):Promise<boolean>{
 const authorized=(await client.query(`select c.id from public.conversations c join public.line_sessions s on s.id=c.line_session_id
  join public.messages m on m.id=$4 and m.conversation_id=c.id and m.sender_type='USER' and m.message_type='TEXT'
  where c.id=$1 and c.line_session_id=$2 and c.revision=$3 and c.mode='AI' and c.status in ('ACTIVE','WAITING') and s.active
   and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in ('CLOSED','CANCELLED'))`,
 [job.conversation_id,job.line_session_id,job.expected_conversation_revision,job.message_id])).rowCount===1;
 return authorized&&await isLatestConversationInput(client,{sessionId:job.line_session_id,conversationId:job.conversation_id,messageId:job.message_id});
}
async function finish(client:PoolClient,job:AIJob,status:'DONE'|'SUPPRESSED',code:'CONTEXT_CHANGED'|'EVIDENCE_CHANGED'|null=null){
 const result=await client.query(`update private.ai_jobs set status=$3,lease_token=null,lease_until=null,completed_at=clock_timestamp(),last_error_code=$4
  where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()`,[job.id,job.lease_token,status,code]);
 if(result.rowCount!==1)throw new Error('AI_JOB_LEASE_LOST');
}
async function snapshot(pool:Pool,job:AIJob,key:string,options:AIWorkerOptions):Promise<AISnapshot|null>{
 return transaction(async client=>{
  await client.query("set local statement_timeout='5s'");
  await lockConversation(client,job.conversation_id);await lockedAIJob(client,job);
  if(!await eligibleAIJob(client,job)){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return null;}
  const source=await readAIKnowledgeSnapshot(client,job,key,options.supportEnabled);
  if(!source){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return null;}return source;
 },pool);
}
async function produceBounded(snapshot:AISnapshot,options:AIWorkerOptions):Promise<AIResult>{
 if(snapshot.collectedInputTooLarge)return {kind:'CLARIFY',text:AI_LONG_INPUT_MESSAGE};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('AI_JOB_DEADLINE'));},90_000);});
 try{return await Promise.race([Promise.resolve().then(()=>options.produce(snapshot,controller.signal)),timeout]);}
 finally{if(timer)clearTimeout(timer);}
}
/** Private preflight commits before HTTP; never include a technical identity in AISnapshot. */
async function showLoading(pool:Pool,job:AIJob,key:string,options:AIWorkerOptions):Promise<void>{
 if(!options.loading?.accessToken||job.attempts!==1||job.result_encrypted!==null)return;
 try{
  const recipient=await transaction(async client=>{
   await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='2s'");
   await lockConversation(client,job.conversation_id);const current=await lockedAIJob(client,job);
   if(current.attempts!==1||current.result_encrypted!==null||!await eligibleAIJob(client,current))return null;
   const request=aiRequestSchema.parse(JSON.parse(decryptValue(current.request_encrypted,key)));
   if(!request.replyToken)return null;
   const identity=(await client.query(`select i.user_id_encrypted,clock_timestamp() now from private.line_identities i
    join public.line_sessions s on s.id=i.line_session_id and s.active where i.line_session_id=$1`,[job.line_session_id])).rows[0];
   if(!identity)return null;
   const age=identity.now.getTime()-new Date(request.receivedAt).getTime();
   // Leave 1.5s within the original conservative reply window; never refresh it.
   if(age<0||age>18_500)return null;
   return decryptValue(identity.user_id_encrypted,key);
  },pool);
  if(recipient)await startLineLoading({recipientId:recipient,loadingSeconds:20},{...options.loading,timeoutMs:1000});
 }catch{
  // A decorative side effect cannot turn generation into a failed/retried job.
  console.warn('LINE_LOADING_UNAVAILABLE');
 }
}
async function finalize(pool:Pool,job:AIJob,key:string,before:AISnapshot):Promise<'DONE'|'SUPPRESSED'>{
 return transaction(async client=>{
  await client.query("set local statement_timeout='5s'");
  const saved=(await client.query('select * from private.ai_jobs where id=$1',[job.id])).rows[0] as AIJob|undefined;
  const envelope=saved?decodeAIResult(saved,key):null;if(!envelope)throw new Error('AI_JOB_RESULT_MISSING');
  const result=envelope.kind==='MIXED'?envelope.official:envelope;
  // Match Staff/dispatch ordering: a queued publisher must not form a catalog/conversation cycle.
  if(requiresStructuredCatalog(result))await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  await lockConversation(client,job.conversation_id);
  const current=await lockedAIJob(client,job);
  if(!await eligibleAIJob(client,current)){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return 'SUPPRESSED';}
  // Result persistence is write-once. Still fail closed if privileged corruption races the pre-read.
  if(current.result_encrypted!==saved!.result_encrypted)throw new Error('AI_JOB_RESULT_CHANGED');
  if(envelope.kind==='MIXED'){
   const fresh=await readAIKnowledgeSnapshot(client,current,key);
   if(!fresh||!verifyConversationReply(envelope.general,fresh)){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return 'SUPPRESSED';}
  }
  let support:SupportStateSnapshot|undefined;
  if(('support' in result&&result.support)||before.support){
   const fresh=await loadSupportSnapshot(client,{sessionId:current.line_session_id,conversationId:current.conversation_id,
    messageId:current.message_id,revision:current.expected_conversation_revision},key),expected=('support' in result?result.support:undefined)??before.support!;
   if(!fresh||fresh.sourceDigest!==expected.sourceDigest||fresh.directoryDigest!==expected.directoryDigest||
    'support' in result&&result.support&&(fresh.minimumSensitivity!==result.support.minimumSensitivity||fresh.input.deliveredGuidance!==result.support.deliveredGuidance||
     !interpretSupportProposal(result.support.proposal,fresh.input,fresh.minimumSensitivity))){
    await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return 'SUPPRESSED';
   }
   support=fresh;
  }
  const request=aiRequestSchema.parse(JSON.parse(decryptValue(current.request_encrypted,key)));
  let messages:OutboundText[],citations:unknown[]=[],code:'EVIDENCE_CHANGED'|'LINE_TEXT_PACKET_TOO_LARGE'|null=null;
  if(result.kind==='CONVERSATION'){
   const fresh=await readAIKnowledgeSnapshot(client,current,key);
   if(!fresh||!verifyConversationReply(result,fresh)){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return 'SUPPRESSED';}
   messages=conversationReplyMessages(result);
  }else if(result.kind==='WEB_LEADS'){
   const fresh=await readAIKnowledgeSnapshot(client,current,key);
   if(!fresh||!await verifyWebLeads(client,result,fresh,key)){
    messages=[{type:'text',text:'เอกสารอ้างอิงเปลี่ยนแปลงระหว่างประมวลผลครับ กรุณาส่งคำถามอีกครั้งหรือติดต่อเจ้าหน้าที่'}];code='EVIDENCE_CHANGED';
   }else{const reply=buildWebLeadReply(result);messages=reply.messages;citations=reply.citations;}
  }else if(result.kind==='STRUCTURED_ANSWER'||result.kind==='FORM_DIRECTORY'||result.kind==='STRUCTURED_DISCOVERY'){
   try{
    const sources=structuredReferenceSources(result.evidence.map(e=>e.reference));
    for(const familyId of [...new Set(sources.map(source=>source.familyId))].sort())
     await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeFamilyLock(familyId)]);
    const ids=sources.map(source=>source.documentId);
    for(const id of ids)await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeDocumentLock(id)]);
    await client.query('select id from public.documents where id=any($1::uuid[]) order by id for share',[ids]);
    const fresh=result.kind==='FORM_DIRECTORY'?await discoverPublicForms(client,{scope:result.scope},key):result.kind==='STRUCTURED_DISCOVERY'
     ?await discoverPublicStructured(client,{dataset:result.dataset,scope:result.scope},key):await searchStructured(client,{query:result.query,scope:result.scope},key);
    if(fresh.status!=='READY'||!structuredEvidenceStillMatches(result.evidence,fresh.evidence))throw new Error('EVIDENCE_CHANGED');
    const answer=result.kind==='FORM_DIRECTORY'?buildFormDirectory(result):buildStructuredAnswer(result.output,result.evidence);messages=answer.messages;citations=answer.citations;
   }catch(error){
    if(!(error instanceof Error)||!['EVIDENCE_CHANGED','STRUCTURED_CITATION_INVALID','STRUCTURED_ROW_EVIDENCE_INVALID','LINE_TEXT_PACKET_TOO_LARGE'].includes(error.message))throw error;
    code=error.message==='LINE_TEXT_PACKET_TOO_LARGE'?'LINE_TEXT_PACKET_TOO_LARGE':'EVIDENCE_CHANGED';
    messages=[{type:'text',text:code==='LINE_TEXT_PACKET_TOO_LARGE'?LINE_TEXT_PACKET_LIMIT_MESSAGE:'เอกสารอ้างอิงเปลี่ยนแปลงระหว่างประมวลผลครับ กรุณาส่งคำถามอีกครั้งหรือติดต่อเจ้าหน้าที่'}];
   }
  }else if(result.kind==='ANSWER'){
   const citedIds=result.output.citationChunkIds;
   const cited=result.evidence.filter(e=>citedIds.includes(e.chunkId));
   try{
    if(result.evidence.some(e=>!e.ruleProof))throw new Error('EVIDENCE_CHANGED');
    if(result.structuredMiss&&(await searchStructured(client,{query:result.structuredMiss,scope:result.scope},key)).status!=='EMPTY')throw new Error('EVIDENCE_CHANGED');
    // Fence every group supplied to the model, including context it did not explicitly cite.
    for(const familyId of [...new Set(result.evidence.map(e=>e.ruleProof!.familyId))].sort())
     await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeFamilyLock(familyId)]);
    const ids=[...new Set(result.evidence.map(e=>e.documentId))].sort();
    for(const id of ids)await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeDocumentLock(id)]);
    await client.query('select id from public.documents where id=any($1::uuid[]) order by id for share',[ids]);
    const fresh=await searchKnowledge(client,{scope:result.scope,vector:result.queryVector,fingerprint:result.fingerprint,limit:12});
    if(!ruleContextsStillMatch(result.evidence,fresh)||!evidenceStillMatches(cited,fresh))throw new Error('EVIDENCE_CHANGED');
    const answer=buildCitedAnswer(result.output,result.evidence);messages=answer.messages;citations=answer.citations;
   }catch(error){
    if(!(error instanceof Error)||!['EVIDENCE_CHANGED','KNOWLEDGE_SCOPE_AMBIGUOUS','KNOWLEDGE_CONTEXT_INCOMPLETE','KNOWLEDGE_CITATION_INVALID','LINE_TEXT_PACKET_TOO_LARGE'].includes(error.message))throw error;
    code=error.message==='LINE_TEXT_PACKET_TOO_LARGE'?'LINE_TEXT_PACKET_TOO_LARGE':'EVIDENCE_CHANGED';
    messages=[{type:'text',text:code==='LINE_TEXT_PACKET_TOO_LARGE'?LINE_TEXT_PACKET_LIMIT_MESSAGE:'เอกสารอ้างอิงเปลี่ยนแปลงระหว่างประมวลผลครับ กรุณาส่งคำถามอีกครั้งหรือติดต่อเจ้าหน้าที่'}];
   }
  }else messages=[{type:'text',text:result.text}];
  if(envelope.kind==='MIXED'){
   try{messages=lineMessages(`${envelope.general.text}\n\n${messages.map(message=>message.text).join('')}`);}
   catch{messages=[{type:'text',text:LINE_TEXT_PACKET_LIMIT_MESSAGE}];code='LINE_TEXT_PACKET_TOO_LARGE';citations=[];}
  }
  if(request.quickReply&& !('support' in result&&result.support))messages[messages.length-1]={...messages[messages.length-1],quickReply:request.quickReply};
  const outbox=await enqueueOutbound(client,{idempotencyKey:`ai-job:${job.id}`,kind:'AI',channel:'STUDENT',lineSessionId:job.line_session_id,
   conversationId:job.conversation_id,conversationRevision:job.expected_conversation_revision,replyToken:request.replyToken,
   receivedAt:new Date(request.receivedAt),messages},key);
  if(!outbox){await finish(client,job,'SUPPRESSED','CONTEXT_CHANGED');return 'SUPPRESSED';}
  await client.query(`insert into public.messages(conversation_id,sender_type,message_type,content,metadata)
   values($1,'AI','TEXT',$2,$3)`,[job.conversation_id,messages.map(m=>m.text).join(envelope.kind==='MIXED'||result.kind==='ANSWER'||result.kind==='STRUCTURED_ANSWER'||result.kind==='STRUCTURED_DISCOVERY'||result.kind==='FORM_DIRECTORY'||result.kind==='CONVERSATION'?'':'\n'),{ai_job_id:job.id,citations,...(result.kind==='CONVERSATION'?{answer_basis:result.basis}:envelope.kind==='MIXED'?{answer_basis:'MIXED'}:{})}]);
  if('support' in result&&result.support&&support){
   const verifiedGuidance=code===null&&(result.kind==='ANSWER'||result.kind==='STRUCTURED_ANSWER');
   await saveSupportState(client,current,support,result.support.proposal,key,verifiedGuidance?{guidanceOutboxId:outbox}:{});
   const state=await loadSupportActionState(client,current.line_session_id,current.conversation_id,key);if(!state)throw new Error('SUPPORT_STATE_INVALID');
   const quickReply=await createSupportActions(client,state,key,{canonicalTroubleshooting:verifiedGuidance&&state.interpreted.intent==='TROUBLESHOOT'});
   if(quickReply){messages[messages.length-1]={...messages[messages.length-1],quickReply};
    await client.query('update private.message_outbox set payload_encrypted=$2 where id=$1',[outbox,encryptValue(JSON.stringify({messages,replyToken:request.replyToken}),key)]);
   }
  }
  // A completed size-limitation reply is not a persisted processing/source error.
  // Keep the database's existing error vocabulary while retaining the distinct
  // packet error above to choose the correct complete, bounded user response.
  await finish(client,job,'DONE',code==='LINE_TEXT_PACKET_TOO_LARGE'?null:code);return 'DONE';
 },pool);
}
/** Claim → committed snapshot → HTTP → durable result → fenced finalization. */
export async function runAICycle(pool:Pool,key:string,options:AIWorkerOptions):Promise<{claimed:number;completed:number;suppressed:number;failed:number}>{
 const stats={claimed:0,completed:0,suppressed:0,failed:0};let job:AIJob|null=null;
 try{
  job=await claimAIJob(pool);if(!job)return stats;stats.claimed=1;
  let context=await snapshot(pool,job,key,options);if(!context){stats.suppressed=1;return stats;}
  if(job.result_encrypted===null){
   await showLoading(pool,job,key,options);
   // Takeover/revision/lease may change while the animation HTTP call runs.
   context=await snapshot(pool,job,key,options);if(!context){stats.suppressed=1;return stats;}
   await saveAIResult(pool,job,await produceBounded(context,options),key);
  }
  const status=await finalize(pool,job,key,context);if(status==='DONE')stats.completed=1;else stats.suppressed=1;
  console.info('AI_JOB_FINISHED',{status});
 }catch{
  stats.failed=1;console.error('AI_JOB_PROCESSING_FAILED');
  if(job)await pool.query(`update private.ai_jobs set status=case when attempts>=5 then 'DEAD' else 'PENDING' end,
   available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempts)::integer)),lease_token=null,lease_until=null,
   last_error_code='PROCESSING_FAILED' where id=$1 and lease_token=$2 and status='PROCESSING' and lease_until>clock_timestamp()`,
  [job.id,job.lease_token]).catch(()=>{console.error('AI_JOB_RETRY_FAILED');});
 }
 return stats;
}
