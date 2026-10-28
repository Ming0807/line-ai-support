import type {PoolClient} from 'pg';
import {structuredReferenceSources} from './structured-row-reference';
import {z} from 'zod';
import {decodeAIResult,requiresStructuredCatalog,type AIJob} from '../ai/jobs';
import {searchKnowledge} from './retrieval';
import {evidenceStillMatches} from './citations';
import {ruleContextsStillMatch} from './rule-proof';
import {searchStructured,discoverPublicForms,discoverPublicStructured} from './structured-search';
import {structuredEvidenceStillMatches} from './structured-citations';
import {loadSupportSnapshot} from '../ai/support-state';
import {readAIKnowledgeSnapshot} from '../ai/knowledge-snapshot';
import {verifyWebLeads} from './web-leads';
import {verifyConversationReply} from '../ai/conversation-reply';

import {knowledgeDocumentLock,knowledgeFamilyLock,knowledgeStructuredCatalogLock} from './source-locks';
export {knowledgeDocumentLock,knowledgeFamilyLock,knowledgeStructuredCatalogLock} from './source-locks';
type OutboxEvidenceInput={idempotencyKey:string;conversationId:string|null;sessionId:string|null};
/** A pre-read only chooses lock order; the locked delivery verification remains authoritative. */
export async function aiOutboxNeedsStructuredCatalog(client:PoolClient,input:OutboxEvidenceInput,key:string):Promise<boolean>{
 if(!input.idempotencyKey.startsWith('ai-job:'))return false;
 const jobId=input.idempotencyKey.slice(7);if(!z.uuid().safeParse(jobId).success)return false;
 const job=(await client.query("select * from private.ai_jobs where id=$1 and conversation_id=$2 and line_session_id=$3 and status='DONE'",
  [jobId,input.conversationId,input.sessionId])).rows[0] as AIJob|undefined;
 const result=job?decodeAIResult(job,key):null;return result!==null&&requiresStructuredCatalog(result);
}
export async function verifyAIOutboxEvidence(client:PoolClient,input:OutboxEvidenceInput,
 key:string,heldLocks:string[]):Promise<boolean>{
 if(!input.idempotencyKey.startsWith('ai-job:'))return true;
 const jobId=input.idempotencyKey.slice(7);if(!z.uuid().safeParse(jobId).success)return false;
 const job=(await client.query(`select * from private.ai_jobs where id=$1 and conversation_id=$2 and line_session_id=$3 and status='DONE'`,
  [jobId,input.conversationId,input.sessionId])).rows[0] as AIJob|undefined;
 if(!job)return false;
 const envelope=decodeAIResult(job,key);if(!envelope)return false;
 if(envelope.kind==='MIXED'){
  const fresh=await readAIKnowledgeSnapshot(client,job,key);
  if(!fresh||!verifyConversationReply(envelope.general,fresh))return false;
 }
 const result=envelope.kind==='MIXED'?envelope.official:envelope;
 // Never acquire the catalog after conversation locks if the pre-read became stale.
 if(requiresStructuredCatalog(result)&&!heldLocks.includes(knowledgeStructuredCatalogLock))return false;
 if('support' in result&&result.support){
  await client.query('begin');
  try{
   const fresh=await loadSupportSnapshot(client,{sessionId:job.line_session_id,conversationId:job.conversation_id,messageId:job.message_id,revision:job.expected_conversation_revision},key);
   const saved=(await client.query('select conversation_id from private.ai_support_state where conversation_id=$1 and ai_job_id=$2 and source_digest=$3 and directory_digest=$4',
    [job.conversation_id,job.id,result.support.sourceDigest,result.support.directoryDigest])).rowCount===1;
   const allowed=saved&&fresh?.sourceDigest===result.support.sourceDigest&&fresh.directoryDigest===result.support.directoryDigest;
   await client.query('commit');if(!allowed)return false;
  }catch(error){await client.query('rollback');throw error;}
 }
 if(result.kind==='CLARIFY')return true;
 if(result.kind==='CONVERSATION'){
  const fresh=await readAIKnowledgeSnapshot(client,job,key);
  return !!fresh&&verifyConversationReply(result,fresh);
 }
 // A source-changing clarification carries no citations and must not reuse the obsolete result.
 const metadata=(await client.query(`select metadata from public.messages where conversation_id=$1 and metadata->>'ai_job_id'=$2
  and sender_type='AI' order by created_at desc,id limit 1`,[input.conversationId,jobId])).rows[0]?.metadata;
 if(Array.isArray(metadata?.citations)&&metadata.citations.length===0)return true;
 if(result.kind==='WEB_LEADS'){
  await client.query('begin');
  try{
   const fresh=await readAIKnowledgeSnapshot(client,job,key);
   const allowed=!!fresh&&await verifyWebLeads(client,result,fresh,key);await client.query('commit');return allowed;
  }catch(error){await client.query('rollback');throw error;}
 }
 if(result.kind==='STRUCTURED_ANSWER'||result.kind==='FORM_DIRECTORY'||result.kind==='STRUCTURED_DISCOVERY'){
  const sources=structuredReferenceSources(result.evidence.map(e=>e.reference)),documentIds=sources.map(source=>source.documentId);
  const documents=(await client.query('select id,document_family_id from public.documents where id=any($1::uuid[])',[documentIds])).rows;
  if(documents.length!==documentIds.length||documents.some(d=>!sources.some(source=>source.documentId===d.id&&source.familyId===d.document_family_id)))return false;
  for(const familyId of [...new Set(sources.map(source=>source.familyId))].sort()){
   const lock=knowledgeFamilyLock(familyId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);
  }
  for(const documentId of documentIds){const lock=knowledgeDocumentLock(documentId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);}
  await client.query('begin');
  try{const fresh=result.kind==='FORM_DIRECTORY'?await discoverPublicForms(client,{scope:result.scope},key):result.kind==='STRUCTURED_DISCOVERY'
   ?await discoverPublicStructured(client,{dataset:result.dataset,scope:result.scope},key):await searchStructured(client,{query:result.query,scope:result.scope},key);const allowed=fresh.status==='READY'&&structuredEvidenceStillMatches(result.evidence,fresh.evidence);await client.query('commit');return allowed;}
  catch(error){await client.query('rollback');throw error;}
 }
 const cited=result.evidence.filter(e=>result.output.citationChunkIds.includes(e.chunkId));
 if(result.evidence.some(e=>!e.ruleProof))return false;
 const documentIds=[...new Set(result.evidence.map(e=>e.documentId))].sort();
 const families=(await client.query('select id,document_family_id from public.documents where id=any($1::uuid[])',[documentIds])).rows;
 if(families.length!==documentIds.length)return false;
 if(families.some(d=>!result.evidence.some(e=>e.documentId===d.id&&e.ruleProof!.familyId===d.document_family_id)))return false;
 for(const familyId of [...new Set(result.evidence.map(e=>e.ruleProof!.familyId))].sort()){
  const lock=knowledgeFamilyLock(familyId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);
 }
 for(const documentId of documentIds){
  const lock=knowledgeDocumentLock(documentId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);
 }
 await client.query('begin');
 try{
  if(result.structuredMiss&&(await searchStructured(client,{query:result.structuredMiss,scope:result.scope},key)).status!=='EMPTY'){
   await client.query('commit');return false;
  }
  const fresh=await searchKnowledge(client,{scope:result.scope,vector:result.queryVector,fingerprint:result.fingerprint,limit:12});
  const allowed=ruleContextsStillMatch(result.evidence,fresh)&&evidenceStillMatches(cited,fresh);await client.query('commit');return allowed;
 }catch(error){
  await client.query('rollback');
  if(error instanceof Error&&['KNOWLEDGE_SCOPE_AMBIGUOUS','KNOWLEDGE_CONTEXT_INCOMPLETE'].includes(error.message))return false;
  throw error;
 }
}
