import { describe, expect, it } from 'vitest';
import {
  routeConversation,
  type RouteCandidate,
} from '../lib/conversation/router';
import type { TicketStatus } from '../lib/conversation/state-machine';

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    conversationId: 'conversation-a',
    conversationRevision: 1,
    mode: 'AI',
    topicLabel: 'Library',
    ticketId: null,
    ticketRevision: null,
    ticketStatus: null,
    ...overrides,
  };
}

function humanCandidate(
  conversationId: string,
  ticketId: string,
  ticketStatus: TicketStatus = 'WAITING_STAFF',
): RouteCandidate {
  return candidate({
    conversationId,
    conversationRevision: 3,
    mode: 'HUMAN',
    topicLabel: 'Registration request',
    ticketId,
    ticketRevision: 7,
    ticketStatus,
  });
}

function assertNoSelection(decision: ReturnType<typeof routeConversation>) {
  expect(decision).not.toHaveProperty('conversationId');
  expect(decision).not.toHaveProperty('ticketId');
}

describe('pure conversation router', () => {
  it('starts an AI conversation when there are no existing candidates', () => {
    const decision = routeConversation({ candidates: [] });

    expect(decision).toMatchObject({ route: 'AI_NEW' });
    assertNoSelection(decision);
  });

  it('routes a uniquely selected AI conversation without inventing a ticket', () => {
    const ai = candidate({ conversationId: 'conversation-ai' });
    const decision = routeConversation({
      candidates: [ai],
      selectedConversationId: 'conversation-ai',
      confidence: 0.95,
    });

    expect(decision).toMatchObject({
      route: 'AI_EXISTING',
      conversationId: 'conversation-ai',
    });
    expect(decision).not.toHaveProperty('ticketId');
  });

  it('routes a uniquely selected active HUMAN ticket to its exact conversation and ticket', () => {
    const human = humanCandidate('conversation-human', 'ticket-41');
    const decision = routeConversation({
      candidates: [human],
      selectedConversationId: 'conversation-human',
      confidence: 0.95,
    });

    expect(decision).toMatchObject({
      route: 'HUMAN_TICKET',
      conversationId: 'conversation-human',
      ticketId: 'ticket-41',
    });
  });

  it('uses an explicit server-resolved selection when classifier confidence is absent', () => {
    const human = humanCandidate('conversation-explicit', 'ticket-explicit');
    const decision = routeConversation({
      candidates: [human],
      selectedConversationId: 'conversation-explicit',
    });

    expect(decision).toMatchObject({
      route: 'HUMAN_TICKET',
      conversationId: 'conversation-explicit',
      ticketId: 'ticket-explicit',
    });
  });

  it('asks for context when multiple candidates have no explicit selection', () => {
    const decision = routeConversation({
      candidates: [
        humanCandidate('conversation-registration', 'ticket-registration'),
        candidate({ conversationId: 'conversation-library' }),
      ],
      confidence: 0.99,
    });

    expect(decision).toMatchObject({ route: 'ASK_CONTEXT' });
    assertNoSelection(decision);
  });

  it('uses the selected conversation independent of candidate ordering', () => {
    const first = humanCandidate('conversation-first', 'ticket-first');
    const selected = humanCandidate('conversation-selected', 'ticket-selected');
    const forward = routeConversation({
      candidates: [first, selected],
      selectedConversationId: 'conversation-selected',
      confidence: 0.95,
    });
    const reversed = routeConversation({
      candidates: [selected, first],
      selectedConversationId: 'conversation-selected',
      confidence: 0.95,
    });

    expect(forward).toMatchObject({
      route: 'HUMAN_TICKET',
      conversationId: 'conversation-selected',
      ticketId: 'ticket-selected',
    });
    expect(reversed).toEqual(forward);
  });

  it('asks for context below the 0.8 confidence threshold and routes at the threshold', () => {
    const only = humanCandidate('conversation-only', 'ticket-only');
    const low = routeConversation({ candidates: [only], confidence: 0.79 });
    const atThreshold = routeConversation({ candidates: [only], confidence: 0.8 });

    expect(low).toMatchObject({ route: 'ASK_CONTEXT' });
    assertNoSelection(low);
    expect(atThreshold).toMatchObject({
      route: 'HUMAN_TICKET',
      conversationId: 'conversation-only',
      ticketId: 'ticket-only',
    });
  });

  it('treats missing confidence as undecided when existing contexts are present', () => {
    const decision = routeConversation({
      candidates: [humanCandidate('conversation-only', 'ticket-only')],
    });

    expect(decision).toMatchObject({ route: 'ASK_CONTEXT', confidence: 0 });
    assertNoSelection(decision);
  });

  it('treats malformed confidence as low confidence', () => {
    const only = humanCandidate('conversation-only', 'ticket-only');

    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      const decision = routeConversation({ candidates: [only], confidence });
      expect(decision).toMatchObject({ route: 'ASK_CONTEXT', confidence: 0 });
      assertNoSelection(decision);
    }
  });

  it('creates a separate AI route for an explicit new topic without mutating old contexts', () => {
    const oldContexts = [
      humanCandidate('conversation-registration', 'ticket-registration'),
      candidate({ conversationId: 'conversation-library-old', topicLabel: 'Library' }),
    ];
    const before = structuredClone(oldContexts);
    const decision = routeConversation({
      candidates: oldContexts,
      newTopic: true,
      confidence: 0.2,
    });

    expect(decision).toMatchObject({ route: 'AI_NEW' });
    assertNoSelection(decision);
    expect(oldContexts).toEqual(before);
  });

  it('does not route an unknown or duplicate selection to a ticket', () => {
    const first = humanCandidate('conversation-duplicate', 'ticket-first');
    const second = humanCandidate('conversation-duplicate', 'ticket-second');
    const unknown = routeConversation({
      candidates: [first],
      selectedConversationId: 'conversation-not-in-context',
      confidence: 1,
    });
    const duplicate = routeConversation({
      candidates: [first, second],
      selectedConversationId: 'conversation-duplicate',
      confidence: 1,
    });

    expect(unknown).toMatchObject({ route: 'ASK_CONTEXT' });
    assertNoSelection(unknown);
    expect(duplicate).toMatchObject({ route: 'ASK_CONTEXT' });
    assertNoSelection(duplicate);
  });

  it.each(['RESOLVED', 'CLOSED', 'CANCELLED'] as const)(
    'never resumes a HUMAN ticket in terminal status %s',
    (status) => {
      const closed = humanCandidate('conversation-terminal', 'ticket-terminal', status);
      const selected = routeConversation({
        candidates: [closed],
        selectedConversationId: 'conversation-terminal',
        confidence: 1,
      });
      const automatic = routeConversation({ candidates: [closed], confidence: 1 });

      expect(selected).toMatchObject({ route: 'ASK_CONTEXT' });
      assertNoSelection(selected);
      expect(automatic).toMatchObject({ route: 'ASK_CONTEXT' });
      assertNoSelection(automatic);
    },
  );

  it('never routes a HUMAN conversation without an active ticket as HUMAN_TICKET', () => {
    const orphanedHuman = candidate({
      conversationId: 'conversation-without-ticket',
      mode: 'HUMAN',
    });
    const decision = routeConversation({
      candidates: [orphanedHuman],
      selectedConversationId: orphanedHuman.conversationId,
      confidence: 1,
    });

    expect(decision).toMatchObject({ route: 'ASK_CONTEXT' });
    assertNoSelection(decision);
  });

  it('treats a spam decision as terminal and returns no selected context', () => {
    const decision = routeConversation({
      candidates: [humanCandidate('conversation-human', 'ticket-human')],
      spam: true,
      confidence: 1,
    });

    expect(decision).toMatchObject({ route: 'SPAM' });
    assertNoSelection(decision);
  });

  it('does not use topic labels as keyword routing evidence', () => {
    const registrationLabel = humanCandidate('conversation-only', 'ticket-only');
    const libraryLabel = {
      ...registrationLabel,
      topicLabel: 'Library',
    };
    const fromRegistrationLabel = routeConversation({
      candidates: [registrationLabel],
      confidence: 0.9,
    });
    const fromLibraryLabel = routeConversation({
      candidates: [libraryLabel],
      confidence: 0.9,
    });

    expect(fromRegistrationLabel).toEqual(fromLibraryLabel);
  });
});
