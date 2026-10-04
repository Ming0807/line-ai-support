import type { TicketStatus } from './state-machine';

export interface RouteCandidate {
  conversationId: string;
  conversationRevision: number;
  mode: 'AI' | 'HUMAN';
  topicLabel: string | null;
  ticketId: string | null;
  ticketRevision: number | null;
  ticketStatus: TicketStatus | null;
}

export type RouteKind =
  | 'AI_NEW'
  | 'AI_EXISTING'
  | 'HUMAN_TICKET'
  | 'ASK_CONTEXT'
  | 'SPAM';

export interface RouteDecision {
  route: RouteKind;
  conversationId?: string;
  ticketId?: string;
  confidence: number;
  reason: string;
}

export interface RouteConversationInput {
  candidates: RouteCandidate[];
  selectedConversationId?: string;
  newTopic?: boolean;
  spam?: boolean;
  confidence?: number;
}

const CONFIDENCE_THRESHOLD = 0.8;
const terminalTicketStatuses = new Set<TicketStatus>([
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
]);

function scoreConfidence(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) return 0;
  return value;
}

function decision(
  route: RouteKind,
  confidence: number,
  reason: string,
  conversationId?: string,
  ticketId?: string,
): RouteDecision {
  return {
    route,
    ...(conversationId ? { conversationId } : {}),
    ...(ticketId ? { ticketId } : {}),
    confidence,
    reason,
  };
}

function askContext(confidence: number, reason: string): RouteDecision {
  return decision('ASK_CONTEXT', confidence, reason);
}

function isTerminal(candidate: RouteCandidate): boolean {
  return candidate.ticketStatus !== null
    && terminalTicketStatuses.has(candidate.ticketStatus);
}

function routeCandidate(
  candidate: RouteCandidate,
  confidence: number,
): RouteDecision {
  if (isTerminal(candidate)) {
    return askContext(confidence, 'terminal_context_requires_explicit_new_topic');
  }

  if (candidate.mode === 'AI') {
    return decision(
      'AI_EXISTING',
      confidence,
      'selected_ai_conversation',
      candidate.conversationId,
    );
  }

  if (
    candidate.mode === 'HUMAN'
    && candidate.ticketId
    && candidate.ticketStatus !== null
    && candidate.ticketRevision !== null
  ) {
    return decision(
      'HUMAN_TICKET',
      confidence,
      'selected_active_human_ticket',
      candidate.conversationId,
      candidate.ticketId,
    );
  }

  return askContext(confidence, 'inconsistent_human_context');
}

/** Pure route selection over server-resolved conversations; labels and IDs are never matched as keywords. */
export function routeConversation(input: RouteConversationInput): RouteDecision {
  const confidence = scoreConfidence(input.confidence);

  if (input.spam === true) {
    return decision('SPAM', confidence, 'server_spam_decision');
  }

  if (input.newTopic === true) {
    return decision('AI_NEW', confidence, 'explicit_new_topic');
  }

  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const selectedId = input.selectedConversationId;

  if (selectedId !== undefined) {
    const matches = candidates.filter((candidate) => candidate.conversationId === selectedId);
    if (matches.length !== 1) {
      return askContext(confidence, 'selection_not_in_current_context');
    }
    // A selected ID represents an explicit server-resolved context choice;
    // classifier confidence is only relevant to automatic routing.
    return routeCandidate(matches[0], confidence);
  }

  if (candidates.length === 0) {
    return decision('AI_NEW', confidence, 'no_existing_context');
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    return askContext(confidence, 'low_confidence');
  }

  if (candidates.length > 1) {
    return askContext(confidence, 'multiple_contexts_require_selection');
  }

  return routeCandidate(candidates[0], confidence);
}
