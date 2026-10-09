import Link from 'next/link';
import { parseMetricQuery } from '@/lib/operations/metrics-contracts';
import { readOperationsAnalytics, readOperationsDepartments } from '@/lib/operations/metrics';
import { requireStaff } from '@/lib/auth/staff';
import { DateFilter, Distribution, EmptyState, MetricCard, queryFromSearchParams, ReadState, formatCount, formatDuration, type SearchParams } from '../operations-views/view';

export default async function AnalyticsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams ?? {};
  let filters: ReturnType<typeof parseMetricQuery> | null = null;
  let invalid = false;
  let error = false;
  let result: Awaited<ReturnType<typeof readOperationsAnalytics>> | null = null;
  let departments: Awaited<ReturnType<typeof readOperationsDepartments>>['items'] = [];
  try { filters = parseMetricQuery(queryFromSearchParams(params)); } catch { invalid = true; }
  if (filters) {
    try { result = await readOperationsAnalytics(staff.id, filters); } catch { error = true; }
    try { departments = (await readOperationsDepartments(staff.id)).items; } catch { /* department filter options are optional; metric read retains backend scope */ }
  }

  return <main className="dashboard-container">
    <header className="dashboard-topbar"><div className="dashboard-topbar-left"><h1 className="dashboard-page-title">สถิติและแนวโน้ม (Analytics)</h1><div className="dashboard-scope-pill">ข้อมูลสถิติภายในขอบเขตสิทธิ์ของคุณ</div></div><div className="dashboard-topbar-right"><Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/dashboard">← กลับไปหน้าหลัก</Link></div></header>
    <DateFilter action="/analytics" from={filters?.from ?? ''} to={filters?.to ?? ''} departments={departments} department={filters?.department} />
    <ReadState error={error} invalid={invalid} message="ไม่สามารถอ่านข้อมูลสถิติได้" resetHref="/analytics" />
    {result && <>
      <p className="operations-muted">ข้อมูล ณ {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(result.observedAt))} · {result.window.from} – {result.window.to} (Asia/Bangkok)</p>
      <div className="operations-grid">
        <MetricCard label="เวลาเฉลี่ยตอบกลับครั้งแรก" value={formatDuration(result.firstStaffResponse.averageSeconds)} detail={`${formatCount(result.firstStaffResponse.samples)} ตัวอย่าง`} />
        <MetricCard label="เวลาเฉลี่ยจนปิดงาน" value={formatDuration(result.resolution.averageSeconds)} detail={`${formatCount(result.resolution.samples)} ตัวอย่าง`} />
        <MetricCard label="อัตราการแก้ปัญหาโดย AI" value={result.aiResolutionRate===null?'ยังไม่มีการยืนยันผล':`${new Intl.NumberFormat('th-TH',{maximumFractionDigits:1}).format(result.aiResolutionRate)}%`}
          detail={`ยืนยันแก้ได้ ${formatCount(result.aiOutcomes.confirmedSolved)} · ยืนยันส่งต่อ ${formatCount(result.aiOutcomes.confirmedEscalated)} จาก ${formatCount(result.aiOutcomes.samples)} เรื่องที่ยืนยัน`} />
      </div>
      <p className="operations-muted">อัตรานี้นับเฉพาะเรื่องที่ผู้แจ้งกดยืนยันว่าแก้ได้แล้วหรือยืนยันส่งต่อเจ้าหน้าที่ในช่วงที่เลือก การส่งคำตอบสำเร็จเพียงอย่างเดียวไม่ถือว่าแก้ปัญหาได้</p>
      <section className="operations-surface"><h2>จำนวนเรื่องตามหน่วยงานในช่วงที่เลือก</h2><Distribution items={result.distribution.map(item => ({ key: item.departmentId, label: item.departmentName, count: item.count }))} /></section>
      {result.firstStaffResponse.samples === 0 && result.resolution.samples === 0 && <EmptyState>ยังไม่มีตัวอย่างเวลาตอบกลับหรือปิดงานในช่วงนี้</EmptyState>}
    </>}
  </main>;
}
