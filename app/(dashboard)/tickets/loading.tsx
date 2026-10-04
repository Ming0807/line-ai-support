import '@/app/tickets.css';

export default function TicketsLoading() {
  return (
    <main className="ticket-page" aria-busy="true" aria-live="polite">
      <h1>กำลังโหลดงานรับเรื่อง…</h1>
      <div className="ticket-loading-filters" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="ticket-loading-list" aria-hidden="true"><span /><span /><span /><span /></div>
      <span className="ticket-sr-only">กำลังโหลดรายการงาน</span>
    </main>
  );
}
