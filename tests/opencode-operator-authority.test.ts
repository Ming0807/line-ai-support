import { describe, expect, it } from 'vitest';
import { acknowledgeCursor, contiguousReadTarget } from '@/app/(dashboard)/tickets/[id]/chat-thread-state';
import {
  clearActionAttempt,
  clearActorActionAttempts,
  findActionAttempt,
  registerActionAttempt,
} from '@/app/(dashboard)/tickets/[id]/ticket-action-workspace';
import { createThreadDraftStore } from '@/app/(dashboard)/tickets/[id]/chat-thread-ops';
import {
  shouldClearSelectedThread,
  ThreadRequestFence,
  writeCompletionValid,
} from '@/app/(dashboard)/inbox/controller';

const ticketIdA = '11111111-1111-4111-8111-111111111111';
const ticketIdB = '22222222-2222-4222-8222-222222222222';

describe('OP06-02 CX1 authority epoch (ThreadRequestFence)', () => {
  it('a token minted before the whole-actor revoke may never write', () => {
    const fence = new ThreadRequestFence('staff-op06', ticketIdA);
    const stale = fence.begin('staff-op06', ticketIdA);
    fence.revokeAuthority();
    expect(fence.accepts(stale)).toBe(false);
    // Still-current ticket: the epoch, not the ticket, kills the token.
    expect(fence.accepts({ ...stale, ticketId: ticketIdA })).toBe(false);
  });

  it('a token minted after the revoke writes; later room selects keep the same authority', () => {
    const fence = new ThreadRequestFence('staff-op06', ticketIdA);
    fence.revokeAuthority();
    const fresh = fence.begin('staff-op06', ticketIdA);
    expect(fence.accepts(fresh)).toBe(true);
    fence.select('staff-op06', ticketIdB);
    expect(fence.accepts(fresh)).toBe(false); // ticket mismatch by select
    const onB = fence.begin('staff-op06', ticketIdB);
    expect(onB.authorityEpoch).toBe(fresh.authorityEpoch);
    expect(fence.accepts(onB)).toBe(true);
  });

  it('every mint carries the epoch of its lease and accepts matches exactly', () => {
    const fence = new ThreadRequestFence('staff-op06', ticketIdA);
    const first = fence.begin('staff-op06', ticketIdA);
    expect(first.authorityEpoch).toBe(0);
    fence.revokeAuthority();
    const second = fence.begin('staff-op06', ticketIdA);
    expect(second.authorityEpoch).toBe(1);
    // Cross-ticket token still compares its epoch before anything else.
    expect(fence.accepts({ ...second, ticketId: ticketIdB })).toBe(false);
  });
});

describe('OP06-02 CX1 write-completion fence', () => {
  it('applies only inside the same authority, actor and ticket', () => {
    const base = { authorityEpoch: 1, leaseEpoch: 1, actorId: 's', leaseActorId: 's', ticketId: ticketIdA, leaseTicketId: ticketIdA };
    expect(writeCompletionValid(base)).toBe(true);
    expect(writeCompletionValid({ ...base, leaseEpoch: 2 })).toBe(false);
    expect(writeCompletionValid({ ...base, leaseActorId: 'other' })).toBe(false);
    expect(writeCompletionValid({ ...base, leaseTicketId: ticketIdB })).toBe(false);
  });
});

describe('OP06-02 RX4 contiguous read-ack frontier', () => {
  it('holds the cursor when the rendered tail sits behind an unloaded gap', () => {
    // exactly the S14/RX4 regression shape: tail 51..60 rendered while 1..50 unloaded
    expect(contiguousReadTarget(0, [{ lo: 51, hi: 60 }])).toBe(0);
    expect(contiguousReadTarget(4, [{ lo: 1, hi: 6 }, { lo: 12, hi: 20 }])).toBe(6);
  });

  it('claims through the contiguous frontier the spans prove loaded', () => {
    expect(contiguousReadTarget(0, [{ lo: 1, hi: 50 }, { lo: 51, hi: 60 }])).toBe(60);
    // S14 shape: gap-free tail 8..10 after cursor 7 keeps acking 10
    expect(contiguousReadTarget(7, [{ lo: 8, hi: 10 }])).toBe(10);
    expect(contiguousReadTarget(4, [{ lo: 1, hi: 6 }, { lo: 7, hi: 9 }, { lo: 12, hi: 20 }])).toBe(9);
    expect(contiguousReadTarget(55, [{ lo: 51, hi: 60 }])).toBe(60);
  });

  it('never regresses the cursor and ignores spans fully behind it', () => {
    expect(contiguousReadTarget(60, [{ lo: 1, hi: 50 }, { lo: 51, hi: 60 }])).toBe(60);
    expect(contiguousReadTarget(57, [{ lo: 1, hi: 50 }, { lo: 51, hi: 56 }])).toBe(57);
  });

  it('stays monotone through acknowledgeCursor on later merges', () => {
    expect(acknowledgeCursor(9, 7)).toBe(9);
    expect(acknowledgeCursor(9, 10)).toBe(10);
  });
});

describe('OP06-02 RX2 guarded attempt clears', () => {
  const actor = 'staff-op06-rx2';
  const action = 'ACCEPT' as const;

  it('keeps the stored attempt when a foreign requestId tries to clear it', () => {
    registerActionAttempt({
      actorId: actor, ticketId: ticketIdA, action,
      endpoint: `/api/tickets/${ticketIdA}/accept`, revision: 3,
      body: { revision: 3, requestId: '00000000-0000-4000-8000-0000000000aa' },
    });
    clearActionAttempt(actor, ticketIdA, action, { requestId: '00000000-0000-4000-8000-0000000000ff' });
    expect(findActionAttempt(actor, ticketIdA, action)?.requestId).toBe('00000000-0000-4000-8000-0000000000aa');
    // The owning requestId clears idempotently.
    clearActionAttempt(actor, ticketIdA, action, { requestId: '00000000-0000-4000-8000-0000000000aa' });
    expect(findActionAttempt(actor, ticketIdA, action)).toBeUndefined();
    // A second clear with the OLD requestId is a harmless no-op.
    clearActionAttempt(actor, ticketIdA, action, { requestId: '00000000-0000-4000-8000-0000000000aa' });
  });

  it('a newer attempt survives a late OLD completion and is cleared by its own requestId', () => {
    registerActionAttempt({
      actorId: actor, ticketId: ticketIdB, action,
      endpoint: `/api/tickets/${ticketIdB}/accept`, revision: 1,
      body: { revision: 1, requestId: '00000000-0000-4000-8000-0000000000aa' },
    });
    // Whole-actor reset, then the retry re-registers under the same key.
    clearActorActionAttempts(actor);
    registerActionAttempt({
      actorId: actor, ticketId: ticketIdB, action,
      endpoint: `/api/tickets/${ticketIdB}/accept`, revision: 4,
      body: { revision: 4, requestId: '00000000-0000-4000-8000-0000000000bb' },
    });
    // The OLD completion (req …aa) resolves late: the NEW attempt must survive.
    clearActionAttempt(actor, ticketIdB, action, { requestId: '00000000-0000-4000-8000-0000000000aa' });
    expect(findActionAttempt(actor, ticketIdB, action)?.body.revision).toBe(4);
    clearActionAttempt(actor, ticketIdB, action, { requestId: '00000000-0000-4000-8000-0000000000bb' });
    expect(findActionAttempt(actor, ticketIdB, action)).toBeUndefined();
  });

  it('an unguarded wipe (authority reset) still clears regardless of requestId', () => {
    registerActionAttempt({
      actorId: actor, ticketId: ticketIdA, action: 'RESOLVE',
      endpoint: `/api/tickets/${ticketIdA}/resolve`, revision: 3,
      body: { revision: 3, requestId: '00000000-0000-4000-8000-0000000000aa' },
    });
    clearActorActionAttempts(actor);
    expect(findActionAttempt(actor, ticketIdA, 'RESOLVE')).toBeUndefined();
  });
});

describe('OP06-02 CX1 whole-actor draft erasure', () => {
  it('erases every draft of the actor and keeps other actors intact', () => {
    const store = createThreadDraftStore();
    store.write('staff-op06', ticketIdA, 'note', 'PRIVATE_DRAFT_A');
    store.write('staff-op06', ticketIdA, 'reply', 'PRIVATE_REPLY_A');
    store.write('staff-op06', ticketIdB, 'reply', 'PRIVATE_REPLY_B');
    store.write('someone-else', ticketIdA, 'note', 'OTHER_ACTOR');
    store.eraseActorDrafts!('staff-op06');
    expect(store.read('staff-op06', ticketIdA, 'note')).toBe('');
    expect(store.read('staff-op06', ticketIdA, 'reply')).toBe('');
    expect(store.read('staff-op06', ticketIdB, 'reply')).toBe('');
    expect(store.read('someone-else', ticketIdA, 'note')).toBe('OTHER_ACTOR');
  });
});

describe('OP06-02 access-loss scope semantics (regression pin)', () => {
  it('closes only the matching selection; the status set stays 401/403/404', () => {
    for (const status of [401, 403, 404]) {
      expect(shouldClearSelectedThread({ status, requestIsCurrent: true, requestTicketId: ticketIdA, selectedTicketId: ticketIdA })).toBe(status === 401 || status === 403 || status === 404);
      expect(shouldClearSelectedThread({ status, requestIsCurrent: true, requestTicketId: ticketIdA, selectedTicketId: ticketIdB })).toBe(false);
      expect(shouldClearSelectedThread({ status, requestIsCurrent: false, requestTicketId: ticketIdA, selectedTicketId: ticketIdB })).toBe(false);
    }
    expect(shouldClearSelectedThread({ status: 409, requestIsCurrent: true, requestTicketId: ticketIdA, selectedTicketId: ticketIdA })).toBe(false);
  });
});

describe('OC07-01 RX4 sparse non-1 sequences and server-proven empties', () => {
  it('advances through sparse 5/9/12 spans when hasMore is false (no earlier messages exist)', () => {
    // Root probe: global message_seq gives non-1, non-contiguous ids for one ticket.
    expect(contiguousReadTarget(0, [{ lo: 5, hi: 12 }], { hasMore: false })).toBe(12);
    // While hasMore is true and earlier ranges are unproven, hold cursor at 0.
    expect(contiguousReadTarget(0, [{ lo: 5, hi: 12 }], { hasMore: true })).toBe(0);
    // hasMore:false proves ONLY [1..oldest-1] empty, never an unbridged mid-thread hole.
    expect(contiguousReadTarget(0, [{ lo: 5, hi: 12 }, { lo: 100, hi: 250 }], { hasMore: false })).toBe(12);
  });

  it('bridges proven empties across spans without ever inventing an empty endpoint sequence', () => {
    expect(contiguousReadTarget(0, [{ lo: 5, hi: 12 }], { empties: [{ lo: 1, hi: 4 }] })).toBe(12);
    expect(contiguousReadTarget(0, [{ lo: 5, hi: 12 }], [{ lo: 1, hi: 4 }])).toBe(12);
    expect(
      contiguousReadTarget(0, [{ lo: 5, hi: 5 }, { lo: 20, hi: 200 }], {
        empties: [{ lo: 1, hi: 4 }, { lo: 6, hi: 19 }],
        hasMore: true,
      }),
    ).toBe(200);
    // A partial empty that leaves [6..9] unproven must halt at 5.
    expect(
      contiguousReadTarget(0, [{ lo: 5, hi: 5 }, { lo: 20, hi: 200 }], {
        empties: [{ lo: 1, hi: 4 }, { lo: 10, hi: 19 }],
        hasMore: false,
      }),
    ).toBe(5);
    // Trailing empties beyond the last loaded span never become throughSequence.
    expect(
      contiguousReadTarget(0, [{ lo: 5, hi: 12 }], {
        empties: [{ lo: 1, hi: 4 }, { lo: 13, hi: 20 }],
        hasMore: false,
      }),
    ).toBe(12);
  });
});
