import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';

export default async function DashboardPage() {
  const staff = await requireStaff();
  return (
    <main className="dashboard-main">
      <p className="eyebrow">หน้าหลัก</p>
      <h1>งานบริการของหน่วยงาน</h1>
      <section className="queue-card" aria-labelledby="queue-title">
        <h2 id="queue-title">คิวงาน</h2>
          <Link href="/tickets">เปิดคิว Ticket</Link>
      </section>
      {staff.role === 'SUPER_ADMIN' && (
        <section className="queue-card" aria-labelledby="providers-title">
          <h2 id="providers-title">ตั้งค่า AI</h2>
          <Link href="/providers">จัดการผู้ให้บริการและ Model</Link>
        </section>
      )}
    </main>
  );
}
