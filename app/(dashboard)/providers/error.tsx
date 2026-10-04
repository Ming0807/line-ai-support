'use client';

import '@/app/providers.css';

export default function ProvidersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="provider-page">
      <section className="provider-empty provider-error" role="alert">
        <h1>โหลดการตั้งค่าไม่สำเร็จ</h1>
        <p>ระบบอาจขัดข้องชั่วคราว ลองโหลดข้อมูลใหม่อีกครั้ง</p>
        <button className="provider-button provider-button-primary" type="button" onClick={reset}>ลองอีกครั้ง</button>
      </section>
    </main>
  );
}
