import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/staff';
import { parseUsageQuery } from '@/lib/operations/metrics-contracts';
import { readOperationsUsage } from '@/lib/operations/metrics';
import { DateFilter, MetricCard, queryFromSearchParams, ReadState, formatCount, type SearchParams } from '../operations-views/view';

function observed(value: number, unknown: number, label: string) { return `${formatCount(value)} ที่ทราบ · ไม่ทราบ${label} ${formatCount(unknown)} ครั้ง`; }
function totals(value: Awaited<ReturnType<typeof readOperationsUsage>>['totals']) {
  return <div className="operations-grid">
    <MetricCard label="คำขอ AI" value={formatCount(value.calls)} detail={`${formatCount(value.success)} สำเร็จ · ${formatCount(value.errors)} ผิดพลาด · ${formatCount(value.fallback)} fallback`} />
    <MetricCard label="เวลาเฉลี่ยตอบกลับ" value={value.meanLatencyMs === null ? 'ยังไม่มีตัวอย่าง' : `${formatCount(Math.round(value.meanLatencyMs))} ms`} />
    <MetricCard label="Input tokens" value={observed(value.inputTokens.knownTotal, value.inputTokens.unknownCalls, 'โทเค็น')} />
    <MetricCard label="Output tokens" value={observed(value.outputTokens.knownTotal, value.outputTokens.unknownCalls, 'โทเค็น')} />
    <MetricCard label="ค่าใช้จ่ายที่บันทึกได้ (ไม่ระบุสกุลเงิน)" value={value.cost.knownTotal} detail={`ไม่ทราบค่าใช้จ่าย ${formatCount(value.cost.unknownCalls)} ครั้ง · ไม่ใช่ข้อมูลโควต้า`} />
  </div>;
}

export default async function UsagePage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const staff = await requireStaff();
  if (staff.role !== 'SUPER_ADMIN') notFound();
  const params = await searchParams ?? {};
  let filters: ReturnType<typeof parseUsageQuery> | null = null;
  let invalid = false;
  let error = false;
  let result: Awaited<ReturnType<typeof readOperationsUsage>> | null = null;
  try { filters = parseUsageQuery(queryFromSearchParams(params)); } catch { invalid = true; }
  if (filters) try { result = await readOperationsUsage(staff.id, filters); } catch { error = true; }

  return <main className="dashboard-container">
    <header className="dashboard-topbar"><div className="dashboard-topbar-left"><h1 className="dashboard-page-title">ปริมาณการใช้งาน AI (Usage)</h1><div className="dashboard-scope-pill">ข้อมูลการใช้งานที่บันทึกโดย AI Gateway · ผู้ดูแลระบบสูงสุด</div></div><div className="dashboard-topbar-right"><Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/providers">← ผู้ให้บริการและโมเดล</Link></div></header>
    <DateFilter action="/usage" from={filters?.from ?? ''} to={filters?.to ?? ''} />
    <ReadState error={error} invalid={invalid} message="ไม่สามารถอ่านข้อมูลการใช้งานได้" resetHref="/usage" />
    {result && <>
      <p className="operations-muted">ช่วง {result.window.from} – {result.window.to} (Asia/Bangkok) · โควต้าผู้ให้บริการแสดงแยกที่ <Link href="/providers">หน้าผู้ให้บริการ</Link></p>
      {totals(result.totals)}
      {result.models.length === 0 ? <section className="operations-state" role="status"><strong>ยังไม่มีรายการใช้งานในช่วงนี้</strong><p>ไม่มีบันทึกการเรียก AI Gateway ที่จะแสดง</p></section> : <section className="operations-surface"><h2>การใช้งานแยกตามผู้ให้บริการและโมเดล</h2><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">ผู้ให้บริการ / โมเดล</th><th scope="col">คำขอ</th><th scope="col">สำเร็จ / ผิดพลาด</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">ค่าใช้จ่ายที่ทราบ (หน่วยตามบันทึก)</th></tr></thead><tbody>{result.models.map((model, index) => <tr key={`${model.providerName}-${model.modelName}-${index}`}><th scope="row" className="operations-safe-value">{model.providerName}<br />{model.modelName}</th><td>{formatCount(model.totals.calls)}</td><td>{formatCount(model.totals.success)} / {formatCount(model.totals.errors)}</td><td>{observed(model.totals.inputTokens.knownTotal, model.totals.inputTokens.unknownCalls, 'โทเค็น')}</td><td>{observed(model.totals.outputTokens.knownTotal, model.totals.outputTokens.unknownCalls, 'โทเค็น')}</td><td>{model.totals.cost.knownTotal} · ไม่ทราบค่าใช้จ่าย {formatCount(model.totals.cost.unknownCalls)} ครั้ง</td></tr>)}</tbody></table></div></section>}
    </>}
  </main>;
}
