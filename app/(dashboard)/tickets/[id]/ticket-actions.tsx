'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StaffTicketAction, TicketDetail } from '@/types/tickets';
import { notifyThreadListeners } from './chat-thread-ops';
import {
  clearActionAttempt,
  findActionAttempt,
  parseActionResult,
  registerActionAttempt,
  subscribeActionAttempts,
  type ActionAttempt,
  type ActionAttemptBody,
} from './ticket-action-workspace';

type Props = Pick<TicketDetail, 'permissions' | 'assignees'> & {
  actorId: string;
  id: string;
  ticketNo: string;
  reporter: string;
  revision: number;
};

type ActionDraftFields = Record<string, string>;

const lifecycle: Partial<Record<StaffTicketAction, string>> = {
  ACCEPT: 'accept', RESOLVE: 'resolve', CLOSE: 'close', REASSIGN: 'reassign', REOPEN: 'reopen',
};

const actionLabels: Record<StaffTicketAction, string> = {
  ACCEPT: 'รับเรื่อง', STAFF_REPLY: 'ส่งคำตอบ', RESOLVE: 'ทำเครื่องหมายว่าแก้ไขแล้ว', CLOSE: 'ปิดเรื่อง', REASSIGN: 'เปลี่ยนผู้รับผิดชอบ', REOPEN: 'เปิดเรื่องอีกครั้ง',
};

const allActions: StaffTicketAction[] = ['ACCEPT', 'RESOLVE', 'CLOSE', 'REASSIGN', 'REOPEN'];

function responseMessage(status: number): string {
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 404) return 'ไม่พบรายการนี้หรือคุณไม่มีสิทธิ์เข้าถึง';
  if (status === 409) return 'รายการมีการเปลี่ยนแปลง กรุณาตรวจสอบข้อมูลล่าสุดก่อนดำเนินการ';
  if (status === 400) return 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง';
  if (status >= 500) return 'เซิร์ฟเวอร์ยังยืนยันผลไม่ได้ · คำขอเดิมยังคงอยู่ กดลองส่งซ้ำเพื่อใช้คำขอเดิม';
  return 'ยังดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง';
}

export default function TicketActions({ actorId, id, ticketNo, reporter, revision, permissions, assignees }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'error' | 'success'>('error');
  const [resolveReason, setResolveReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [, setAttemptTick] = useState(0);
  // Synchronous same-tick guard: one in-flight attempt per panel, no double POST.
  const executingRef = useRef(false);

  useEffect(() => subscribeActionAttempts(() => setAttemptTick(value => value + 1)), []);

  // Stored attempts of THIS ticket (per (actor, ticket, action)) drive the visible retries.
  const storedAttempts: ActionAttempt[] = [];
  for (const action of allActions) {
    const attempt = findActionAttempt(actorId, id, action);
    if (attempt) storedAttempts.push(attempt);
  }

  async function executeAttempt(attempt: ActionAttempt) {
    if (executingRef.current) return;
    executingRef.current = true;
    setPending(true);
    setNotice('');
    let message = '';
    let kind: 'error' | 'success' = 'error';
    let committed = false;
    try {
      const response = await fetch(attempt.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        // Only the stored attempt body travels; a form edit never rewrites it, and a
        // retry keeps the original requestId (idempotent intent, no auto-resend).
        body: JSON.stringify(attempt.body),
      });
      if (response.ok) {
        let parsed = null;
        try {
          parsed = parseActionResult(await response.json(), attempt.ticketId);
        } catch {
          parsed = null;
        }
        if (parsed) {
          committed = true;
          // RX2: the clear carries the owning requestId.
          clearActionAttempt(attempt.actorId, attempt.ticketId, attempt.action, { requestId: attempt.requestId });
          message = 'บันทึกการเปลี่ยนแปลงแล้ว';
          kind = 'success';
          if (attempt.action === 'RESOLVE') setResolveReason('');
          else if (attempt.action === 'REOPEN') setReopenReason('');
        } else {
          // A 200 without the exact success DTO stays unknown: keep the attempt.
          message = 'ระบบตอบกลับไม่สมบูรณ์ ยังไม่ยืนยันผล · คำขอเดิมยังคงอยู่ กดลองส่งซ้ำได้';
          kind = 'error';
        }
      } else {
        const definite = response.status >= 400 && response.status < 500;
        if (definite) {
          // RX2: the clear carries the owning requestId.
          clearActionAttempt(attempt.actorId, attempt.ticketId, attempt.action, { requestId: attempt.requestId });
          // OP06-03 lane: a lifecycle access loss (401/403/404) announces the
          // ticket — the thread ops owner erases that room's retained state and
          // the inbox closes only the MATCHING selection (CX2 scope).
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            notifyThreadListeners(attempt.ticketId, { accessLostStatus: response.status });
            router.refresh();
          } else if (response.status === 409) {
            notifyThreadListeners(attempt.ticketId);
            router.refresh();
          }
        }
        message = responseMessage(response.status);
        kind = 'error';
      }
    } catch {
      message = 'การเชื่อมต่อขาดหาย ยังไม่ทราบผลการบันทึก กดลองส่งซ้ำเพื่อใช้คำขอเดิม (ข้อความที่พิมพ์ไว้ยังคงอยู่)';
      kind = 'error';
    }
    setNotice(message);
    setNoticeKind(kind);
    // Wait for the next paint before reopening the panel; avoids double-click resubmits.
    setPending(false);
    executingRef.current = false;
    if (committed) {
      notifyThreadListeners(attempt.ticketId);
      router.refresh();
    }
  }

  function runAction(action: StaffTicketAction, fields: ActionDraftFields) {
    if (executingRef.current) return;
    const attempt = registerActionAttempt({
      actorId,
      ticketId: id,
      action,
      endpoint: `/api/tickets/${encodeURIComponent(id)}/${lifecycle[action]}`,
      revision,
      body: { ...fields, revision } satisfies ActionAttemptBody,
    });
    void executeAttempt(attempt);
  }

  const hasAnyLifecycle = permissions.accept || permissions.resolve || permissions.close || permissions.reassign || permissions.reopen;

  return (
    <section className="ticket-action-panel" aria-labelledby="action-heading">
      <div className="ticket-section-heading"><div><h2 id="action-heading">การดำเนินการ</h2></div></div>
      <div className="ticket-recipient-context" aria-label="เคสที่กำลังดำเนินการ">
        <span>เคสที่เปิดอยู่</span><strong>{ticketNo}</strong><span>ผู้แจ้ง {reporter}</span>
        <p>ข้อความในหน้านี้ส่งเฉพาะเคสนี้ การเปิดหน้าหรือเคสอื่นจะไม่เปลี่ยนเคสที่เลือกไว้ใน LINE</p>
      </div>
      {notice && <p className={`ticket-action-notice ticket-action-notice-${noticeKind}`} role="status">{notice}</p>}
      {storedAttempts.length > 0 && (
        <div className="ticket-uncertain-attempts" role="status">
          <h3 className="ticket-secondary-title">คำขอที่ยังไม่ทราบผล</h3>
          {storedAttempts.map(attempt => (
            <div key={attempt.action} className="ticket-uncertain-attempt">
              <p>
                {actionLabels[attempt.action]} ส่งไปแล้วแต่ยังไม่ทราบผล (ไอดีคำขอ {attempt.requestId.slice(0, 8)}…) —
                กดส่งซ้ำจะใช้คำขอเดิมทั้งคำขอและร่างเดิม ไม่สร้างคำขอใหม่
              </p>
              <button
                className="ticket-button ticket-button-secondary"
                type="button"
                disabled={pending}
                onClick={() => void executeAttempt(attempt)}
              >
                ลองส่งซ้ำ
              </button>
            </div>
          ))}
        </div>
      )}
      {!hasAnyLifecycle ? (
        <p className="ticket-muted">คุณไม่มีสิทธิ์ในการดำเนินการกับคำขอนี้ หรือเคสนี้อยู่ในสถานะสิ้นสุดการดำเนินการแล้ว</p>
      ) : (
        <div className="ticket-action-grid">
          {permissions.accept && (
            <div className="ticket-takeover-box">
              <div className="ticket-takeover-text">
                <strong>เรื่องนี้รอเจ้าหน้าที่รับเรื่อง</strong>
                <p>กดรับเรื่องเพื่อเริ่มดูแลเคสนี้ด้วยตนเองและเปลี่ยนโหมดเป็นเจ้าหน้าที่ดูแล (HUMAN)</p>
              </div>
              <form onSubmit={event => { event.preventDefault(); runAction('ACCEPT', {}); }}>
                <button className="ticket-button ticket-button-primary ticket-button-lg" disabled={pending}>
                  {pending ? 'กำลังดำเนินการ…' : 'รับเรื่องนี้'}
                </button>
              </form>
            </div>
          )}
          <div className="ticket-secondary-actions">
            {(permissions.resolve || permissions.close || permissions.reassign || permissions.reopen) && (
              <>
                <h3 className="ticket-secondary-title">การจัดการสถานะและมอบหมาย</h3>
                {permissions.resolve && (
                  <form className="ticket-action-form" onSubmit={event => { event.preventDefault(); const trimmed = resolveReason.trim(); runAction('RESOLVE', trimmed ? { reason: trimmed } : {}); }}>
                    <label htmlFor="resolve-reason">บันทึกการแก้ไข <span>(ไม่บังคับ)</span></label>
                    <input
                      id="resolve-reason"
                      name="reason"
                      maxLength={1000}
                      value={resolveReason}
                      onChange={e => setResolveReason(e.target.value)}
                      placeholder="สรุปสิ่งที่ดำเนินการ…"
                    />
                    <button className="ticket-button ticket-button-secondary" disabled={pending}>ทำเครื่องหมายว่าแก้ไขแล้ว</button>
                  </form>
                )}
                {permissions.close && (
                  <form onSubmit={event => { event.preventDefault(); runAction('CLOSE', {}); }}>
                    <button className="ticket-button ticket-button-secondary" disabled={pending}>ปิดเรื่อง</button>
                  </form>
                )}
                {permissions.reassign && (
                  <form className="ticket-action-form" onSubmit={event => {
                    event.preventDefault();
                    const assigneeId = String(new FormData(event.currentTarget).get('assigneeId') ?? '');
                    if (assigneeId) runAction('REASSIGN', { assigneeId });
                  }}>
                    <label htmlFor="assignee">มอบหมายให้เจ้าหน้าที่อื่น</label>
                    <select id="assignee" name="assigneeId" required defaultValue="">
                      <option value="" disabled>เลือกเจ้าหน้าที่</option>
                      {assignees.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}
                    </select>
                    <button className="ticket-button ticket-button-secondary" disabled={pending}>เปลี่ยนผู้รับผิดชอบ</button>
                  </form>
                )}
                {permissions.reopen && (
                  <form className="ticket-action-form" onSubmit={event => { event.preventDefault(); runAction('REOPEN', { reason: reopenReason.trim() }); }}>
                    <label htmlFor="reopen-reason">เหตุผลที่เปิดเรื่องอีกครั้ง</label>
                    <textarea
                      id="reopen-reason"
                      name="reason"
                      rows={3}
                      maxLength={1000}
                      required
                      value={reopenReason}
                      onChange={e => setReopenReason(e.target.value)}
                      placeholder="ระบุเหตุผล…"
                    />
                    <button className="ticket-button ticket-button-secondary" disabled={pending || !reopenReason.trim()}>เปิดเรื่องอีกครั้ง</button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {pending && <p className="ticket-pending" role="status">กำลังบันทึก…</p>}
    </section>
  );
}
