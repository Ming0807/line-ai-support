import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { readActivities } from '@/lib/operations/reads';
import {
  ACTIVITY_ACTIONS,
  buildActivityPageUrl,
  buildActivityClearUrl,
  buildActivityServiceFilters,
  loadActivityList,
  parseActivityQuery,
} from '../operator-workflows/activities';
import ActivitiesView from '../operator-workflows/ActivitiesView';
import '@/app/operator-workflows.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function ActivityFilterForm({
  canonical,
}: {
  canonical: ReturnType<typeof parseActivityQuery>;
}) {
  return (
    <form className="opw-filters" method="get" aria-label="กรองกิจกรรม">
      <label htmlFor="opw-activity-q">
        คำค้นหา
        <input
          id="opw-activity-q"
          type="search"
          name="q"
          defaultValue={canonical.q ?? ''}
          placeholder="ค้นหาการกระทำ ผู้ดำเนินการ รหัสคำร้อง..."
        />
      </label>
      <label htmlFor="opw-activity-action">
        ประเภทกิจกรรม
        <select id="opw-activity-action" name="action" defaultValue={canonical.action ?? ''}>
          <option value="">ทุกประเภท</option>
          {Object.entries(ACTIVITY_ACTIONS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="opw-activity-from">
        ตั้งแต่วันที่
        <input id="opw-activity-from" type="date" name="from" defaultValue={canonical.from ?? ''} />
      </label>
      <label htmlFor="opw-activity-to">
        ถึงวันที่
        <input id="opw-activity-to" type="date" name="to" defaultValue={canonical.to ?? ''} />
      </label>
      <label htmlFor="opw-activity-size">
        จำนวนต่อหน้า
        <select id="opw-activity-size" name="pageSize" defaultValue={String(canonical.pageSize)}>
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
        <Link className="opw-reset" href={buildActivityClearUrl({pageSize:String(canonical.pageSize)})}>
          ล้างตัวกรอง
        </Link>
      </div>
    </form>
  );
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const staff = await requireStaff();
  const canonical = parseActivityQuery(params);

  if (canonical.validationError) {
    return (
      <div className="dashboard-container">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-left">
            <h1 className="dashboard-page-title">ประวัติกิจกรรม (Activities)</h1>
            <div className="dashboard-scope-pill" title="บันทึกกิจกรรมการทำงาน">
              <span className="scope-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
              <span>บันทึกการทำงานของเจ้าหน้าที่และการเปลี่ยนสถานะ</span>
            </div>
          </div>
          <div className="dashboard-topbar-right">
            <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/logs">
              ดูบันทึกระบบ (Logs) →
            </Link>
          </div>
        </header>
        <nav className="activity-tabs-header" aria-label="เมนูกิจกรรมและบันทึกระบบ" style={{ marginBottom: '1.5rem' }}>
          <div className="activity-tabs-group">
            <span className="activity-tab is-active" aria-current="page">
              ประวัติกิจกรรมงาน (Activities)
            </span>
            <Link href="/logs" className="activity-tab">
              บันทึกการทำงานระบบ (Logs)
            </Link>
          </div>
        </nav>
        <p className="opw-error" role="alert">
          {canonical.validationError} · <Link href="/activities">ล้างตัวกรองทั้งหมด</Link>
        </p>
        <ActivityFilterForm canonical={canonical} />
        <section className="opw-state" aria-labelledby="invalid-title">
          <p className="opw-state-title" id="invalid-title">
            ตัวกรองไม่ถูกต้อง
          </p>
          <p>โปรดตรวจสอบค่าที่กรอกแล้วลองอีกครั้ง หรือล้างตัวกรองทั้งหมดเพื่อดูรายการทั้งหมด</p>
          <Link className="opw-btn opw-btn-secondary" href="/activities">
            ล้างตัวกรองทั้งหมด
          </Link>
        </section>
      </div>
    );
  }

  const filters = buildActivityServiceFilters(canonical);
  const state = await loadActivityList(filters, async (readFilters) => readActivities(staff.id, readFilters));
  const retryHref = buildActivityPageUrl(params, canonical.page);

  return (
    <div className="dashboard-container">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-left">
          <h1 className="dashboard-page-title">ประวัติกิจกรรม (Activities)</h1>
          <div className="dashboard-scope-pill" title="บันทึกกิจกรรมการทำงาน">
            <span className="scope-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
            <span>บันทึกการทำงานของเจ้าหน้าที่และการเปลี่ยนสถานะ</span>
          </div>
        </div>
        <div className="dashboard-topbar-right">
          <Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/logs">
            ดูบันทึกระบบ (Logs) →
          </Link>
        </div>
      </header>
      <nav className="activity-tabs-header" aria-label="เมนูกิจกรรมและบันทึกระบบ" style={{ marginBottom: '1.5rem' }}>
        <div className="activity-tabs-group">
          <span className="activity-tab is-active" aria-current="page">
            ประวัติกิจกรรมงาน (Activities)
          </span>
          <Link href="/logs" className="activity-tab">
            บันทึกการทำงานระบบ (Logs)
          </Link>
        </div>
      </nav>
      <div className="dashboard-white-card" style={{ marginBottom: '2rem' }}>
        <div className="white-card-head" style={{ marginBottom: '1.25rem' }}>
          <div>
            <span className="white-card-label">รายการกิจกรรมล่าสุดในขอบเขตของคุณ</span>
            <p style={{ margin: '0.25rem 0 0', color: '#70757d', fontSize: '0.875rem' }}>
              ครอบคลุมการรับเรื่อง (Takeover), การตอบกลับ, การเปลี่ยนหน่วยงาน, และการอนุมัติคลังความรู้
            </p>
          </div>
          <span className="white-card-dots" aria-hidden="true">
            •••
          </span>
        </div>
        <ActivityFilterForm canonical={canonical} />
        <p className="opw-count" role="status">ช่วงเวลา {canonical.from} – {canonical.to} · Asia/Bangkok</p>
        <ActivitiesView key={`${canonical.from}:${canonical.to}:${canonical.page}:${canonical.pageSize}:${canonical.q ?? ''}:${canonical.action ?? ''}`} state={state} baseParams={params} filters={filters} retryHref={retryHref} />
      </div>
    </div>
  );
}
