import Link from 'next/link';
import { requireStaff } from '@/lib/auth/staff';
import { readOperationsSettings } from '@/lib/operations/metrics';
import { getEmbeddingStatus } from '@/lib/knowledge/embedding-status';
import { EmptyState, ReadState, formatCount } from '../operations-views/view';
import {getBindingStatus} from '@/lib/staff/line-binding';
import StaffLinePanel from './staff-line-panel';

function queueRows(label: string, rows: Awaited<ReturnType<typeof readOperationsSettings>>['queues']['inbox']) {
  return <section className="operations-surface"><h2>{label}</h2>{rows.length === 0 ? <p className="operations-muted">ไม่มีรายการในคิวขณะตรวจสอบ</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">สถานะ</th><th scope="col">ช่องทาง</th><th scope="col">จำนวน</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.status}-${row.channel ?? 'all'}-${index}`}><th scope="row">{row.status}</th><td>{row.channel ?? 'รวมทุกช่องทาง'}</td><td>{formatCount(row.count)}</td></tr>)}</tbody></table></div>}</section>;
}

export default async function SettingsPage() {
  const staff = await requireStaff();
  const isSuperAdmin = staff.role === 'SUPER_ADMIN';
  let binding: Awaited<ReturnType<typeof getBindingStatus>> | null = null;
  try { binding = await getBindingStatus(staff.id); } catch { /* fixed unavailable state in the self panel */ }
  let status: Awaited<ReturnType<typeof readOperationsSettings>> | null = null;
  let error = false;
  if(isSuperAdmin)try { status = await readOperationsSettings(staff.id); } catch { error = true; }
  let embedding: Awaited<ReturnType<typeof getEmbeddingStatus>> | null = null;
  if(isSuperAdmin)try { embedding = await getEmbeddingStatus(staff.id); } catch { /* independent HTTP probe is unknown when unavailable */ }

  return <main className="dashboard-container">
    <header className="dashboard-topbar"><div className="dashboard-topbar-left"><h1 className="dashboard-page-title">การตั้งค่า</h1><div className="dashboard-scope-pill">บัญชีของคุณ{isSuperAdmin?' · สถานะระบบ':''}</div></div>{isSuperAdmin&&<div className="dashboard-topbar-right"><Link className="dashboard-pill-btn dashboard-pill-btn-dark" href="/departments">ขอบเขตหน่วยงาน →</Link></div>}</header>
    <StaffLinePanel initialStatus={binding}/>
    {isSuperAdmin&&<ReadState error={error} resetHref="/settings" />}
    {status && <>
      <p className="operations-muted">สังเกตเมื่อ {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(status.observedAt))}</p>
      <div className="operations-grid">
        <article className="operations-metric-card"><h2>ฐานข้อมูล</h2><p className="operations-metric-value">ตรวจพบการเชื่อมต่อ</p><p className="operations-muted">สถานะจากการอ่านข้อมูลระบบรอบนี้</p></article>
        <article className="operations-metric-card"><h2>การเชื่อมต่อใน pool</h2><p className="operations-metric-value">{formatCount(status.pool.total)} ทั้งหมด</p><p className="operations-muted">ว่าง {formatCount(status.pool.idle)} · รอ {formatCount(status.pool.waiting)}</p></article>
        <article className="operations-metric-card"><h2>Worker liveness</h2><p className="operations-metric-value">ยังไม่ทราบสถานะการทำงานของ worker</p><p className="operations-muted">จำนวนงานค้างไม่ยืนยันว่า worker ทำงานอยู่</p></article>
        <article className="operations-metric-card"><h2>LINE Student OA</h2><p className="operations-metric-value">{status.line.studentConfigured ? 'กำหนดค่าแล้ว' : 'ยังไม่ได้กำหนดค่า'}</p><p className="operations-muted">แสดงเฉพาะสถานะการมีค่าตั้งต้น ไม่เปิดเผยค่า secret</p></article>
        <article className="operations-metric-card"><h2>LINE Staff OA</h2><p className="operations-metric-value">{status.line.staffConfigured ? 'กำหนดค่าแล้ว' : 'ยังไม่ได้กำหนดค่า'}</p><p className="operations-muted">แสดงเฉพาะสถานะการมีค่าตั้งต้น ไม่เปิดเผยค่า secret</p></article>
      </div>
      <section className="operations-surface" aria-labelledby="worker-observations-heading"><h2 id="worker-observations-heading">การทำงานล่าสุดของ worker</h2><p className="operations-muted">เวลาที่พบแต่ละ worker เข้ารอบการทำงาน ไม่ยืนยันว่ากำลังทำงานอยู่หรือส่งข้อความสำเร็จ</p><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">งานเบื้องหลัง</th><th scope="col">ข้อมูลที่พบ</th></tr></thead><tbody>{status.workerObservations.map(row=><tr key={row.worker}><th scope="row">{{INBOX:'รับข้อความ',OUTBOX:'ส่งข้อความ',AI:'ประมวลผล AI',INCIDENT:'ตรวจเหตุขัดข้อง'}[row.worker]}</th><td>{row.lastObservedAt?<><span>พบการทำงานล่าสุด </span><time dateTime={row.lastObservedAt}>{new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(row.lastObservedAt))}</time></>:'ยังไม่มีข้อมูลการทำงาน'}</td></tr>)}</tbody></table></div></section>
      {queueRows('Webhook inbox', status.queues.inbox)}{queueRows('AI jobs', status.queues.ai)}{queueRows('Message outbox', status.queues.outbox)}
    </>}
    {isSuperAdmin&&<section className="operations-surface"><h2>Local CPU Embedding (ตรวจสอบแยก)</h2>{embedding ? <><p><span className="operations-status">{embedding.healthy ? 'ตอบสถานะพร้อม' : 'ปลายทางรายงานไม่พร้อม'}</span> · HTTP {embedding.httpStatus ?? 'ไม่ทราบ'}</p><p className="operations-muted">{embedding.model} · {embedding.dimension}-dim · {embedding.mode} · ตรวจเมื่อ {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(embedding.observedAt))}</p></> : <EmptyState>ตรวจสอบบริการ E5 ไม่สำเร็จ; สถานะจึงยังไม่ทราบ</EmptyState>}</section>}
  </main>;
}
