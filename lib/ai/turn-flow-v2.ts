import {AIProviderError} from './types';
import type {AIWorkerOptions, AISnapshot} from './run-worker';
import type {AssistantHandoffReason, createAssistantDecision} from './assistant-decision';
import {createConversationReply, generalReplyNeedsEvidence} from './conversation-reply';
import type {KnowledgeEvidence, KnowledgeScope} from '../knowledge/types';
import type {SectionComposeResult} from '../knowledge/section-answer';
import {needsSpecificScope} from '../knowledge/answer-producer';
import {scopeIsGrounded, temporalScopeMatches, timeInQuestion} from '../knowledge/scope-validation';

type ProduceResult = Awaited<ReturnType<AIWorkerOptions['produce']>>;

/** Current, unscoped public information: no year, date, cohort, program, audience or department. */
export const DEFAULT_SCOPE: KnowledgeScope = {
  historical: false, academicYear: null, asOfDate: null, familyCodes: [], departmentCode: null,
  audience: null, studentType: null, semester: null, programCode: null, curriculumCode: null, cohort: null,
};

export type SectionSearchResult =
  | {status: 'READY'; evidence: KnowledgeEvidence[]; incompleteSections: number; queryVector: number[]; fingerprint: string}
  | {status: 'EMPTY' | 'SCOPE_AMBIGUOUS' | 'FAILED'};

export interface TurnFlowV2Options {
  /** Call 1: the accepted assistant decision contract, unchanged. */
  decide: ReturnType<typeof createAssistantDecision>;
  /** Backend-only: embed, search eligible evidence and add whole sections. No model call. */
  searchSections(scope: KnowledgeScope, queries: string[], signal: AbortSignal): Promise<SectionSearchResult>;
  /** Call 2: compose one cited answer over the selected evidence. */
  compose(snapshot: AISnapshot, scope: KnowledgeScope, evidence: KnowledgeEvidence[], incompleteSections: number, signal: AbortSignal): Promise<SectionComposeResult>;
  /** Existing knowledge producer: scope planning, structured data, discovery and web fallback. */
  fullLookup(snapshot: AISnapshot, signal: AbortSignal, retrievalHint?: string): Promise<ProduceResult>;
  handoff(snapshot: AISnapshot, signal: AbortSignal, reason: AssistantHandoffReason): Promise<ProduceResult>;
}

// Short limitation messages (CONV-V2-05 adds quick replies). Same meaning as the current flow:
// nothing was sent to Staff and no official fact is claimed.
export const TURN_FAILED_TEXT = 'ตอนนี้ผมตอบคำถามนี้ไม่สำเร็จครับ ลองส่งอีกครั้งได้ (ยังไม่ได้ส่งเรื่องถึงเจ้าหน้าที่)';
export const TURN_PARTIAL_GENERAL_TEXT = 'ส่วนคำแนะนำทั่วไปผมยังตอบได้ไม่มั่นใจครับ ส่วนข้อมูลทางการมีดังนี้';
export const TURN_OFFICIAL_FAILED_TEXT = 'ส่วนข้อมูลของมหาวิทยาลัยยังตรวจสอบไม่สำเร็จครับ ลองถามส่วนนี้อีกครั้งได้';

/** The finalizer offers a "talk to staff" choice only beside these exact V2 failure messages. */
export function isTurnFailureText(text: string): boolean {
  return text === TURN_FAILED_TEXT || text === TURN_OFFICIAL_FAILED_TEXT;
}

function cancelled(): AIProviderError {
  return new AIProviderError('CANCELLED');
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof AIProviderError && error.code === 'CANCELLED');
}

/**
 * True when the default current, unscoped search would not match what the USER asked:
 * any year, date, cohort, program, student type or historical cue keeps the full planning path.
 * This only chooses the more thorough path; it never routes a conversation or answers anything.
 */
export function requiresScopePlanning(snapshot: AISnapshot): boolean {
  if (needsSpecificScope(snapshot.question)) return true;
  const time = timeInQuestion(snapshot.question, snapshot.history, snapshot.continuesOwnedConversation === true);
  if (!temporalScopeMatches(DEFAULT_SCOPE, time)) return true;
  return !scopeIsGrounded(DEFAULT_SCOPE, snapshot, time);
}

/**
 * CONV-V2 turn: the unchanged decision call, then for official questions a backend-only
 * section search and one compose call. General answers take one model call, typical
 * unscoped official answers two. Everything else uses the existing full lookup path.
 */
export function createTurnFlowV2(options: TurnFlowV2Options): AIWorkerOptions['produce'] {
  async function official(snapshot: AISnapshot, signal: AbortSignal, query?: string): Promise<ProduceResult> {
    if (requiresScopePlanning(snapshot)) return options.fullLookup(snapshot, signal, query);
    const queries = query && query !== snapshot.question ? [query, snapshot.question] : [snapshot.question];
    const found = await options.searchSections(DEFAULT_SCOPE, queries, signal);
    if (signal.aborted) throw cancelled();
    // Empty, ambiguous or failed searches need the full path: scope questions, structured data, web fallback.
    if (found.status !== 'READY') return options.fullLookup(snapshot, signal, query);
    const composed = await options.compose(snapshot, DEFAULT_SCOPE, found.evidence, found.incompleteSections, signal);
    if (signal.aborted) throw cancelled();
    if (composed.status === 'NO_ANSWER') return options.fullLookup(snapshot, signal, query);
    if (composed.status === 'FAILED') return {kind: 'CLARIFY', text: TURN_OFFICIAL_FAILED_TEXT};
    return {
      kind: 'ANSWER',
      output: composed.output,
      scope: DEFAULT_SCOPE,
      evidence: found.evidence,
      queryVector: found.queryVector,
      fingerprint: found.fingerprint,
      sectionExpanded: true,
    };
  }

  return async (snapshot, signal) => {
    if (signal.aborted) throw cancelled();
    try {
      const {decision} = await options.decide({question: snapshot.question, history: snapshot.history}, signal);
      if (signal.aborted) throw cancelled();

      switch (decision.action) {
        case 'HANDOFF':
          return await options.handoff(snapshot, signal, decision.reason);
        case 'LOOKUP':
          return await official(snapshot, signal, decision.query);
        case 'GENERAL_REPLY':
        case 'CLARIFY': {
          const reply = createConversationReply(snapshot, decision.text);
          if (reply) return reply;
          // No repair call: prose that needs evidence goes to the official path, anything else fails short.
          if (decision.action === 'CLARIFY' || generalReplyNeedsEvidence(decision.text, snapshot.question, snapshot.history))
            return await official(snapshot, signal);
          return {kind: 'CLARIFY', text: TURN_FAILED_TEXT};
        }
        case 'MIXED_REPLY': {
          const general = createConversationReply(snapshot, decision.generalText) ?? createConversationReply(snapshot, TURN_PARTIAL_GENERAL_TEXT);
          let result: ProduceResult;
          try {
            result = await official(snapshot, signal, decision.query);
          } catch (error) {
            if (isCancellation(error, signal)) throw cancelled();
            result = {kind: 'CLARIFY', text: TURN_OFFICIAL_FAILED_TEXT};
          }
          if (signal.aborted) throw cancelled();
          if (!general || result.kind === 'CONVERSATION' || result.kind === 'MIXED' || result.support) return result;
          return {kind: 'MIXED', general, official: result};
        }
      }
    } catch (error) {
      if (isCancellation(error, signal)) throw cancelled();
      return {kind: 'CLARIFY', text: TURN_FAILED_TEXT};
    }
  };
}
