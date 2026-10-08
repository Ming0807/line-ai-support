import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/staff';
import { readLogs } from '@/lib/operations/reads';
import {
  buildLogPageUrl,
  buildLogClearUrl,
  buildLogServiceFilters,
  loadLogList,
  LOG_CODES,
  LOG_COMPONENTS,
  LOG_SEVERITIES,
  parseLogQuery,
} from '../operator-workflows/logs';
import LogsView from '../operator-workflows/LogsView';
import '@/app/operator-workflows.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function LogFilterForm({ canonical }: { canonical: ReturnType<typeof parseLogQuery> }) {
  return (
    <form className="opw-filters" method="get" aria-label="กรองบันทึก">
      <label htmlFor="opw-log-q">
        คำค้นหา
        <input
          id="opw-log-q"
          type="search"
          name="q"
          defaultValue={canonical.q ?? ''}
          placeholder="ค้นหารหัสเหตุการณ์ ข้อความบันทึก..."
        />
      </label>
      <label htmlFor="opw-log-severity">
        ระดับบันทึก
        <select id="opw-log-severity" name="severity" defaultValue={canonical.severity ?? ''}>
          <option value="">ทุกระดับ</option>
          {Object.entries(LOG_SEVERITIES).map(([value, label]) => (
            <option value={value} key={value}>
              {value} ({label})
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="opw-log-component">
        คอมโพเนนต์
        <select id="opw-log-component" name="component" defaultValue={canonical.component ?? ''}>
          <option value="">ทุกคอมโพเนนต์</option>
          {LOG_COMPONENTS.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="opw-log-code">
        รหัสเหตุการณ์
        <select
          id="opw-log-code"
          name="code"
          defaultValue={canonical.code ?? ''}
        >
          <option value="">ทุกรหัส</option>
          {LOG_CODES.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <label htmlFor="opw-log-from">
        ตั้งแต่วันที่
        <input id="opw-log-from" type="date" name="from" defaultValue={canonical.from ?? ''} />
      </label>
      <label htmlFor="opw-log-to">
        ถึงวันที่
        <input id="opw-log-to" type="date" name="to" defaultValue={canonical.to ?? ''} />
      </label>
      <label htmlFor="opw-log-size">
        จำนวนต่อหน้า
        <select id="opw-log-size" name="pageSize" defaultValue={String(canonical.pageSize)}>
          <option value="10">10 ต่อหน้า</option>
          <option value="25">25 ต่อหน้า</option>
          <option value="50">50 ต่อหน้า</option>
          <option value="100">100 ต่อหน้า</option>
        </select>
      </label>
      <div className="opw-filter-buttons">
        <button className="opw-btn opw-btn-primary" type="submit">
          ใช้ตัวกรอง
        </button>
        <Link className="opw-reset" href={buildLogClearUrl({pageSize:String(canonical.pageSize)})}>
          ล้างตัวกรอง
        </Link>
      </div>
    </form>
  );
}

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const staff = await requireStaff();
  if (staff.role !== 'SUPER_ADMIN') notFound();
  const canonical = parseLogQuery(params);

  if (canonical.validationError) {
    return (
      <div className="dashboard-container">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-left">
            <h1 className="dashboard-page-title">บันทึกระบบ (System Logs)</h1>
            <div className="dashboard-scope-pill" title="บันทึกข้อผิดพลาดและการทำงานของระบบ">
              <span className="scope-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="M8 12h8M8 9h8M8 15h5" /></svg></span>
              <span>ข้อผิดพลาด สถานะงาน และประวัติการประมวลผล (Sanitized)</span>
            </div>
          </div>
          <div className="dashboard-topbar-right">
            <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/activities">
              ← ดูกิจกรรมงาน
            </Link>
          </div>
        </header>
        <nav className="activity-tabs-header" aria-label="เมนูกิจกรรมและบันทึกระบบ" style={{ marginBottom: '1.5rem' }}>
          <div className="activity-tabs-group">
            <Link href="/activities" className="activity-tab">
              ประวัติกิจกรรมงาน (Activities)
            </Link>
            <span className="activity-tab is-active" aria-current="page">
              บันทึกการทำงานระบบ (Logs)
            </span>
          </div>
        </nav>
        <p className="opw-error" role="alert">
          {canonical.validationError} · <Link href="/logs">ล้างตัวกรองทั้งหมด</Link>
        </p>
        <LogFilterForm canonical={canonical} />
        <section className="opw-state" aria-labelledby="invalid-title">
          <p className="opw-state-title" id="invalid-title">
            ตัวกรองไม่ถูกต้อง
          </p>
          <p>โปรดตรวจสอบค่าที่กรอกแล้วลองอีกครั้ง หรือล้างตัวกรองทั้งหมดเพื่อดูรายการทั้งหมด</p>
          <Link className="opw-btn opw-btn-secondary" href="/logs">
            ล้างตัวกรองทั้งหมด
          </Link>
        </section>
      </div>
    );
  }

  const filters = buildLogServiceFilters(canonical);
  const state = await loadLogList(filters, async (readFilters) => readLogs(staff.id, readFilters));
  const retryHref = buildLogPageUrl(params, canonical.page);

  return (
    <div className="dashboard-container">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-left">
          <h1 className="dashboard-page-title">บันทึกระบบ (System Logs)</h1>
          <div className="dashboard-scope-pill" title="บันทึกข้อผิดพลาดและการทำงานของระบบ">
            <span className="scope-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="M8 12h8M8 9h8M8 15h5" /></svg></span>
            <span>ข้อผิดพลาด สถานะงาน และประวัติการประมวลผล (Sanitized)</span>
          </div>
        </div>
        <div className="dashboard-topbar-right">
          <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/activities">
            ← ดูกิจกรรมงาน
          </Link>
        </div>
      </header>
      <nav className="activity-tabs-header" aria-label="เมนูกิจกรรมและบันทึกระบบ" style={{ marginBottom: '1.5rem' }}>
        <div className="activity-tabs-group">
          <Link href="/activities" className="activity-tab">
            ประวัติกิจกรรมงาน (Activities)
          </Link>
          <span className="activity-tab is-active" aria-current="page">
            บันทึกการทำงานระบบ (Logs)
          </span>
        </div>
      </nav>
      <div className="dashboard-white-card" style={{ marginBottom: '1.5rem', background: '#f8fafc', borderColor: '#e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></svg></span>
          <div>
            <strong style={{ color: '#0f172a', display: 'block', marginBottom: '0.2rem' }}>
              การรักษาความลับและความปลอดภัยระดับระบบ
            </strong>
            <p style={{ margin: 0, color: '#475569', fontSize: '0.875rem' }}>
              ใช้เฉพาะรหัสและฟิลด์ที่ผ่านสัญญาอ่านแบบจำกัด ไม่มี raw error, request body, token หรือ LINE identity
            </p>
          </div>
        </div>
      </div>
      <div className="dashboard-white-card" style={{ marginBottom: '2rem' }}>
        <div className="white-card-head" style={{ marginBottom: '1.25rem' }}>
          <div>
            <span className="white-card-label">บันทึกการทำงานของระบบ (Sanitized Logs)</span>
            <p style={{ margin: '0.25rem 0 0', color: '#70757d', fontSize: '0.875rem' }}>
              เฉพาะการสังเกตการณ์ข้อผิดพลาด AI Gateway และการส่ง LINE ที่ยืนยันแล้ว
            </p>
          </div>
          <span className="white-card-dots" aria-hidden="true">
            •••
          </span>
        </div>
        <LogFilterForm canonical={canonical} />
        <p className="opw-count" role="status">ช่วงเวลา {canonical.from} – {canonical.to} · Asia/Bangkok</p>
        <LogsView key={`${canonical.from}:${canonical.to}:${canonical.page}:${canonical.pageSize}:${canonical.q ?? ''}:${canonical.severity ?? ''}:${canonical.component ?? ''}:${canonical.code ?? ''}`} state={state} baseParams={params} filters={filters} retryHref={retryHref} />
      </div>
    </div>
  );
}
