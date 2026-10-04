import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/staff';
import { getTicketDetail } from '@/lib/tickets/reads';
import type { TicketDetail, TicketListItem } from '@/types/tickets';
import TicketActions from './ticket-actions';
import '@/app/tickets.css';

const statusLabels: Record<TicketListItem['status'], string> = {
  NEW: 'ใหม่', AI_HANDLING: 'ระบบกำลังดูแล', WAITING_STAFF: 'รอเจ้าหน้าที่',
  STAFF_HANDLING: 'เจ้าหน้าที่กำลังดูแล', WAITING_USER: 'รอผู้แจ้ง',
  RESOLVED: 'แก้ไขแล้ว', CLOSED: 'ปิดงาน', CANCELLED: 'ยกเลิก',
};
const actionLabels: Record<string, string> = {
  CREATED: 'รับเรื่องใหม่', ACCEPTED: 'รับดูแลเรื่อง', STAFF_REPLIED: 'ส่งคำตอบ', USER_REPLIED: 'ได้รับข้อความเพิ่มเติม',
  RESOLVED: 'ทำเครื่องหมายว่าแก้ไขแล้ว', CLOSED: 'ปิดเรื่อง', REOPENED: 'เปิดเรื่องอีกครั้ง', REASSIGNED: 'เปลี่ยนผู้รับผิดชอบ',
  ROUTED: 'ส่งต่อให้เจ้าหน้าที่',
};
const senderLabels: Record<TicketDetail['messages'][number]['sender_type'], string> = {
  USER: 'ผู้แจ้ง', AI: 'ระบบ', STAFF: 'เจ้าหน้าที่', SYSTEM: 'บันทึกระบบ',
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value));
}

function statusName(value: string | null): string {
  if (!value) return 'เริ่มต้น';
  return Object.entries(statusLabels).find(([code]) => code === value)?.[1] ?? 'สถานะก่อนหน้า';
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const detail = await getTicketDetail(staff.id, id);
  if (!detail) notFound();

  const { ticket } = detail;
  return (
    <main className="ticket-page ticket-detail-page">
      <Link className="ticket-back-link" href="/tickets">← กลับไปงานรับเรื่อง</Link>
      <header className="ticket-detail-header">
        <div className="ticket-detail-title">
          <h1>{ticket.problem_summary}</h1>
          <p className="ticket-detail-byline">{ticket.ticket_no} · {ticket.category} · ผู้แจ้ง {ticket.anonymous_code} · {ticket.department_name} · รับเรื่องเมื่อ {dateTime(ticket.created_at)}</p>
        </div>
        <div className="ticket-detail-badges">
          <span className={`ticket-mode ticket-mode-${ticket.mode.toLowerCase()}`}>{ticket.mode === 'HUMAN' ? 'เจ้าหน้าที่ดูแล' : 'ระบบดูแล'}</span>
          <span className={`ticket-status ticket-status-${ticket.status.toLowerCase()}`}>{statusLabels[ticket.status]}</span>
        </div>
      </header>

      <div className="ticket-detail-grid">
        <div className="ticket-detail-main">
          <section className="ticket-panel" aria-labelledby="conversation-heading">
            <div className="ticket-section-heading">
              <div><h2 id="conversation-heading">บทสนทนา</h2></div>
              <span className="ticket-message-count">{detail.messages.length} ข้อความ</span>
            </div>
            {detail.messages.length === 0 ? <p className="ticket-muted">ยังไม่มีข้อความในเรื่องนี้</p> : (
              <ol className="ticket-message-list">
                {detail.messages.map(message => (
                  <li className={`ticket-message ticket-message-${message.sender_type.toLowerCase()}`} key={message.id}>
                    <div className="ticket-message-meta"><strong>{message.sender_type === 'STAFF' && message.staff_name ? message.staff_name : senderLabels[message.sender_type]}</strong><time dateTime={message.created_at}>{dateTime(message.created_at)}</time></div>
                    <p>{message.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="ticket-panel" aria-labelledby="history-heading">
            <div className="ticket-section-heading"><div><h2 id="history-heading">ประวัติการดำเนินการ</h2></div></div>
            {detail.history.length === 0 ? <p className="ticket-muted">ยังไม่มีประวัติการดำเนินการ</p> : (
              <ol className="ticket-history-list">
                {detail.history.map(item => (
                  <li key={item.id}>
                    <span className="ticket-history-dot" aria-hidden="true" />
                    <div><strong>{actionLabels[item.action] ?? 'อัปเดตเรื่อง'}</strong>{item.actor_name && <span> โดย {item.actor_name}</span>}
                      {(item.from_status || item.to_status) && <p>{statusName(item.from_status)} → {item.to_status ? statusName(item.to_status) : 'สิ้นสุด'}</p>}
                      {item.reason && <p className="ticket-history-reason">{item.reason}</p>}
                      <time dateTime={item.created_at}>{dateTime(item.created_at)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="ticket-detail-aside">
          <section className="ticket-panel ticket-facts" aria-labelledby="facts-heading">
            <div className="ticket-section-heading"><div><h2 id="facts-heading">รายละเอียดเรื่อง</h2></div></div>
            <dl>
              <div><dt>ความสำคัญ</dt><dd>{ticket.priority === 'CRITICAL' ? 'เร่งด่วน' : ticket.priority === 'HIGH' ? 'สูง' : ticket.priority === 'MEDIUM' ? 'ปกติ' : 'ต่ำ'}</dd></div>
              <div><dt>ระดับข้อมูล</dt><dd>{ticket.sensitive_level === 'GENERAL' ? 'ทั่วไป' : ticket.sensitive_level === 'SENSITIVE' ? 'ละเอียดอ่อน' : 'จำกัดการเข้าถึง'}</dd></div>
              <div><dt>ผู้รับผิดชอบ</dt><dd>{ticket.assignee_name ?? 'ยังไม่มอบหมาย'}</dd></div>
              <div><dt>อัปเดตล่าสุด</dt><dd>{dateTime(ticket.updated_at)}</dd></div>
            </dl>
          </section>
          <TicketActions id={ticket.id} revision={ticket.revision} permissions={detail.permissions} assignees={detail.assignees} />
          {detail.deliveries.length > 0 && <section className="ticket-panel ticket-delivery-panel" aria-labelledby="delivery-heading">
            <h2 id="delivery-heading">สถานะการส่งข้อความ</h2>
            <ul>{detail.deliveries.map((delivery, index) => <li key={`${delivery.created_at}-${index}`}><span>{delivery.status === 'SENT' ? 'ส่งแล้ว' : delivery.status === 'RETRY' ? 'กำลังลองส่งอีกครั้ง' : delivery.status === 'UNKNOWN' ? 'กำลังตรวจสอบผลการส่ง' : 'ยังส่งไม่สำเร็จ'}</span><time dateTime={delivery.created_at}>{dateTime(delivery.created_at)}</time></li>)}</ul>
          </section>}
        </aside>
      </div>
    </main>
  );
}
