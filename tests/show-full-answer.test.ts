import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeAIResult: vi.fn(),
  freshAnswerEvidence: vi.fn(),
  ruleContextsStillMatch: vi.fn(),
  evidenceStillMatches: vi.fn(),
  buildCitedAnswer: vi.fn(),
}));
vi.mock('../lib/ai/jobs', () => ({decodeAIResult: mocks.decodeAIResult}));
vi.mock('../lib/knowledge/section-expansion', () => ({freshAnswerEvidence: mocks.freshAnswerEvidence}));
vi.mock('../lib/knowledge/rule-proof', () => ({ruleContextsStillMatch: mocks.ruleContextsStillMatch}));
vi.mock('../lib/knowledge/citations', () => ({evidenceStillMatches: mocks.evidenceStillMatches, buildCitedAnswer: mocks.buildCitedAnswer}));
vi.mock('../lib/knowledge/delivery-fence', () => ({
  knowledgeFamilyLock: (id: string) => `family:${id}`,
  knowledgeDocumentLock: (id: string) => `document:${id}`,
}));

import {fullAnswerForChoice} from '../lib/conversation/show-full-answer';
import type {RouteCandidate} from '../lib/conversation/router';
import type {DbClient} from '../lib/tickets/authorization';

const jobId = '00000000-0000-4000-8000-000000000001';
const conversationId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const chunk = (id: string, documentId: string) => ({chunkId: id, documentId, ruleProof: {familyId: 'fam-1'}});
const savedAnswer = {
  kind: 'ANSWER', sectionExpanded: true,
  output: {answer: 'ขั้นตอนทั้งหมด', citationChunkIds: ['c1']},
  evidence: [chunk('c1', 'doc-b'), chunk('c2', 'doc-a')],
  scope: {}, queryVector: [1], fingerprint: 'f'.repeat(64),
};
const candidate = (mode: 'AI' | 'HUMAN') => ({conversationId, conversationRevision: 7, mode}) as unknown as RouteCandidate;

function fakeClient(job: unknown) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      sql.push(text);
      params.push(values);
      return {rows: text.includes('private.ai_jobs') ? (job ? [job] : []) : []};
    }),
  } as unknown as DbClient;
  return {client, sql, params};
}

const choice = {action: 'SHOW_FULL', jobId, conversationId};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decodeAIResult.mockReturnValue(savedAnswer);
  mocks.freshAnswerEvidence.mockResolvedValue(savedAnswer.evidence);
  mocks.ruleContextsStillMatch.mockReturnValue(true);
  mocks.evidenceStillMatches.mockReturnValue(true);
  mocks.buildCitedAnswer.mockReturnValue({messages: [{type: 'text', text: 'ขั้นตอนทั้งหมด'}], citations: [{chunkId: 'c1'}]});
});

describe('fullAnswerForChoice', () => {
  it('rebuilds the saved answer after re-checking its evidence under family then document locks', async () => {
    const {client, sql, params} = fakeClient({id: jobId});
    const result = await fullAnswerForChoice(client, {sessionId, choice, candidates: [candidate('AI')]}, 'key');
    expect(result).toEqual({
      status: 'READY', jobId, conversationId, conversationRevision: 7,
      messages: [{type: 'text', text: 'ขั้นตอนทั้งหมด'}], citations: [{chunkId: 'c1'}],
    });
    expect(params[0]).toEqual([jobId, conversationId, sessionId]);
    expect(sql[0]).toContain("status='DONE'");
    expect(params.slice(1, 4)).toEqual([['family:fam-1'], ['document:doc-a'], ['document:doc-b']]);
    expect(sql[4]).toContain('for share');
    expect(mocks.evidenceStillMatches).toHaveBeenCalledWith([savedAnswer.evidence[0]], savedAnswer.evidence);
  });

  it.each([
    ['a malformed job id', {...choice, jobId: 'not-a-uuid'}, 'AI'],
    ['a conversation now handled by Staff', choice, 'HUMAN'],
  ] as const)('refuses %s without reading the job', async (_name, value, mode) => {
    const {client} = fakeClient({id: jobId});
    expect(await fullAnswerForChoice(client, {sessionId, choice: value, candidates: [candidate(mode)]}, 'key')).toEqual({status: 'STALE'});
    expect(client.query).not.toHaveBeenCalled();
  });

  it('refuses when the job is not a finished answer of this session', async () => {
    const {client} = fakeClient(null);
    expect(await fullAnswerForChoice(client, {sessionId, choice, candidates: [candidate('AI')]}, 'key')).toEqual({status: 'STALE'});
  });

  it('refuses answers that were not produced by the section flow', async () => {
    mocks.decodeAIResult.mockReturnValue({...savedAnswer, sectionExpanded: undefined});
    const {client} = fakeClient({id: jobId});
    expect(await fullAnswerForChoice(client, {sessionId, choice, candidates: [candidate('AI')]}, 'key')).toEqual({status: 'STALE'});
    expect(mocks.freshAnswerEvidence).not.toHaveBeenCalled();
  });

  it('refuses when the evidence changed since the short answer was sent', async () => {
    mocks.evidenceStillMatches.mockReturnValue(false);
    const {client} = fakeClient({id: jobId});
    expect(await fullAnswerForChoice(client, {sessionId, choice, candidates: [candidate('AI')]}, 'key')).toEqual({status: 'STALE'});
    expect(mocks.buildCitedAnswer).not.toHaveBeenCalled();
  });

  it('treats an ambiguous fresh scope as stale and rethrows unexpected errors', async () => {
    mocks.freshAnswerEvidence.mockRejectedValueOnce(new Error('KNOWLEDGE_SCOPE_AMBIGUOUS'));
    const first = fakeClient({id: jobId});
    expect(await fullAnswerForChoice(first.client, {sessionId, choice, candidates: [candidate('AI')]}, 'key')).toEqual({status: 'STALE'});
    mocks.freshAnswerEvidence.mockRejectedValueOnce(new Error('connection lost'));
    const second = fakeClient({id: jobId});
    await expect(fullAnswerForChoice(second.client, {sessionId, choice, candidates: [candidate('AI')]}, 'key')).rejects.toThrow('connection lost');
  });
});
