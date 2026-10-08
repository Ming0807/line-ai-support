import Link from 'next/link';
import type { IncidentDetail, IncidentRulesView } from '@/lib/incidents/reads';
import { IncidentRulesEditor, IncidentStatusActions } from './IncidentActions';
import { incidentSeverityLabel, incidentStatusLabel } from './presentation';

export default function IncidentDetailView({ detail, rules = null, canViewRules = false }: {
  detail: IncidentDetail; rules?: IncidentRulesView | null; canViewRules?: boolean;
}) {
  const { incident, tickets, canManage } = detail;
  return (
    <main className="incident-page">
      <header className="incident-heading">
        <div>
          <Link className="incident-back-link" href="/incidents">← เหตุการณ์ทั้งหมด</Link>
          <h1>{incident.title}</h1>
          <p>{incident.departmentLabel} · {incident.category}</p>
        </div>
        <span className={`incident-badge incident-severity-${incident.severity.toLowerCase()}`}>{incidentSeverityLabel(incident.severity)}</span>
      </header>

      <section className="incident-panel" aria-labelledby="incident-summary-title">
        <div className="incident-section-heading">
          <h2 id="incident-summary-title">รายละเอียดเหตุการณ์</h2>
          <span className="incident-badge">{incidentStatusLabel(incident.status)}</span>
        </div>
        <dl className="incident-facts">
          <div><dt>จำนวนรายงาน</dt><dd>{incident.reportCount} รายงาน</dd></div>
          <div><dt>ผู้รายงานไม่ซ้ำ</dt><dd>{incident.distinctSessionCount} คน</dd></div>
          <div><dt>ระดับความอ่อนไหว</dt><dd>{incident.sensitivity === 'GENERAL' ? 'ทั่วไป' : 'จำกัดตามสิทธิ์'}</dd></div>
          <div><dt>ปรับปรุงล่าสุด</dt><dd><time dateTime={incident.updatedAt}>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(incident.updatedAt))}</time></dd></div>
        </dl>
        <IncidentStatusActions incidentId={incident.id} revision={incident.revision} status={incident.status} canManage={canManage} />
      </section>

      <section className="incident-panel" aria-labelledby="linked-tickets-title">
        <div className="incident-section-heading">
          <h2 id="linked-tickets-title">คำร้องที่เชื่อมโยง</h2>
          <p>{tickets.length} รายการที่คุณมีสิทธิ์ดู</p>
        </div>
        {tickets.length === 0 ? (
          <p className="incident-state" role="status">ไม่มีคำร้องที่แสดงได้ภายใต้สิทธิ์ปัจจุบัน</p>
        ) : (
          <ul className="incident-ticket-list">
            {tickets.map((ticket) => <li key={ticket.id}>
              <Link href={`/tickets/${ticket.id}`}><strong>{ticket.ticketCode}</strong><span>{ticket.category}</span><span>{ticket.status}</span></Link>
            </li>)}
          </ul>
        )}
      </section>

      {canViewRules && <section className="incident-panel" aria-labelledby="incident-rules-title">
        <div className="incident-section-heading"><h2 id="incident-rules-title">กติกาการตรวจจับเหตุการณ์</h2></div>
        <IncidentRulesEditor initial={rules} canManage />
      </section>}
    </main>
  );
}
