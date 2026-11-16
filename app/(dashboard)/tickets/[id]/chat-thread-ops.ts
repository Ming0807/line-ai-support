'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { InboxThreadResult, ChatNote } from '@/types/inbox';
import { createBrowserClient } from '@/lib/supabase/browser';
import {
  assistantDraftDisposition,
  draftKey,
  installVisibleRefresh,
  restoredScrollTop,
  shouldAcknowledgeRead,
  shouldClearSelectedThread,
  ThreadRequestFence,
  writeCompletionValid,
  type DraftKind,
} from '../../inbox/controller';
import {
  acknowledgeCursor,
  catchUpAfterFetch,
  composeAfterSuccess,
  contiguousReadTarget,
  firstCatchUpBeforeSpans,
  mergeThreadWindow,
  parseChatNote,
  parseReplyResult,
  pendingWriteDecision,
  realtimePhaseMapper,
  writeAttemptOutcome,
  type IncomingWindow,
  type PendingWrite,
  type ThreadMergeResult,
  type ThreadMergeSource,
  type ThreadSpan,
} from './chat-thread-state';
import {
  OUTBOUND_MAX_BYTES,
  buildOutboundConfirmBody,
  buildOutboundUploadHeaders,
  canShowOutboundAttachControl,
  computeSha256Hex,
  extractSafeErrorCode,
  mapOutboundConfirmError,
  mapOutboundRevokeError,
  mapOutboundUploadError,
  parseOutboundConfirmResult,
  parseOutboundRevokeResult,
  parseOutboundUploadResult,
  readOutboundAttachment,
  readOutboundFilesEnabled,
  validateOutboundFileMeta,
  type OutboundAttachmentMimeType,
  type OutboundAttachmentView,
} from './chat-outbound-state';
import { clearActorActionAttempts, clearTicketActionAttempts } from './ticket-action-workspace';

export type ChatThreadNotice = { text: string; kind: 'success' | 'error' };
export type ChatThreadAssist = { available: boolean; revision: number; onDraft: (text: string) => void };
export type OutboundBusyKind = 'upload' | 'confirm' | 'revoke';
export type OutboundUploadState = {
  requestId: string;
  fileName: string;
  mimeType: OutboundAttachmentMimeType;
  size: number;
  sha256: string;
  revision: number;
  phase: 'hashing' | 'uploading' | 'retryable-error' | 'needs-reselect-error';
  errorText: string | null;
};
export type OutboundReadyDraft = {
  attachmentId: string;
  name: string;
  mimeType: OutboundAttachmentMimeType;
  size: number;
  uploadedRevision: number;
};
export type OutboundConfirmAttempt = {
  attachmentId: string;
  requestId: string;
  revision: number;
  ticketNo: string;
  phase: 'submitting' | 'uncertain';
  errorText: string | null;
};
export type OutboundRevokeState = {
  attachmentId: string;
  attachmentName: string;
  phase: 'confirming' | 'submitting' | 'error';
  errorText: string | null;
};
export type OutboundRoomState = {
  upload: OutboundUploadState | null;
  readyDraft: OutboundReadyDraft | null;
  confirmDialogOpen: boolean;
  confirmAttempt: OutboundConfirmAttempt | null;
  revokeState: OutboundRevokeState | null;
};
export type ChatThreadOutboundOps = {
  busy: OutboundBusyKind | null;
  upload: OutboundUploadState | null;
  readyDraft: OutboundReadyDraft | null;
  confirmDialogOpen: boolean;
  confirmAttempt: OutboundConfirmAttempt | null;
  revokeState: OutboundRevokeState | null;
  onSelectFile: (file: File) => void;
  onRetryUpload: () => void;
  onDismissUploadError: () => void;
  onRemoveDraft: () => void;
  onOpenConfirmDialog: () => void;
  onCloseConfirmDialog: () => void;
  onConfirmSend: () => void;
  onOpenRevokeDialog: (attachment: OutboundAttachmentView) => void;
  onCloseRevokeDialog: () => void;
  onConfirmRevoke: () => void;
};
export type DraftStore = {
  read(actorId: string, ticketId: string, kind: DraftKind): string;
  write(actorId: string, ticketId: string, kind: DraftKind, text: string): void;
  /** OP06-02: whole-actor draft erasure (list denial / logout) — optional so fixture stores stay simple. */
  eraseActorDrafts?(actorId: string): void;
};

/** Memory-only draft store for mounts without a parent-side store (e.g. the ticket detail route). */
export function createThreadDraftStore(): DraftStore {
  const drafts = new Map<string, string>();
  return {
    read: (actorId, ticketId, kind) => drafts.get(draftKey(actorId, ticketId, kind)) ?? '',
    write: (actorId, ticketId, kind, text) => {
      const key = draftKey(actorId, ticketId, kind);
      if (text) drafts.set(key, text);
      else drafts.delete(key);
    },
    eraseActorDrafts: actorId => {
      const prefix = `${actorId}:`;
      for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key);
    },
  };
}

type ThreadEventDetail = { ticketId: string; accessLostStatus?: number };
export const CHAT_THREAD_REFRESH_EVENT = 'yru:chat-thread-refresh';

export function notifyThreadListeners(ticketId: string, detail: Omit<ThreadEventDetail, 'ticketId'> = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ThreadEventDetail>(CHAT_THREAD_REFRESH_EVENT, { detail: { ticketId, ...detail } }));
}

export type ThreadLivePhase = 'connecting' | 'live' | 'polling';

/**
 * D8 shared lifetime supervisor for BOTH routes (inbox and detail): one private
 * `staff:<actorId>:inbox` subscription whose `invalidate` marker triggers a plain
 * refetch (no payload travels), visible/online interval refresh through the real
 * `installVisibleRefresh`, and a single cleanup that removes exactly its own
 * channel. Listener panels never poll while hidden or offline; the marker path
 * carries no PII.
 */
export function useStaffInvalidateSupervisor({ actorId, onInvalidate, intervalMs = 5000 }: {
  actorId: string;
  onInvalidate: () => void;
  intervalMs?: number;
}): ThreadLivePhase {
  const [phase, setPhase] = useState<ThreadLivePhase>('connecting');
  const listenerRef = useRef(onInvalidate);
  useLayoutEffect(() => { listenerRef.current = onInvalidate; });
  useEffect(() => {
    let alive = true;
    let channel: RealtimeChannel | null = null;
    let client: ReturnType<typeof createBrowserClient> | null = null;
    let stopVisibleRefresh: () => void = () => {};
    const trigger = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      listenerRef.current();
    };
    try {
      client = createBrowserClient();
      channel = client.channel(`staff:${actorId}:inbox`, { config: { private: true } });
      channel.on('broadcast', { event: 'invalidate' }, () => { trigger(); });
      channel.subscribe(status => {
        if (!alive) return;
        setPhase(realtimePhaseMapper(status));
        if (status === 'SUBSCRIBED') trigger();
      });
    } catch {
      queueMicrotask(() => { if (alive) setPhase('polling'); });
    }
    stopVisibleRefresh = installVisibleRefresh(document, window, trigger, intervalMs);
    return () => {
      alive = false;
      stopVisibleRefresh();
      if (client && channel) void client.removeChannel(channel);
    };
  }, [actorId, intervalMs]);
  return phase;
}

type OpsInput = {
  actorId: string;
  ticketId: string | null;
  initialThread?: InboxThreadResult | null;
  draftsStore: DraftStore;
  /** The list owner trims its rows when the server denies access to this ticket (401/404 semantics). */
  onThreadAccessLost?: (status: number, ticketId: string) => void;
};

type ThreadRecord = { epoch: number; result: InboxThreadResult; spans: ThreadSpan[]; empties: ThreadSpan[] };

const THREAD_FETCH_LIMIT = 50;
const CATCH_UP_MAX_ATTEMPTS = 2;
const COMPOSER_LIMITS: Record<DraftKind, number> = { reply: 5000, note: 4000 };

function threadEndpoint(kind: DraftKind, ticketId: string): string {
  return kind === 'reply'
    ? `/api/tickets/${encodeURIComponent(ticketId)}/reply`
    : `/api/chat/tickets/${encodeURIComponent(ticketId)}/notes`;
}

function seedWindow(result: InboxThreadResult): ThreadMergeResult {
  return mergeThreadWindow(
    { messages: [], hasMore: false, nextBefore: null },
    { messages: result.messages, hasMore: result.hasMore, nextBefore: result.nextBefore },
    'refresh',
  );
}

export function useChatThreadOps({ actorId, ticketId, initialThread = null, draftsStore, onThreadAccessLost }: OpsInput) {
  const activeRef = useRef<string | null>(ticketId);
  const fenceRef = useRef<ThreadRequestFence | null>(null);
  if (fenceRef.current === null) fenceRef.current = new ThreadRequestFence(actorId, ticketId);
  const recordsRef = useRef(new Map<string, ThreadRecord>());
  const seededTicketsRef = useRef(new Set<string>());
  const attemptsRef = useRef<Record<string, PendingWrite>>({});
  const readLocalRef = useRef(new Map<string, number>());
  const paneRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const pendingScrollRef = useRef<{ ticketId: string; scrollTop: number; scrollHeight: number; stickToBottom: boolean } | null>(null);
  /**
   * CX1 authority epoch: one generation counter for the whole mounted actor.
   * A denial-scoped reset (list 401/403/404 or teardown) bumps the epoch and
   * invalidates EVERY retained record, draft, attempt, cursor and outstanding
   * request token; re-selecting a ticket therefore always requires a fresh
   * GET before any private content can appear again.
   */
  const authorityEpochRef = useRef(0);

  const [thread, setThread] = useState<InboxThreadResult | null>(initialThread);
  const [, setDraftTicks] = useState(0);
  const bumpDraftTicks = useCallback(() => setDraftTicks(value => value + 1), []);
  const [loading, setLoading] = useState(false);
  const [error, setThreadError] = useState('');
  const [hasStaleResponse, setHasStaleResponse] = useState(false);
  // D5: history loading is PER ROOM, never a flag shared across tickets — a
  // late/pending history load of room A may not disable or spin room B. The set
  // is honest state (no ref read during render).
  const [historyBusy, setHistoryBusy] = useState<ReadonlySet<string>>(() => new Set());
  const beginHistoryBusy = useCallback((id: string) => {
    setHistoryBusy(current => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);
  const endHistoryBusy = useCallback((id: string) => {
    setHistoryBusy(current => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);
  const [catchUpBefore, setCatchUpBefore] = useState<number | null>(null);
  // OP06-05 CX3: write state is PER ROOM. A room's pending write, its busy
  // kind, its completion lease and its notice live under that room's own key;
  // nothing a room does may disable, notice-flip or erase another room's UI.
  const busyMapRef = useRef<Record<string, DraftKind>>({});
  const [busyMap, setBusyMap] = useState<Record<string, DraftKind>>({});
  const busyLeaseRef = useRef<Record<string, symbol>>({});
  const noticeMapRef = useRef<Record<string, ChatThreadNotice>>({});
  const [noticeMap, setNoticeMap] = useState<Record<string, ChatThreadNotice>>({});
  const [attempts, setAttempts] = useState<Record<string, PendingWrite>>({});

  // OC-08 per-(actor, ticket) outbound attachment store + active-room-only File handle ref.
  const outboundRoomsRef = useRef<Record<string, OutboundRoomState>>({});
  const [outboundRooms, setOutboundRooms] = useState<Record<string, OutboundRoomState>>({});
  const outboundBusyRef = useRef<Record<string, OutboundBusyKind>>({});
  const [outboundBusyMap, setOutboundBusyMap] = useState<Record<string, OutboundBusyKind>>({});
  const outboundBusyLeaseRef = useRef<Record<string, symbol>>({});
  const retryFileRef = useRef<{ ticketId: string; requestId: string; file: File } | null>(null);

  const outboundKey = useCallback((ownerId: string, roomId: string) => `${ownerId}:${roomId}`, []);

  const updateOutboundRoom = useCallback((
    ownerId: string,
    roomId: string,
    updater: (current: OutboundRoomState) => OutboundRoomState,
  ) => {
    const key = outboundKey(ownerId, roomId);
    const current = outboundRoomsRef.current[key] ?? {
      upload: null,
      readyDraft: null,
      confirmDialogOpen: false,
      confirmAttempt: null,
      revokeState: null,
    };
    const nextState = updater(current);
    const next = { ...outboundRoomsRef.current };
    const isEmpty = !nextState.upload
      && !nextState.readyDraft
      && !nextState.confirmDialogOpen
      && !nextState.confirmAttempt
      && !nextState.revokeState;
    if (isEmpty) delete next[key];
    else next[key] = nextState;
    outboundRoomsRef.current = next;
    setOutboundRooms(next);
  }, [outboundKey]);

  const setRoomOutboundBusy = useCallback((roomId: string, kind: OutboundBusyKind | null) => {
    const next = { ...outboundBusyRef.current };
    if (kind) next[roomId] = kind;
    else if (next[roomId]) delete next[roomId];
    else return;
    outboundBusyRef.current = next;
    setOutboundBusyMap(next);
  }, []);

  const setRoomBusy = useCallback((roomId: string, kind: DraftKind | null) => {
    const next = { ...busyMapRef.current };
    if (kind) next[roomId] = kind;
    else if (next[roomId]) delete next[roomId];
    else return;
    busyMapRef.current = next;
    setBusyMap(next);
  }, []);

  const setRoomNotice = useCallback((roomId: string, entry: ChatThreadNotice | null) => {
    const next = { ...noticeMapRef.current };
    if (entry) next[roomId] = entry;
    else if (next[roomId]) delete next[roomId];
    else return;
    noticeMapRef.current = next;
    setNoticeMap(next);
  }, []);

  const revealRecord = useCallback((id: string, record: ThreadRecord) => {
    if (activeRef.current !== id) return;
    // CX1: a record from a dead authority generation may never surface — even a
    // retained "current" object captured before a reset stays invisible.
    if (record.epoch !== authorityEpochRef.current) return;
    setThread(record.result);
    setCatchUpBefore(firstCatchUpBeforeSpans(record.spans, record.empties));
  }, []);

  const applyWindow = useCallback((
    id: string,
    incoming: InboxThreadResult,
    source: ThreadMergeSource,
    coverage?: { spans: ThreadSpan[]; empties: ThreadSpan[] },
    mergeOptions?: { beforeSequence?: number },
  ) => {
    const existing = recordsRef.current.get(id);
    const merged = existing
      ? mergeThreadWindow(
        { messages: existing.result.messages, hasMore: existing.result.hasMore, nextBefore: existing.result.nextBefore, spans: existing.spans, empties: existing.empties },
        { messages: incoming.messages, hasMore: incoming.hasMore, nextBefore: incoming.nextBefore },
        source,
        mergeOptions,
      )
      : seedWindow(incoming);
    // D4/D5 authority rule: a history/catch-up window only extends message
    // coverage — it must never replace the detail/permissions/revision snapshot
    // the owner already holds. A refresh carries the newer authority and wins by
    // revision epoch: a stale refresh response keeps the newer known snapshot.
    const keepDetail = existing !== undefined && (
      source !== 'refresh'
      || incoming.detail.ticket.revision < existing.result.detail.ticket.revision
    );
    const authority = keepDetail && existing ? existing.result : incoming;
    const nextCoverage = coverage ?? { spans: merged.spans, empties: merged.empties };
    const nextRecord: ThreadRecord = {
      // CX1: the record belongs to the CURRENT authority generation; a later
      // whole-actor reset bumps the epoch and this snapshot stops revealing.
      epoch: authorityEpochRef.current,
      result: {
        ...authority,
        messages: merged.messages,
        hasMore: merged.hasMore,
        nextBefore: merged.nextBefore,
        latestSequence: Math.max(authority.latestSequence, incoming.latestSequence, existing?.result.latestSequence ?? 0),
        readThroughSequence: Math.max(authority.readThroughSequence, readLocalRef.current.get(id) ?? 0, existing?.result.readThroughSequence ?? 0),
      },
      spans: nextCoverage.spans,
      empties: nextCoverage.empties,
    };
    recordsRef.current.set(id, nextRecord);
    if (source === 'refresh') {
      const roomKey = outboundKey(actorId, id);
      const roomOutbound = outboundRoomsRef.current[roomKey];
      const existingDraft = roomOutbound?.readyDraft;
      if (existingDraft && merged.messages.some(message => readOutboundAttachment(message)?.id === existingDraft.attachmentId)) {
        updateOutboundRoom(actorId, id, current => ({
          ...current,
          readyDraft: null,
          confirmDialogOpen: false,
          confirmAttempt: null,
        }));
      }
    }
    revealRecord(id, nextRecord);
    return nextRecord;
  }, [actorId, outboundKey, revealRecord, updateOutboundRoom]);

  // Server-provided first paint (detail route) and later RSC refreshes merge
  // into the record by revision epoch (D4): a router.refresh() after a lifecycle
  // commit must update the authority (detail/permissions/revision) while still
  // never replacing newer messages with a late history window.
  // The ref starts as null so the FIRST effect run seeds the SSR thread. Later
  // runs re-apply only when an RSC refresh hands over a NEW object identity —
  // same identity (initial mount replays) never re-applies.
  const initialThreadRef = useRef<InboxThreadResult | null>(null);
  const initialTicketId = initialThread?.detail.ticket.id ?? null;
  useEffect(() => {
    if (!initialThread || !initialTicketId) return;
    if (initialThreadRef.current === initialThread) return;
    initialThreadRef.current = initialThread;
    queueMicrotask(() => {
      applyWindow(initialTicketId, initialThread, 'refresh');
      seededTicketsRef.current.add(initialTicketId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThread]);

  /**
   * S04: owner-side erasure — when the server denies access to a ticket (current
   * request, 401/403/404) the ops owner removes its OWN retained state without
   * relying on any parent callback: cached record, seeded flag, local read cursor,
   * pending composer writes, the typed drafts under the lost ticket, and every
   * retained lifecycle attempt of the ticket.
   */
  const eraseTicketOwner = useCallback((id: string) => {
    // CX1 scope note: the ticket-scoped erase relies on record DELETION + the
    // refresh listener re-GET; it must not bump the whole-actor epoch — other
    // rooms keep their authority and in-flight read-acks stay valid. Only
    // revokeActorAuthority (list denial / teardown) invalidates everything.
    recordsRef.current.delete(id);
    seededTicketsRef.current.delete(id);
    readLocalRef.current.delete(id);
    const remaining: Record<string, PendingWrite> = { ...attemptsRef.current };
    delete remaining[draftKey(actorId, id, 'reply')];
    delete remaining[draftKey(actorId, id, 'note')];
    attemptsRef.current = remaining;
    setAttempts(remaining);
    draftsStore.write(actorId, id, 'reply', '');
    draftsStore.write(actorId, id, 'note', '');
    clearTicketActionAttempts(actorId, id);
    // OP06-05: the erased room's stale notice and pending-write state die with
    // its records — a later re-selection may never show an outcome the erased
    // authority never confirmed.
    if (busyLeaseRef.current[id]) {
      const leases = { ...busyLeaseRef.current };
      delete leases[id];
      busyLeaseRef.current = leases;
    }
    if (busyMapRef.current[id]) setRoomBusy(id, null);
    if (noticeMapRef.current[id]) setRoomNotice(id, null);
    if (retryFileRef.current?.ticketId === id) retryFileRef.current = null;
    if (outboundBusyLeaseRef.current[id]) {
      const leases = { ...outboundBusyLeaseRef.current };
      delete leases[id];
      outboundBusyLeaseRef.current = leases;
    }
    if (outboundBusyRef.current[id]) setRoomOutboundBusy(id, null);
    const roomKey = outboundKey(actorId, id);
    if (outboundRoomsRef.current[roomKey]) {
      const next = { ...outboundRoomsRef.current };
      delete next[roomKey];
      outboundRoomsRef.current = next;
      setOutboundRooms(next);
    }
    if (activeRef.current === id) {
      queueMicrotask(() => {
        if (activeRef.current !== id) return;
        setThread(null);
        setCatchUpBefore(null);
        setLoading(false);
      });
    }
  }, [actorId, draftsStore, outboundKey, setRoomBusy, setRoomNotice, setRoomOutboundBusy]);

  /** CX1 whole-actor authority reset: every retained record, cursor, seed and
   * attempt of the mounted actor dies, drafts erase, the fence generation
   * moves forward, and composer state returns to a fresh mount's shape. */
  const revokeActorAuthority = useCallback(() => {
    authorityEpochRef.current += 1;
    fenceRef.current?.revokeAuthority();
    recordsRef.current.clear();
    seededTicketsRef.current.clear();
    readLocalRef.current.clear();
    attemptsRef.current = {};
    setAttempts({});
    draftsStore.eraseActorDrafts?.(actorId);
    clearActorActionAttempts(actorId);
    retryFileRef.current = null;
    outboundRoomsRef.current = {};
    setOutboundRooms({});
    outboundBusyRef.current = {};
    setOutboundBusyMap({});
    outboundBusyLeaseRef.current = {};
    setHistoryBusy(() => new Set());
    pendingScrollRef.current = null;
    busyMapRef.current = {};
    setBusyMap({});
    busyLeaseRef.current = {};
    noticeMapRef.current = {};
    setNoticeMap({});
    setThread(null);
    setCatchUpBefore(null);
    setLoading(false);
    setHasStaleResponse(false);
    setThreadError('');
  }, [actorId, draftsStore]);

  const handleThreadAccessDenial = useCallback((status: number, id: string) => {
    if (status === 401) {
      // P3-1: session loss (401) revokes the whole actor workspace immediately
      // so other cached rooms and drafts never wait on a pending list request.
      revokeActorAuthority();
      setThreadError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      onThreadAccessLost?.(401, id);
      return;
    }
    const wasActive = activeRef.current === id;
    eraseTicketOwner(id);
    if (wasActive && !onThreadAccessLost) {
      setThreadError('ไม่พบรายการนี้หรือสิทธิ์ของคุณเปลี่ยนไป');
    }
    onThreadAccessLost?.(status, id);
  }, [eraseTicketOwner, onThreadAccessLost, revokeActorAuthority]);

  const fetchThread = useCallback(async (id: string): Promise<InboxThreadResult | null> => {
    if (!id) return null;
    const fence = fenceRef.current!;
    const token = fence.begin(actorId, id);
    let response: Response;
    try {
      response = await fetch(`/api/chat/tickets/${encodeURIComponent(id)}?limit=${THREAD_FETCH_LIMIT}`, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      if (!fence.accepts(token) || activeRef.current !== id) return null;
      setThreadError('เชื่อมต่อเพื่อโหลดบทสนทนาไม่ได้ · ลองอีกครั้ง');
      return null;
    }
    if (!response.ok) {
      if (!fence.accepts(token) || activeRef.current !== id) return null;
      if (shouldClearSelectedThread({ status: response.status, requestIsCurrent: true, requestTicketId: id, selectedTicketId: id })) {
        handleThreadAccessDenial(response.status, id);
      }
      setThreadError(
        response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
          : response.status === 403 || response.status === 404 ? 'ไม่พบรายการนี้หรือสิทธิ์ของคุณเปลี่ยนไป'
            : response.status === 409 ? 'เคสมีการเปลี่ยนแปลง · ร่างข้อความยังคงอยู่ ตรวจข้อมูลล่าสุดก่อนส่งอีกครั้ง'
              : 'โหลดบทสนทนาไม่สำเร็จ',
      );
      setHasStaleResponse(response.status === 409);
      return null;
    }
    let data: InboxThreadResult;
    try {
      data = await response.json() as InboxThreadResult;
    } catch {
      if (!fence.accepts(token) || activeRef.current !== id) return null;
      setThreadError('ระบบตอบกลับไม่สมบูรณ์ · ลองโหลดใหม่อีกครั้ง');
      return null;
    }
    if (!fence.accepts(token) || activeRef.current !== id) return null;
    const pane = paneRef.current;
    if (pane) {
      const distanceFromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      pendingScrollRef.current = { ticketId: id, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, stickToBottom: distanceFromBottom < 48 };
    }
    applyWindow(id, data, 'refresh');
    setThreadError('');
    setHasStaleResponse(false);
    return data;
  }, [actorId, applyWindow, handleThreadAccessDenial]);

  // Selection change: reveal the cached thread instantly (bounded scroll anchor), then re-fetch unless this
  // mount already received server truth for the ticket (detail route initialThread).
  // React state updates run after the microtask boundary so a same-tick selection change cannot cascade.
  useEffect(() => {
    // Byte hygiene: never retain File handles across room switches.
    retryFileRef.current = null;
    const activeKey = ticketId ? outboundKey(actorId, ticketId) : '';
    let changed = false;
    const updatedRooms = { ...outboundRoomsRef.current };
    for (const [key, room] of Object.entries(outboundRoomsRef.current)) {
      if (room.upload?.phase === 'retryable-error' && key !== activeKey) {
        updatedRooms[key] = {
          ...room,
          upload: {
            ...room.upload,
            phase: 'needs-reselect-error',
            errorText: 'การอัปโหลดก่อนหน้ายังไม่สำเร็จ (ไม่เก็บไฟล์ค้างเมื่อเปลี่ยนห้อง) · กรุณาเลือกไฟล์ใหม่อีกครั้ง',
          },
        };
        changed = true;
      }
    }
    if (changed) {
      outboundRoomsRef.current = updatedRooms;
      queueMicrotask(() => { setOutboundRooms(updatedRooms); });
    }
    if (!ticketId) {
      activeRef.current = null;
      fenceRef.current?.select(actorId, null);
      queueMicrotask(() => {
        if (activeRef.current !== null) return;
        setThread(null);
        setCatchUpBefore(null);
        setLoading(false);
      });
      return;
    }
    const target = ticketId;
    activeRef.current = target;
    fenceRef.current?.select(actorId, target);
    pendingScrollRef.current = null;
    queueMicrotask(() => {
      if (activeRef.current !== target) return;
      const cachedNow = recordsRef.current.get(target) ?? null;
      // CX1 reveal gate: a retained record may show only when its authority
      // generation is still current; after a whole-actor reset the cache is
      // empty anyway — a stale-epoch leftover (belt and braces) is dropped and
      // always re-proven with a fresh GET.
      if (cachedNow && cachedNow.epoch === authorityEpochRef.current) {
        revealRecord(target, cachedNow);
        setLoading(false);
      } else {
        if (cachedNow) recordsRef.current.delete(target);
        setThread(null);
        setCatchUpBefore(null);
        setLoading(true);
      }
      if (seededTicketsRef.current.has(target)) return;
      void fetchThread(target).finally(() => {
        if (activeRef.current === target) setLoading(false);
      });
    });
  }, [ticketId, actorId, fetchThread, outboundKey, revealRecord]);

  const refresh = useCallback(() => {
    const id = activeRef.current;
    if (id) void fetchThread(id);
  }, [fetchThread]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ThreadEventDetail>).detail;
      const target = detail && typeof detail.ticketId === 'string' ? detail.ticketId : null;
      // OP06-02 RX lane: a lifecycle write that lost access erases the affected
      // room here (the whole record/drafts/attempts of that ticket) and lets
      // the owner callback close the MATCHING selection — no room-wide reset.
      if (target && detail && typeof detail.accessLostStatus === 'number' &&
        shouldClearSelectedThread({ status: detail.accessLostStatus, requestIsCurrent: true, requestTicketId: target, selectedTicketId: target })) {
        handleThreadAccessDenial(detail.accessLostStatus, target);
        return;
      }
      if (target && target === activeRef.current) void fetchThread(target);
    };
    window.addEventListener(CHAT_THREAD_REFRESH_EVENT, handler as EventListener);
    return () => window.removeEventListener(CHAT_THREAD_REFRESH_EVENT, handler as EventListener);
  }, [fetchThread, handleThreadAccessDenial]);

  // OP06-02 teardown: lifecycle attempts are module-global per actor — this
  // mount's authority dies with the hook, so the actor's attempt workspace is
  // erased exactly once on unmount (logout, room unmount, navigation).
  useEffect(() => () => {
    retryFileRef.current = null;
    clearActorActionAttempts(actorId);
  }, [actorId]);

  useLayoutEffect(() => {
    const anchor = pendingScrollRef.current;
    const pane = paneRef.current;
    if (!anchor || !pane || anchor.ticketId !== ticketId || activeRef.current !== ticketId) return;
    pane.scrollTop = restoredScrollTop(anchor, pane.scrollHeight);
    pendingScrollRef.current = null;
  }, [ticketId, thread]);

  useEffect(() => {
    const id = ticketId;
    const pane = paneRef.current;
    const sentinel = sentinelRef.current;
    if (!id || !pane || !sentinel) return;
    const record = recordsRef.current.get(id);
    if (!record || record.result.detail.ticket.id !== id) return;
    const sequence = record.result.messages.at(-1)?.sequence;
    if (sequence === undefined) return;
    const observer = new IntersectionObserver(entries => {
      const sentinelVisible = entries.some(entry => entry.isIntersecting);
      const local = readLocalRef.current.get(id) ?? 0;
      const known = Math.max(record.result.readThroughSequence, local);
      if (!shouldAcknowledgeRead({
        documentVisible: document.visibilityState === 'visible',
        rendered: sentinel.isConnected,
        sentinelVisible,
        latestSequence: sequence,
        readThroughSequence: known,
      })) return;
      // RX4 contiguity + P2 proven empties: advance across loaded server spans
      // (a single window is contiguous for this ticket), hasMore:false below the
      // earliest message, and proven empties, while holding across unloaded
      // history. Always verify throughSequence exists as a real message sequence.
      const target = contiguousReadTarget(known, record.spans, {
        empties: record.empties,
        hasMore: record.result.hasMore,
      });
      if (target <= known) return;
      if (!record.result.messages.some(message => message.sequence === target)) return;
      observer.disconnect();
      const requestEpoch = authorityEpochRef.current;
      void fetch(`/api/chat/tickets/${encodeURIComponent(id)}/read`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ throughSequence: target }),
      }).then(async response => {
        if (!response.ok) {
          // P3-2: read-ack failures from a superseded authority epoch must not
          // tear down or close a newly authorized room.
          if (authorityEpochRef.current !== requestEpoch) return;
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            handleThreadAccessDenial(response.status, id);
          }
          return;
        }
        const body = await response.json().catch(() => null) as { readThroughSequence?: number } | null;
        if (authorityEpochRef.current !== requestEpoch) return;
        // RX3: completion re-reads the CURRENT record — interleaved windows or
        // a local ack during the POST can never regress the cursor; the server
        // value is capped at the record's latestSequence and merged monotone
        // with BOTH the local cursor and the record's own cursor.
        const current = recordsRef.current.get(id);
        if (!current || current.epoch !== authorityEpochRef.current) return;
        const localNow = readLocalRef.current.get(id) ?? 0;
        const recordKnown = Math.max(current.result.readThroughSequence, localNow);
        const rawCursor = typeof body?.readThroughSequence === 'number' ? body.readThroughSequence : target;
        const serverCursor = Math.min(rawCursor, current.result.latestSequence);
        const next = acknowledgeCursor(recordKnown, serverCursor);
        readLocalRef.current.set(id, next);
        const updated: ThreadRecord = { ...current, result: { ...current.result, readThroughSequence: next } };
        recordsRef.current.set(id, updated);
        revealRecord(id, updated);
      }).catch(() => { /* The local cursor stays the optimistic value; the server monotone rule recovers it. */ });
    }, { root: pane, threshold: 1 });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && sentinel.isConnected) {
        observer.unobserve(sentinel);
        observer.observe(sentinel);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    observer.observe(sentinel);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [ticketId, thread, revealRecord, handleThreadAccessDenial]);

  const loadEarlier = useCallback(async () => {
    const id = activeRef.current;
    const record = id ? recordsRef.current.get(id) : undefined;
    if (!id || !record || historyBusy.has(id)) return;
    const cursor = record.result.nextBefore;
    if (!cursor) return;
    // D5: the whole request is bound to (actorId, ticketId, requestEpoch). A
    // late response — issued here but answered after a room switch — is
    // discarded entirely: no record write, no error text, no busy flip.
    // OP06-05: the busy gate is THIS room's write, never another room's.
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    const fence = fenceRef.current!;
    const token = fence.begin(actorId, id);
    beginHistoryBusy(id);
    const pane = paneRef.current;
    if (pane) {
      pendingScrollRef.current = { ticketId: id, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, stickToBottom: false };
    }
    try {
      const response = await fetch(`/api/chat/tickets/${encodeURIComponent(id)}?beforeSequence=${cursor}&limit=${THREAD_FETCH_LIMIT}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        if (!fence.accepts(token) || activeRef.current !== id) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          handleThreadAccessDenial(response.status, id);
          return;
        }
        setThreadError('โหลดประวัติก่อนหน้าไม่สำเร็จ · ลองอีกครั้ง');
        return;
      }
      let data: InboxThreadResult | null = null;
      try { data = await response.json() as InboxThreadResult; } catch { data = null; }
      if (!data) {
        if (!fence.accepts(token) || activeRef.current !== id) return;
        setThreadError('ระบบตอบกลับไม่สมบูรณ์ · ลองโหลดใหม่อีกครั้ง');
        return;
      }
      if (!fence.accepts(token) || activeRef.current !== id) return;
      applyWindow(id, data, 'history', undefined, { beforeSequence: cursor });
    } catch {
      if (fence.accepts(token) && activeRef.current === id) setThreadError('โหลดประวัติก่อนหน้าไม่สำเร็จ · ลองอีกครั้ง');
    } finally {
      endHistoryBusy(id);
    }
  }, [actorId, applyWindow, beginHistoryBusy, endHistoryBusy, handleThreadAccessDenial, historyBusy]);

  const loadCatchUp = useCallback(async () => {
    const id = activeRef.current;
    const record = id ? recordsRef.current.get(id) : undefined;
    if (!id || !record || historyBusy.has(id)) return;
    if (firstCatchUpBeforeSpans(record.spans, record.empties) === null) return;
    // OP06-05: the busy gate is THIS room's write, never another room's.
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    // Same request epoch fence as loadEarlier: crossed-room transitions kill
    // the whole catch-up run, including every remaining loop iteration.
    const fence = fenceRef.current!;
    const token = fence.begin(actorId, id);
    beginHistoryBusy(id);
    const pane = paneRef.current;
    if (pane) {
      pendingScrollRef.current = { ticketId: id, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, stickToBottom: false };
    }
    try {
      let coverage = { spans: record.spans, empties: record.empties };
      for (let attempt = 0; attempt < CATCH_UP_MAX_ATTEMPTS; attempt += 1) {
        const cursor = firstCatchUpBeforeSpans(coverage.spans, coverage.empties);
        if (cursor === null) break;
        const response = await fetch(`/api/chat/tickets/${encodeURIComponent(id)}?beforeSequence=${cursor}&limit=${THREAD_FETCH_LIMIT}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) {
          if (!fence.accepts(token) || activeRef.current !== id) return;
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            handleThreadAccessDenial(response.status, id);
            return;
          }
          throw new Error('โหลดช่วงที่ขาดไม่สำเร็จ');
        }
        let data: InboxThreadResult | null = null;
        try { data = await response.json() as InboxThreadResult; } catch { data = null; }
        if (!data) {
          if (!fence.accepts(token) || activeRef.current !== id) return;
          setThreadError('ระบบตอบกลับไม่สมบูรณ์ · ลองโหลดใหม่อีกครั้ง');
          return;
        }
        if (!fence.accepts(token) || activeRef.current !== id) return;
        const outcome = catchUpAfterFetch(coverage, {
          cursor,
          window: { messages: data.messages, hasMore: data.hasMore, nextBefore: data.nextBefore } satisfies IncomingWindow,
        });
        coverage = { spans: outcome.spans, empties: outcome.empties };
        applyWindow(id, data, 'catchup', coverage);
        if (outcome.firstCatchUpBefore === null) break;
      }
      const finalRecord = recordsRef.current.get(id);
      if (finalRecord) revealRecord(id, finalRecord);
    } catch {
      if (fence.accepts(token) && activeRef.current === id) setThreadError('โหลดช่วงที่ขาดไม่สำเร็จ · ลองอีกครั้ง');
    } finally {
      endHistoryBusy(id);
    }
  }, [actorId, applyWindow, beginHistoryBusy, endHistoryBusy, revealRecord, handleThreadAccessDenial, historyBusy]);

  const drafts = {
    reply: ticketId ? draftsStore.read(actorId, ticketId, 'reply') : '',
    note: ticketId ? draftsStore.read(actorId, ticketId, 'note') : '',
  };

  const attemptsView = {
    reply: ticketId ? attempts[draftKey(actorId, ticketId, 'reply')] ?? null : null,
    note: ticketId ? attempts[draftKey(actorId, ticketId, 'note')] ?? null : null,
  };

  const onDraftChange = useCallback((kind: 'reply' | 'note', text: string) => {
    const id = activeRef.current;
    if (!id) return;
    // Typed text never deletes the pending retry of an unknown request: the stored body stays immutable.
    draftsStore.write(actorId, id, kind, text);
    bumpDraftTicks();
  }, [actorId, draftsStore, bumpDraftTicks]);

  const submitMessage = useCallback(async (kind: DraftKind, id: string, text: string, fields: Record<string, string | number>) => {
    // OP06-05: one write in flight PER ROOM. Another room's pending write never
    // blocks this gate and never flips this room's notice/busy.
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    if (!text.trim()) return;
    const limit = COMPOSER_LIMITS[kind];
    if (text.trim().length > limit) {
      setRoomNotice(id, { kind: 'error', text: `ข้อความยาวเกิน ${limit} ตัวอักษร กรุณาแก้ไขก่อนส่ง` });
      return;
    }
    const key = draftKey(actorId, id, kind);
    let attempt = attemptsRef.current[key];
    if (!attempt) {
      const decision = pendingWriteDecision(undefined, {
        actorId, ticketId: id, kind, endpoint: threadEndpoint(kind, id), text, body: { ...fields },
      });
      attempt = decision.write;
      attemptsRef.current = { ...attemptsRef.current, [key]: attempt };
      setAttempts(attemptsRef.current);
    }
    const leaseToken = Symbol('submit');
    busyLeaseRef.current = { ...busyLeaseRef.current, [id]: leaseToken };
    setRoomBusy(id, kind);
    setRoomNotice(id, null);
    // OP06-05 completion fence: the response may apply ONLY while (a) the same
    // authority epoch still owns the workspace and (b) the exact attempt whose
    // request was sent is still retained (its requestId matches). A reset or an
    // erased room voids the completion entirely — no notice, no draft write,
    // no note attach, no busy flip in a room the actor no longer owns.
    const leaseEpoch = authorityEpochRef.current;
    const leaseRequestId = attempt.body.requestId;
    let completionValid = false; // true once a response landed in THIS authority
    const completionCurrent = () =>
      attemptsRef.current[key]?.body.requestId === leaseRequestId &&
      writeCompletionValid({
        authorityEpoch: authorityEpochRef.current, leaseEpoch,
        actorId, leaseActorId: attempt.actorId, ticketId: id, leaseTicketId: attempt.ticketId,
      });
    // null status means the request never reached an HTTP answer: the outcome must stay unknown.
    let status: number | null = null;
    let responseKind: 'parsed' | 'invalid-json' | 'no-json' = 'no-json';
    let notePayload: ChatNote | null = null;
    try {
      const response = await fetch(attempt.endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(attempt.body),
      });
      status = response.status;
      if (response.ok) {
        try {
          const body: unknown = await response.json();
          // D9: a 200 commits ONLY via the strict DTO — notes via parseChatNote,
          // replies via parseReplyResult with the exact ticket id. A loose shape
          // stays unknown and keeps the retained attempt for an explicit retry.
          if (kind === 'note') {
            const parsed = parseChatNote(body);
            if (parsed) {
              const source = body as { text?: unknown };
              if (typeof source.text !== 'string') parsed.text = text;
              notePayload = parsed;
              responseKind = 'parsed';
            } else {
              responseKind = 'invalid-json';
            }
          } else {
            responseKind = parseReplyResult(body, id) ? 'parsed' : 'invalid-json';
          }
        } catch {
          responseKind = 'invalid-json';
        }
      }
      completionValid = completionCurrent();
      if (!completionValid) return;
      if (status === 401) {
        completionValid = false;
        handleThreadAccessDenial(401, id);
        return;
      }
      const outcome = writeAttemptOutcome(status, responseKind);
      // RX2: a clear carries its owning requestId — a completion of an OLD
      // attempt never releases a NEWER attempt re-registered under the same key.
      const clearAttempt = () => {
        const stored = attemptsRef.current[key];
        if (!stored || stored.body.requestId !== leaseRequestId) return;
        const remaining = { ...attemptsRef.current };
        delete remaining[key];
        attemptsRef.current = remaining;
        setAttempts(remaining);
      };
      if (outcome === 'committed') {
        clearAttempt();
        const currentDraft = draftsStore.read(actorId, id, kind);
        if (composeAfterSuccess(attempt, currentDraft).clearComposer) draftsStore.write(actorId, id, kind, '');
        if (notePayload) {
          const note = notePayload;
          const record = recordsRef.current.get(id);
          if (record && !record.result.notes.some(item => item.id === note.id)) {
            const updated: ThreadRecord = { ...record, result: { ...record.result, notes: [...record.result.notes, note] } };
            recordsRef.current.set(id, updated);
            revealRecord(id, updated);
          }
        }
        bumpDraftTicks();
        // OP06-05: the outcome lands ONLY in the room that owns the request —
        // the other room's notice/busy is untouched even when deferred.
        setRoomNotice(id, { kind: 'success', text: kind === 'reply' ? 'บันทึกคำตอบแล้ว · สถานะการส่งจะแสดงในบทสนทนา' : 'บันทึกบันทึกส่วนตัวแล้ว · ผู้แจ้งจะไม่เห็นข้อความนี้' });
      } else if (outcome === 'reject-clear') {
        clearAttempt();
        setRoomNotice(id, { kind: 'error', text: status === 409
          ? 'เคสมีการเปลี่ยนแปลง · ข้อความยังคงอยู่ ตรวจข้อมูลล่าสุดก่อนส่งอีกครั้ง'
          : 'บันทึกไม่สำเร็จ · ข้อความที่พิมพ์ไว้ยังคงอยู่' });
      } else {
        setRoomNotice(id, { kind: 'error', text: status !== null && status >= 500
          ? 'ยังยืนยันผลไม่ได้ · ข้อความและคำขอเดิมยังคงอยู่ กดส่งซ้ำได้'
            : 'ระบบตอบกลับไม่สมบูรณ์ ยังไม่ยืนยันผล · กดส่งซ้ำได้' });
      }
    } catch {
      completionValid = completionCurrent();
      if (completionValid) setRoomNotice(id, { kind: 'error', text: 'การเชื่อมต่อขาดหาย ยังไม่ทราบผล · กดส่งซ้ำเพื่อใช้คำขอเดิม' });
    } finally {
      // A voided completion releases only the busy state it still OWNS (its own
      // per-room submit lease) and never fires a queue refresh for a foreign
      // authority. The notice stays stored under the room's key either way, so
      // returning to that room reveals its own honest outcome.
      if (busyLeaseRef.current[id] === leaseToken) {
        const leases = { ...busyLeaseRef.current };
        delete leases[id];
        busyLeaseRef.current = leases;
        setRoomBusy(id, null);
      }
      if (completionValid) notifyThreadListeners(id);
    }
  }, [actorId, draftsStore, revealRecord, setRoomBusy, setRoomNotice, bumpDraftTicks, handleThreadAccessDenial]);

  const onSubmitReply = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = ticketId;
    const current = id ? recordsRef.current.get(id) : undefined;
    const value = id ? draftsStore.read(actorId, id, 'reply') : '';
    if (!id || !current || !current.result.detail.permissions.reply || !value.trim()) return;
    void submitMessage('reply', id, value, { revision: current.result.detail.ticket.revision, text: value.trim() });
  }, [actorId, draftsStore, submitMessage, ticketId]);

  const onSubmitNote = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = ticketId;
    const value = id ? draftsStore.read(actorId, id, 'note') : '';
    if (!id || !value.trim()) return;
    void submitMessage('note', id, value, { text: value.trim() });
  }, [actorId, draftsStore, submitMessage, ticketId]);

  const executeOutboundUpload = useCallback(async (params: {
    id: string;
    file: File;
    requestId: string;
    fileName: string;
    mimeType: OutboundAttachmentMimeType;
    size: number;
    revision: number;
    knownSha256?: string;
    isRetry: boolean;
  }) => {
    const { id, file, requestId, fileName, mimeType, size, revision, knownSha256, isRetry } = params;
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    const ownerActorId = actorId;
    const roomKey = outboundKey(ownerActorId, id);
    const leaseEpoch = authorityEpochRef.current;
    const leaseToken = Symbol('outbound-upload');
    outboundBusyLeaseRef.current = { ...outboundBusyLeaseRef.current, [id]: leaseToken };
    setRoomOutboundBusy(id, 'upload');
    setRoomNotice(id, null);
    retryFileRef.current = { ticketId: id, requestId, file };

    const isLeaseCurrent = () =>
      authorityEpochRef.current === leaseEpoch
      && actorId === ownerActorId
      && outboundRoomsRef.current[roomKey]?.upload?.requestId === requestId;

    updateOutboundRoom(ownerActorId, id, current => ({
      ...current,
      readyDraft: isRetry ? current.readyDraft : null,
      confirmDialogOpen: false,
      confirmAttempt: isRetry ? current.confirmAttempt : null,
      upload: {
        requestId,
        fileName,
        mimeType,
        size,
        sha256: knownSha256 ?? '',
        revision,
        phase: isRetry ? 'uploading' : 'hashing',
        errorText: null,
      },
    }));

    let buffer: ArrayBuffer | null = null;
    try {
      buffer = await file.arrayBuffer();
      const actualSize = buffer.byteLength;
      if (actualSize < 1 || actualSize > OUTBOUND_MAX_BYTES) {
        buffer = null;
        if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
        if (isLeaseCurrent()) {
          const message = actualSize > OUTBOUND_MAX_BYTES
            ? 'ไฟล์มีขนาดเกิน 10 MiB (10,485,760 ไบต์) กรุณาเลือกไฟล์ที่เล็กกว่า'
            : 'ขนาดไฟล์ไม่อยู่ในช่วง 1 ไบต์ ถึง 10 MiB';
          updateOutboundRoom(ownerActorId, id, current => ({ ...current, upload: null }));
          setRoomNotice(id, { kind: 'error', text: message });
        }
        return;
      }
      const sha256 = await computeSha256Hex(buffer);
      if (isRetry && knownSha256 && sha256 !== knownSha256) {
        buffer = null;
        if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
        if (isLeaseCurrent()) {
          updateOutboundRoom(ownerActorId, id, current => ({ ...current, upload: null }));
          setRoomNotice(id, { kind: 'error', text: 'เนื้อหาไฟล์มีการเปลี่ยนแปลง · กรุณาเลือกไฟล์ใหม่อีกครั้ง' });
        }
        return;
      }
      // If user navigated to another room before HTTP upload started, drop bytes immediately.
      if (!isLeaseCurrent() || activeRef.current !== id || retryFileRef.current?.requestId !== requestId) {
        buffer = null;
        if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
        if (isLeaseCurrent()) {
          updateOutboundRoom(ownerActorId, id, current => ({ ...current, upload: null }));
        }
        return;
      }
      updateOutboundRoom(ownerActorId, id, current => ({
        ...current,
        upload: current.upload ? { ...current.upload, sha256, phase: 'uploading', errorText: null } : null,
      }));

      let response: Response;
      try {
        response = await fetch(`/api/chat/tickets/${encodeURIComponent(id)}/outbound-attachments`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: buildOutboundUploadHeaders({
            contentType: mimeType,
            requestId,
            revision,
            fileName,
            sha256,
          }),
          body: buffer,
        });
      } finally {
        // Release raw file byte buffer reference immediately once fetch completes or throws.
        buffer = null;
      }

      if (!isLeaseCurrent()) return;
      const payload: unknown = await response.json().catch(() => null);
      if (!isLeaseCurrent()) return;

      if (response.status === 401) {
        if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
        handleThreadAccessDenial(401, id);
        return;
      }

      if (response.ok) {
        const parsed = parseOutboundUploadResult(payload);
        if (parsed) {
          if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
          updateOutboundRoom(ownerActorId, id, current => ({
            ...current,
            upload: null,
            readyDraft: {
              attachmentId: parsed.attachmentId,
              name: fileName,
              mimeType,
              size,
              uploadedRevision: revision,
            },
            confirmDialogOpen: false,
            confirmAttempt: null,
          }));
          setRoomNotice(id, { kind: 'success', text: 'อัปโหลดร่างไฟล์แล้ว · ยังไม่ได้ส่งถึงนักศึกษา' });
          return;
        }
      }

      const errorCode = extractSafeErrorCode(payload);
      const mapped = mapOutboundUploadError(response.ok ? 503 : response.status, errorCode);
      if (mapped.accessLossStatus !== null) {
        if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
        handleThreadAccessDenial(mapped.accessLossStatus, id);
        return;
      }
      if (mapped.retryableSameRequest) {
        const canRetryInRoom = activeRef.current === id
          && retryFileRef.current?.ticketId === id
          && retryFileRef.current?.requestId === requestId;
        updateOutboundRoom(ownerActorId, id, current => ({
          ...current,
          upload: current.upload
            ? {
              ...current.upload,
              phase: canRetryInRoom ? 'retryable-error' : 'needs-reselect-error',
              errorText: canRetryInRoom
                ? mapped.message
                : 'การอัปโหลดยังไม่สำเร็จ (ไม่เก็บไฟล์ค้างเมื่อเปลี่ยนห้อง) · กรุณาเลือกไฟล์ใหม่อีกครั้ง',
            }
            : null,
        }));
        setRoomNotice(id, { kind: 'error', text: mapped.message });
        return;
      }
      if (retryFileRef.current?.requestId === requestId) retryFileRef.current = null;
      updateOutboundRoom(ownerActorId, id, current => ({ ...current, upload: null }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
      if (mapped.refreshThread) notifyThreadListeners(id);
    } catch {
      buffer = null;
      if (!isLeaseCurrent()) return;
      const mapped = mapOutboundUploadError('network', null);
      const canRetryInRoom = activeRef.current === id
        && retryFileRef.current?.ticketId === id
        && retryFileRef.current?.requestId === requestId;
      updateOutboundRoom(ownerActorId, id, current => ({
        ...current,
        upload: current.upload
          ? {
            ...current.upload,
            phase: canRetryInRoom ? 'retryable-error' : 'needs-reselect-error',
            errorText: canRetryInRoom
              ? mapped.message
              : 'การอัปโหลดยังไม่สำเร็จ (ไม่เก็บไฟล์ค้างเมื่อเปลี่ยนห้อง) · กรุณาเลือกไฟล์ใหม่อีกครั้ง',
          }
          : null,
      }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
    } finally {
      buffer = null;
      if (outboundBusyLeaseRef.current[id] === leaseToken) {
        const leases = { ...outboundBusyLeaseRef.current };
        delete leases[id];
        outboundBusyLeaseRef.current = leases;
        setRoomOutboundBusy(id, null);
      }
    }
  }, [actorId, handleThreadAccessDenial, outboundKey, setRoomNotice, setRoomOutboundBusy, updateOutboundRoom]);

  const onSelectOutboundFile = useCallback((file: File) => {
    const id = activeRef.current;
    const record = id ? recordsRef.current.get(id) : undefined;
    if (!id || !record) return;
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    if (!canShowOutboundAttachControl({
      outboundFiles: { enabled: readOutboundFilesEnabled(record.result) },
      canReply: record.result.detail.permissions.reply,
      ticketMode: record.result.detail.ticket.mode,
      composerKind: 'reply',
    })) return;
    const validation = validateOutboundFileMeta({ name: file.name, type: file.type, size: file.size });
    if (!validation.ok) {
      setRoomNotice(id, { kind: 'error', text: validation.message });
      return;
    }
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID !== 'function' || typeof cryptoApi?.subtle?.digest !== 'function') {
      setRoomNotice(id, { kind: 'error', text: 'เบราว์เซอร์ไม่รองรับการสร้างคำขอหรือตรวจแฮชไฟล์อย่างปลอดภัย' });
      return;
    }
    const requestId = cryptoApi.randomUUID();
    void executeOutboundUpload({
      id,
      file,
      requestId,
      fileName: validation.name,
      mimeType: validation.mimeType,
      size: validation.size,
      revision: record.result.detail.ticket.revision,
      isRetry: false,
    });
  }, [executeOutboundUpload, setRoomNotice]);

  const onRetryOutboundUpload = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    const room = outboundRoomsRef.current[outboundKey(actorId, id)];
    const pending = room?.upload;
    const retry = retryFileRef.current;
    if (!pending || pending.phase !== 'retryable-error' || !retry || retry.ticketId !== id || retry.requestId !== pending.requestId) {
      return;
    }
    void executeOutboundUpload({
      id,
      file: retry.file,
      requestId: pending.requestId,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      size: pending.size,
      revision: pending.revision,
      knownSha256: pending.sha256,
      isRetry: true,
    });
  }, [actorId, executeOutboundUpload, outboundKey]);

  const onDismissOutboundUploadError = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    if (retryFileRef.current?.ticketId === id) retryFileRef.current = null;
    updateOutboundRoom(actorId, id, current => ({ ...current, upload: null }));
  }, [actorId, updateOutboundRoom]);

  const onRemoveOutboundDraft = useCallback(() => {
    const id = activeRef.current;
    if (!id || outboundBusyRef.current[id] !== undefined) return;
    if (retryFileRef.current?.ticketId === id) retryFileRef.current = null;
    updateOutboundRoom(actorId, id, current => ({
      ...current,
      readyDraft: null,
      confirmDialogOpen: false,
      confirmAttempt: null,
    }));
    setRoomNotice(id, {
      kind: 'success',
      text: 'นำร่างไฟล์ออกจากหน้าจอแล้ว · ไฟล์ร่างยังคงเก็บแบบส่วนตัวในระบบและไม่ได้ส่งถึงนักศึกษา',
    });
  }, [actorId, setRoomNotice, updateOutboundRoom]);

  const onOpenOutboundConfirmDialog = useCallback(() => {
    const id = activeRef.current;
    const record = id ? recordsRef.current.get(id) : undefined;
    if (!id || !record) return;
    const room = outboundRoomsRef.current[outboundKey(actorId, id)];
    if (!room?.readyDraft) return;
    if (!canShowOutboundAttachControl({
      outboundFiles: { enabled: readOutboundFilesEnabled(record.result) },
      canReply: record.result.detail.permissions.reply,
      ticketMode: record.result.detail.ticket.mode,
      composerKind: 'reply',
    })) return;
    updateOutboundRoom(actorId, id, current => ({ ...current, confirmDialogOpen: true }));
  }, [actorId, outboundKey, updateOutboundRoom]);

  const onCloseOutboundConfirmDialog = useCallback(() => {
    const id = activeRef.current;
    if (!id || outboundBusyRef.current[id] === 'confirm') return;
    updateOutboundRoom(actorId, id, current => ({ ...current, confirmDialogOpen: false }));
  }, [actorId, updateOutboundRoom]);

  const onConfirmOutboundSend = useCallback(async () => {
    const id = activeRef.current;
    const record = id ? recordsRef.current.get(id) : undefined;
    if (!id || !record) return;
    if (busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    const ownerActorId = actorId;
    const roomKey = outboundKey(ownerActorId, id);
    const room = outboundRoomsRef.current[roomKey];
    const draft = room?.readyDraft;
    if (!draft) return;
    if (!canShowOutboundAttachControl({
      outboundFiles: { enabled: readOutboundFilesEnabled(record.result) },
      canReply: record.result.detail.permissions.reply,
      ticketMode: record.result.detail.ticket.mode,
      composerKind: 'reply',
    })) return;

    const existingAttempt = room.confirmAttempt && room.confirmAttempt.attachmentId === draft.attachmentId
      ? room.confirmAttempt
      : null;
    const cryptoApi = globalThis.crypto;
    if (!existingAttempt && typeof cryptoApi?.randomUUID !== 'function') {
      setRoomNotice(id, { kind: 'error', text: 'เบราว์เซอร์ไม่รองรับการสร้างรหัสยืนยันคำขอ' });
      return;
    }
    const requestId = existingAttempt ? existingAttempt.requestId : cryptoApi.randomUUID();
    const revision = existingAttempt ? existingAttempt.revision : record.result.detail.ticket.revision;
    const ticketNo = existingAttempt ? existingAttempt.ticketNo : record.result.detail.ticket.ticket_no;

    const leaseEpoch = authorityEpochRef.current;
    const leaseToken = Symbol('outbound-confirm');
    outboundBusyLeaseRef.current = { ...outboundBusyLeaseRef.current, [id]: leaseToken };
    setRoomOutboundBusy(id, 'confirm');
    setRoomNotice(id, null);

    updateOutboundRoom(ownerActorId, id, current => ({
      ...current,
      confirmDialogOpen: false,
      confirmAttempt: {
        attachmentId: draft.attachmentId,
        requestId,
        revision,
        ticketNo,
        phase: 'submitting',
        errorText: null,
      },
    }));

    const isLeaseCurrent = () =>
      authorityEpochRef.current === leaseEpoch
      && actorId === ownerActorId
      && outboundRoomsRef.current[roomKey]?.confirmAttempt?.requestId === requestId;

    try {
      const response = await fetch(
        `/api/chat/tickets/${encodeURIComponent(id)}/outbound-attachments/${encodeURIComponent(draft.attachmentId)}/confirm`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildOutboundConfirmBody({ requestId, revision, ticketNo })),
        },
      );
      if (!isLeaseCurrent()) return;
      const payload: unknown = await response.json().catch(() => null);
      if (!isLeaseCurrent()) return;

      if (response.status === 401) {
        handleThreadAccessDenial(401, id);
        return;
      }

      if (response.ok) {
        const parsed = parseOutboundConfirmResult(payload, draft.attachmentId);
        if (parsed) {
          updateOutboundRoom(ownerActorId, id, current => ({
            ...current,
            readyDraft: null,
            confirmDialogOpen: false,
            confirmAttempt: null,
          }));
          const latestRecord = recordsRef.current.get(id);
          if (latestRecord && latestRecord.epoch === authorityEpochRef.current) {
            const nextRevision = Math.max(latestRecord.result.detail.ticket.revision, parsed.revision);
            const updated: ThreadRecord = {
              ...latestRecord,
              result: {
                ...latestRecord.result,
                detail: {
                  ...latestRecord.result.detail,
                  ticket: {
                    ...latestRecord.result.detail.ticket,
                    revision: nextRevision,
                    status: parsed.status,
                  },
                },
              },
            };
            recordsRef.current.set(id, updated);
            revealRecord(id, updated);
          }
          setRoomNotice(id, { kind: 'success', text: 'ยืนยันส่งไฟล์เข้าคิวแล้ว · รอข้อความและสถานะการส่งจากระบบ' });
          notifyThreadListeners(id);
          return;
        }
      }

      const errorCode = extractSafeErrorCode(payload);
      const mapped = mapOutboundConfirmError(response.ok ? 503 : response.status, errorCode);
      if (mapped.accessLossStatus !== null) {
        handleThreadAccessDenial(mapped.accessLossStatus, id);
        return;
      }
      if (mapped.retryableSameRequest) {
        updateOutboundRoom(ownerActorId, id, current => ({
          ...current,
          confirmAttempt: current.confirmAttempt
            ? { ...current.confirmAttempt, phase: 'uncertain', errorText: mapped.message }
            : null,
        }));
        setRoomNotice(id, { kind: 'error', text: mapped.message });
        return;
      }
      // 409 CONFLICT / INVALID_ACTION or definitive 4xx: clear attempt, close dialog for human re-review, keep READY draft.
      updateOutboundRoom(ownerActorId, id, current => ({
        ...current,
        confirmDialogOpen: false,
        confirmAttempt: null,
      }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
      if (mapped.refreshThread) notifyThreadListeners(id);
    } catch {
      if (!isLeaseCurrent()) return;
      const mapped = mapOutboundConfirmError('network', null);
      updateOutboundRoom(ownerActorId, id, current => ({
        ...current,
        confirmAttempt: current.confirmAttempt
          ? { ...current.confirmAttempt, phase: 'uncertain', errorText: mapped.message }
          : null,
      }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
    } finally {
      if (outboundBusyLeaseRef.current[id] === leaseToken) {
        const leases = { ...outboundBusyLeaseRef.current };
        delete leases[id];
        outboundBusyLeaseRef.current = leases;
        setRoomOutboundBusy(id, null);
      }
    }
  }, [actorId, handleThreadAccessDenial, outboundKey, revealRecord, setRoomNotice, setRoomOutboundBusy, updateOutboundRoom]);

  const onOpenOutboundRevokeDialog = useCallback((attachment: OutboundAttachmentView) => {
    const id = activeRef.current;
    if (!id || !attachment.canRevoke) return;
    if (outboundBusyRef.current[id] !== undefined) return;
    updateOutboundRoom(actorId, id, current => ({
      ...current,
      revokeState: {
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        phase: 'confirming',
        errorText: null,
      },
    }));
  }, [actorId, updateOutboundRoom]);

  const onCloseOutboundRevokeDialog = useCallback(() => {
    const id = activeRef.current;
    if (!id || outboundBusyRef.current[id] === 'revoke') return;
    updateOutboundRoom(actorId, id, current => ({ ...current, revokeState: null }));
  }, [actorId, updateOutboundRoom]);

  const onConfirmOutboundRevoke = useCallback(async () => {
    const id = activeRef.current;
    if (!id || busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined) return;
    const ownerActorId = actorId;
    const roomKey = outboundKey(ownerActorId, id);
    const revokeState = outboundRoomsRef.current[roomKey]?.revokeState;
    if (!revokeState) return;
    const targetAttachmentId = revokeState.attachmentId;

    const leaseEpoch = authorityEpochRef.current;
    const leaseToken = Symbol('outbound-revoke');
    outboundBusyLeaseRef.current = { ...outboundBusyLeaseRef.current, [id]: leaseToken };
    setRoomOutboundBusy(id, 'revoke');
    setRoomNotice(id, null);
    updateOutboundRoom(ownerActorId, id, current => ({
      ...current,
      revokeState: current.revokeState ? { ...current.revokeState, phase: 'submitting', errorText: null } : null,
    }));

    const isLeaseCurrent = () =>
      authorityEpochRef.current === leaseEpoch
      && actorId === ownerActorId
      && outboundRoomsRef.current[roomKey]?.revokeState?.attachmentId === targetAttachmentId;

    try {
      const response = await fetch(
        `/api/chat/tickets/${encodeURIComponent(id)}/outbound-attachments/${encodeURIComponent(targetAttachmentId)}/revoke`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      if (!isLeaseCurrent()) return;
      const payload: unknown = await response.json().catch(() => null);
      if (!isLeaseCurrent()) return;

      if (response.status === 401) {
        handleThreadAccessDenial(401, id);
        return;
      }

      if (response.ok && parseOutboundRevokeResult(payload, targetAttachmentId)) {
        updateOutboundRoom(ownerActorId, id, current => ({ ...current, revokeState: null }));
        setRoomNotice(id, {
          kind: 'success',
          text: 'ถอนสิทธิ์การเปิดไฟล์แล้ว · ข้อความใน LINE ยังคงอยู่ แต่ลิงก์จะเปิดไม่ได้อีกต่อไป',
        });
        notifyThreadListeners(id);
        return;
      }

      const errorCode = extractSafeErrorCode(payload);
      const mapped = mapOutboundRevokeError(response.ok ? 503 : response.status, errorCode);
      if (mapped.accessLossStatus !== null) {
        handleThreadAccessDenial(mapped.accessLossStatus, id);
        return;
      }
      if (mapped.retryable) {
        updateOutboundRoom(ownerActorId, id, current => ({
          ...current,
          revokeState: current.revokeState ? { ...current.revokeState, phase: 'error', errorText: mapped.message } : null,
        }));
        setRoomNotice(id, { kind: 'error', text: mapped.message });
        return;
      }
      updateOutboundRoom(ownerActorId, id, current => ({ ...current, revokeState: null }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
      if (mapped.refreshThread) notifyThreadListeners(id);
    } catch {
      if (!isLeaseCurrent()) return;
      const mapped = mapOutboundRevokeError('network', null);
      updateOutboundRoom(ownerActorId, id, current => ({
        ...current,
        revokeState: current.revokeState ? { ...current.revokeState, phase: 'error', errorText: mapped.message } : null,
      }));
      setRoomNotice(id, { kind: 'error', text: mapped.message });
    } finally {
      if (outboundBusyLeaseRef.current[id] === leaseToken) {
        const leases = { ...outboundBusyLeaseRef.current };
        delete leases[id];
        outboundBusyLeaseRef.current = leases;
        setRoomOutboundBusy(id, null);
      }
    }
  }, [actorId, handleThreadAccessDenial, outboundKey, setRoomNotice, setRoomOutboundBusy, updateOutboundRoom]);

  const applyAssistantDraft = useCallback((sourceActorId: string, sourceTicketId: string, sourceRevision: number, draftText: string) => {
    const id = activeRef.current;
    const selected = id ? recordsRef.current.get(id) : undefined;
    if (!id || !selected) return;
    const disposition = assistantDraftDisposition({
      currentActorId: actorId, sourceActorId,
      currentTicketId: id, sourceTicketId,
      currentRevision: selected.result.detail.ticket.revision, sourceRevision,
      canReply: selected.result.detail.permissions.reply,
      busy: busyMapRef.current[id] !== undefined || outboundBusyRef.current[id] !== undefined,
      draftText,
      currentReply: draftsStore.read(actorId, id, 'reply'),
    });
    if (disposition === 'reject') {
      setRoomNotice(id, { kind: 'error', text: 'ร่างนี้ไม่ตรงกับเคสหรือสิทธิ์ปัจจุบัน หรือยาวเกินช่องตอบกลับ กรุณาตรวจข้อมูลล่าสุด' });
      return;
    }
    if (disposition === 'confirm' && !window.confirm('แทนที่ข้อความที่พิมพ์ไว้ด้วยร่างนี้?')) return;
    draftsStore.write(actorId, id, 'reply', draftText);
    bumpDraftTicks();
    setRoomNotice(id, { kind: 'success', text: 'นำร่างไปไว้ในช่องตอบกลับแล้ว · โปรดตรวจทานก่อนส่ง' });
  }, [actorId, draftsStore, setRoomNotice, bumpDraftTicks]);

  // D5 per-room view: the active room's own history/write state only. The
  // composer and the notice below are the SELECTED room's own — another room's
  // pending write or its stored outcome can never leak into this view.
  const historyLoading = ticketId !== null && historyBusy.has(ticketId);
  const busy = ticketId ? busyMap[ticketId] ?? null : null;
  const notice = ticketId ? noticeMap[ticketId] ?? null : null;
  const activeOutbound = ticketId ? outboundRooms[outboundKey(actorId, ticketId)] : undefined;
  const outbound: ChatThreadOutboundOps = {
    busy: ticketId ? outboundBusyMap[ticketId] ?? null : null,
    upload: activeOutbound?.upload ?? null,
    readyDraft: activeOutbound?.readyDraft ?? null,
    confirmDialogOpen: activeOutbound?.confirmDialogOpen ?? false,
    confirmAttempt: activeOutbound?.confirmAttempt ?? null,
    revokeState: activeOutbound?.revokeState ?? null,
    onSelectFile: onSelectOutboundFile,
    onRetryUpload: onRetryOutboundUpload,
    onDismissUploadError: onDismissOutboundUploadError,
    onRemoveDraft: onRemoveOutboundDraft,
    onOpenConfirmDialog: onOpenOutboundConfirmDialog,
    onCloseConfirmDialog: onCloseOutboundConfirmDialog,
    onConfirmSend: () => { void onConfirmOutboundSend(); },
    onOpenRevokeDialog: onOpenOutboundRevokeDialog,
    onCloseRevokeDialog: onCloseOutboundRevokeDialog,
    onConfirmRevoke: () => { void onConfirmOutboundRevoke(); },
  };

  return {
    thread, loading, error, hasStaleResponse, catchUpBefore, historyLoading,
    busy, notice, drafts, attempts: attemptsView, refresh, outbound,
    revokeAuthority: revokeActorAuthority,
    paneRef, sentinelRef,
    onDraftChange, onSubmitReply, onSubmitNote, applyAssistantDraft, loadEarlier, loadCatchUp,
  };
}
