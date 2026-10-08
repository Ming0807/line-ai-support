import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { listTickets } from '@/lib/tickets/reads';
import type { TicketListItem } from '@/types/tickets';
import {
  buildPageUrl,
  buildTicketServiceFilters,
  parseCanonicalTicketQuery,
  readTicketPagination,
} from './ticket-helpers';
import '@/app/tickets.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

function FilterForm({
  canonical,
  departments,
  assignees,
}: {
  canonical: ReturnType<typeof parseCanonicalTicketQuery>;
  departments: { id: string; name_th: string }[];
  assignees: { id: string; display_name: string }[];
}) {
  return (
    <form className="ticket-filters" method="get" aria-label="กรองรายการงาน">
      <label>คำค้นหา
        <input type="search" name="q" defaultValue={canonical.q ?? ''} placeholder="ค้นหาเรื่อง รหัส ผู้แจ้ง..." />
      </label>
      <label>หน่วยงาน
        <select name="department" defaultValue={canonical.department ?? ''}>
          <option value="">ทุกหน่วยงาน</option>
          {departments.map(department => <option value={department.id} key={department.id}>{department.name_th}</option>)}
        </select>
      </label>
      <label>สถานะ
        <select name="status" defaultValue={canonical.status ?? ''}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label>ความสำคัญ
        <select name="priority" defaultValue={canonical.priority ?? ''}>
          <option value="">ทุกระดับ</option>
          {Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label>ผู้รับผิดชอบ
        <select name="assignee" defaultValue={canonical.assignee ?? ''}>
          <option value="">ทุกคน</option>
          {assignees.map(person => <option value={person.id} key={person.id}>{person.display_name}</option>)}
        </select>
      </label>
      <label>ตั้งแต่วันที่<input type="date" name="from" defaultValue={canonical.from ?? ''} /></label>
      <label>ถึงวันที่<input type="date" name="to" defaultValue={canonical.to ?? ''} /></label>
      <label>ระดับข้อมูล
        <select name="sensitivity" defaultValue={canonical.sensitivity ?? ''}>
          <option value="">ทุกระดับที่ดูได้</option>
          <option value="GENERAL">ทั่วไป</option>
          <option value="SENSITIVE">ละเอียดอ่อน</option>
          <option value="RESTRICTED">จำกัดการเข้าถึง</option>
        </select>
      </label>
      <label>จำนวนต่อหน้า
        <select name="pageSize" defaultValue={String(canonical.pageSize ?? 100)}>
          {![10,25,50,100].includes(canonical.pageSize) && <option value={canonical.pageSize}>{canonical.pageSize} ต่อหน้า</option>}
          <option value="10">10 ต่อหน้า</option>
          <option value="25">25 ต่อหน้า</option>
          <option value="50">50 ต่อหน้า</option>
          <option value="100">100 ต่อหน้า</option>
        </select>
      </label>
      <div className="ticket-filter-buttons">
        <button className="ticket-button ticket-button-primary" type="submit">ใช้ตัวกรอง</button>
        <Link className="ticket-reset" href={buildPageUrl({pageSize:String(canonical.pageSize)},1)}>ล้างตัวกรอง</Link>
      </div>
    </form>
  );
}

export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const canonical = parseCanonicalTicketQuery(params);

  if (canonical.validationError) {
    return (
      <main className="ticket-page">
        <div className="ticket-page-heading">
          <div>
            <h1>งานรับเรื่อง</h1>
            <p>ติดตามและดูแลเรื่องที่อยู่ในขอบเขตงานของคุณ</p>
          </div>
          <span className="ticket-count">ไม่ระบุจำนวนรวม (รอการเชื่อมต่อ API แบ่งหน้า)</span>
        </div>
        <nav className="activity-tabs-header" style={{ marginBottom: '1.25rem' }} aria-label="หมวดหมู่งานรับเรื่อง">
          <div className="activity-tabs-group">
            <span className="activity-tab is-active" aria-current="page">
              คำร้องทั้งหมด (Tickets)
            </span>
            <Link href="/incidents" className="activity-tab">
              ปัญหาเชิงระบบ (Incidents)
            </Link>
          </div>
        </nav>
        <p className="ticket-notice ticket-notice-error" role="alert" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          {canonical.validationError} · <Link href="/tickets">ล้างตัวกรองทั้งหมด</Link>
        </p>
        <FilterForm canonical={canonical} departments={[]} assignees={[]} />
        <section className="ticket-empty" aria-labelledby="empty-title">
          <p className="ticket-empty-mark" aria-hidden="true">—</p>
          <h2 id="empty-title">ตัวกรองไม่ถูกต้อง</h2>
          <p>โปรดตรวจสอบค่าที่กรอกแล้วลองอีกครั้ง หรือล้างตัวกรองทั้งหมดเพื่อดูรายการทั้งหมด</p>
          <Link className="ticket-button ticket-button-secondary" href="/tickets">ล้างตัวกรองทั้งหมด</Link>
        </section>
      </main>
    );
  }

  const serviceFilters = buildTicketServiceFilters(canonical);
  const staff = await requireStaff();
  const result = await listTickets(staff.id, serviceFilters);

  // Use server pagination if available from Root contract; otherwise mark as unobserved.
  // Missing pagination is unknown: never fabricate a total from array length.
  const serverPagination = readTicketPagination(result.pagination,canonical,result.tickets.length);
  const displayedTickets = result.tickets;

  const totalLabel = serverPagination
    ? `${serverPagination.total} เรื่อง`
    : 'ไม่ระบุจำนวนรวม (รอการเชื่อมต่อ API แบ่งหน้า)';

  const searchScopeLabel = canonical.q
    ? serverPagination
      ? `คำค้นหา \u201C${canonical.q}\u201D (พบ ${serverPagination.total} รายการที่ตรงเงื่อนไข)`
      : `คำค้นหา \u201C${canonical.q}\u201D (ยังไม่ทราบจำนวนรวม)`
    : null;

  const isZeroMatch = serverPagination !== null && serverPagination.total === 0;
  const isOutOfRange =
    serverPagination !== null &&
    serverPagination.total > 0 &&
    serverPagination.page > serverPagination.totalPages;
  const lastPage = serverPagination ? serverPagination.totalPages : 1;
  const rangeStart =
    serverPagination === null || displayedTickets.length === 0
      ? 0
      : (serverPagination.page - 1) * serverPagination.pageSize + 1;
  const rangeEnd =
    displayedTickets.length === 0 ? 0 : serverPagination === null
      ? displayedTickets.length
      : (serverPagination.page - 1) * serverPagination.pageSize + displayedTickets.length;

  return (
    <main className="ticket-page">
      <div className="ticket-page-heading">
        <div>
          <h1>งานรับเรื่อง</h1>
          <p>ติดตามและดูแลเรื่องที่อยู่ในขอบเขตงานของคุณ</p>
        </div>
        <span className="ticket-count">{totalLabel}</span>
      </div>

      {/* Sub-Navigation */}
      <nav className="activity-tabs-header" style={{ marginBottom: '1.25rem' }} aria-label="หมวดหมู่งานรับเรื่อง">
        <div className="activity-tabs-group">
          <span className="activity-tab is-active" aria-current="page">
            คำร้องทั้งหมด (Tickets)
          </span>
          <Link href="/incidents" className="activity-tab">
            ปัญหาเชิงระบบ (Incidents)
          </Link>
        </div>
      </nav>

      {searchScopeLabel && (
        <p className="ticket-notice" role="status">
          {searchScopeLabel}
        </p>
      )}

      <FilterForm canonical={canonical} departments={result.departments} assignees={result.assignees} />

      {isZeroMatch ? (
        <section className="ticket-empty" aria-labelledby="empty-title">
          <p className="ticket-empty-mark" aria-hidden="true">—</p>
          <h2 id="empty-title">
            {canonical.q ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : 'ยังไม่มีรายการตรงกับตัวกรอง'}
          </h2>
          <p>
            {canonical.q
              ? `ไม่พบคำว่า "${canonical.q}" ที่ตรงเงื่อนไข ลองเปลี่ยนคำค้นหรือล้างตัวกรอง`
              : 'ลองเปลี่ยนเงื่อนไข หรือกลับมาดูอีกครั้งเมื่อมีเรื่องใหม่เข้ามา'}
          </p>
          <Link className="ticket-button ticket-button-secondary" href="/tickets">ดูรายการทั้งหมด</Link>
        </section>
      ) : isOutOfRange && serverPagination ? (
        <section className="ticket-empty" aria-labelledby="out-of-range-title">
          <p className="ticket-empty-mark" aria-hidden="true">—</p>
          <h2 id="out-of-range-title">หน้านี้ไม่มีรายการ (หน้าที่ {serverPagination.page} จาก {serverPagination.totalPages})</h2>
          <p>
            มีทั้งหมด {serverPagination.total} รายการที่ตรงเงื่อนไข แต่หน้านี้อยู่เกินขอบเขต โปรดกลับไปหน้าที่มีข้อมูล
          </p>
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link className="ticket-button ticket-button-secondary" href={buildPageUrl(params, 1)}>กลับหน้าแรก</Link>
            <Link className="ticket-button ticket-button-primary" href={buildPageUrl(params, Math.max(1, lastPage))}>
              ไปหน้าสุดท้าย ({Math.max(1, lastPage)})
            </Link>
          </div>
        </section>
      ) : displayedTickets.length === 0 && serverPagination === null ? (
        <section className="ticket-empty" aria-labelledby="empty-title">
          <p className="ticket-empty-mark" aria-hidden="true">—</p>
          <h2 id="empty-title">ยังไม่ทราบผลการค้นหา</h2>
          <p>ข้อมูลจำนวนรวมและการแบ่งหน้ายังไม่พร้อม โปรดลองโหลดรายการอีกครั้ง</p>
          <Link className="ticket-button ticket-button-secondary" href={buildPageUrl(params,canonical.page)}>ลองอีกครั้ง</Link>
        </section>
      ) : (
        <section className="ticket-table-wrap" aria-label="รายการงานรับเรื่อง">
          <table className="ticket-table">
            <thead><tr><th scope="col">เรื่อง</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะ</th><th scope="col">ความสำคัญ</th><th scope="col">ผู้รับผิดชอบ</th><th scope="col">อัปเดตล่าสุด</th></tr></thead>
            <tbody>{displayedTickets.map(ticket => (
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

      {/* Pagination Bar */}
      {serverPagination ? (
        <nav className="ticket-pagination-bar" aria-label="การแบ่งหน้ารายการตั๋ว">
          <div className="ticket-pagination-info" role="status">
            แสดง <strong>{rangeStart} - {rangeEnd}</strong> จากทั้งหมด <strong>{serverPagination.total}</strong> รายการ
          </div>
          <div className="ticket-pagination-controls">
            {serverPagination.hasPrevious ? (
              <Link
                className="ticket-page-nav-btn"
                href={buildPageUrl(params, serverPagination.page - 1)}
                aria-label="ไปยังหน้าก่อนหน้า"
              >
                « ก่อนหน้า
              </Link>
            ) : (
              <span className="ticket-page-nav-btn is-disabled" aria-disabled="true">
                « ก่อนหน้า
              </span>
            )}
            <span className="ticket-page-indicator" aria-current="page">
              หน้า {serverPagination.page} จาก {serverPagination.totalPages}
            </span>
            {serverPagination.hasNext ? (
              <Link
                className="ticket-page-nav-btn"
                href={buildPageUrl(params, serverPagination.page + 1)}
                aria-label="ไปยังหน้าถัดไป"
              >
                ถัดไป »
              </Link>
            ) : (
              <span className="ticket-page-nav-btn is-disabled" aria-disabled="true">
                ถัดไป »
              </span>
            )}
          </div>
        </nav>
      ) : (
        <div style={{ textAlign: 'center', margin: '1rem 0', fontSize: '.84rem', color: 'var(--text-muted)' }} role="status">
          ระบบแสดงผลคำร้องตามสิทธิ์การเข้าถึงของหน่วยงาน (ระบบแบ่งหน้าข้อมูลกำลังอยู่ระหว่างเชื่อมต่อกับฐานข้อมูลเซิร์ฟเวอร์)
        </div>
      )}
    </main>
  );
}
