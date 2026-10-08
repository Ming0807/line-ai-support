import Link from 'next/link';
import type { IncidentPage } from '@/lib/incidents/reads';
import { incidentSeverityLabel, incidentStatusLabel } from './presentation';

export default function IncidentListView({
  query,
  result,
  error = false,
  departments,
}: {
  query: { status?: string; severity?: string; department?: string; page: number; pageSize: number };
  result?: IncidentPage;
  error?: boolean;
  departments?: {id:string;name:string}[];
}) {
  const page = result?.pagination;
  const pageUrl = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.severity) params.set('severity', query.severity);
    if (query.department) params.set('department', query.department);
    params.set('page', String(nextPage));
    params.set('pageSize', String(query.pageSize));
    return `/incidents?${params.toString()}`;
  };

  return (
    <main className="incident-page">
      <header className="incident-heading">
        <div>
          <h1>เหตุการณ์ระบบ</h1>
          <p>ติดตามปัญหาที่กระทบผู้ใช้และคำร้องที่เชื่อมโยง</p>
        </div>
        <Link className="incident-secondary-link" href="/tickets">กลับไปงานรับเรื่อง</Link>
      </header>

      <section className="incident-panel" aria-labelledby="incident-list-title">
        <div className="incident-section-heading">
          <h2 id="incident-list-title">รายการเหตุการณ์</h2>
          {page && <p>ทั้งหมด {page.total} เหตุการณ์ · หน้า {page.page} จาก {Math.max(1, page.totalPages)}</p>}
        </div>
        <form className="incident-filters" action="/incidents" method="get">
          <label>
            <span>สถานะ</span>
            <select name="status" defaultValue={query.status ?? ''}>
              <option value="">ทุกสถานะ</option>
              <option value="DETECTED">ตรวจพบ</option>
              <option value="INVESTIGATING">กำลังตรวจสอบ</option>
              <option value="MONITORING">เฝ้าติดตาม</option>
              <option value="RESOLVED">แก้ไขแล้ว</option>
              <option value="CLOSED">ปิดเหตุการณ์</option>
            </select>
          </label>
          <label>
            <span>ระดับความรุนแรง</span>
            <select name="severity" defaultValue={query.severity ?? ''}>
              <option value="">ทุกระดับ</option>
              <option value="MEDIUM">ปานกลาง</option>
              <option value="HIGH">สูง</option>
              <option value="CRITICAL">วิกฤต</option>
            </select>
          </label>
          <label className="incident-department-filter">
            <span>หน่วยงาน</span>
            <select name="department" defaultValue={query.department ?? ''} disabled={!departments}>
              <option value="">{departments ? 'ทุกหน่วยงานที่มีสิทธิ์' : 'ยังอ่านรายชื่อหน่วยงานไม่ได้'}</option>
              {departments?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {!departments && query.department && <input type="hidden" name="department" value={query.department} />}
          </label>
          <input type="hidden" name="pageSize" value={query.pageSize} />
          <button className="incident-primary-button" type="submit">ใช้ตัวกรอง</button>
        </form>

        {error ? (
          <div className="incident-state incident-error" role="alert">
            <h3>ยังอ่านข้อมูลเหตุการณ์ไม่ได้</h3>
            <p>ระบบไม่สามารถยืนยันรายการเหตุการณ์ได้ในขณะนี้ โปรดลองโหลดข้อมูลอีกครั้ง</p>
            <Link className="incident-primary-button" href={pageUrl(query.page)}>ลองอีกครั้ง</Link>
          </div>
        ) : result?.items.length === 0 ? (
          <div className="incident-state" role="status">
            <h3>ยังไม่มีเหตุการณ์ในตัวกรองนี้</h3>
            <p>การค้นหาสำเร็จและไม่พบเหตุการณ์ที่ตรงกับตัวกรองปัจจุบัน</p>
          </div>
        ) : result ? (
          <>
            <div className="incident-list" role="list">
              {result.items.map((item) => (
                <article className="incident-row" key={item.id} role="listitem">
                  <div className="incident-row-main">
                    <Link className="incident-title" href={`/incidents/${item.id}`}>{item.title}</Link>
                    <p>{item.departmentLabel} · {item.category}</p>
                  </div>
                  <div className="incident-row-status">
                    <span className={`incident-badge incident-severity-${item.severity.toLowerCase()}`}>{incidentSeverityLabel(item.severity)}</span>
                    <span className="incident-badge">{incidentStatusLabel(item.status)}</span>
                  </div>
                  <div className="incident-row-counts">
                    <span><strong>{item.reportCount}</strong> รายงาน</span>
                    <span><strong>{item.distinctSessionCount}</strong> ผู้รายงานที่ไม่ซ้ำ</span>
                  </div>
                  <time dateTime={item.updatedAt}>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(item.updatedAt))}</time>
                </article>
              ))}
            </div>
            <nav className="incident-pagination" aria-label="เปลี่ยนหน้ารายการเหตุการณ์">
              <span>หน้า {page?.page} จาก {Math.max(1, page?.totalPages ?? 1)}</span>
              <div>
                {query.page > 1 && <Link className="incident-secondary-link" href={pageUrl(query.page - 1)}>หน้าก่อนหน้า</Link>}
                {page && query.page < page.totalPages && <Link className="incident-secondary-link" href={pageUrl(query.page + 1)}>หน้าถัดไป</Link>}
              </div>
            </nav>
          </>
        ) : (
          <div className="incident-state" role="status"><h3>กำลังอ่านข้อมูลเหตุการณ์</h3></div>
        )}
      </section>
    </main>
  );
}
