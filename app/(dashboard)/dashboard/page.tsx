import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { listTickets } from '@/lib/tickets/reads';
import { listImportJobs, type ImportJobView } from '@/lib/imports/import-staging';
import { listProviders } from '@/lib/ai/provider-admin';
import { getEmbeddingStatus } from '@/lib/knowledge/embedding-status';
import { parseMetricQuery } from '@/lib/operations/metrics-contracts';
import { readOperationsSummary, readOperationsDepartments } from '@/lib/operations/metrics';
import { DateFilter, queryFromSearchParams, ReadState, formatCount, type SearchParams } from '../operations-views/view';
import type { TicketListResult } from '@/types/tickets';
import type { ProviderView } from '@/types/providers';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
  ADMIN: 'ผู้ดูแลระบบ',
  SUPERVISOR: 'หัวหน้างาน',
  STAFF: 'เจ้าหน้าที่บริการ',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

// Visual color themes for row avatars matching reference photo
const avatarThemes = [
  { bg: '#fef3c7', text: '#b45309', icon: 'A' },
  { bg: '#fee2e2', text: '#b91c1c', icon: 'B' },
  { bg: '#e0e7ff', text: '#4338ca', icon: 'C' },
  { bg: '#ffedd5', text: '#c2410c', icon: 'D' },
  { bg: '#f1f5f9', text: '#334155', icon: 'E' },
];

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams ?? {};
  let filters: ReturnType<typeof parseMetricQuery> | null = null;
  let metricsInvalid = false;
  let metricsError = false;
  try { filters = parseMetricQuery(queryFromSearchParams(params)); } catch { metricsInvalid = true; }

  let summary: Awaited<ReturnType<typeof readOperationsSummary>> | null = null;
  let departments: Awaited<ReturnType<typeof readOperationsDepartments>>['items'] = [];
  if (filters) {
    try { summary = await readOperationsSummary(staff.id, filters); } catch { metricsError = true; }
    try { departments = (await readOperationsDepartments(staff.id)).items; } catch { /* date and department filtering remains optional */ }
  }

  let ticketResult: TicketListResult = { tickets: [], departments: [], assignees: [] };
  let ticketError = false;
  try {
    ticketResult = await listTickets(staff.id);
  } catch {
    ticketError = true;
  }

  const { tickets } = ticketResult;

  // Real operational subsets
  const myAssignedTickets = tickets.filter(t => t.assigned_staff_id === staff.id && t.status !== 'RESOLVED' && t.status !== 'CLOSED' && t.status !== 'CANCELLED');
  const activeTickets = tickets.filter(t => t.status !== 'RESOLVED' && t.status !== 'CLOSED' && t.status !== 'CANCELLED');

  // Priority queue: items that need staff intervention first
  const actionableTickets = tickets
    .filter(t => t.status === 'WAITING_STAFF' || t.status === 'STAFF_HANDLING' || t.priority === 'CRITICAL' || t.status === 'NEW')
    .slice(0, 6);

  let importJobs: ImportJobView[] = [];
  let importJobsError = false;
  let providers: ProviderView[] = [];
  let providersError = false;
  let embeddingStatus: Awaited<ReturnType<typeof getEmbeddingStatus>> | null = null;
  let embeddingChecked = false;

  if (staff.role === 'SUPER_ADMIN') {
    try {
      importJobs = await listImportJobs(staff.id);
    } catch {
      importJobsError = true;
    }

    try {
      providers = await listProviders(staff.id);
    } catch {
      providersError = true;
    }

    try {
      embeddingStatus = await getEmbeddingStatus(staff.id);
      embeddingChecked = true;
    } catch {
      embeddingChecked = false;
    }
  }

  // Ticket-assignment cards describe only the currently returned ticket page.
  const totalActive = activeTickets.length;
  const myCount = myAssignedTickets.length;
  const otherCount = Math.max(0, totalActive - myCount);

  const circumference = 239; // 2 * pi * 38
  const myPct = totalActive > 0 ? Math.round((myCount / totalActive) * 100) : 0;
  const otherPct = totalActive > 0 ? Math.round((otherCount / totalActive) * 100) : 0;

  const myStrokeDash = totalActive > 0 ? (myCount / totalActive) * circumference : 0;
  const otherStrokeDash = totalActive > 0 ? (otherCount / totalActive) * circumference : 0;

  // AI model counts for SUPER_ADMIN
  const allModels = providers.flatMap(p => p.models);
  const enabledModels = allModels.filter(m => m.enabled);

  // Import jobs (Staging intake)
  const readyImportJobs = importJobs.filter(j => j.status === 'READY');
  const failedImportJobs = importJobs.filter(j => j.status === 'FAILED');

  return (
    <div className="dashboard-container">
      {/* Top Action Bar */}
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-left">
          <h1 className="dashboard-page-title">ภาพรวมระบบ (Overview)</h1>
          <div className="dashboard-scope-pill" title={`สิทธิ์การใช้งาน: ${roleLabels[staff.role] ?? staff.role}`}>
            <span className="scope-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4" /></svg></span>
            <span>{roleLabels[staff.role] ?? staff.role} · ข้อมูลตามสิทธิ์ที่ได้รับ</span>
          </div>
        </div>

        <div className="dashboard-topbar-right">
          {/* Functional Search Form */}
          <form action="/tickets" method="GET" className="dashboard-search-wrap">
            <span className="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg></span>
            <input
              type="text"
              name="q"
              className="dashboard-search-input"
              placeholder="ค้นหาในรายการตั๋วงานล่าสุด..."
              aria-label="ค้นหาข้อมูลในรายการตั๋วงานที่โหลดมา"
            />
          </form>

          {/* Action Button */}
          {staff.role === 'SUPER_ADMIN' ? (
            <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/knowledge/import">
              + นำเข้าเอกสาร
            </Link>
          ) : (
            <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/tickets">
              จัดการคิวงาน
            </Link>
          )}

          {/* Clickable Notification Bell with Badge */}
          <Link
            href="/tickets?status=WAITING_STAFF"
            className="dashboard-icon-badge-wrap"
            title={metricsError || metricsInvalid || !summary ? 'ไม่สามารถอ่านจำนวนงานรอเจ้าหน้าที่ได้' : `ตามสิทธิ์ของคุณ มีงานรอเจ้าหน้าที่ ${summary.counts.waitingStaff} เรื่อง`}
            aria-label={metricsError || metricsInvalid || !summary ? 'ไม่สามารถอ่านจำนวนงานรอเจ้าหน้าที่ได้' : `ตามสิทธิ์ของคุณ มีงานรอเจ้าหน้าที่ ${summary.counts.waitingStaff} เรื่อง`}
          >
            <span className="dashboard-icon-btn" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            {!metricsError && !metricsInvalid && summary && summary.counts.waitingStaff > 0 && (
              <span className="dashboard-badge-counter">{summary.counts.waitingStaff}</span>
            )}
          </Link>
        </div>
      </header>

      {ticketError && <p className="dashboard-alert dashboard-alert-warning" role="alert">ไม่สามารถอ่านรายการงานในหน้าปัจจุบันได้ รายการจึงไม่แสดง</p>}
      <DateFilter action="/dashboard" from={filters?.from ?? ''} to={filters?.to ?? ''} departments={departments} department={filters?.department} />
      <ReadState error={metricsError} invalid={metricsInvalid} />
      {summary && <p className="operations-muted">ยอดรวมตามขอบเขตสิทธิ์: {formatCount(summary.counts.total)} เรื่อง · ตัวเลขยอดรวมเป็นข้อมูลปัจจุบัน ส่วนกราฟรับเรื่องใช้ช่วง {summary.window.from} – {summary.window.to} (Asia/Bangkok)</p>}

      {/* Main Grid: Left Stats & Right Analytics */}
      <div className="dashboard-main-grid">
        {/* Left Column: Top 2 Cards + Activity Queue */}
        <div className="dashboard-grid-left">
          {/* Top 2 Metric Cards */}
          <div className="dashboard-hero-row">
            {/* Card 1: Sunset Coral Hero Card */}
            <div className="dashboard-hero-card">
              <div className="hero-card-head">
                <span className="hero-card-label">รอเจ้าหน้าที่ดูแล</span>
                <span className="hero-card-dots" aria-hidden="true">•••</span>
              </div>

              <div className="hero-card-val-row">
                <span className="hero-card-value">{metricsError || metricsInvalid || !summary ? 'ไม่ทราบ' : `${formatCount(summary.counts.waitingStaff)} เรื่อง`}</span>
              </div>

              {/* Decorative SVG Wave Lines */}
              <div className="hero-wave-container" aria-hidden="true">
                <svg className="hero-wave-svg" viewBox="0 0 300 55" fill="none" preserveAspectRatio="none">
                  <path d="M0 35 C 50 15, 100 45, 150 25 C 200 5, 250 40, 300 20" stroke="rgba(255, 255, 255, 0.45)" strokeWidth="3" />
                  <path d="M0 45 C 60 25, 110 50, 160 30 C 210 10, 260 45, 300 35" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="2.5" />
                  <path d="M0 25 C 70 45, 120 20, 180 40 C 230 55, 270 20, 300 30" stroke="#fbcfe8" strokeWidth="2" strokeDasharray="3 3" />
                </svg>
              </div>

              {/* Sub-breakdown Columns */}
              <div className="hero-card-breakdown">
                <div className="hero-subcol">
                  <span className="hero-subcol-label">เรื่องเร่งด่วน</span>
                  <strong className="hero-subcol-val">{metricsError || metricsInvalid || !summary ? '—' : formatCount(summary.counts.critical)}</strong>
                </div>
                <div className="hero-subcol">
                  <span className="hero-subcol-label">เรื่องของฉันในหน้านี้</span>
                  <strong className="hero-subcol-val">{ticketError ? '—' : myAssignedTickets.length}</strong>
                </div>
                <div className="hero-subcol">
                  <span className="hero-subcol-label">งานที่ยังเปิดทั้งหมด</span>
                  <strong className="hero-subcol-val">{metricsError || metricsInvalid || !summary ? '—' : formatCount(summary.counts.open)}</strong>
                </div>
              </div>

              <Link className="hero-card-overlay-link" href="/tickets?status=WAITING_STAFF" aria-label="เปิดเรื่องรอเจ้าหน้าที่">
                เปิดเรื่องรอเจ้าหน้าที่ →
              </Link>
            </div>

            {/* Card 2: White Card with Truthful Donut Chart */}
            <div className="dashboard-white-card dashboard-donut-card">
              <div className="donut-card-left">
                <div className="white-card-head">
                  <span className="white-card-label">งานที่ฉันรับผิดชอบ (เฉพาะรายการหน้านี้)</span>
                  <span className="white-card-dots" aria-hidden="true">•••</span>
                </div>
                <div className="white-card-value">{ticketError ? 'ไม่ทราบ' : `${myAssignedTickets.length} เรื่อง`}</div>

                <div className="donut-legend">
                  <div className="legend-item">
                    <span className="legend-dot legend-dot-coral" />
                    <span className="legend-text">ของฉัน</span>
                    <strong className="legend-pct">
                      {ticketError ? '—' : totalActive > 0 ? `${myPct}%` : '0%'}
                    </strong>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot legend-dot-yellow" />
                  <span className="legend-text">รายการงานอื่นในหน้านี้</span>
                    <strong className="legend-pct">
                      {ticketError ? '—' : totalActive > 0 ? `${otherPct}%` : '0%'}
                    </strong>
                  </div>
                </div>

                <Link className="white-card-link" href={`/tickets?assignee=${staff.id}`}>
                  ดูงานของฉัน →
                </Link>
              </div>

              {/* Data-backed Donut Chart SVG */}
              <div className="donut-card-right" aria-hidden="true">
                <svg width="115" height="115" viewBox="0 0 100 100" className="donut-chart-svg">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                  {totalActive > 0 && myStrokeDash > 0 && (
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      fill="none"
                      stroke="#ff4b72"
                      strokeWidth="12"
                      strokeDasharray={`${myStrokeDash} ${circumference}`}
                      strokeDashoffset="0"
                      strokeLinecap="round"
                    />
                  )}
                  {totalActive > 0 && otherStrokeDash > 0 && (
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="12"
                      strokeDasharray={`${otherStrokeDash} ${circumference}`}
                      strokeDashoffset={`-${myStrokeDash}`}
                      strokeLinecap="round"
                    />
                  )}
                  <g transform="translate(50, 50)">
                    <rect x="-8" y="-3" width="16" height="6" rx="3" fill="#ff7a59" />
                    <rect x="-3" y="-8" width="6" height="16" rx="3" fill="#ff7a59" />
                  </g>
                </svg>
              </div>
            </div>
          </div>

          {/* Activity Feed Section */}
          <div className="dashboard-activity-section">
            <nav className="activity-tabs-header" aria-label="เมนูงานและสถิติ">
              <div className="activity-tabs-group">
                <span className="activity-tab is-active" aria-current="page">
                  งานที่ต้องดำเนินการล่าสุด
                </span>
                <Link href="/analytics" className="activity-tab">
                  สถิติและแนวโน้ม (Analytics)
                </Link>
                <Link href="/tickets" className="activity-tab">
                  ประวัติงานทั้งหมด ({ticketError ? 'ไม่ทราบจำนวน' : `${tickets.length} รายการในหน้าปัจจุบัน`})
                </Link>
              </div>
            </nav>

            {ticketError ? (
              <div className="dashboard-empty-panel" role="status">
                <h3>ยังอ่านคิวงานไม่ได้</h3>
                <p>จำนวนงานและสถานะว่างจะทราบได้เมื่อเชื่อมต่อข้อมูลสำเร็จ</p>
                <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/tickets">เปิดรายการงาน</Link>
              </div>
            ) : actionableTickets.length === 0 ? (
              <div className="dashboard-empty-panel">
                <p className="dashboard-empty-icon" aria-hidden="true">✓</p>
                <h3>ไม่มีเรื่องค้างที่ต้องดำเนินการในขณะนี้</h3>
                <p>ทุกเรื่องในขอบเขตของคุณได้รับการตอบกลับหรือปิดงานเรียบร้อยแล้ว</p>
                <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/tickets">
                  ตรวจสอบประวัติงานทั้งหมด
                </Link>
              </div>
            ) : (
              <div className="activity-row-list" role="list">
                {actionableTickets.map((ticket, idx) => {
                  const theme = avatarThemes[idx % avatarThemes.length];
                  return (
                    <div key={ticket.id} className="activity-row-item">
                      {/* Avatar Thumbnail */}
                      <div className="activity-avatar" style={{ background: theme.bg, color: theme.text }} aria-hidden="true">
                        <span>{theme.icon}</span>
                      </div>

                      {/* Main Info */}
                      <div className="activity-info">
                        <Link className="activity-title" href={`/tickets/${ticket.id}`}>
                          {ticket.problem_summary}
                          <span className="activity-ext-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17 17 7M8 7h9v9" /></svg></span>
                        </Link>
                        <span className="activity-subtext">
                          {ticket.ticket_no} · อัปเดต {formatDate(ticket.updated_at)}
                        </span>
                      </div>

                      {/* Department Tag */}
                      <div className="activity-dept">
                        <span className="activity-dept-pill">{ticket.department_name}</span>
                      </div>

                      {/* Assignee / User Pill */}
                      <div className="activity-assignee">
                        <span className="activity-icon-pill" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span>
                        <span>{ticket.anonymous_code}</span>
                      </div>

                      {/* Priority / Trend Badge */}
                      <div className="activity-priority">
                        <span className={`activity-trend-tag tag-${ticket.priority.toLowerCase()}`}>
                          {ticket.priority === 'CRITICAL' ? '↑ ด่วน' : ticket.priority === 'HIGH' ? '↑ สูง' : 'ปกติ'}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="activity-actions">
                        <Link className="activity-dots-btn" href={`/tickets/${ticket.id}`} title="ดูรายละเอียด" aria-label="ดูรายละเอียด">
                          •••
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Stacked Metric Cards */}
        <div className="dashboard-grid-right">
          {/* Aggregate urgent count from the scoped metric read. */}
          <div className="dashboard-white-card dashboard-kpi-pill-card">
            <div className="pill-card-head">
              <span className="pill-card-big-num">{metricsError || metricsInvalid || !summary ? '—' : formatCount(summary.counts.critical)}</span>
              <span className="pill-card-label">
                {metricsError || metricsInvalid || !summary ? 'ไม่ทราบจำนวนงานเร่งด่วน' : `เรื่องเร่งด่วนจาก ${formatCount(summary.counts.open)} งานที่ยังเปิด`}
              </span>
            </div>
            <div className="pill-card-track" aria-hidden="true">
              <div
                className="pill-card-fill fill-coral"
                style={{
                  width: `${summary && summary.counts.open > 0 ? Math.round((summary.counts.critical / summary.counts.open) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Accepted scoped daily intake distribution. */}
          <div className="dashboard-white-card dashboard-poststats-card">
            <div className="white-card-head">
              <div>
                <span className="white-card-label">รับเรื่องรายวัน (Asia/Bangkok)</span>
                <small style={{ display: 'block', color: '#70757d', fontSize: '0.75rem', marginTop: '0.15rem' }}>
                  เฉพาะช่วงวันที่เลือก · รวมทุกหน้าตามสิทธิ์
                </small>
              </div>
              <span className="white-card-dots" aria-hidden="true">•••</span>
            </div>

            {metricsError || metricsInvalid || !summary ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#70757d', fontSize: '0.85rem' }} role="status"><p style={{ margin: 0 }}>อ่านสรุปการรับเรื่องไม่ได้</p></div>
            ) : summary.intake.every(item => item.count === 0) ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#70757d', fontSize: '0.85rem' }}>
                <p style={{ margin: 0 }}>ไม่มีคำร้องใหม่ในช่วงวันที่เลือก</p>
              </div>
            ) : (
              <>
                <div className="mini-barchart dashboard-intake-chart" role="group" tabIndex={0} aria-label={`จำนวนรับเรื่อง: ${summary.intake.map(d => `${d.date} ${d.count} เรื่อง`).join(', ')}`}>
                  {summary.intake.map(day => {
                    const count = day.count;
                    const maxDayCount = Math.max(...summary.intake.map(item => item.count), 1);
                    const pct = count > 0 ? Math.max(15, Math.round((count / maxDayCount) * 100)) : 8;
                    return (
                      <div key={day.date} className="mini-bar-col" title={`${day.date}: ${count} เรื่อง`}>
                        <div
                          className="mini-bar-fill"
                          style={{ height: `${pct}%` }}
                        />
                        <span>{day.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
                <table className="sr-only" aria-label="ข้อมูลรับเรื่องแยกตามวันที่">
                  <thead>
                    <tr><th>วันที่</th><th>จำนวนเรื่อง</th></tr>
                  </thead>
                  <tbody>
                    {summary.intake.map(d => (
                      <tr key={d.date}><td>{d.date}</td><td>{formatCount(d.count)} เรื่อง</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Bottom KPI */}
            <div className="poststats-bottom">
              <div className="poststats-icon-wrap" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-3" /><rect x="8" y="2" width="8" height="5" rx="1" /><path d="M7 11h10M7 15h10" /></svg>
              </div>
              <div className="poststats-info">
                <strong>รายการที่แสดงในระบบ</strong>
                    <small>{ticketError ? 'ไม่สามารถอ่านรายการได้' : `รายการในหน้าปัจจุบัน · ${tickets.length} แสดงจาก ${ticketResult.pagination?.total ?? tickets.length} รายการตามตัวกรอง`}</small>
              </div>
              <div className="poststats-total-num">{ticketError ? '—' : tickets.length}</div>
            </div>
          </div>

          {/* Card 5: AI Models or Staff Queue KPI */}
          {staff.role === 'SUPER_ADMIN' ? (
            <div className="dashboard-white-card dashboard-kpi-pill-card">
              <div className="pill-card-head">
                <span className="pill-card-big-num">
                  {providersError ? 'ข้อผิดพลาด' : `${enabledModels.length}/${allModels.length}`}
                </span>
                <span className="pill-card-label">
                  โมเดล AI เปิดใช้งาน ({providersError ? 'ไม่สามารถเชื่อมต่อได้' : `${providers.filter(p => p.enabled).length}/${providers.length} ผู้ให้บริการ`})
                </span>
              </div>
              <div className="pill-card-track" aria-hidden="true">
                <div
                  className="pill-card-fill fill-dark"
                  style={{
                    width: `${!providersError && allModels.length > 0 ? Math.round((enabledModels.length / allModels.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="dashboard-white-card dashboard-kpi-pill-card">
              <div className="pill-card-head">
                <span className="pill-card-big-num">
                  {ticketError ? '—' : `${myAssignedTickets.length}/${tickets.length}`}
                </span>
                <span className="pill-card-label">งานของฉัน / เรื่องทั้งหมดที่โหลด</span>
              </div>
              <div className="pill-card-track" aria-hidden="true">
                <div
                  className="pill-card-fill fill-dark"
                  style={{
                    width: `${tickets.length > 0 ? Math.round((myAssignedTickets.length / tickets.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Super Admin Staging Overview */}
          {staff.role === 'SUPER_ADMIN' && (
            <div className="dashboard-white-card dashboard-admin-sidepanel">
              <div className="white-card-head">
                <span className="white-card-label">คลังความรู้ & AI</span>
                <span className="white-card-dots" aria-hidden="true">•••</span>
              </div>

              <div className="admin-sidepanel-content">
                <div className="admin-sidepanel-item">
                  <span className="admin-item-title">Embedding (CPU 384-dim)</span>
                  <span className={`admin-status-pill ${embeddingChecked && embeddingStatus?.healthy ? 'is-healthy' : !embeddingChecked ? 'is-unavailable' : 'is-off'}`}>
                    {embeddingChecked && embeddingStatus?.healthy
                      ? '● พร้อมใช้งาน'
                      : !embeddingChecked
                        ? '○ ไม่สามารถตรวจสอบได้'
                        : '○ ออฟไลน์'}
                  </span>
                </div>

                <div className="admin-sidepanel-item">
                  <span className="admin-item-title">งานนำเข้าขั้นตรวจ (Staging)</span>
                  {importJobsError ? (
                    <strong className="admin-item-val" style={{ color: '#dc2626' }}>ไม่สามารถเชื่อมต่อได้</strong>
                  ) : (
                    <strong className="admin-item-val" title={`สกัดสำเร็จ ${readyImportJobs.length} ฉบับ, มีข้อผิดพลาด ${failedImportJobs.length} ฉบับ จากทั้งหมด ${importJobs.length} ฉบับ`}>
                      {readyImportJobs.length} ฉบับ
                    </strong>
                  )}
                </div>
              </div>

              <div className="admin-sidepanel-actions">
                <Link className="dashboard-pill-btn dashboard-pill-btn-sm" href="/knowledge/import">
                  นำเข้าเอกสาร
                </Link>
                <Link className="dashboard-pill-btn dashboard-pill-btn-sm dashboard-pill-btn-outline" href="/knowledge">
                  คลังความรู้
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
