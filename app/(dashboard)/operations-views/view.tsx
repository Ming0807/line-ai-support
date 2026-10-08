import type { ReactNode } from 'react';

export type SearchParams = Record<string, string | string[] | undefined>;

export function queryFromSearchParams(params: SearchParams = {}): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.append(key, value);
  }
  return query;
}

export function dateRangeLabel(from: string, to: string): string {
  return `${from} – ${to} (เวลา Asia/Bangkok)`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'ยังไม่มีตัวอย่าง';
  if (seconds < 60) return `${Math.round(seconds)} วินาที`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(minutes)} นาที`;
  return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(seconds / 3600)} ชั่วโมง`;
}

export function DateFilter({ action, from, to, departments = [], department }: {
  action: string; from: string; to: string;
  departments?: Array<{ id: string; name: string; code: string }>;
  department?: string;
}) {
  return <form action={action} method="get" className="operations-filter" aria-label="ตัวกรองช่วงวันที่">
    <div className="operations-filter-fields">
      <label>ตั้งแต่วันที่<input name="from" type="date" required defaultValue={from} /></label>
      <label>ถึงวันที่<input name="to" type="date" required defaultValue={to} /></label>
      {departments.length > 0 && <label>หน่วยงาน (จำกัดผลสถิติเท่านั้น)<select name="department" defaultValue={department ?? ''}>
        <option value="">ทุกหน่วยงานที่มีสิทธิ์</option>
        {departments.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
      </select></label>}
    </div>
    <div className="operations-filter-actions"><button type="submit" className="dashboard-pill-btn dashboard-pill-btn-dark">แสดงผล</button><a className="dashboard-pill-btn dashboard-pill-btn-outline" href={action}>ล้างตัวกรอง</a></div>
    <p className="operations-muted">สูงสุด 90 วัน · {dateRangeLabel(from, to)}</p>
  </form>;
}

export function ReadState({ error, invalid = false, message = 'ไม่สามารถอ่านข้อมูลได้', resetHref = '' }: { error: boolean; invalid?: boolean; message?: string; resetHref?: string }) {
  if (!error && !invalid) return null;
  return <section className="operations-state is-error" role="alert"><strong>{invalid ? 'ตัวกรองไม่ถูกต้อง' : message}</strong><p>{invalid ? 'ตรวจสอบวันที่และตัวกรอง แล้วลองใหม่' : 'ระบบยังสรุปข้อมูลไม่ได้ กรุณาลองใหม่ภายหลัง'}</p><a href={resetHref} className="dashboard-pill-btn dashboard-pill-btn-outline">ล้างตัวกรองและลองใหม่</a></section>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="operations-state" role="status">{children}</div>;
}

export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <article className="operations-metric-card"><h2>{label}</h2><p className="operations-metric-value">{value}</p>{detail && <p className="operations-muted">{detail}</p>}</article>;
}

export function Distribution({ items }: { items: Array<{ key: string; label: string; count: number }> }) {
  if (items.length === 0) return <EmptyState>ยังไม่มีข้อมูลการกระจายตามหน่วยงานในช่วงนี้</EmptyState>;
  const max = Math.max(...items.map(item => item.count), 1);
  return <ul className="operations-distribution">{items.map(item => <li key={item.key}><div className="operations-distribution-label"><span>{item.label}</span><strong>{formatCount(item.count)}</strong></div><div className="operations-track" aria-hidden="true"><span style={{ width: `${Math.round(item.count / max * 100)}%` }} /></div></li>)}</ul>;
}
