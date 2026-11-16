'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { InboxListResult } from '@/types/inbox';
import type { TicketListItem } from '@/types/tickets';
import TicketActions from '@/app/(dashboard)/tickets/[id]/ticket-actions';
import ChatThread from '@/app/(dashboard)/tickets/[id]/chat-thread';
import {
  CHAT_THREAD_REFRESH_EVENT,
  useChatThreadOps,
  useStaffInvalidateSupervisor,
  type DraftStore,
} from '@/app/(dashboard)/tickets/[id]/chat-thread-ops';
import {
  ListRequestGate,
  buildInboxListParams,
  inboxListStateFromURL,
  inboxListUrl,
  paginationLabel,
  priorityValues,
  rawFromURLSearchParams,
  sensitivityValues,
  ticketSelectionFromURL,
  ticketStatusValues,
  type InboxListState,
} from '@/app/(dashboard)/tickets/[id]/chat-thread-state';
import { draftKey, writeDraft } from './controller';

type Props = { actorId: string; initialTicketId: string | null; initialParams: Record<string, string | string[] | undefined> };

const views = [
  { id: 'all', label: 'ทั้งหมด' }, { id: 'mine', label: 'ของฉัน' }, { id: 'unassigned', label: 'ยังไม่มอบหมาย' },
  { id: 'unread', label: 'ยังไม่อ่าน' }, { id: 'waiting_staff', label: 'รอเจ้าหน้าที่' }, { id: 'waiting_user', label: 'รอผู้แจ้ง' },
] as const;

const statusLabels: Record<TicketListItem['status'], string> = {
  NEW: 'ใหม่', AI_HANDLING: 'ระบบกำลังดูแล', WAITING_STAFF: 'รอเจ้าหน้าที่', STAFF_HANDLING: 'กำลังดูแล',
  WAITING_USER: 'รอผู้แจ้ง', RESOLVED: 'แก้ไขแล้ว', CLOSED: 'ปิดแล้ว', CANCELLED: 'ยกเลิก',
};
const priorityLabels: Record<TicketListItem['priority'], string> = { LOW: 'ต่ำ', MEDIUM: 'ปกติ', HIGH: 'สูง', CRITICAL: 'เร่งด่วน' };
const sensitivityLabels: Record<string, string> = { GENERAL: 'ทั่วไป', SENSITIVE: 'ละเอียดอ่อน', RESTRICTED: 'จำกัดการเข้าถึง' };

function dateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function Inbox({ actorId, initialParams }: Props) {
  const router = useRouter();

  // URL is the single source of truth for list filters; first paint derives it on the server.
  const [listSeed] = useState(() => inboxListStateFromURL(initialParams));
  const [listState, setListState] = useState<InboxListState>(listSeed.state);
  // S08: the selection deep-link is validated BEFORE anything may fetch with it;
  // a malformed ticket id never starts a thread request and shows in the dropped note.
  const seededTicket = ticketSelectionFromURL(initialParams);
  const [droppedKeys, setDroppedKeys] = useState<string[]>(seededTicket.malformed ? [...listSeed.dropped, 'ticket'] : listSeed.dropped);
  const listStateRef = useRef(listState);

  const [list, setList] = useState<InboxListResult | null>(null);
  const [listLoading, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeId, setActiveId] = useState<string | null>(seededTicket.id);
  const activeIdRef = useRef<string | null>(seededTicket.id);

  // Drafts stay in this tab's memory only: parent state keeps controlled textareas exact.
  const [drafts, setDraftsState] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const [draftsStore] = useState<DraftStore>(() => ({
    read: (ownerId, ticketId, kind) => draftsRef.current[draftKey(ownerId, ticketId, kind)] ?? '',
    write: (ownerId, ticketId, kind, text) => {
      const next = writeDraft(draftsRef.current, ownerId, ticketId, kind, text);
      draftsRef.current = next;
      setDraftsState(next);
    },
    // OP06-02 CX1: a whole-actor authority reset erases EVERY draft of the
    // actor in this store (list denial loses the entire mounted workspace).
    eraseActorDrafts: ownerId => {
      const prefix = `${ownerId}:`;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(draftsRef.current)) {
        if (!key.startsWith(prefix)) next[key] = value;
      }
      draftsRef.current = next;
      setDraftsState(next);
    },
  }));

  // Bounded serial list gate: out-of-order responses never overwrite the newest query.
  const listGateRef = useRef<ListRequestGate | null>(null);
  if (listGateRef.current === null) listGateRef.current = new ListRequestGate();
  const listAbortRef = useRef<AbortController | null>(null);

  // List denial (401/403/404) resets the WHOLE actor workspace; the hook is
  // defined below, so the reset is handed over through this ref once mounted.
  const resetOpsRef = useRef<(() => void) | null>(null);

  const composeUrl = useCallback((state: InboxListState, ticketId: string | null) => {
    const base = inboxListUrl(state);
    if (!ticketId) return base;
    return base.includes('?') ? `${base}&ticket=${encodeURIComponent(ticketId)}` : `${base}?ticket=${encodeURIComponent(ticketId)}`;
  }, []);

  const applySelection = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
    setFeedback('');
  }, []);

  const requestList = useCallback(async (state: InboxListState) => {
    const gate = listGateRef.current!;
    const ticket = gate.begin();
    const controller = new AbortController();
    listAbortRef.current?.abort();
    listAbortRef.current = controller;
    setLoadingList(true);
    setListError('');
    try {
      const response = await fetch(`/api/chat/inbox?${buildInboxListParams(state)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (!gate.accepts(ticket)) return;
        setListError(response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'โหลดรายการสนทนาไม่สำเร็จ · กดรีเฟรชเพื่อลองอีกครั้ง');
        // S03: an auth/authorization denial invalidates the whole snapshot — no stale
        // rows may stay clickable. 409 and network errors must NOT clear the list.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setList(null);
          // CX1: a list-level denial invalidates the whole actor workspace —
          // the retained records/drafts/attempts cannot survive it.
          resetOpsRef.current?.();
          if (activeIdRef.current) {
            applySelection(null);
            router.replace(composeUrl(listStateRef.current, null), { scroll: false });
          }
        }
        return;
      }
      let data: InboxListResult | null = null;
      try { data = await response.json() as InboxListResult; } catch { data = null; }
      if (!gate.accepts(ticket) || controller.signal.aborted) return;
      if (!data) { setListError('ระบบตอบกลับไม่สมบูรณ์ · กดรีเฟรชเพื่อลองอีกครั้ง'); return; }
      setList(data);
    } catch {
      if (!gate.accepts(ticket) || controller.signal.aborted) return;
      setListError('เชื่อมต่อเพื่อโหลดรายการไม่ได้ · กดรีเฟรชเพื่อลองอีกครั้ง');
    } finally {
      if (gate.accepts(ticket) && !controller.signal.aborted) setLoadingList(false);
    }
  }, [applySelection, composeUrl, router]);

  // The list owner trims its rows when the server denies this thread entirely.
  // P3-1: a 401 means the actor session itself is gone — reset the WHOLE actor
  // immediately without waiting for a pending list request to answer 401.
  // CX2: 403/404 stay ticket-scoped so another open room remains untouched.
  const onThreadAccessLost = useCallback((status: number, lostTicketId: string) => {
    if (status === 401) {
      setList(null);
      setListError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
      resetOpsRef.current?.();
      if (activeIdRef.current) {
        applySelection(null);
        router.replace(composeUrl(listStateRef.current, null), { scroll: false });
      }
      setFeedback('เซสชันหมดอายุ · บทสนทนาที่เปิดไว้ถูกปิดลง');
      void requestList(listStateRef.current);
      return;
    }
    if (activeIdRef.current === lostTicketId) {
      applySelection(null);
      router.replace(composeUrl(listStateRef.current, null), { scroll: false });
      setFeedback('บทสนทนานี้ไม่แสดงให้คุณอีกต่อไป · ลองโหลดรายการใหม่');
    }
    // The ops owner already erased the lost room's retained state either way.
    void requestList(listStateRef.current);
  }, [applySelection, composeUrl, requestList, router]);

  const ops = useChatThreadOps({ actorId, ticketId: activeId, draftsStore, onThreadAccessLost });
  const {
    thread, loading, error: threadError, hasStaleResponse, catchUpBefore, historyLoading,
    busy, notice, drafts: threadDrafts, attempts,
    refresh, paneRef, sentinelRef,
    onDraftChange, applyAssistantDraft, loadEarlier, loadCatchUp,
    onSubmitReply, onSubmitNote,
  } = ops;
  // The list owner may reset the whole actor workspace on a list-level denial;
  // handed over through a ref (written in an effect, never during render).
  useEffect(() => {
    resetOpsRef.current = ops.revokeAuthority;
  }, [ops]);

  // D7 mobile focus transfer: a row click hands focus into the opened pane (its
  // back button); closing hands it back to the originating row if still present,
  // else the queue heading. Focus never stays inside a display:none pane. The
  // previous-selection ref is read and written only inside this effect.
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const queueHeadingRef = useRef<HTMLDivElement | null>(null);
  const previousActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousActiveIdRef.current;
    if (previous === activeId) return;
    previousActiveIdRef.current = activeId;
    if (activeId !== null) {
      backButtonRef.current?.focus();
      return;
    }
    if (previous === null) return;
    const queue = queueHeadingRef.current?.closest('.inbox-queue');
    const originating = queue
      ? queue.querySelector<HTMLButtonElement>(`[data-ticket-row="${previous}"]`)
      : null;
    (originating ?? queueHeadingRef.current)?.focus();
  }, [activeId]);

  const selectTicket = useCallback((id: string) => {
    applySelection(id);
    router.replace(composeUrl(listStateRef.current, id), { scroll: false });
  }, [applySelection, composeUrl, router]);

  const closeTicket = useCallback(() => {
    applySelection(null);
    router.replace(composeUrl(listStateRef.current, null), { scroll: false });
  }, [applySelection, composeUrl, router]);

  // One fetch per effective state; URL mirrors it for sharing and back/forward.
  const rangeInvalid = Boolean(listState.from && listState.to && listState.from > listState.to);
  useEffect(() => {
    listStateRef.current = listState;
    if (rangeInvalid) return;
    const target = listState;
    queueMicrotask(() => {
      if (listStateRef.current !== target) return;
      void requestList(target);
    });
    window.history.replaceState(window.history.state, '', composeUrl(listState, activeIdRef.current));
  }, [listState, requestList, composeUrl, rangeInvalid]);

  useEffect(() => {
    const onPop = () => {
      const params = rawFromURLSearchParams(new URLSearchParams(window.location.search));
      const next = inboxListStateFromURL(params);
      const selection = ticketSelectionFromURL(params);
      setListState(next.state);
      setDroppedKeys(selection.malformed ? [...next.dropped, 'ticket'] : next.dropped);
      applySelection(selection.id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applySelection]);

  // Lifecycle writes and submissions announce themselves; the queue must catch up.
  useEffect(() => {
    const handler = () => { void requestList(listStateRef.current); };
    window.addEventListener(CHAT_THREAD_REFRESH_EVENT, handler);
    return () => window.removeEventListener(CHAT_THREAD_REFRESH_EVENT, handler);
  }, [requestList]);

  // D8 shared lifetime wiring (one listener set + cleanup per route): private
  // `staff:<actorId>:inbox` invalidate marker refetch, visible/online interval
  // refresh, and exactly one removeChannel of its own channel on unmount.
  const liveState = useStaffInvalidateSupervisor({
    actorId,
    onInvalidate: () => {
      void requestList(listStateRef.current);
      refresh();
    },
  });

  const patchState = useCallback((patch: Partial<InboxListState>) => {
    setListState(current => ({ ...current, ...patch }));
  }, []);

  const resetFilters = useCallback((patch: Partial<InboxListState>) => {
    setListState(current => ({ ...current, ...patch, page: 1 }));
  }, []);

  const activeTicket = useMemo(() => thread?.detail.ticket ?? list?.tickets.find(item => item.id === activeId) ?? null, [activeId, list, thread]);
  const selectedTickets = list?.tickets ?? [];
  const countOutcome = paginationLabel(list?.pagination, listState.page);
  const pagination = list?.pagination;

  return (
    <main className="inbox-page" aria-label="กล่องข้อความเจ้าหน้าที่">
      <header className="inbox-heading">
        <div><span className="inbox-eyebrow">YRU AI HELPDESK</span><h1>กล่องข้อความ</h1><p>ดูแลบทสนทนาของผู้แจ้งในขอบเขตที่คุณได้รับอนุญาต</p></div>
        <div className={`inbox-live inbox-live-${liveState}`} aria-live="polite"><span aria-hidden="true" />{liveState === 'live' ? 'เชื่อมต่อการอัปเดตแล้ว' : liveState === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'ติดตามการเปลี่ยนแปลงอัตโนมัติ'}</div>
      </header>
      <section className="inbox-layout" aria-label="รายการและบทสนทนา">
        <aside className={`inbox-queue ${activeId ? 'inbox-mobile-hidden' : ''}`} aria-label="รายการสนทนา">
          <div className="inbox-queue-heading" ref={queueHeadingRef} tabIndex={-1}>
            <div><h2>การสนทนา</h2><span aria-live="polite">{countOutcome.text}</span></div>
            <button type="button" className="inbox-icon-button" aria-label="โหลดรายการใหม่" onClick={() => { void requestList(listStateRef.current); }}>↻</button>
          </div>
          {countOutcome.kind === 'out-of-range' && (
            <div className="inbox-range-recovery" role="status">
              <span>{countOutcome.text}</span>
              <button type="button" onClick={() => patchState({ page: 1 })}>กลับไปหน้าแรก</button>
            </div>
          )}
          {droppedKeys.length > 0 && <p className="inbox-dropped-note">พารามิเตอร์ที่ไม่รู้จักถูกข้าม: {droppedKeys.join(', ')}</p>}
          <label className="inbox-search"><span className="sr-only">ค้นหาบทสนทนา</span><span aria-hidden="true">⌕</span><input value={listState.q ?? ''} onChange={event => resetFilters({ q: event.target.value || undefined })} placeholder="ค้นหาเรื่องหรือรหัสผู้แจ้ง" /></label>
          <div className="inbox-filter-row">
            <label><span className="sr-only">มุมมอง</span><select value={listState.view} onChange={event => resetFilters({ view: event.target.value as InboxListState['view'] })}>{views.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label><span className="sr-only">หมวดหมู่</span><select value={listState.category ?? ''} onChange={event => resetFilters({ category: event.target.value || undefined })}><option value="">ทุกหมวด</option>{list?.categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="inbox-filter-row">
            <label><span className="sr-only">หน่วยงาน</span><select value={listState.department ?? ''} onChange={event => resetFilters({ department: event.target.value || undefined })}><option value="">ทุกหน่วยงาน</option>{list?.departments.map(item => <option key={item.id} value={item.id}>{item.name_th}</option>)}</select></label>
            <label><span className="sr-only">สถานะ</span><select value={listState.status ?? ''} onChange={event => resetFilters({ status: event.target.value || undefined })}><option value="">ทุกสถานะ</option>{ticketStatusValues.map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}</select></label>
          </div>
          <div className="inbox-filter-row">
            <label><span className="sr-only">ความสำคัญ</span><select value={listState.priority ?? ''} onChange={event => resetFilters({ priority: event.target.value || undefined })}><option value="">ทุกระดับ</option>{priorityValues.map(item => <option key={item} value={item}>{priorityLabels[item]}</option>)}</select></label>
            <label><span className="sr-only">เจ้าหน้าที่ผู้รับผิดชอบ</span><select value={listState.assignee ?? ''} onChange={event => resetFilters({ assignee: event.target.value || undefined })}><option value="">ทุกผู้รับผิดชอบ</option>{list?.assignees.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
          </div>
          <div className="inbox-filter-row">
            <label><span className="sr-only">ระดับข้อมูล</span><select value={listState.sensitivity ?? ''} onChange={event => resetFilters({ sensitivity: event.target.value || undefined })}><option value="">ทุกระดับข้อมูล</option>{sensitivityValues.map(item => <option key={item} value={item}>{sensitivityLabels[item]}</option>)}</select></label>
            <span className="inbox-date-pair">
              <label><span className="sr-only">ตั้งแต่วันที่</span><input type="date" value={listState.from ?? ''} onChange={event => resetFilters({ from: event.target.value || undefined })} /></label>
              <label><span className="sr-only">ถึงวันที่</span><input type="date" value={listState.to ?? ''} onChange={event => resetFilters({ to: event.target.value || undefined })} /></label>
            </span>
          </div>
          {rangeInvalid && <p className="inbox-inline-error" role="alert">ช่วงวันที่ไม่ถูกต้อง · ตั้งแต่วันที่ต้องไม่เป็นวันหลังถึงวันที่ (รายการยังไม่โหลด)</p>}
          {listError && <div className="inbox-inline-error" role="alert">{listError}<button type="button" onClick={() => { void requestList(listStateRef.current); }}>ลองใหม่</button></div>}
          <div className="inbox-ticket-list" aria-live="polite" aria-busy={listLoading}>
            {listLoading && selectedTickets.length === 0 ? <p className="inbox-empty-state">กำลังโหลดรายการ…</p>
              : selectedTickets.length === 0
                ? <p className="inbox-empty-state">{countOutcome.kind === 'empty' ? 'ยังไม่มีบทสนทนา' : 'ไม่มีบทสนทนาตรงกับตัวกรอง'}</p>
                : selectedTickets.map(ticket => {
                  const unread = list?.unreadCounts[ticket.id] ?? 0;
                  return <button key={ticket.id} type="button" className={`inbox-ticket-row ${activeId === ticket.id ? 'is-selected' : ''}`} aria-current={activeId === ticket.id ? 'true' : undefined} data-ticket-row={ticket.id} onClick={() => selectTicket(ticket.id)}>
                    <span className="inbox-ticket-avatar" aria-hidden="true">{ticket.anonymous_code.slice(0, 1)}</span>
                    <span className="inbox-ticket-main"><span className="inbox-ticket-title">{ticket.problem_summary}</span><span className="inbox-ticket-snippet">{ticket.category} · {ticket.department_name}</span><span className="inbox-ticket-meta">{ticket.ticket_no} · {ticket.assignee_name ?? 'ยังไม่มอบหมาย'}</span></span>
                    <span className="inbox-ticket-side"><span className={`inbox-status-chip inbox-status-${ticket.status.toLowerCase()}`}>{statusLabels[ticket.status]}</span>{unread > 0 && <span className="inbox-unread-count" aria-label={`${unread} ข้อความที่ยังไม่อ่าน`}>{unread}</span>}<time dateTime={ticket.updated_at}>{new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' }).format(new Date(ticket.updated_at))}</time></span>
                  </button>;
                })}
          </div>
          <nav className="inbox-pagination" aria-label="หน้ารายการสนทนา">
            <button type="button" disabled={!pagination?.hasPrevious || listLoading} onClick={() => patchState({ page: Math.max(1, listState.page - 1) })}>ก่อนหน้า</button>
            <span>{pagination ? `หน้า ${pagination.page} / ${pagination.totalPages}` : `หน้า ${listState.page} / ไม่ทราบ`}</span>
            <button type="button" disabled={!pagination?.hasNext || listLoading} onClick={() => patchState({ page: listState.page + 1 })}>ถัดไป</button>
          </nav>
        </aside>

        <section className={`inbox-conversation ${!activeId ? 'inbox-mobile-hidden' : ''}`} aria-label="บทสนทนาที่เลือก">
          {!activeId ? <div className="inbox-welcome"><span className="inbox-welcome-icon" aria-hidden="true">✳</span><h2>เลือกบทสนทนา</h2><p>เลือกเรื่องจากรายการเพื่อดูข้อความและตอบกลับผู้แจ้ง</p>{feedback && <p className="inbox-muted" role="status">{feedback}</p>}</div>
            : (
              <>
                <div className="inbox-conversation-topbar">
                  <button ref={backButtonRef} type="button" className="inbox-back-mobile" onClick={closeTicket}>← รายการ</button>
                  {activeTicket && <Link href={`/tickets/${activeTicket.id}`} className="inbox-details-link">เปิดรายละเอียด ↗</Link>}
                </div>
                <ChatThread
                  actorId={actorId}
                  thread={thread}
                  loading={loading}
                  error={threadError}
                  drafts={threadDrafts}
                  attempts={attempts}
                  busy={busy}
                  notice={notice}
                  hasStaleResponse={hasStaleResponse}
                  catchUpBefore={catchUpBefore}
                  historyLoading={historyLoading}
                  onDraftChange={onDraftChange}
                  onLoadEarlier={() => void loadEarlier()}
                  onLoadCatchUp={() => void loadCatchUp()}
                  onRefresh={refresh}
                  onSubmitReply={onSubmitReply}
                  onSubmitNote={onSubmitNote}
                  assist={{
                    available: thread !== null,
                    revision: thread?.detail.ticket.revision ?? 0,
                    onDraft: text => {
                      const current = activeIdRef.current;
                      if (!current || !thread) return;
                      applyAssistantDraft(actorId, current, thread.detail.ticket.revision, text);
                    },
                  }}
                  paneRef={paneRef}
                  sentinelRef={sentinelRef}
                />
              </>
            )}
        </section>

        <aside className={`inbox-context ${activeId ? '' : 'inbox-mobile-hidden'}`} aria-label="บริบทของเคส">
          {!activeTicket || !thread ? <div className="inbox-context-empty"><span aria-hidden="true">⌁</span><p>รายละเอียดเคสจะแสดงที่นี่</p></div> : <>
            <div className="inbox-context-top"><div className="inbox-context-avatar" aria-hidden="true">{activeTicket.anonymous_code.slice(0, 1)}</div><h2>ผู้แจ้ง {activeTicket.anonymous_code}</h2><p>{activeTicket.ticket_no}</p></div>
            <section className="inbox-context-section"><h3>สถานะเคส</h3><dl><div><dt>การดูแล</dt><dd>{activeTicket.mode === 'HUMAN' ? 'เจ้าหน้าที่ดูแล' : 'ระบบดูแล'}</dd></div><div><dt>สถานะ</dt><dd>{statusLabels[activeTicket.status]}</dd></div><div><dt>ความสำคัญ</dt><dd>{priorityLabels[activeTicket.priority]}</dd></div><div><dt>ผู้รับผิดชอบ</dt><dd>{activeTicket.assignee_name ?? 'ยังไม่มอบหมาย'}</dd></div></dl></section>
            <section className="inbox-context-section"><h3>หน่วยงานและข้อมูล</h3><dl><div><dt>หน่วยงาน</dt><dd>{activeTicket.department_name}</dd></div><div><dt>หมวดหมู่</dt><dd>{activeTicket.category}</dd></div><div><dt>ระดับข้อมูล</dt><dd>{sensitivityLabels[activeTicket.sensitive_level]}</dd></div><div><dt>เริ่มเรื่อง</dt><dd>{dateTime(activeTicket.created_at)}</dd></div></dl></section>
            <TicketActions key={thread.detail.ticket.id} actorId={actorId} id={thread.detail.ticket.id} ticketNo={thread.detail.ticket.ticket_no} reporter={thread.detail.ticket.anonymous_code} revision={thread.detail.ticket.revision} permissions={thread.detail.permissions} assignees={thread.detail.assignees} />
            <section className="inbox-context-section" aria-label="เหตุการณ์ร่วมของหน่วยงาน">
              <h3>เหตุการณ์ร่วม</h3>
              <Link href={`/incidents?department=${activeTicket.department_id}`} className="inbox-context-link">ดูเหตุการณ์ร่วมของ {activeTicket.department_name} <span aria-hidden="true">↗</span></Link>
              <p className="inbox-muted">การเปิดหน้าเหตุการณ์ร่วมไม่เปลี่ยนเคสที่กำลังตอบ · ตรวจผู้รับข้อความก่อนส่งทุกครั้ง ผู้รับปลายทางยืนยันจากเคสที่เปิดอยู่เสมอ และปุ่มส่งในหน้ารวมจะถูกปิดจนกว่าจะเลือกผู้รับชัดเจน</p>
            </section>
            <Link href={`/tickets/${activeTicket.id}`} className="inbox-context-link">ดูประวัติและการดำเนินการ <span aria-hidden="true">↗</span></Link>
          </>}
        </aside>
      </section>
    </main>
  );
}
