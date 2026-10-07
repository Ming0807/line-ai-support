import type {PoolClient} from 'pg';
import {z} from 'zod';
import {decodeAIResult,type AIJob} from '../ai/jobs';
import {searchKnowledge} from './retrieval';
import {evidenceStillMatches} from './citations';
import {ruleContextsStillMatch} from './rule-proof';
import {searchStructured} from './structured-search';
import {structuredEvidenceStillMatches} from './structured-citations';

/** M7 writers acquire sorted family locks, then sorted document locks, before publishing or changing eligibility. */
export const knowledgeDocumentLock=(documentId:string)=>`knowledge-document:${documentId}`;
export const knowledgeFamilyLock=(familyId:string)=>`knowledge-family:${familyId}`;
/** Shared readers fence even a newly created family. Publication takes the exclusive catalog lock first. */
export const knowledgeStructuredCatalogLock='knowledge-structured-selection-catalog:v1';
export async function verifyAIOutboxEvidence(client:PoolClient,input:{idempotencyKey:string;conversationId:string|null;sessionId:string|null},
 key:string,heldLocks:string[]):Promise<boolean>{
 if(!input.idempotencyKey.startsWith('ai-job:'))return true;
 const jobId=input.idempotencyKey.slice(7);if(!z.uuid().safeParse(jobId).success)return false;
 const job=(await client.query(`select * from private.ai_jobs where id=$1 and conversation_id=$2 and line_session_id=$3 and status='DONE'`,
  [jobId,input.conversationId,input.sessionId])).rows[0] as AIJob|undefined;
 if(!job)return false;
 const result=decodeAIResult(job,key);if(!result)return false;if(result.kind==='CLARIFY')return true;
 // A source-changing clarification carries no citations and must not reuse the obsolete result.
 const metadata=(await client.query(`select metadata from public.messages where conversation_id=$1 and metadata->>'ai_job_id'=$2
  and sender_type='AI' order by created_at desc,id limit 1`,[input.conversationId,jobId])).rows[0]?.metadata;
 if(Array.isArray(metadata?.citations)&&metadata.citations.length===0)return true;
 if(result.kind==='STRUCTURED_ANSWER'){
  await client.query('select pg_advisory_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);heldLocks.push(knowledgeStructuredCatalogLock);
  const documentIds=[...new Set(result.evidence.map(e=>e.reference.documentId))].sort();
  const documents=(await client.query('select id,document_family_id from public.documents where id=any($1::uuid[])',[documentIds])).rows;
  if(documents.length!==documentIds.length||documents.some(d=>!result.evidence.some(e=>e.reference.documentId===d.id&&e.reference.ruleProof.familyId===d.document_family_id)))return false;
  for(const familyId of [...new Set(result.evidence.map(e=>e.reference.ruleProof.familyId))].sort()){
   const lock=knowledgeFamilyLock(familyId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);
  }
  for(const documentId of documentIds){const lock=knowledgeDocumentLock(documentId);await client.query('select pg_advisory_lock(hashtextextended($1,0))',[lock]);heldLocks.push(lock);}
  await client.query('begin');
  try{const fresh=await searchStructured(client,{query:result.query,scope:result.scope},key);const allowed=fresh.status==='READY'&&structuredEvidenceStillMatches(result.evidence,fresh.evidence);await client.query('commit');return allowed;}
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
  const fresh=await searchKnowledge(client,{scope:result.scope,vector:result.queryVector,fingerprint:result.fingerprint,limit:12});
  const allowed=ruleContextsStillMatch(result.evidence,fresh)&&evidenceStillMatches(cited,fresh);await client.query('commit');return allowed;
 }catch(error){
  await client.query('rollback');
  if(error instanceof Error&&['KNOWLEDGE_SCOPE_AMBIGUOUS','KNOWLEDGE_CONTEXT_INCOMPLETE'].includes(error.message))return false;
  throw error;
 }
}
