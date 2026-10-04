import Link from 'next/link';

export default function DashboardPage() {
  return (
    <main className="dashboard-main">
      <p className="eyebrow">หน้าหลัก</p>
      <h1>งานบริการของหน่วยงาน</h1>
      <section className="queue-card" aria-labelledby="queue-title">
        <h2 id="queue-title">คิวงาน</h2>
          <Link href="/dashboard/queue">เปิดคิวงาน</Link>
      </section>
    </main>
  );
}
