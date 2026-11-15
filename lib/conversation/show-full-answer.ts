import type {DbClient} from '../tickets/authorization';
import type {OutboundText} from '../queue/outbox';
import type {RouteCandidate} from './router';
import {decodeAIResult, type AIJob} from '../ai/jobs';
import {buildCitedAnswer, evidenceStillMatches} from '../knowledge/citations';
import {ruleContextsStillMatch} from '../knowledge/rule-proof';
import {knowledgeDocumentLock, knowledgeFamilyLock} from '../knowledge/delivery-fence';
import {freshAnswerEvidence} from '../knowledge/section-expansion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type FullAnswer =
  | {status: 'READY'; jobId: string; conversationId: string; conversationRevision: number; messages: OutboundText[]; citations: unknown[]}
  | {status: 'STALE'};

/**
 * CONV-V2-05: rebuilds the complete answer for a consumed SHOW_FULL choice.
 *
 * Runs in the inbox transaction that already holds the session's conversation locks. The saved
 * job result is the only content source; its evidence is re-read under the same family and
 * document locks as finalization, and any change, takeover or mismatch returns STALE.
 * No model call is made.
 */
export async function fullAnswerForChoice(
  client: DbClient,
  input: {sessionId: string; choice: Record<string, string>; candidates: RouteCandidate[]},
  key: string,
): Promise<FullAnswer> {
  const {jobId, conversationId} = input.choice;
  if (typeof jobId !== 'string' || !UUID.test(jobId) || typeof conversationId !== 'string' || !UUID.test(conversationId)) return {status: 'STALE'};
  const candidate = input.candidates.find(item => item.conversationId === conversationId && item.mode === 'AI');
  if (!candidate) return {status: 'STALE'};

  const job = (await client.query(`select * from private.ai_jobs where id=$1 and conversation_id=$2 and line_session_id=$3
   and status='DONE' for share`, [jobId, conversationId, input.sessionId])).rows[0] as AIJob | undefined;
  if (!job) return {status: 'STALE'};
  const result = decodeAIResult(job, key);
  if (!result || result.kind !== 'ANSWER' || result.sectionExpanded !== true || result.evidence.some(item => !item.ruleProof)) return {status: 'STALE'};

  for (const familyId of [...new Set(result.evidence.map(item => item.ruleProof!.familyId))].sort())
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [knowledgeFamilyLock(familyId)]);
  const documentIds = [...new Set(result.evidence.map(item => item.documentId))].sort();
  for (const id of documentIds) await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [knowledgeDocumentLock(id)]);
  await client.query('select id from public.documents where id=any($1::uuid[]) order by id for share', [documentIds]);

  try {
    const fresh = await freshAnswerEvidence(client as Parameters<typeof freshAnswerEvidence>[0], result);
    const cited = result.evidence.filter(item => result.output.citationChunkIds.includes(item.chunkId));
    if (!ruleContextsStillMatch(result.evidence, fresh) || !evidenceStillMatches(cited, fresh)) return {status: 'STALE'};
    const answer = buildCitedAnswer(result.output, result.evidence);
    return {status: 'READY', jobId, conversationId, conversationRevision: candidate.conversationRevision, messages: answer.messages, citations: answer.citations};
  } catch (error) {
    if (error instanceof Error && ['KNOWLEDGE_SCOPE_AMBIGUOUS', 'KNOWLEDGE_CONTEXT_INCOMPLETE', 'KNOWLEDGE_CITATION_INVALID', 'LINE_TEXT_PACKET_TOO_LARGE'].includes(error.message))
      return {status: 'STALE'};
    throw error;
  }
}
