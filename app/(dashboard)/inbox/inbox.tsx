'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase/browser';
import type { InboxListResult, InboxThreadResult, ChatMessage } from '@/types/inbox';
import type { TicketListItem } from '@/types/tickets';
import StaffAiPanel from '@/app/(dashboard)/tickets/[id]/staff-ai-panel';
import StaffKnowledgePanel from '@/app/(dashboard)/tickets/[id]/staff-knowledge-panel';
import StaffCopilotPanel from '@/app/(dashboard)/tickets/[id]/staff-copilot-panel';
import { assistantDraftDisposition, deliveryEvidence, draftKey, installVisibleRefresh, readDraft, requestForText, restoredScrollTop, retryAfterStatus, shouldAcknowledgeRead, shouldClearSelectedThread, ThreadRequestFence, writeDraft, type DraftKind, type RetryRequest } from './controller';

type Props = { actorId: string; initialTicketId: string | null };
type View = 'all' | 'mine' | 'unassigned' | 'unread' | 'waiting_staff' | 'waiting_user';
type Retry = RetryRequest;

const views: { id: View; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' }, { id: 'mine', label: 'ของฉัน' }, { id: 'unassigned', label: 'ยังไม่มอบหมาย' },
  { id: 'unread', label: 'ยังไม่อ่าน' }, { id: 'waiting_staff', label: 'รอเจ้าหน้าที่' }, { id: 'waiting_user', label: 'รอผู้แจ้ง' },
];
const statusLabels: Record<TicketListItem['status'], string> = {
  NEW: 'ใหม่', AI_HANDLING: 'ระบบกำลังดูแล', WAITING_STAFF: 'รอเจ้าหน้าที่', STAFF_HANDLING: 'กำลังดูแล',
  WAITING_USER: 'รอผู้แจ้ง', RESOLVED: 'แก้ไขแล้ว', CLOSED: 'ปิดแล้ว', CANCELLED: 'ยกเลิก',
};
const priorityLabels: Record<TicketListItem['priority'], string> = { LOW: 'ต่ำ', MEDIUM: 'ปกติ', HIGH: 'สูง', CRITICAL: 'เร่งด่วน' };
const senderLabels: Record<ChatMessage['senderType'], string> = { USER: 'ผู้แจ้ง', AI: 'YRU AI', STAFF: 'เจ้าหน้าที่', SYSTEM: 'ระบบ' };

function dateTime(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function recipient(ticket: TicketListItem) { return `${ticket.ticket_no} · ผู้แจ้ง ${ticket.anonymous_code}`; }

export default function Inbox({ actorId, initialTicketId }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<InboxListResult | null>(null);
  const [activeId, setActiveId] = useState(initialTicketId);
  const [thread, setThread] = useState<InboxThreadResult | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [retries, setRetries] = useState<Record<string, Retry>>({});
  const [busy, setBusy] = useState<DraftKind | 'accept' | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const messagesPaneRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLLIElement | null>(null);
  const readThroughRef = useRef<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeIdRef = useRef(initialTicketId);
  const requestFenceRef = useRef<ThreadRequestFence | null>(null);
  if (requestFenceRef.current === null) requestFenceRef.current = new ThreadRequestFence(actorId, initialTicketId);
  const latestThreadRef = useRef(thread);
  const pendingScrollRef = useRef<{ ticketId: string; scrollTop: number; scrollHeight: number; stickToBottom: boolean } | null>(null);

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ view, page: String(page), pageSize: '50' });
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    const response = await fetch(`/api/chat/inbox?${params}`, { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok) throw new Error(response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'โหลดรายการสนทนาไม่สำเร็จ');
    const data = await response.json() as InboxListResult;
    setList(data);
  }, [category, page, query, view]);

  const refreshThread = useCallback(async (id: string, signal?: AbortSignal) => {
    const requestToken = requestFenceRef.current!.begin(actorId, id);
    let response: Response;
    try { response = await fetch(`/api/chat/tickets/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal }); }
    catch (error) {
      if (!requestFenceRef.current?.accepts(requestToken) || activeIdRef.current !== id) return;
      throw error;
    }
    if (!response.ok) {
      const isCurrent = requestFenceRef.current?.accepts(requestToken) ?? false;
      if (!isCurrent || activeIdRef.current !== id) return;
      if (shouldClearSelectedThread({ status: response.status, requestIsCurrent: isCurrent, requestTicketId: id, selectedTicketId: activeIdRef.current })) {
        setThread(null);
        setList(current => response.status === 401 ? null : current ? { ...current, tickets: current.tickets.filter(ticket => ticket.id !== id), unreadCounts: withoutKey(current.unreadCounts, id) } : current);
        setThreadError(response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'ไม่พบรายการนี้หรือสิทธิ์ของคุณเปลี่ยนไป');
      }
      throw new Error(response.status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
        : response.status === 403 || response.status === 404 ? 'ไม่พบรายการนี้หรือสิทธิ์ของคุณเปลี่ยนไป'
          : response.status === 409 ? 'เคสมีการเปลี่ยนแปลง · ร่างข้อความยังคงอยู่ ตรวจข้อมูลล่าสุดก่อนส่งอีกครั้ง'
            : 'โหลดบทสนทนาไม่สำเร็จ');
    }
    let data: InboxThreadResult;
    try { data = await response.json() as InboxThreadResult; }
    catch (error) {
      if (!requestFenceRef.current?.accepts(requestToken) || activeIdRef.current !== id) return;
      throw error;
    }
    if (!requestFenceRef.current?.accepts(requestToken) || activeIdRef.current !== id) return;
    const pane = messagesPaneRef.current;
    if (pane) {
      const distanceFromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      pendingScrollRef.current = { ticketId: id, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, stickToBottom: distanceFromBottom < 48 };
    }
    setThread(current => {
      if (current?.detail.ticket.id !== id) return data;
      const oldFirst = current.messages[0]?.sequence;
      const newFirst = data.messages[0]?.sequence;
      const retainedHistory = oldFirst !== undefined && newFirst !== undefined && oldFirst < newFirst;
      return {
        ...data,
        messages: mergeMessages(current.messages, data.messages),
        hasMore: data.hasMore || current.hasMore,
        nextBefore: retainedHistory ? current.nextBefore : data.nextBefore,
      };
    });
    setThreadError('');
  }, [actorId]);

  useLayoutEffect(() => {
    latestThreadRef.current = thread;
  }, [thread]);

  useLayoutEffect(() => {
    const anchor = pendingScrollRef.current;
    const pane = messagesPaneRef.current;
    if (!anchor || !pane || anchor.ticketId !== activeId || activeIdRef.current !== activeId) return;
    pane.scrollTop = restoredScrollTop(anchor, pane.scrollHeight);
    pendingScrollRef.current = null;
  }, [activeId, thread]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoadingList(true); setListError('');
      void refreshList(controller.signal).catch(error => {
        if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'โหลดรายการสนทนาไม่สำเร็จ');
      }).finally(() => { if (!controller.signal.aborted) setLoadingList(false); });
    });
    return () => controller.abort();
  }, [refreshList]);

  useEffect(() => {
    if (!activeId) return;
    const id = activeId;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoadingThread(true); setThreadError('');
      void refreshThread(id, controller.signal).catch(error => {
        if (!controller.signal.aborted) setThreadError(error instanceof Error ? error.message : 'โหลดบทสนทนาไม่สำเร็จ');
      }).finally(() => { if (!controller.signal.aborted) setLoadingThread(false); });
    });
    return () => controller.abort();
  }, [activeId, refreshThread]);

  const invalidate = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshList().catch(() => setListError('รายการอาจเปลี่ยนแปลง · กดรีเฟรชเพื่อลองอีกครั้ง'));
    const id = activeId;
    if (id) void refreshThread(id).catch(() => setThreadError('บทสนทนาอาจเปลี่ยนแปลง · กดโหลดใหม่เพื่อลองอีกครั้ง'));
  }, [activeId, refreshList, refreshThread]);

  useEffect(() => {
    let client: ReturnType<typeof createBrowserClient> | null = null;
    let alive = true;
    let stopVisibleRefresh: () => void = () => {};
    try {
      client = createBrowserClient();
      const channel = client.channel(`staff:${actorId}:inbox`, { config: { private: true } });
      channelRef.current = channel;
      channel.on('broadcast', { event: 'invalidate' }, () => invalidate());
      channel.subscribe(status => {
        if (!alive) return;
        if (status === 'SUBSCRIBED') { setLiveState('live'); invalidate(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveState('polling');
      });
    } catch { queueMicrotask(() => { if (alive) setLiveState('polling'); }); }

    stopVisibleRefresh = installVisibleRefresh(document, window, invalidate, 5000);
    return () => {
      alive = false;
      stopVisibleRefresh();
      if (client && channelRef.current) void client.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [actorId, invalidate]);

  useEffect(() => {
    const id = activeId;
    const pane = messagesPaneRef.current;
    const sentinel = bottomRef.current;
    if (!id || !pane || !sentinel || !thread || thread.detail.ticket.id !== id) return;
    const sequence = thread.messages.at(-1)?.sequence;
    if (sequence === undefined) return;
    const observer = new IntersectionObserver(entries => {
      const sentinelVisible = entries.some(entry => entry.isIntersecting);
      if (!shouldAcknowledgeRead({ documentVisible: document.visibilityState === 'visible', rendered: sentinel.isConnected, sentinelVisible, latestSequence: sequence, readThroughSequence: Math.max(thread.readThroughSequence, readThroughRef.current[id] ?? 0) })) return;
      readThroughRef.current[id] = sequence;
      observer.disconnect();
      void fetch(`/api/chat/tickets/${encodeURIComponent(id)}/read`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ throughSequence: sequence }),
      }).then(response => {
        if (response.ok) setThread(current => current?.detail.ticket.id === id ? { ...current, readThroughSequence: Math.max(current.readThroughSequence, sequence) } : current);
        else readThroughRef.current[id] = thread.readThroughSequence;
      }).catch(() => { readThroughRef.current[id] = thread.readThroughSequence; });
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
  }, [activeId, thread]);

  const activeTicket = useMemo(() => thread?.detail.ticket ?? list?.tickets.find(ticket => ticket.id === activeId) ?? null, [activeId, list, thread]);
  const activeReplyKey = activeId ? draftKey(actorId, activeId, 'reply') : '';
  const activeNoteKey = activeId ? draftKey(actorId, activeId, 'note') : '';
  const reply = activeId ? readDraft(drafts, actorId, activeId, 'reply') : '';
  const note = activeId ? readDraft(drafts, actorId, activeId, 'note') : '';
  const pagination = list?.pagination;

  function selectTicket(id: string) {
    activeIdRef.current = id;
    requestFenceRef.current?.select(actorId, id);
    pendingScrollRef.current = null;
    setActiveId(id);
    setThread(null);
    setLoadingThread(true);
    setNotice(null);
    router.replace(`/inbox?ticket=${encodeURIComponent(id)}`, { scroll: false });
  }

  function updateDraft(key: string, kind: DraftKind, value: string) {
    const scopedKey = activeId ? draftKey(actorId, activeId, kind) : key;
    setDrafts(current => writeDraft(current, actorId, activeId ?? '', kind, value));
    const pending = retries[scopedKey];
    if (pending && pending.text !== value) setRetries(current => { const next = { ...current }; delete next[scopedKey]; return next; });
  }

  function applyAssistantDraft(sourceActorId: string, sourceTicketId: string, sourceRevision: number, draftText: string) {
    const selectedThread = latestThreadRef.current;
    const selectedId = activeIdRef.current;
    if (!selectedId || !selectedThread) return;
    const disposition = assistantDraftDisposition({
      currentActorId: actorId, sourceActorId,
      currentTicketId: selectedId, sourceTicketId,
      currentRevision: selectedThread.detail.ticket.revision, sourceRevision,
      canReply: selectedThread.detail.permissions.reply, busy: busy !== null,
      draftText, currentReply: readDraft(drafts, actorId, selectedId, 'reply'),
    });
    if (disposition === 'reject') {
      setNotice({ kind: 'error', text: 'ร่างนี้ไม่ตรงกับเคสหรือสิทธิ์ปัจจุบัน หรือยาวเกินช่องตอบกลับ กรุณาตรวจข้อมูลล่าสุด' });
      return;
    }
    if (disposition === 'confirm' && !window.confirm('แทนที่ข้อความที่พิมพ์ไว้ด้วยร่างนี้?')) return;
    const key = draftKey(sourceActorId, sourceTicketId, 'reply');
    setDrafts(current => writeDraft(current, sourceActorId, sourceTicketId, 'reply', draftText));
    setRetries(current => { const next = { ...current }; delete next[key]; return next; });
    setNotice({ kind: 'success', text: 'นำร่างไปไว้ในช่องตอบกลับแล้ว · โปรดตรวจทานก่อนส่ง' });
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || !thread || !thread.detail.permissions.reply || !reply.trim()) return;
    await submitMessage('reply', activeId, reply, `/api/tickets/${encodeURIComponent(activeId)}/reply`, {
      revision: thread.detail.ticket.revision, text: reply.trim(),
    });
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || !note.trim()) return;
    await submitMessage('note', activeId, note, `/api/chat/tickets/${encodeURIComponent(activeId)}/notes`, { text: note.trim() });
  }

  async function submitMessage(kind: DraftKind, id: string, text: string, endpoint: string, fields: Record<string, string | number>) {
    const key = draftKey(actorId, id, kind);
    const retry = requestForText(retries[key], text, fields, () => crypto.randomUUID());
    setRetries(current => ({ ...current, [key]: retry }));
    setBusy(kind); setNotice(null);
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(retry.body) });
      if (!response.ok) {
        if (retryAfterStatus(response.status) === 'clear') setRetries(current => { const next = { ...current }; delete next[key]; return next; });
        setNotice({ kind: 'error', text: response.status === 409
          ? 'เคสมีการเปลี่ยนแปลง · ข้อความยังคงอยู่ ตรวจข้อมูลล่าสุดก่อนส่งอีกครั้ง'
          : response.status >= 500 ? 'ยังยืนยันผลไม่ได้ · ข้อความและคำขอเดิมยังคงอยู่ กดส่งซ้ำได้'
            : 'บันทึกไม่สำเร็จ · ข้อความที่พิมพ์ไว้ยังคงอยู่' });
        setBusy(null); return;
      }
      setRetries(current => { const next = { ...current }; delete next[key]; return next; });
      setDrafts(current => ({ ...current, [key]: '' }));
      setNotice({ kind: 'success', text: kind === 'reply' ? 'บันทึกคำตอบแล้ว · สถานะการส่งจะแสดงในบทสนทนา' : 'บันทึกบันทึกส่วนตัวแล้ว · ผู้แจ้งจะไม่เห็นข้อความนี้' });
      await Promise.all([refreshThread(id).catch(() => undefined), refreshList().catch(() => undefined)]);
      setBusy(null);
    } catch {
      setNotice({ kind: 'error', text: 'การเชื่อมต่อขาดหาย ยังไม่ทราบผล · กดส่งซ้ำเพื่อใช้คำขอเดิม' });
      setBusy(null);
    }
  }

  async function acceptTicket() {
    if (!activeId || !thread?.detail.permissions.accept || busy) return;
    setBusy('accept'); setNotice(null);
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(activeId)}/accept`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: thread.detail.ticket.revision, requestId: crypto.randomUUID() }),
      });
      if (!response.ok) { setNotice({ kind: 'error', text: response.status === 409 ? 'เคสมีการเปลี่ยนแปลง · โหลดข้อมูลล่าสุดก่อนรับเรื่อง' : 'ยังรับเรื่องไม่สำเร็จ · โหลดใหม่เพื่อตรวจสอบสถานะ' }); setBusy(null); return; }
      setNotice({ kind: 'success', text: 'รับเรื่องแล้ว · เคสนี้อยู่ในโหมดเจ้าหน้าที่ดูแล' });
      await Promise.all([refreshThread(activeId).catch(() => undefined), refreshList().catch(() => undefined)]);
    } catch { setNotice({ kind: 'error', text: 'ยังไม่ทราบผลการรับเรื่อง · โหลดใหม่เพื่อตรวจสอบสถานะ' }); }
    setBusy(null);
  }

  async function loadEarlier() {
    if (!activeId || !thread?.nextBefore || historyLoading) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/chat/tickets/${encodeURIComponent(activeId)}?beforeSequence=${thread.nextBefore}&limit=50`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('โหลดประวัติก่อนหน้าไม่สำเร็จ');
      const earlier = await response.json() as InboxThreadResult;
      const pane = messagesPaneRef.current;
      if (pane) pendingScrollRef.current = { ticketId: activeId, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, stickToBottom: false };
      setThread(current => current?.detail.ticket.id === activeId ? { ...earlier, messages: mergeMessages(earlier.messages, current.messages), notes: current.notes, readThroughSequence: current.readThroughSequence } : current);
    } catch { setThreadError('โหลดประวัติก่อนหน้าไม่สำเร็จ · ลองอีกครั้ง'); }
    setHistoryLoading(false);
  }

  const selectedTickets = list?.tickets ?? [];

  return (
    <main className="inbox-page" aria-label="กล่องข้อความเจ้าหน้าที่">
      <header className="inbox-heading">
        <div><span className="inbox-eyebrow">YRU AI HELPDESK</span><h1>กล่องข้อความ</h1><p>ดูแลบทสนทนาของผู้แจ้งในขอบเขตที่คุณได้รับอนุญาต</p></div>
        <div className={`inbox-live inbox-live-${liveState}`} aria-live="polite"><span aria-hidden="true" />{liveState === 'live' ? 'เชื่อมต่อการอัปเดตแล้ว' : liveState === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'ติดตามการเปลี่ยนแปลงอัตโนมัติ'}</div>
      </header>
      <section className="inbox-layout" aria-label="รายการและบทสนทนา">
        <aside className={`inbox-queue ${activeId ? 'inbox-mobile-hidden' : ''}`} aria-label="รายการสนทนา">
          <div className="inbox-queue-heading"><div><h2>การสนทนา</h2><span>{pagination ? `${pagination.total} รายการ` : 'รายการที่อยู่ในขอบเขต'}</span></div><button type="button" className="inbox-icon-button" aria-label="โหลดรายการใหม่" onClick={() => { setLoadingList(true); void refreshList().catch(() => setListError('โหลดรายการสนทนาไม่สำเร็จ')).finally(() => setLoadingList(false)); }}>↻</button></div>
          <label className="inbox-search"><span className="sr-only">ค้นหาบทสนทนา</span><span aria-hidden="true">⌕</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="ค้นหาเรื่องหรือรหัสผู้แจ้ง" /></label>
          <div className="inbox-filter-row"><label><span className="sr-only">มุมมอง</span><select value={view} onChange={event => { setView(event.target.value as View); setPage(1); }}>{views.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span className="sr-only">หมวดหมู่</span><select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">ทุกหมวด</option>{list?.categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
          {listError && <div className="inbox-inline-error" role="alert">{listError}<button type="button" onClick={() => void refreshList().catch(() => undefined)}>ลองใหม่</button></div>}
          <div className="inbox-ticket-list" aria-live="polite" aria-busy={loadingList}>
            {loadingList && selectedTickets.length === 0 ? <p className="inbox-empty-state">กำลังโหลดรายการ…</p> : selectedTickets.length === 0 ? <p className="inbox-empty-state">ไม่มีบทสนทนาตรงกับตัวกรอง</p> : selectedTickets.map(ticket => {
              const unread = list?.unreadCounts[ticket.id] ?? 0;
              return <button key={ticket.id} type="button" className={`inbox-ticket-row ${activeId === ticket.id ? 'is-selected' : ''}`} aria-current={activeId === ticket.id ? 'true' : undefined} onClick={() => selectTicket(ticket.id)}>
                <span className="inbox-ticket-avatar" aria-hidden="true">{ticket.anonymous_code.slice(0, 1)}</span>
                <span className="inbox-ticket-main"><span className="inbox-ticket-title">{ticket.problem_summary}</span><span className="inbox-ticket-snippet">{ticket.category} · {ticket.department_name}</span><span className="inbox-ticket-meta">{ticket.ticket_no} · {ticket.assignee_name ?? 'ยังไม่มอบหมาย'}</span></span>
                <span className="inbox-ticket-side"><span className={`inbox-status-chip inbox-status-${ticket.status.toLowerCase()}`}>{statusLabels[ticket.status]}</span>{unread > 0 && <span className="inbox-unread-count" aria-label={`${unread} ข้อความที่ยังไม่อ่าน`}>{unread}</span>}<time dateTime={ticket.updated_at}>{new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' }).format(new Date(ticket.updated_at))}</time></span>
              </button>;
            })}
          </div>
          {pagination && <nav className="inbox-pagination" aria-label="หน้ารายการสนทนา"><button type="button" disabled={!pagination.hasPrevious || loadingList} onClick={() => setPage(value => Math.max(1, value - 1))}>ก่อนหน้า</button><span>หน้า {pagination.page} / {pagination.totalPages}</span><button type="button" disabled={!pagination.hasNext || loadingList} onClick={() => setPage(value => value + 1)}>ถัดไป</button></nav>}
        </aside>

        <section className={`inbox-conversation ${!activeId ? 'inbox-mobile-hidden' : ''}`} aria-label="บทสนทนาที่เลือก">
          {!activeId ? <div className="inbox-welcome"><span className="inbox-welcome-icon" aria-hidden="true">✳</span><h2>เลือกบทสนทนา</h2><p>เลือกเรื่องจากรายการเพื่อดูข้อความและตอบกลับผู้แจ้ง</p></div> : loadingThread && !thread ? <p className="inbox-empty-state">กำลังโหลดบทสนทนา…</p> : threadError && !thread ? <div className="inbox-welcome" role="alert"><h2>เปิดบทสนทนาไม่ได้</h2><p>{threadError}</p><button type="button" className="inbox-button inbox-button-secondary" onClick={() => void refreshThread(activeId).catch(error => setThreadError(error.message))}>ลองโหลดใหม่</button></div> : thread && activeTicket ? <>
            <header className="inbox-conversation-header">
              <button type="button" className="inbox-back-mobile" onClick={() => { activeIdRef.current = null; requestFenceRef.current?.select(actorId, null); pendingScrollRef.current = null; setActiveId(null); setThread(null); router.replace('/inbox', { scroll: false }); }}>← รายการ</button>
              <div className="inbox-conversation-title"><h2>{activeTicket.problem_summary}</h2><p>{activeTicket.ticket_no} · ผู้แจ้ง {activeTicket.anonymous_code} · {activeTicket.category}</p></div>
              <div className="inbox-header-actions">{thread.detail.permissions.accept && <button type="button" className="inbox-button inbox-button-primary" disabled={busy !== null} onClick={() => void acceptTicket()}>{busy === 'accept' ? 'กำลังรับ…' : 'รับเรื่อง'}</button>}<Link href={`/tickets/${activeId}`} className="inbox-details-link">เปิดรายละเอียด ↗</Link></div>
            </header>
            <div className="inbox-message-scroll" ref={messagesPaneRef}>
              {thread.hasMore && <div className="inbox-history-control"><button type="button" onClick={() => void loadEarlier()} disabled={historyLoading}>{historyLoading ? 'กำลังโหลด…' : 'โหลดข้อความก่อนหน้า'}</button></div>}
              {threadError && <p className="inbox-inline-error" role="alert">{threadError}</p>}
              <ol className="inbox-messages" aria-label="ประวัติบทสนทนา">
                {thread.messages.map(message => <li key={message.id} className={`inbox-message inbox-message-${message.senderType.toLowerCase()}`}>
                  <div className="inbox-message-meta"><span>{senderLabels[message.senderType]}{message.senderType === 'STAFF' && message.staffName ? ` · ${message.staffName}` : ''}</span><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></div>
                  <div className="inbox-message-bubble"><p>{message.content}</p>{message.attachments.map(file => <div className="inbox-attachment" key={file.id}><span aria-hidden="true">{file.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}</span><span>{file.name}<small>{file.status === 'PENDING' ? 'กำลังเตรียมไฟล์' : file.status === 'FAILED' ? 'ไฟล์ยังเปิดไม่ได้' : `${Math.max(1, Math.round(file.size / 1024))} KB`}</small></span>{file.status === 'READY' && file.downloadUrl ? <a href={file.downloadUrl} target="_blank" rel="noreferrer">เปิด</a> : null}</div>)}</div>
                  {(() => {
                    const evidence = deliveryEvidence(message.senderType, message.deliveryStatus);
                    return evidence && <span className={`inbox-delivery inbox-delivery-${evidence.kind.toLowerCase()}`}>{evidence.kind === 'unproven' ? evidence.text : `สถานะข้อความ: ${evidence.text}`}</span>;
                  })()}
                </li>)}
                <li ref={bottomRef} className="inbox-bottom-sentinel" aria-hidden="true" />
              </ol>
              {thread.messages.length === 0 && <p className="inbox-empty-state">ยังไม่มีข้อความในบทสนทนานี้</p>}
            </div>
            <div className="inbox-composer-wrap">
              {notice && <p className={`inbox-notice inbox-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}{notice.kind === 'error' && notice.text.includes('เคสมีการเปลี่ยนแปลง') && <button type="button" className="inbox-notice-refresh" onClick={() => void refreshThread(activeId).catch(error => setThreadError(error.message))}>โหลดข้อมูลล่าสุด</button>}</p>}
              {thread.detail.permissions.reply ? <form className="inbox-reply-form" onSubmit={submitReply}>
                <label htmlFor="inbox-reply">ตอบกลับผู้แจ้ง <span>ข้อความจะส่งถึง {recipient(activeTicket)} เท่านั้น</span></label>
                <textarea id="inbox-reply" value={reply} maxLength={5000} onChange={event => updateDraft(activeReplyKey, 'reply', event.target.value)} placeholder="เขียนข้อความตอบกลับ…" rows={3} />
                <div className="inbox-compose-footer"><span>{reply.length}/5,000 · ร่างอยู่ในหน่วยความจำของแท็บนี้</span><button type="submit" className="inbox-button inbox-button-primary" disabled={busy !== null || !reply.trim()}>{busy === 'reply' ? 'กำลังบันทึก…' : retries[activeReplyKey] ? 'ส่งซ้ำด้วยคำขอเดิม' : 'ส่งข้อความ'}</button></div>
              </form> : <p className="inbox-readonly-note">คุณไม่มีสิทธิ์ตอบกลับ หรือเคสนี้ยังไม่อยู่ในสถานะที่ตอบได้</p>}
              <details className="inbox-note-disclosure"><summary>บันทึกส่วนตัวสำหรับเจ้าหน้าที่</summary><form onSubmit={submitNote}><label htmlFor="inbox-note" className="sr-only">บันทึกส่วนตัว</label><textarea id="inbox-note" value={note} maxLength={3000} onChange={event => updateDraft(activeNoteKey, 'note', event.target.value)} placeholder="บันทึกนี้ผู้แจ้งจะไม่เห็น" rows={2} /><div className="inbox-compose-footer"><span>{note.length}/3,000</span><button className="inbox-button inbox-button-secondary" type="submit" disabled={busy !== null || !note.trim()}>{busy === 'note' ? 'กำลังบันทึก…' : retries[activeNoteKey] ? 'บันทึกซ้ำด้วยคำขอเดิม' : 'เพิ่มบันทึก'}</button></div></form>{thread.notes.length > 0 && <ul className="inbox-notes">{thread.notes.map(item => <li key={item.id}><p>{item.text}</p><span>{item.staffName} · {dateTime(item.createdAt)}</span></li>)}</ul>}</details>
            </div>
          </> : null}
        </section>

        <aside className={`inbox-context ${activeId ? '' : 'inbox-mobile-hidden'}`} aria-label="บริบทของเคส">
          {!activeTicket ? <div className="inbox-context-empty"><span aria-hidden="true">⌁</span><p>รายละเอียดเคสจะแสดงที่นี่</p></div> : <>
            <div className="inbox-context-top"><div className="inbox-context-avatar" aria-hidden="true">{activeTicket.anonymous_code.slice(0, 1)}</div><h2>ผู้แจ้ง {activeTicket.anonymous_code}</h2><p>{activeTicket.ticket_no}</p></div>
            <section className="inbox-context-section"><h3>สถานะเคส</h3><dl><div><dt>การดูแล</dt><dd>{activeTicket.mode === 'HUMAN' ? 'เจ้าหน้าที่ดูแล' : 'ระบบดูแล'}</dd></div><div><dt>สถานะ</dt><dd>{statusLabels[activeTicket.status]}</dd></div><div><dt>ความสำคัญ</dt><dd>{priorityLabels[activeTicket.priority]}</dd></div><div><dt>ผู้รับผิดชอบ</dt><dd>{activeTicket.assignee_name ?? 'ยังไม่มอบหมาย'}</dd></div></dl></section>
            <section className="inbox-context-section"><h3>หน่วยงานและข้อมูล</h3><dl><div><dt>หน่วยงาน</dt><dd>{activeTicket.department_name}</dd></div><div><dt>หมวดหมู่</dt><dd>{activeTicket.category}</dd></div><div><dt>ระดับข้อมูล</dt><dd>{activeTicket.sensitive_level === 'GENERAL' ? 'ทั่วไป' : activeTicket.sensitive_level === 'SENSITIVE' ? 'ละเอียดอ่อน' : 'จำกัดการเข้าถึง'}</dd></div><div><dt>เริ่มเรื่อง</dt><dd>{dateTime(activeTicket.created_at)}</dd></div></dl></section>
            <section className="inbox-context-section"><h3>บันทึกส่วนตัว</h3>{thread?.notes.length ? <ul className="inbox-notes">{thread.notes.map(item => <li key={item.id}><p>{item.text}</p><span>{item.staffName} · {dateTime(item.createdAt)}</span></li>)}</ul> : <p className="inbox-muted">ยังไม่มีบันทึก</p>}</section>
            {thread && activeTicket.mode === 'HUMAN' && ['WAITING_STAFF', 'STAFF_HANDLING', 'WAITING_USER'].includes(activeTicket.status) && <section className="inbox-context-section inbox-assist-tools" aria-label="เครื่องมือช่วยร่าง">
              <h3>เครื่องมือช่วยร่าง</h3>
              <StaffAiPanel key={`summary:${activeTicket.id}:${activeTicket.revision}`} id={activeTicket.id} revision={activeTicket.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={text => applyAssistantDraft(actorId, activeTicket.id, activeTicket.revision, text)} />
              <StaffKnowledgePanel key={`knowledge:${activeTicket.id}:${activeTicket.revision}`} id={activeTicket.id} revision={activeTicket.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={text => applyAssistantDraft(actorId, activeTicket.id, activeTicket.revision, text)} />
              <StaffCopilotPanel key={`copilot:${activeTicket.id}:${activeTicket.revision}`} id={activeTicket.id} revision={activeTicket.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={text => applyAssistantDraft(actorId, activeTicket.id, activeTicket.revision, text)} />
            </section>}
            <Link href={`/tickets/${activeTicket.id}`} className="inbox-context-link">ดูประวัติและการดำเนินการ <span aria-hidden="true">↗</span></Link>
          </>}
        </aside>
      </section>
    </main>
  );
}

function mergeMessages(first: ChatMessage[], second: ChatMessage[]) {
  const messages = new Map<string, ChatMessage>();
  for (const item of [...first, ...second]) messages.set(item.id, item);
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
