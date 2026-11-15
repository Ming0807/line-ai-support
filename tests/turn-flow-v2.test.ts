import {describe, expect, it, vi} from 'vitest';
import {AIProviderError} from '../lib/ai/types';
import type {AISnapshot} from '../lib/ai/run-worker';
import type {AssistantDecision} from '../lib/ai/assistant-decision';
import {
  createTurnFlowV2, DEFAULT_SCOPE, requiresScopePlanning, TURN_FAILED_TEXT,
  type SectionSearchResult, type TurnFlowV2Options,
} from '../lib/ai/turn-flow-v2';
import type {SectionComposeResult} from '../lib/knowledge/section-answer';
import type {KnowledgeEvidence} from '../lib/knowledge/types';

const chunkId = '00000000-0000-4000-8000-000000000001';
const evidence = [{chunkId, documentId: '00000000-0000-4000-8000-0000000000aa', content: '1. เปิด Wi-Fi'}] as unknown as KnowledgeEvidence[];
const ready: SectionSearchResult = {status: 'READY', evidence, incompleteSections: 0, queryVector: [0.1, 0.2], fingerprint: 'f'.repeat(64)};
const answer: SectionComposeResult = {status: 'READY', output: {answer: 'ทำตามขั้นตอนนี้ครับ', citationChunkIds: [chunkId]}};

function snapshot(question: string, history: AISnapshot['history'] = []): AISnapshot {
  return {
    jobId: '00000000-0000-4000-8000-000000000010',
    sessionId: '00000000-0000-4000-8000-000000000011',
    conversationId: '00000000-0000-4000-8000-000000000012',
    messageId: '00000000-0000-4000-8000-000000000013',
    revision: 1, question, history,
  };
}

function setup(decision: AssistantDecision | Error, overrides: Partial<TurnFlowV2Options> = {}) {
  const calls = {
    decide: vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return {decision, provenance: 'MODEL_PROPOSAL_UNVERIFIED' as const, historyOmittedCount: 0};
    }),
    searchSections: vi.fn(async (): Promise<SectionSearchResult> => ready),
    compose: vi.fn(async (): Promise<SectionComposeResult> => answer),
    fullLookup: vi.fn(async () => ({kind: 'CLARIFY' as const, text: 'full lookup'})),
    handoff: vi.fn(async () => ({kind: 'CLARIFY' as const, text: 'handoff proposal'})),
  };
  const produce = createTurnFlowV2({
    decide: calls.decide as unknown as TurnFlowV2Options['decide'],
    searchSections: calls.searchSections,
    compose: calls.compose,
    fullLookup: calls.fullLookup,
    handoff: calls.handoff,
    ...overrides,
  });
  return {produce, calls};
}

const signal = () => new AbortController().signal;

describe('createTurnFlowV2', () => {
  it('answers a general question with only the decision call', async () => {
    const {produce, calls} = setup({action: 'GENERAL_REPLY', text: 'สวัสดีครับ มีอะไรให้ผมช่วยไหมครับ'});
    const result = await produce(snapshot('สวัสดีครับ'), signal());
    expect(result).toMatchObject({kind: 'CONVERSATION', text: 'สวัสดีครับ มีอะไรให้ผมช่วยไหมครับ'});
    expect(calls.searchSections).not.toHaveBeenCalled();
    expect(calls.compose).not.toHaveBeenCalled();
    expect(calls.fullLookup).not.toHaveBeenCalled();
  });

  it('answers an unscoped official question with a section search and one compose call', async () => {
    const {produce, calls} = setup({action: 'LOOKUP', query: 'วิธีเชื่อมต่อ Wi-Fi มหาวิทยาลัย'});
    const result = await produce(snapshot('ต่อไวไฟมหาลัยยังไง'), signal());
    expect(calls.searchSections).toHaveBeenCalledWith(DEFAULT_SCOPE, ['วิธีเชื่อมต่อ Wi-Fi มหาวิทยาลัย', 'ต่อไวไฟมหาลัยยังไง'], expect.anything());
    expect(calls.compose).toHaveBeenCalledTimes(1);
    expect(calls.fullLookup).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'ANSWER', output: answer.status === 'READY' ? answer.output : null, scope: DEFAULT_SCOPE, evidence,
      queryVector: [0.1, 0.2], fingerprint: 'f'.repeat(64), sectionExpanded: true,
    });
  });

  it('keeps the full planning path when the question names a year', async () => {
    const {produce, calls} = setup({action: 'LOOKUP', query: 'ปฏิทินการศึกษา 2569'});
    const result = await produce(snapshot('ปฏิทินการศึกษาปีการศึกษา 2569'), signal());
    expect(calls.searchSections).not.toHaveBeenCalled();
    expect(calls.fullLookup).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'ปฏิทินการศึกษา 2569');
    expect(result).toEqual({kind: 'CLARIFY', text: 'full lookup'});
  });

  it.each(['EMPTY', 'SCOPE_AMBIGUOUS', 'FAILED'] as const)('falls back to the full lookup when the section search is %s', async status => {
    const {produce, calls} = setup({action: 'LOOKUP', query: 'Wi-Fi'}, {searchSections: async () => ({status})});
    await produce(snapshot('ต่อไวไฟยังไง'), signal());
    expect(calls.fullLookup).toHaveBeenCalledTimes(1);
  });

  it('uses the full lookup when the evidence does not answer the question', async () => {
    const {produce, calls} = setup({action: 'LOOKUP', query: 'Wi-Fi'}, {compose: async () => ({status: 'NO_ANSWER'})});
    await produce(snapshot('ต่อไวไฟยังไง'), signal());
    expect(calls.fullLookup).toHaveBeenCalledTimes(1);
  });

  it('gives a short limitation without another model call when composing fails', async () => {
    const {produce, calls} = setup({action: 'LOOKUP', query: 'Wi-Fi'}, {compose: async () => ({status: 'FAILED'})});
    const result = await produce(snapshot('ต่อไวไฟยังไง'), signal());
    expect(result.kind).toBe('CLARIFY');
    expect(calls.fullLookup).not.toHaveBeenCalled();
    expect(calls.decide).toHaveBeenCalledTimes(1);
  });

  it('passes a staff request to the existing handoff proposal', async () => {
    const {produce, calls} = setup({action: 'HANDOFF', reason: 'USER_REQUEST'});
    await produce(snapshot('ขอคุยกับเจ้าหน้าที่'), signal());
    expect(calls.handoff).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'USER_REQUEST');
  });

  it('combines the general part with the official answer for a mixed request', async () => {
    const {produce} = setup({action: 'MIXED_REPLY', generalText: 'ลองรีสตาร์ทอุปกรณ์ก่อนครับ', query: 'วิธีเชื่อมต่อ Wi-Fi'});
    const result = await produce(snapshot('ไวไฟหลุดบ่อย และต่อไวไฟมหาลัยยังไง'), signal());
    expect(result).toMatchObject({kind: 'MIXED', general: {kind: 'CONVERSATION'}, official: {kind: 'ANSWER', sectionExpanded: true}});
  });

  it('sends general prose that needs evidence to the official path instead of repairing it', async () => {
    const {produce, calls} = setup({action: 'GENERAL_REPLY', text: 'เข้าไปที่ https://wifi.example.ac.th ได้เลยครับ'});
    await produce(snapshot('ต่อไวไฟยังไง'), signal());
    expect(calls.decide).toHaveBeenCalledTimes(1);
    expect(calls.searchSections).toHaveBeenCalledTimes(1);
  });

  it('returns the short failure text when the decision call fails', async () => {
    const {produce} = setup(new AIProviderError('TIMEOUT'));
    expect(await produce(snapshot('สวัสดี'), signal())).toEqual({kind: 'CLARIFY', text: TURN_FAILED_TEXT});
  });

  it('propagates cancellation instead of answering', async () => {
    const controller = new AbortController();
    const {produce} = setup({action: 'LOOKUP', query: 'Wi-Fi'}, {
      searchSections: async () => {
        controller.abort();
        return ready;
      },
    });
    await expect(produce(snapshot('ต่อไวไฟยังไง'), controller.signal)).rejects.toMatchObject({code: 'CANCELLED'});
  });
});

describe('requiresScopePlanning', () => {
  it.each([
    ['ต่อไวไฟมหาลัยยังไง', false],
    ['ห้องสมุดเปิดกี่โมง', false],
    ['ปฏิทินการศึกษาปีการศึกษา 2569', true],
    ['ค่าเทอมนักศึกษาภาคพิเศษ', true],
    ['ระเบียบย้อนหลังเป็นอย่างไร', true],
  ])('%s → %s', (question, expected) => {
    expect(requiresScopePlanning(snapshot(question))).toBe(expected);
  });
});
