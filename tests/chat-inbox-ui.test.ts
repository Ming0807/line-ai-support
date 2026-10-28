import { describe, expect, it, vi } from 'vitest';
import {
  actorMountKey,
  assistantDraftDisposition,
  deliveryEvidence,
  draftKey,
  installVisibleRefresh,
  readDraft,
  requestForText,
  restoredScrollTop,
  retryAfterStatus,
  shouldAcknowledgeRead,
  shouldClearSelectedThread,
  ThreadRequestFence,
  writeDraft,
} from '@/app/(dashboard)/inbox/controller';

describe('CHAT06 Inbox controller', () => {
  it('keeps reply and note drafts isolated by actor and ticket through selection changes/refreshes', () => {
    let drafts: Record<string, string> = {};
    drafts = writeDraft(drafts, 'staff-a', 'ticket-1', 'reply', 'ตอบเรื่องเดิม');
    drafts = writeDraft(drafts, 'staff-a', 'ticket-1', 'note', 'บันทึกส่วนตัว');
    drafts = writeDraft(drafts, 'staff-a', 'ticket-2', 'reply', 'หัวข้อใหม่');
    drafts = writeDraft(drafts, 'staff-b', 'ticket-1', 'reply', 'อีกผู้ใช้หนึ่ง');

    // Reading after a refetch or switching back to a ticket uses the same scoped slot.
    expect(readDraft(drafts, 'staff-a', 'ticket-1', 'reply')).toBe('ตอบเรื่องเดิม');
    expect(readDraft(drafts, 'staff-a', 'ticket-1', 'note')).toBe('บันทึกส่วนตัว');
    expect(readDraft(drafts, 'staff-a', 'ticket-2', 'reply')).toBe('หัวข้อใหม่');
    expect(readDraft(drafts, 'staff-b', 'ticket-1', 'reply')).toBe('อีกผู้ใช้หนึ่ง');
    expect(readDraft(drafts, 'staff-b', 'ticket-1', 'note')).toBe('');
  });

  it('changes the mounted Inbox identity when a different staff actor signs in', () => {
    expect(actorMountKey('staff-a')).not.toBe(actorMountKey('staff-b'));
    expect(draftKey('staff-a', 'ticket-1', 'reply')).not.toBe(draftKey('staff-b', 'ticket-1', 'reply'));
  });

  it('rejects stale ticket responses and older same-ticket refetches', () => {
    const fence = new ThreadRequestFence('staff-a', 'ticket-1');
    const firstRefresh = fence.begin('staff-a', 'ticket-1');
    const laterRefresh = fence.begin('staff-a', 'ticket-1');
    expect(fence.accepts(firstRefresh)).toBe(false);
    expect(fence.accepts(laterRefresh)).toBe(true);

    const switchedTicketRequest = fence.begin('staff-a', 'ticket-1');
    fence.select('staff-a', 'ticket-2');
    expect(fence.accepts(switchedTicketRequest)).toBe(false);

    const formerActorRequest = fence.begin('staff-a', 'ticket-2');
    fence.select('staff-b', 'ticket-2');
    expect(fence.accepts(formerActorRequest)).toBe(false);
  });

  it('clears only the still-selected thread after 401/403/404 authorization responses', () => {
    for (const status of [401, 403, 404]) {
      expect(shouldClearSelectedThread({ status, requestIsCurrent: true, requestTicketId: 'ticket-1', selectedTicketId: 'ticket-1' })).toBe(true);
      expect(shouldClearSelectedThread({ status, requestIsCurrent: false, requestTicketId: 'ticket-1', selectedTicketId: 'ticket-1' })).toBe(false);
      expect(shouldClearSelectedThread({ status, requestIsCurrent: true, requestTicketId: 'ticket-1', selectedTicketId: 'ticket-2' })).toBe(false);
    }
    for (const status of [409, 500]) {
      expect(shouldClearSelectedThread({ status, requestIsCurrent: true, requestTicketId: 'ticket-1', selectedTicketId: 'ticket-1' })).toBe(false);
    }
  });

  it('does not describe a STAFF or AI message with no matching outbox evidence as delivered', () => {
    expect(deliveryEvidence('STAFF', null)).toEqual({ kind: 'unproven', text: 'ยังไม่มีหลักฐานการส่ง' });
    expect(deliveryEvidence('AI', null)).toEqual({ kind: 'unproven', text: 'ยังไม่มีหลักฐานการส่ง' });
    expect(deliveryEvidence('USER', null)).toBeNull();
    expect(deliveryEvidence('STAFF', 'UNKNOWN')).toEqual({ kind: 'UNKNOWN', text: 'กำลังตรวจสอบผล' });
    expect(deliveryEvidence('STAFF', 'SENT')).toEqual({ kind: 'SENT', text: 'ส่งแล้ว' });
  });

  it('requires matching actor, ticket, revision, permission and replacement confirmation before applying an assistant draft', () => {
    const source = {
      currentActorId: 'staff-a', sourceActorId: 'staff-a',
      currentTicketId: 'ticket-1', sourceTicketId: 'ticket-1',
      currentRevision: 7, sourceRevision: 7, canReply: true, busy: false,
      draftText: 'ร่างคำตอบ', currentReply: '',
    };
    expect(assistantDraftDisposition(source)).toBe('apply');
    expect(assistantDraftDisposition({ ...source, currentReply: 'ฉบับที่พิมพ์ไว้' })).toBe('confirm');
    expect(assistantDraftDisposition({ ...source, currentActorId: 'staff-b' })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, currentTicketId: 'ticket-2' })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, currentRevision: 8 })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, canReply: false })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, busy: true })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, draftText: ' '.repeat(2) })).toBe('reject');
    expect(assistantDraftDisposition({ ...source, draftText: 'x'.repeat(5001) })).toBe('reject');
  });

  it('only acknowledges a latest message when its rendered tail is visible in a visible tab', () => {
    const base = { latestSequence: 12, readThroughSequence: 9, rendered: true, sentinelVisible: true };
    expect(shouldAcknowledgeRead({ ...base, documentVisible: true })).toBe(true);
    expect(shouldAcknowledgeRead({ ...base, documentVisible: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...base, documentVisible: true, rendered: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...base, documentVisible: true, sentinelVisible: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...base, documentVisible: true, latestSequence: 9 })).toBe(false);
  });

  it('runs five-second recovery only while visible and removes its timer/listener on cleanup', () => {
    let visibility: DocumentVisibilityState = 'hidden';
    const callbacks: { visibility: (() => void) | null; interval: (() => void) | null } = { visibility: null, interval: null };
    const removed = vi.fn();
    const cleared = vi.fn();
    const refresh = vi.fn();
    const documentLike = {
      get visibilityState() { return visibility; },
      addEventListener: vi.fn((_type: 'visibilitychange', listener: () => void) => { callbacks.visibility = listener; }),
      removeEventListener: vi.fn((_type: 'visibilitychange', listener: () => void) => { if (callbacks.visibility === listener) callbacks.visibility = null; removed(); }),
    };
    const timers = {
      setInterval: vi.fn((callback: () => void, milliseconds: number) => { expect(milliseconds).toBe(5000); callbacks.interval = callback; return 1; }),
      clearInterval: vi.fn((handle: number) => { expect(handle).toBe(1); cleared(); }),
    };

    const cleanup = installVisibleRefresh(documentLike, timers, refresh);
    callbacks.interval?.();
    expect(refresh).not.toHaveBeenCalled();
    visibility = 'visible';
    callbacks.visibility?.();
    callbacks.interval?.();
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanup();
    expect(cleared).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledOnce();
    expect(callbacks.visibility).toBeNull();
  });

  it('reuses the exact request ID/body after an unknown outcome and retains draft text after 409', () => {
    const createRequestId = vi.fn(() => 'request-1');
    const first = requestForText(undefined, 'ข้อความเดิม', { revision: 4, text: 'ข้อความเดิม' }, createRequestId);
    expect(first.body.requestId).toBe('request-1');
    expect(retryAfterStatus('network')).toBe('keep');
    expect(retryAfterStatus(503)).toBe('keep');

    const retry = requestForText(first, 'ข้อความเดิม', { revision: 5, text: 'ข้อความเดิม' }, createRequestId);
    expect(retry).toBe(first);
    expect(retry.body).toEqual({ revision: 4, text: 'ข้อความเดิม', requestId: 'request-1' });
    expect(createRequestId).toHaveBeenCalledOnce();

    let drafts = writeDraft({}, 'staff-a', 'ticket-1', 'reply', 'ข้อความเดิม');
    expect(retryAfterStatus(409)).toBe('clear');
    // The UI clears the definitive retry token on 409, while draft state remains untouched.
    expect(readDraft(drafts, 'staff-a', 'ticket-1', 'reply')).toBe('ข้อความเดิม');
    drafts = writeDraft(drafts, 'staff-a', 'ticket-1', 'reply', 'แก้ไขข้อความ');
    const edited = requestForText(first, 'แก้ไขข้อความ', { revision: 5, text: 'แก้ไขข้อความ' }, () => 'request-2');
    expect(edited.body.requestId).toBe('request-2');
  });

  it('preserves scroll anchor on same-thread refresh and stays at bottom only when already there', () => {
    expect(restoredScrollTop({ scrollTop: 300, scrollHeight: 1000, stickToBottom: false }, 1250)).toBe(550);
    expect(restoredScrollTop({ scrollTop: 900, scrollHeight: 1000, stickToBottom: true }, 1250)).toBe(1250);
  });
});
