import { describe, expect, it } from 'vitest';
import {
  buildInboxListParams,
  inboxListStateFromURL,
  isTicketId,
  paginationLabel,
  parseChatNote,
  parseReplyResult,
  ticketSelectionFromURL,
  ticketStatusValues,
} from '@/app/(dashboard)/tickets/[id]/chat-thread-state';
import {
  clearActionAttempt,
  clearTicketActionAttempts,
  findActionAttempt,
  parseActionResult,
  registerActionAttempt,
} from '@/app/(dashboard)/tickets/[id]/ticket-action-workspace';

const ticketIdA = '11111111-1111-4111-8111-111111111111';
const ticketIdB = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

describe('strict lifecycle success DTO (D3)', () => {
  const valid = { id: ticketIdA, status: 'STAFF_HANDLING', revision: 3 };

  it('commits only on the exact success DTO', () => {
    expect(parseReplyResult(valid, ticketIdA)).toEqual(valid);
    expect(parseActionResult(valid, ticketIdA)).toEqual(parseReplyResult(valid, ticketIdA));
  });

  it('keeps the outcome unknown for empty, malformed, wrong-ticket or non-status payloads', () => {
    expect(parseReplyResult({}, ticketIdA)).toBeNull();
    expect(parseReplyResult({ ...valid, id: ticketIdB }, ticketIdA)).toBeNull();
    expect(parseReplyResult({ ...valid, status: 'SOMETHING_ELSE' }, ticketIdA)).toBeNull();
    expect(parseReplyResult({ ...valid, status: 42 }, ticketIdA)).toBeNull();
    expect(parseReplyResult({ ...valid, revision: 1.5 }, ticketIdA)).toBeNull();
    expect(parseReplyResult({ ...valid, revision: -1 }, ticketIdA)).toBeNull();
    expect(parseReplyResult(null, ticketIdA)).toBeNull();
    expect(parseReplyResult('ok', ticketIdA)).toBeNull();
    expect(parseReplyResult([valid], ticketIdA)).toBeNull();
    expect(parseActionResult({ error: 'X_SERIALIZATION_BROKEN' }, ticketIdA)).toBeNull();
  });

  it('accepts every ticket status enum value and rejects anything outside it', () => {
    for (const status of ticketStatusValues) {
      expect(parseReplyResult({ ...valid, status }, ticketIdA)?.status).toBe(status);
    }
  });
});

describe('strict note DTO (D9)', () => {
  it('accepts a synthetic non-uuid id with a real creation timestamp', () => {
    const note = { id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่', createdAt: '2026-10-28T01:12:00.000Z' };
    expect(parseChatNote(note)).toEqual(note);
  });

  it('keeps a note unknown when the id or timestamp is missing/broken', () => {
    expect(parseChatNote({ id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่' })).toBeNull();
    expect(parseChatNote({ id: '', text: 'บันทึก', staffName: 'เจ้าหน้าที่', createdAt: '2026-10-28T01:12:00.000Z' })).toBeNull();
    expect(parseChatNote({ id: 'note-9', text: 'บันทึก', staffName: 'เจ้าหน้าที่', createdAt: 'not-a-date' })).toBeNull();
    expect(parseChatNote(null)).toBeNull();
    expect(parseChatNote('note')).toBeNull();
  });
});

describe('S07 page out-of-range is distinct from an ordinary total', () => {
  const overflow = { page: 10000, pageSize: 25, total: 42, totalPages: 2, hasNext: false, hasPrevious: true };

  it('reports out-of-range with recovery when a nonzero total answers a page past totalPages', () => {
    const outcome = paginationLabel(overflow, 10000);
    expect(outcome.kind).toBe('out-of-range');
    expect(outcome.text).toContain('กลับไปหน้าแรก');
  });

  it('keeps the ordinary total wording inside the covered range', () => {
    expect(paginationLabel(overflow, 2).kind).toBe('total');
    expect(paginationLabel(overflow, 2).text).toBe('42 รายการ');
  });
});

describe('S08 duplicate query keys and the selection deep-link', () => {
  it('collapses identical duplicate values to one accepted value without a drop note', () => {
    const result = inboxListStateFromURL({ view: ['mine', 'mine'], page: ['2', '2'] });
    expect(result.state.view).toBe('mine');
    expect(result.state.page).toBe(2);
    expect(result.dropped).toEqual([]);
  });

  it('drops conflicting duplicate keys instead of silently keeping the first value', () => {
    const result = inboxListStateFromURL({ view: ['mine', 'all'], page: ['2', '5'] });
    expect(result.dropped).toEqual(expect.arrayContaining(['view', 'page']));
    expect(result.state.view).toBe('all');
    expect(result.state.page).toBe(1);
  });

  it('lets an accepted duplicate build exactly one backend query key for that parameter', () => {
    const params = buildInboxListParams(inboxListStateFromURL({ view: ['mine', 'mine'] }).state);
    expect(params.getAll('view')).toEqual(['mine']);
  });

  it('validates the ticket deep-link id strictly before any fetch may use it', () => {
    expect(isTicketId(ticketIdA)).toBe(true);
    expect(isTicketId('abc')).toBe(false);
    expect(isTicketId('')).toBe(false);
    expect(ticketSelectionFromURL({})).toEqual({ id: null, malformed: false });
    expect(ticketSelectionFromURL({ ticket: ticketIdA })).toEqual({ id: ticketIdA, malformed: false });
    expect(ticketSelectionFromURL({ ticket: 'abc' })).toEqual({ id: null, malformed: true });
    expect(ticketSelectionFromURL({ ticket: ['not-a-uuid', 'worse'] })).toEqual({ id: null, malformed: true });
  });

  it('keeps the selection key out of the list module (the inbox mount owns its drop note)', () => {
    expect(inboxListStateFromURL({ ticket: 'abc' }).dropped).toEqual([]);
  });
});

describe('write-once lifecycle attempt workspace (D1)', () => {
  it('returns the original attempt unchanged on a second registration', () => {
    const first = registerActionAttempt({
      actorId: 'staff-x', ticketId: ticketIdA, action: 'ACCEPT',
      endpoint: `/api/tickets/${ticketIdA}/accept`, revision: 3,
      body: { revision: 3, requestId },
    });
    const second = registerActionAttempt({
      actorId: 'staff-x', ticketId: ticketIdA, action: 'ACCEPT',
      endpoint: `/api/tickets/${ticketIdA}/accept`, revision: 99,
      body: { revision: 99, requestId: requestId },
    });
    expect(second).toBe(first);
    expect(findActionAttempt('staff-x', ticketIdA, 'ACCEPT')?.body.revision).toBe(3);
    expect(clearActionAttempt('staff-x', ticketIdA, 'ACCEPT')).toBeUndefined();
    expect(findActionAttempt('staff-x', ticketIdA, 'ACCEPT')).toBeUndefined();
  });

  it('separates attempts per ticket and clears a whole ticket on access loss', () => {
    registerActionAttempt({
      actorId: 'staff-x', ticketId: ticketIdA, action: 'RESOLVE',
      endpoint: `/api/tickets/${ticketIdA}/resolve`, revision: 3,
      body: { revision: 3, requestId },
    });
    registerActionAttempt({
      actorId: 'staff-x', ticketId: ticketIdB, action: 'RESOLVE',
      endpoint: `/api/tickets/${ticketIdB}/resolve`, revision: 5,
      body: { revision: 5, requestId },
    });
    clearTicketActionAttempts('staff-x', ticketIdA);
    expect(findActionAttempt('staff-x', ticketIdA, 'RESOLVE')).toBeUndefined();
    expect(findActionAttempt('staff-x', ticketIdB, 'RESOLVE')).toBeDefined();
    clearTicketActionAttempts('staff-x', ticketIdB);
    expect(findActionAttempt('staff-x', ticketIdB, 'RESOLVE')).toBeUndefined();
  });
});
