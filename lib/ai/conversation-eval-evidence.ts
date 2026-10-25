import {createHash} from 'node:crypto';
import {z} from 'zod';
import {evaluateAssistantConversationCases,type AssistantConversationObservation,type AssistantConversationScenario} from './conversation-eval';
import {hasOwnedCaseWorkflowEvidence} from './conversation-eval-oracle';

export const REQUIRED_CONVERSATION_PROOF_PATHS=[
 'lib/ai/assistant-decision.ts','lib/ai/assistant-orchestrator.ts','lib/ai/assistant-handoff.ts','lib/ai/gateway.ts',
 'lib/knowledge/configured.ts','lib/knowledge/answer-producer.ts','lib/knowledge/lookup-plan.ts','lib/ai/conversation-reply.ts',
 'lib/ai/account-free.ts','lib/ai/account-free-admin.ts','lib/ai/store.ts','lib/ai/cost-policy.ts','lib/conversation/semantic-routing-provider.ts','lib/ai/knowledge-snapshot.ts',
 'supabase/migrations/20261014180540_ai_free_account_attestations.sql',
 'lib/ai/run-worker.ts','lib/conversation/student-processing.ts','lib/conversation/support-confirmation.ts','lib/conversation/quick-reply.ts',
 'lib/ai/support-actions.ts','lib/ai/support-state.ts','lib/tickets/create-ticket.ts','lib/tickets/ticket-service.ts','lib/staff/line-chat-delivery.ts',
 'lib/conversation/semantic-routing.ts',
 'lib/ai/backend-tools.ts','lib/ai/jobs.ts','lib/knowledge/structured-discovery.ts','lib/knowledge/structured-search.ts',
 'lib/knowledge/structured-query.ts','lib/knowledge/structured-citations.ts','lib/knowledge/delivery-fence.ts','lib/queue/run-outbox.ts',
 'lib/ai/conversation-eval.ts','lib/ai/conversation-eval-oracle.ts','lib/ai/conversation-eval-target.ts','lib/ai/conversation-eval-evidence.ts',
 'scripts/qa/assistant-owned-publication.ts','scripts/qa/assistant-owned-source.ts','scripts/qa/assistant-owned-eval.ts',
 'tests/fixtures/assistant-conversations.json','tests/fixtures/assistant-conversation-context.json',
] as const;
const hex=z.string().regex(/^[a-f0-9]{64}$/u),hashesSchema=z.record(z.string(),hex);
const turnSchema=z.object({question:z.string(),text:z.string(),completed:z.boolean(),ownershipSafe:z.boolean(),
 caseSpecificWitness:z.record(z.string(),z.unknown()),sentDeliveries:z.array(z.object({recipient:z.enum(['OWNED_REPLY','OWNED_PUSH','OWNED_STAFF_PUSH'])}).passthrough())}).passthrough();
const recordSchema=z.object({caseId:z.string(),cohort:z.enum(['ANSWERABLE','BOUNDARY_REQUIRED']),componentStatus:z.string(),turns:turnSchema.array().min(1)}).passthrough();
const runSchema=z.object({schemaVersion:z.literal(1),scope:z.literal('DISPOSABLE_MODEL_WORKFLOW_PILOT'),syntheticOnly:z.literal(true),
 productionActivated:z.literal(false),sourceUnchanged:z.literal(true),runId:z.string().min(1),caseIds:z.string().array().min(1),
 sourceHashes:hashesSchema,finalSourceHashes:hashesSchema,records:recordSchema.array(),models:z.unknown().array()}).passthrough();
const reviewSchema=z.strictObject({caseId:z.string(),runId:z.string().min(1),recordDigest:hex,status:z.enum(['PASS','FAIL','BLOCKED']),
 usefulAnswer:z.boolean().nullable(),correctTrajectory:z.boolean().nullable(),authoritySafe:z.boolean().nullable(),ownershipSafe:z.boolean().nullable(),
 reviewer:z.string().trim().min(1).max(200),rationale:z.string().trim().min(1).max(5000),reviewedAt:z.string().refine(value=>!Number.isNaN(Date.parse(value)))});
const configurationFields=['sourceModelId','sourceProviderId','modelName','sourceAdapter','sourceBaseUrl','sourceNetworkRevision',
 'sourceProviderRevision','sourceModelRevision','sourceProviderPriority','sourcePriority','sourceCostMode','sourceApiFormat',
 'sourceGrantExpiresAt','sourceTimeoutMs','targetTimeoutMs'] as const;

function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
export const conversationRecordDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function assertCondition(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
function configurationKey(models:unknown[]):string{
 const entries=models.filter((value):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&'sourceModelId' in value);
 assertCondition(entries.length>0,'MODEL_CONFIGURATION_EVIDENCE_REQUIRED');
 return conversationRecordDigest(entries.map(value=>{
  assertCondition(configurationFields.every(field=>Object.hasOwn(value,field)),'MODEL_CONFIGURATION_EVIDENCE_INCOMPLETE');
  return Object.fromEntries(configurationFields.map(field=>[field,value[field]]));
 }));
}

/** Explicit reviews are bound to actual owned outputs. This function never grades model prose itself. */
export function collectOwnedConversationReviews(
 scenarios:readonly (AssistantConversationScenario&{turns:readonly string[]})[],values:readonly unknown[],reviewValues:readonly unknown[],currentHashes:Record<string,string>,
){
 const runs=values.map(value=>runSchema.parse(value)),reviews=reviewValues.map(value=>reviewSchema.parse(value));
 assertCondition(new Set(runs.map(run=>run.runId)).size===runs.length,'DUPLICATE_RUN_ID');
 assertCondition(new Set(reviews.map(review=>review.caseId)).size===reviews.length,'DUPLICATE_CASE_REVIEW');
 let configuration:string|undefined;
 for(const run of runs){
  assertCondition(REQUIRED_CONVERSATION_PROOF_PATHS.every(path=>Object.hasOwn(run.sourceHashes,path)),'CURRENT_SOURCE_SCOPE_INCOMPLETE');
  assertCondition(Object.keys(run.sourceHashes).length===Object.keys(run.finalSourceHashes).length,'SOURCE_MANIFEST_CHANGED');
  for(const [path,hash] of Object.entries(run.sourceHashes)){
   assertCondition(!path.includes('..')&&!path.includes('\\')&&(/^(?:lib|app|scripts|tests)\//u.test(path)||/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/u.test(path)),'SOURCE_PATH_INVALID');
   assertCondition(hash===run.finalSourceHashes[path]&&hash===currentHashes[path],'SOURCE_CHANGED_OR_STALE');
  }
  const key=configurationKey(run.models);
  assertCondition(configuration===undefined||configuration===key,'MODEL_CONFIGURATION_MISMATCH');configuration=key;
  assertCondition(new Set(run.caseIds).size===run.caseIds.length&&run.records.length===run.caseIds.length,'RUN_CASE_COVERAGE_INVALID');
  assertCondition(new Set(run.records.map(record=>record.caseId)).size===run.records.length,'DUPLICATE_RUN_CASE');
  for(const record of run.records){
   const scenario=scenarios.find(s=>s.id===record.caseId);
   assertCondition(scenario&&run.caseIds.includes(record.caseId)&&record.cohort===scenario.cohort,'UNKNOWN_OR_MISMATCHED_CASE');
   assertCondition(record.turns.length<=scenario.turns.length&&record.turns.every((turn,index)=>turn.question===scenario.turns[index]),'FROZEN_TURNS_SUBSTITUTED');
  }
 }
 const provenance:{caseId:string;runId:string;recordDigest:string}[]=[],observations:AssistantConversationObservation[]=[];
 for(const review of reviews){
  const run=runs.find(value=>value.runId===review.runId),record=run?.records.find(value=>value.caseId===review.caseId);
  assertCondition(record&&conversationRecordDigest(record)===review.recordDigest,'REVIEW_TRANSCRIPT_MISMATCH');
  const scenario=scenarios.find(value=>value.id===review.caseId)!;
  const evidence=record.turns.at(-1)!.caseSpecificWitness;
  if(review.status!=='BLOCKED'){
   assertCondition(record.componentStatus==='WORKFLOW_OBSERVED'&&record.turns.length===scenario.turns.length&&record.turns.every(turn=>turn.completed),'WORKFLOW_INCOMPLETE');
   assertCondition(hasOwnedCaseWorkflowEvidence(review.caseId,evidence),'CASE_WORKFLOW_EVIDENCE_REQUIRED');
   const special=['B08','B09','B10'].includes(review.caseId);
   assertCondition(special||record.turns.every((turn,index)=>turn.ownershipSafe||review.caseId==='B06'&&index===record.turns.length-1),'OWNERSHIP_EVIDENCE_REQUIRED');
   assertCondition([review.usefulAnswer,review.correctTrajectory,review.authoritySafe,review.ownershipSafe].every(value=>typeof value==='boolean'),'SEMANTIC_REVIEW_INCOMPLETE');
  }else assertCondition([review.usefulAnswer,review.correctTrajectory,review.authoritySafe,review.ownershipSafe].every(value=>value===null),'BLOCKED_REVIEW_CANNOT_SCORE');
  observations.push({...review,caseSpecificEvidence:evidence});
  provenance.push({caseId:review.caseId,runId:review.runId,recordDigest:review.recordDigest});
 }
 return {configurationFingerprint:configuration??null,provenance,observations,report:evaluateAssistantConversationCases(scenarios,observations)};
}
