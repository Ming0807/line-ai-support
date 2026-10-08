import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { readOperationsDepartments } from '@/lib/operations/metrics';
import { EmptyState, ReadState, formatCount } from '../operations-views/view';

export default async function DepartmentsPage() {
  const staff = await requireStaff();
  let items: Awaited<ReturnType<typeof readOperationsDepartments>>['items'] = [];
  let error = false;
  try { items = (await readOperationsDepartments(staff.id)).items; } catch { error = true; }

  return <main className="dashboard-container">
    <header className="dashboard-topbar"><div className="dashboard-topbar-left"><h1 className="dashboard-page-title">ขอบเขตหน่วยงาน (Departments)</h1><div className="dashboard-scope-pill">เฉพาะหน่วยงานและจำนวนงานที่คุณมีสิทธิ์เห็น</div></div><div className="dashboard-topbar-right"><Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/settings">← กลับไปการตั้งค่า</Link></div></header>
    {error ? <ReadState error resetHref="/departments" /> : items.length === 0 ? <EmptyState><strong>ยังไม่มีหน่วยงานที่แสดงได้</strong><p>ไม่มีข้อมูลหน่วยงานที่ใช้งานอยู่ในขอบเขตสิทธิ์ปัจจุบัน</p></EmptyState> : <section className="operations-grid" aria-label="หน่วยงานที่เข้าถึงได้">{items.map(item => <article className="operations-metric-card" key={item.id}><h2>{item.code} · {item.name}</h2><dl className="operations-department-counts"><div><dt>งานที่มองเห็นได้</dt><dd>{formatCount(item.totalTickets)}</dd></div><div><dt>งานที่ยังเปิด</dt><dd>{formatCount(item.openTickets)}</dd></div><div><dt>เจ้าหน้าที่ที่ใช้งาน</dt><dd>{formatCount(item.activeStaff)}</dd></div></dl></article>)}</section>}
  </main>;
}
