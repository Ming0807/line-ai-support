import { describe, expect, it } from 'vitest';
import {
  ListRequestGate,
  buildInboxListParams,
  composeAfterSuccess,
  contiguousReadTarget,
  inboxListStateFromURL,
  inboxListUrl,
  mergeThreadWindow,
  paginationLabel,
  pendingWriteDecision,
  realtimePhaseMapper,
  writeAttemptOutcome,
  type PendingWrite,
  type ThreadWindow,
} from '@/app/(dashboard)/tickets/[id]/chat-thread-state';
import type { ChatMessage } from '@/types/inbox';

function message(sequence: number, id = `m-${sequence}`): ChatMessage {
  return {
    id, sequence, senderType: 'USER', staffName: null,
    content: `ข้อความ ${sequence}`, createdAt: `2026-10-28T01:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    deliveryStatus: null, attachments: [],
  };
}

const thread = (sequences: number[]): ThreadWindow => ({
  messages: sequences.map(sequence => message(sequence)),
  hasMore: false, nextBefore: null,
});

describe('inbox thread window merge and catch-up', () => {
  it('merges windows without duplicates and keeps the full union ordered by sequence', () => {
    const merged = mergeThreadWindow(thread([51, 52, 53]), {
      messages: [message(52), message(53), message(54)],
      hasMore: false, nextBefore: null,
    }, 'refresh');
    expect(merged.messages.map(item => item.sequence)).toEqual([51, 52, 53, 54]);
  });

  it('keeps the older-history cursor and detects a mid-window gap after a burst beyond the 50-message window', () => {
    // In-flight state: [s51..s100]; the refetch returns the newest window [s151..s200].
    const before: ThreadWindow = { ...thread([51, 100]), hasMore: true, nextBefore: 51 };
    const incoming = { messages: [message(151), message(200)], hasMore: false, nextBefore: null };
    const merged = mergeThreadWindow(before, incoming, 'refresh');
    // The union is not contiguous: [s51, s100, s151, s200] — the hole [101..150] must NOT be hidden.
    expect(merged.messages.map(item => item.sequence)).toEqual([51, 100, 151, 200]);
    expect(merged.firstCatchUpBefore).toBe(151);
    // Older history below s51 still needs loading.
    expect(merged.hasMore).toBe(true);
    expect(merged.nextBefore).toBe(51);
  });

  it('normalises the older cursor to the earliest loaded sequence of the union', () => {
    const before: ThreadWindow = { messages: [message(80), message(90)], hasMore: true, nextBefore: 80 };
    const incoming = { messages: [message(70), message(80)], hasMore: true, nextBefore: 70 };
    const merged = mergeThreadWindow(before, incoming, 'history');
    expect(merged.messages.map(item => item.sequence)).toEqual([70, 80, 90]);
    expect(merged.nextBefore).toBe(70);
  });

  it('S13: a stale history copy never overwrites the newer known message of the same id', () => {
    const previous: ThreadWindow = {
      messages: [{ ...message(4), deliveryStatus: 'SENT', content: 'ฉบับที่รู้ล่าสุด' }],
      hasMore: true, nextBefore: 4,
    };
    const stale = mergeThreadWindow(previous, {
      messages: [{ ...message(4), deliveryStatus: 'PENDING', content: 'สำเนาเก่า' }],
      hasMore: false, nextBefore: null,
    }, 'history');
    expect(stale.messages[0].deliveryStatus).toBe('SENT');
    expect(stale.messages[0].content).toBe('ฉบับที่รู้ล่าสุด');
  });

  it('a refresh copy carries the server truth for a repeated id', () => {
    const previous: ThreadWindow = { messages: [{ ...message(4), content: 'ฉบับเดิม' }], hasMore: true, nextBefore: 4 };
    const refreshed = mergeThreadWindow(previous, {
      messages: [{ ...message(4), content: 'ฉบับจากเซิร์ฟเวอร์' }],
      hasMore: false, nextBefore: null,
    }, 'refresh');
    expect(refreshed.messages[0].content).toBe('ฉบับจากเซิร์ฟเวอร์');
  });

  it('reports catch-up completion when the union is contiguous', () => {
    // Boundary-aware: the resolved merge result carries the catch-up cursor itself.
    const merged = mergeThreadWindow(thread([1, 2, 3]), { messages: [message(2), message(3)], hasMore: false, nextBefore: null }, 'refresh');
    expect(merged.firstCatchUpBefore).toBeNull();
  });

  it('OC07-01 RX4: records proven empties from beforeSequence history fetch and hasMore:false', () => {
    // Page 1 returns newest 50 sparse messages [20..200] with hasMore:true.
    const latest: ThreadWindow = {
      messages: [message(20), message(200)],
      hasMore: true,
      nextBefore: 20,
    };
    // Loading earlier (beforeSequence=20) returns sparse sequence 5 and hasMore:false.
    const merged = mergeThreadWindow(
      latest,
      { messages: [message(5)], hasMore: false, nextBefore: null },
      'history',
      { beforeSequence: 20 },
    );
    expect(merged.hasMore).toBe(false);
    expect(merged.nextBefore).toBeNull();
    expect(merged.firstCatchUpBefore).toBeNull();
    expect(merged.empties).toEqual(expect.arrayContaining([{ lo: 1, hi: 4 }, { lo: 6, hi: 19 }]));
    expect(
      contiguousReadTarget(0, merged.spans, { empties: merged.empties, hasMore: merged.hasMore }),
    ).toBe(200);
  });

  it('OC07-01 RX4: clears hasMore when history fetch returns empty with hasMore:false', () => {
    const latest: ThreadWindow = {
      messages: [message(20), message(200)],
      hasMore: true,
      nextBefore: 20,
    };
    const merged = mergeThreadWindow(
      latest,
      { messages: [], hasMore: false, nextBefore: null },
      'history',
      { beforeSequence: 20 },
    );
    expect(merged.hasMore).toBe(false);
    expect(merged.nextBefore).toBeNull();
    expect(merged.empties).toEqual(expect.arrayContaining([{ lo: 1, hi: 19 }]));
    expect(
      contiguousReadTarget(0, merged.spans, { empties: merged.empties, hasMore: merged.hasMore }),
    ).toBe(200);
  });

  it('OC07-01 RX4: keeps holding cursor while older history still has hasMore:true', () => {
    const latest: ThreadWindow = {
      messages: [message(20), message(200)],
      hasMore: true,
      nextBefore: 20,
    };
    const partial = mergeThreadWindow(
      latest,
      { messages: [message(12)], hasMore: true, nextBefore: 12 },
      'history',
      { beforeSequence: 20 },
    );
    // [13..19] is proven empty (no false catch-up gap), but [1..11] still exists (hasMore:true).
    expect(partial.hasMore).toBe(true);
    expect(partial.nextBefore).toBe(12);
    expect(partial.firstCatchUpBefore).toBeNull();
    expect(
      contiguousReadTarget(0, partial.spans, { empties: partial.empties, hasMore: partial.hasMore }),
    ).toBe(0);
  });
});

describe('immutable pending write for composer submissions', () => {
  const base = {
    actorId: 'staff-a', ticketId: 't-1', kind: 'reply' as const,
    endpoint: '/api/tickets/t-1/reply', text: 'ข้อความเดิม',
    body: { revision: 4, text: 'ข้อความเดิม' },
  };

  it('reuses the exact pending body and request id while an outcome is still unknown', () => {
    const first = pendingWriteDecision(undefined, base);
    expect(first.reuse).toBe(false);
    const retry = pendingWriteDecision(first.write, base);
    expect(retry.reuse).toBe(true);
    // The stored body (including requestId) must not be regenerated by a poll, a new revision, or a text edit.
    expect(retry.write.body).toEqual(first.write.body);
    expect(retry.write.body.requestId).toBe(first.write.body.requestId);
  });

  it('separates a freshly typed draft from the old request so it survives confirmation later', () => {
    const pending: PendingWrite = {
      ...base, startedAt: 100,
      body: { revision: 4, text: 'ข้อความเดิม', requestId: 'request-1' },
    };
    expect(composeAfterSuccess(pending, 'ข้อความเดิม').clearComposer).toBe(true);
    // The user typed a NEW draft while the old request was in flight; success must not destroy it.
    expect(composeAfterSuccess(pending, 'ข้อความใหม่ที่พิมพ์ระหว่างรอ').clearComposer).toBe(false);
    expect(composeAfterSuccess(pending, '').clearComposer).toBe(false);
  });

  it('classifies outcomes: network/5xx/invalid success JSON keep the request, 409 and 4xx clear it', () => {
    expect(writeAttemptOutcome('network', 'no-json')).toBe('uncertain');
    expect(writeAttemptOutcome(503, 'no-json')).toBe('uncertain');
    expect(writeAttemptOutcome(200, 'invalid-json')).toBe('uncertain');
    expect(writeAttemptOutcome(409, 'parsed')).toBe('reject-clear');
    expect(writeAttemptOutcome(401, 'parsed')).toBe('reject-clear');
    expect(writeAttemptOutcome(400, 'parsed')).toBe('reject-clear');
    expect(writeAttemptOutcome(200, 'parsed')).toBe('committed');
  });
});

describe('list request gate', () => {
  it('rejects a stale response after a newer query was already issued', () => {
    const gate = new ListRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.accepts(first)).toBe(false);
    expect(gate.accepts(second)).toBe(true);
  });
});

describe('inbox filter state and URL round trip', () => {
  it('accepts known filter keys, clamps bad values, and reports what was dropped', () => {
    const result = inboxListStateFromURL({
      view: ['waiting_staff'], q: ' ทะเบียน ', category: ['REG_TOREG'], department: ['not-a-uuid'],
      status: ['WAITING_STAFF'], priority: ['HIGH'], assignee: [], sensitivity: ['RESTRICTED'],
      from: '2026-10-01', to: '2026-10-31', page: ['3'], pageSize: ['50'], hacker: ['DROP TABLE'],
    });
    expect(result.state.view).toBe('waiting_staff');
    expect(result.state.q).toBe('ทะเบียน');
    expect(result.state.category).toBe('REG_TOREG');
    expect(result.state.status).toBe('WAITING_STAFF');
    expect(result.state.from).toBe('2026-10-01');
    expect(result.state.page).toBe(3);
    expect(result.state.department).toBeUndefined();
    expect(result.dropped).toEqual(expect.arrayContaining(['department', 'hacker']));
  });

  it('builds no private or invented query payload and round-trips through the URL builder', () => {
    const state = inboxListStateFromURL({ view: 'unread', q: 'ทะเบียน', page: '2' }).state;
    const params = buildInboxListParams(state);
    expect(params.get('view')).toBe('unread');
    expect(params.get('q')).toBe('ทะเบียน');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
    expect(buildInboxListParams(inboxListStateFromURL({ view: 'all' }).state).get('page')).toBe('1');
    expect(inboxListUrl(state)).toBe('/inbox?view=unread&q=%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%99&page=2');
  });
});

describe('server pagination outcomes are distinct', () => {
  it('separates total, unknown, empty and out-of-range pages', () => {
    const pagination = { page: 3, pageSize: 50, total: 101, totalPages: 3, hasNext: false, hasPrevious: true };
    expect(paginationLabel(pagination, 3).kind).toBe('total');
    expect(paginationLabel(undefined, 3).kind).toBe('unknown');
    expect(paginationLabel(undefined, 3).text).not.toBe(paginationLabel({ ...pagination, total: 0 }, 1).text);
    expect(paginationLabel({ ...pagination, total: 0, page: 1 }, 1).kind).toBe('empty');
    expect(paginationLabel({ ...pagination, total: 0, page: 1 }, 1).text).toContain('ไม่มีบทสนทนาตรงตัวกรอง');
    expect(paginationLabel({ ...pagination, total: 0, page: 2 }, 2).kind).toBe('out-of-range');
  });
});

describe('realtime status mapping', () => {
  it('announces live only for SUBSCRIBED and falls back honestly on errors', () => {
    expect(realtimePhaseMapper('SUBSCRIBED')).toBe('live');
    expect(realtimePhaseMapper('CHANNEL_ERROR')).toBe('polling');
    expect(realtimePhaseMapper('TIMED_OUT')).toBe('polling');
    expect(realtimePhaseMapper('CLOSED')).toBe('polling');
    expect(realtimePhaseMapper('SYNCING')).toBe('connecting');
  });
});
