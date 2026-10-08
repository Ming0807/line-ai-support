'use client';

export default function LogsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="dashboard-container">
      <section className="opw-state" role="alert">
        <p className="opw-state-title">โหลดบันทึกไม่สำเร็จ</p>
        <p>ระบบอาจขัดข้องชั่วคราว ตัวกรองที่เลือกไว้ยังอยู่ ลองโหลดข้อมูลใหม่อีกครั้ง</p>
        <button className="opw-btn opw-btn-primary" type="button" onClick={() => retry()}>
          ลองอีกครั้ง
        </button>
      </section>
    </div>
  );
}
