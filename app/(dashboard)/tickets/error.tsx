'use client';

import '@/app/tickets.css';

export default function TicketsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="ticket-page">
      <section className="ticket-empty ticket-error-state" role="alert">
        <h1>โหลดรายการงานไม่สำเร็จ</h1>
        <p>ระบบอาจขัดข้องชั่วคราว ลองโหลดข้อมูลใหม่อีกครั้ง</p>
        <button className="ticket-button ticket-button-primary" type="button" onClick={() => retry()}>ลองอีกครั้ง</button>
      </section>
    </main>
  );
}
