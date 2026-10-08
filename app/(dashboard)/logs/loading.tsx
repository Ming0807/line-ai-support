export default function LogsLoading() {
  return (
    <div className="dashboard-container" aria-busy="true" aria-live="polite">
      <h1 className="dashboard-page-title">บันทึกระบบ (System Logs)</h1>
      <p role="status">กำลังโหลดบันทึก…</p>
      <span className="opw-sr-only">กำลังโหลดรายการบันทึก</span>
    </div>
  );
}
