'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TicketDetail, StaffTicketAction } from '@/types/tickets';
import StaffAiPanel from './staff-ai-panel';
import StaffKnowledgePanel from './staff-knowledge-panel';

type Props = Pick<TicketDetail, 'permissions' | 'assignees'> & { id: string; revision: number; assistAvailable?:boolean };
type ActionDraft = { action: StaffTicketAction; fields: Record<string, string> };
type PendingAction = ActionDraft & { body: Record<string, string | number> };

const endpoint: Record<StaffTicketAction, string> = {
  ACCEPT: 'accept', STAFF_REPLY: 'reply', RESOLVE: 'resolve', CLOSE: 'close', REASSIGN: 'reassign', REOPEN: 'reopen',
};

function responseMessage(status: number): string {
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 404) return 'ไม่พบรายการนี้หรือคุณไม่มีสิทธิ์เข้าถึง';
  if (status === 409) return 'รายการมีการเปลี่ยนแปลง กรุณาตรวจสอบข้อมูลล่าสุดก่อนดำเนินการ';
  if (status === 400) return 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง';
  if (status >= 500) return 'เซิร์ฟเวอร์ยังยืนยันผลไม่ได้ ข้อความที่กรอกยังคงอยู่ กดส่งซ้ำเพื่อใช้คำขอเดิม';
  return 'ยังดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง';
}

export default function TicketActions({ id, revision, permissions, assignees,assistAvailable=false }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [retryPayload, setRetryPayload] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'error' | 'success'>('error');
  const [replyText, setReplyText] = useState('');
  const [resolveReason, setResolveReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  const hasAnyPermission =
    permissions.accept ||
    permissions.reply ||
    permissions.resolve ||
    permissions.close ||
    permissions.reassign ||
    permissions.reopen;

  async function execute(draft: ActionDraft) {
    let pendingAction = retryPayload;
    if (!pendingAction || pendingAction.action !== draft.action || JSON.stringify(pendingAction.fields) !== JSON.stringify(draft.fields)) {
      pendingAction = {
        ...draft,
        body: { ...draft.fields, revision, requestId: crypto.randomUUID() },
      };
    }

    setRetryPayload(pendingAction);
    setPending(true);
    setNotice('');
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(id)}/${endpoint[pendingAction.action]}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pendingAction.body),
      });
      if (!response.ok) {
        // A 5xx can follow a committed write; preserve the same request ID so
        // the retry remains idempotent. Client errors are definitive rejects.
        const outcomeIsDefinitive = response.status >= 400 && response.status < 500;
        if (outcomeIsDefinitive) setRetryPayload(null);
        setNotice(responseMessage(response.status));
        setNoticeKind('error');
        setPending(false);
        if (response.status === 409) router.refresh();
        return;
      }
      setRetryPayload(null);
      if (pendingAction.action === 'STAFF_REPLY') {
        setReplyText('');
      } else if (pendingAction.action === 'RESOLVE') {
        setResolveReason('');
      } else if (pendingAction.action === 'REOPEN') {
        setReopenReason('');
      }
      setNotice('บันทึกการเปลี่ยนแปลงแล้ว');
      setNoticeKind('success');
      setPending(false);
      router.refresh();
    } catch {
      // Preserve the exact body and request ID so the user can retry safely after a lost response.
      setNotice('การเชื่อมต่อขาดหาย ยังไม่ทราบผลการบันทึก กดลองส่งซ้ำเพื่อใช้คำขอเดิม (ข้อความที่พิมพ์ไว้ยังคงอยู่)');
      setNoticeKind('error');
      setPending(false);
    }
  }

  function submit(action: StaffTicketAction, fields: () => Record<string, string>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void execute({ action, fields: fields() });
    };
  }
  function applyDraft(text:string){
    if(!permissions.reply||pending)return;
    if(replyText.trim()&&!window.confirm('แทนที่ข้อความที่คุณพิมพ์ไว้ด้วยร่างจาก AI?'))return;
    setReplyText(text);setRetryPayload(null);
  }

  return (
    <section className="ticket-action-panel" aria-labelledby="action-heading">
      <div className="ticket-section-heading"><div><h2 id="action-heading">การดำเนินการ</h2></div></div>
      {assistAvailable&&<><StaffAiPanel key={`summary:${id}:${revision}`} id={id} revision={revision} canReply={permissions.reply&&!pending} onDraft={applyDraft}/>
        <StaffKnowledgePanel key={`knowledge:${id}:${revision}`} id={id} revision={revision} canReply={permissions.reply&&!pending} onDraft={applyDraft}/></>}
      {notice && <p className={`ticket-action-notice ticket-action-notice-${noticeKind}`} role="status">{notice}</p>}
      {retryPayload && noticeKind === 'error' && notice.startsWith('การเชื่อมต่อขาดหาย') && <button className="ticket-button ticket-button-secondary" type="button" disabled={pending} onClick={() => void execute(retryPayload)}>ลองส่งซ้ำ</button>}
      {!hasAnyPermission ? (
        <p className="ticket-muted">คุณไม่มีสิทธิ์ในการดำเนินการกับคำขอนี้ หรือเคสนี้อยู่ในสถานะสิ้นสุดการดำเนินการแล้ว</p>
      ) : (
        <div className="ticket-action-grid">
          {permissions.accept && (
            <div className="ticket-takeover-box">
              <div className="ticket-takeover-text">
                <strong>เรื่องนี้รอเจ้าหน้าที่รับเรื่อง</strong>
                <p>กดรับเรื่องเพื่อเริ่มดูแลเคสนี้ด้วยตนเองและเปลี่ยนโหมดเป็นเจ้าหน้าที่ดูแล (HUMAN)</p>
              </div>
              <form onSubmit={submit('ACCEPT', () => ({}))}>
                <button className="ticket-button ticket-button-primary ticket-button-lg" disabled={pending}>
                  {pending ? 'กำลังดำเนินการ…' : 'รับเรื่องนี้'}
                </button>
              </form>
            </div>
          )}
          {permissions.reply && (
            <form className="ticket-action-form ticket-reply-form" onSubmit={submit('STAFF_REPLY', () => ({ text: replyText.trim() }))}>
              <label htmlFor="staff-reply">
                ข้อความตอบกลับ
                <span>ส่งคำตอบอย่างเป็นทางการไปยัง LINE ของผู้แจ้ง</span>
              </label>
              <textarea
                id="staff-reply"
                name="text"
                rows={4}
                maxLength={5000}
                required
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="เขียนคำตอบถึงผู้แจ้ง…"
              />
              <button className="ticket-button ticket-button-primary" disabled={pending || !replyText.trim()}>
                {pending ? 'กำลังส่ง…' : 'ส่งคำตอบ'}
              </button>
            </form>
          )}

          {(permissions.resolve || permissions.close || permissions.reassign || permissions.reopen) && (
            <div className="ticket-secondary-actions">
              <h3 className="ticket-secondary-title">การจัดการสถานะและมอบหมาย</h3>
              {permissions.resolve && (
                <form className="ticket-action-form" onSubmit={submit('RESOLVE', () => { const trimmed = resolveReason.trim(); return trimmed ? { reason: trimmed } : ({} as Record<string, string>); })}>
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
                <form onSubmit={submit('CLOSE', () => ({}))}>
                  <button className="ticket-button ticket-button-secondary" disabled={pending}>ปิดเรื่อง</button>
                </form>
              )}
              {permissions.reassign && (
                <form className="ticket-action-form" onSubmit={(e) => {
                  e.preventDefault();
                  const assigneeId = String(new FormData(e.currentTarget).get('assigneeId') ?? '');
                  if (assigneeId) void execute({ action: 'REASSIGN', fields: { assigneeId } });
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
                <form className="ticket-action-form" onSubmit={submit('REOPEN', () => ({ reason: reopenReason.trim() }))}>
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
            </div>
          )}
        </div>
      )}
      {pending && <p className="ticket-pending" role="status">กำลังบันทึก…</p>}
    </section>
  );
}
