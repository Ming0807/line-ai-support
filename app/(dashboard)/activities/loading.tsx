export default function ActivitiesLoading() {
  return (
    <div className="dashboard-container" aria-busy="true" aria-live="polite">
      <h1 className="dashboard-page-title">ประวัติกิจกรรม (Activities)</h1>
      <p role="status">กำลังโหลดกิจกรรม…</p>
      <span className="opw-sr-only">กำลังโหลดรายการกิจกรรม</span>
    </div>
  );
}
