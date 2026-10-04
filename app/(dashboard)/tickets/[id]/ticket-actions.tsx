'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TicketDetail, StaffTicketAction } from '@/types/tickets';

type Props = Pick<TicketDetail, 'permissions' | 'assignees'> & { id: string; revision: number };
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
  return 'ยังดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง';
}

export default function TicketActions({ id, revision, permissions, assignees }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [retryPayload, setRetryPayload] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'error' | 'success'>('error');

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
        setRetryPayload(null);
        setNotice(responseMessage(response.status));
        setNoticeKind('error');
        setPending(false);
        if (response.status === 409) router.refresh();
        return;
      }
      setRetryPayload(null);
      setNotice('บันทึกการเปลี่ยนแปลงแล้ว');
      setNoticeKind('success');
      setPending(false);
      router.refresh();
    } catch {
      // Preserve the exact body and request ID so the user can retry safely after a lost response.
      setNotice('การเชื่อมต่อขาดหาย ยังไม่ทราบผลการบันทึก กดลองส่งซ้ำเพื่อใช้คำขอเดิม');
      setNoticeKind('error');
      setPending(false);
    }
  }

  function submit(action: StaffTicketAction, fields: (form: HTMLFormElement) => Record<string, string>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void execute({ action, fields: fields(event.currentTarget) });
    };
  }

  return (
    <section className="ticket-action-panel" aria-labelledby="action-heading">
      <div className="ticket-section-heading"><div><h2 id="action-heading">การดำเนินการ</h2></div></div>
      {notice && <p className={`ticket-action-notice ticket-action-notice-${noticeKind}`} role="status">{notice}</p>}
      {retryPayload && noticeKind === 'error' && notice.startsWith('การเชื่อมต่อขาดหาย') && <button className="ticket-button ticket-button-secondary" type="button" disabled={pending} onClick={() => void execute(retryPayload)}>ลองส่งซ้ำ</button>}
      <div className="ticket-action-grid">
        {permissions.accept && <form onSubmit={submit('ACCEPT', () => ({}))}><button className="ticket-button ticket-button-primary" disabled={pending}>รับเรื่องนี้</button></form>}
        {permissions.reply && <form className="ticket-action-form ticket-reply-form" onSubmit={submit('STAFF_REPLY', form => ({ text: String(new FormData(form).get('text') ?? '') }))}>
          <label htmlFor="staff-reply">ข้อความตอบกลับ</label><textarea id="staff-reply" name="text" rows={4} maxLength={5000} required placeholder="เขียนคำตอบถึงผู้แจ้ง" />
          <button className="ticket-button ticket-button-primary" disabled={pending}>ส่งคำตอบ</button>
        </form>}
        {permissions.resolve && <form className="ticket-action-form" onSubmit={submit('RESOLVE', form => { const reason = String(new FormData(form).get('reason') ?? '').trim(); const fields: Record<string, string> = {}; if (reason) fields.reason = reason; return fields; })}>
          <label htmlFor="resolve-reason">บันทึกการแก้ไข <span>(ไม่บังคับ)</span></label><input id="resolve-reason" name="reason" maxLength={1000} placeholder="สรุปสิ่งที่ดำเนินการ" />
          <button className="ticket-button ticket-button-secondary" disabled={pending}>ทำเครื่องหมายว่าแก้ไขแล้ว</button>
        </form>}
        {permissions.close && <form onSubmit={submit('CLOSE', () => ({}))}><button className="ticket-button ticket-button-secondary" disabled={pending}>ปิดเรื่อง</button></form>}
        {permissions.reassign && <form className="ticket-action-form" onSubmit={submit('REASSIGN', form => ({ assigneeId: String(new FormData(form).get('assigneeId') ?? '') }))}>
          <label htmlFor="assignee">มอบหมายให้</label><select id="assignee" name="assigneeId" required defaultValue=""><option value="" disabled>เลือกเจ้าหน้าที่</option>{assignees.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select>
          <button className="ticket-button ticket-button-secondary" disabled={pending}>เปลี่ยนผู้รับผิดชอบ</button>
        </form>}
        {permissions.reopen && <form className="ticket-action-form" onSubmit={submit('REOPEN', form => ({ reason: String(new FormData(form).get('reason') ?? '') }))}>
          <label htmlFor="reopen-reason">เหตุผลที่เปิดเรื่องอีกครั้ง</label><textarea id="reopen-reason" name="reason" rows={3} maxLength={1000} required placeholder="ระบุเหตุผล" />
          <button className="ticket-button ticket-button-secondary" disabled={pending}>เปิดเรื่องอีกครั้ง</button>
        </form>}
      </div>
      {pending && <p className="ticket-pending" role="status">กำลังบันทึก…</p>}
    </section>
  );
}
