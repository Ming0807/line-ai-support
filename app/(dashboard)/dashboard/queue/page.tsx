export default function QueuePage() {
  return (
    <main className="dashboard-main">
      <p className="eyebrow">งานบริการ</p>
      <h1>คิวงาน</h1>
      <section className="queue-card" aria-live="polite">
        <p>คิวงานยังว่าง</p>
      </section>
    </main>
  );
}
