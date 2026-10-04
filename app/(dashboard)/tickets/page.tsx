import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { listTickets } from '@/lib/tickets/reads';
import { ticketFiltersSchema, type TicketFilters, type TicketListItem } from '@/types/tickets';
import '@/app/tickets.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const statusLabels: Record<TicketListItem['status'], string> = {
  NEW: 'ใหม่', AI_HANDLING: 'ระบบกำลังดูแล', WAITING_STAFF: 'รอเจ้าหน้าที่',
  STAFF_HANDLING: 'เจ้าหน้าที่กำลังดูแล', WAITING_USER: 'รอผู้แจ้ง',
  RESOLVED: 'แก้ไขแล้ว', CLOSED: 'ปิดงาน', CANCELLED: 'ยกเลิก',
};
const priorityLabels: Record<TicketListItem['priority'], string> = {
  LOW: 'ต่ำ', MEDIUM: 'ปกติ', HIGH: 'สูง', CRITICAL: 'เร่งด่วน',
};

export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const candidate = {
    department: queryValue(params.department), status: queryValue(params.status),
    priority: queryValue(params.priority), assignee: queryValue(params.assignee),
    from: queryValue(params.from), to: queryValue(params.to), sensitivity: queryValue(params.sensitivity),
  };
  const parsed = ticketFiltersSchema.safeParse(Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)));
  const filters: TicketFilters = parsed.success ? parsed.data : {};
  const staff = await requireStaff();
  const result = await listTickets(staff.id, filters);

  return (
    <main className="ticket-page">
      <div className="ticket-page-heading">
        <div>
          <h1>งานรับเรื่อง</h1>
          <p>ติดตามและดูแลเรื่องที่อยู่ในขอบเขตงานของคุณ</p>
        </div>
        <span className="ticket-count">{result.tickets.length} เรื่อง</span>
      </div>

      {!parsed.success && <p className="ticket-notice" role="status">ตัวกรองบางรายการไม่ถูกต้อง จึงแสดงรายการทั้งหมดที่คุณมีสิทธิ์ดู</p>}

      <form className="ticket-filters" method="get" aria-label="กรองรายการงาน">
        <label>หน่วยงาน
          <select name="department" defaultValue={filters.department ?? ''}>
            <option value="">ทุกหน่วยงาน</option>
            {result.departments.map(department => <option value={department.id} key={department.id}>{department.name_th}</option>)}
          </select>
        </label>
        <label>สถานะ
          <select name="status" defaultValue={filters.status ?? ''}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>ความสำคัญ
          <select name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">ทุกระดับ</option>
            {Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>ผู้รับผิดชอบ
          <select name="assignee" defaultValue={filters.assignee ?? ''}>
            <option value="">ทุกคน</option>
            {result.assignees.map(person => <option value={person.id} key={person.id}>{person.display_name}</option>)}
          </select>
        </label>
        <label>ตั้งแต่วันที่<input type="date" name="from" defaultValue={filters.from ?? ''} /></label>
        <label>ถึงวันที่<input type="date" name="to" defaultValue={filters.to ?? ''} /></label>
        <label>ระดับข้อมูล
          <select name="sensitivity" defaultValue={filters.sensitivity ?? ''}>
            <option value="">ทุกระดับที่ดูได้</option>
            <option value="GENERAL">ทั่วไป</option>
            <option value="SENSITIVE">ละเอียดอ่อน</option>
            <option value="RESTRICTED">จำกัดการเข้าถึง</option>
          </select>
        </label>
        <div className="ticket-filter-buttons">
          <button className="ticket-button ticket-button-primary" type="submit">ใช้ตัวกรอง</button>
          <Link className="ticket-reset" href="/tickets">ล้างตัวกรอง</Link>
        </div>
      </form>

      {result.tickets.length === 0 ? (
        <section className="ticket-empty" aria-labelledby="empty-title">
          <p className="ticket-empty-mark" aria-hidden="true">—</p>
          <h2 id="empty-title">ยังไม่มีรายการตรงกับตัวกรอง</h2>
          <p>ลองเปลี่ยนเงื่อนไข หรือกลับมาดูอีกครั้งเมื่อมีเรื่องใหม่เข้ามา</p>
          <Link className="ticket-button ticket-button-secondary" href="/tickets">ดูรายการทั้งหมด</Link>
        </section>
      ) : (
        <section className="ticket-table-wrap" aria-label="รายการงานรับเรื่อง">
          <table className="ticket-table">
            <thead><tr><th scope="col">เรื่อง</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะ</th><th scope="col">ความสำคัญ</th><th scope="col">ผู้รับผิดชอบ</th><th scope="col">อัปเดตล่าสุด</th></tr></thead>
            <tbody>{result.tickets.map(ticket => (
              <tr key={ticket.id}>
                <td data-label="เรื่อง">
                  <Link className="ticket-subject" href={`/tickets/${ticket.id}`}>{ticket.problem_summary}</Link>
                  <span className="ticket-meta">{ticket.ticket_no} · {ticket.category} · ผู้แจ้ง {ticket.anonymous_code}</span>
                  <span className={`ticket-mode ticket-mode-${ticket.mode.toLowerCase()}`}>{ticket.mode === 'HUMAN' ? 'เจ้าหน้าที่ดูแล' : 'ระบบดูแล'}</span>
                </td>
                <td data-label="หน่วยงาน">{ticket.department_name}</td>
                <td data-label="สถานะ"><span className={`ticket-status ticket-status-${ticket.status.toLowerCase()}`}>{statusLabels[ticket.status]}</span></td>
                <td data-label="ความสำคัญ">{priorityLabels[ticket.priority]}</td>
                <td data-label="ผู้รับผิดชอบ">{ticket.assignee_name ?? 'ยังไม่มอบหมาย'}</td>
                <td data-label="อัปเดตล่าสุด">{formatDate(ticket.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </main>
  );
}
