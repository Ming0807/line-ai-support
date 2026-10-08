import { notFound } from 'next/navigation';
import '../../../incidents.css';
import { requireStaff } from '@/lib/auth/staff';
import { IncidentError } from '@/lib/incidents/contracts';
import { getIncident, getIncidentRules } from '@/lib/incidents/reads';
import IncidentDetailView from '../IncidentDetailView';

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  let detail;
  try {
    detail = await getIncident(staff.id, id);
  } catch (error) {
    if (error instanceof IncidentError && error.code === 'NOT_FOUND') notFound();
    return <main className="incident-page"><div className="incident-state incident-error" role="alert"><h1>ยังอ่านข้อมูลเหตุการณ์ไม่ได้</h1><p>ระบบไม่สามารถยืนยันรายละเอียดเหตุการณ์หรือคำร้องที่เชื่อมโยงได้ โปรดลองโหลดอีกครั้ง</p><a className="incident-primary-button" href={`/incidents/${encodeURIComponent(id)}`}>ลองอีกครั้ง</a></div></main>;
  }
  let rules = null;
  const canViewRules = staff.role === 'SUPER_ADMIN';
  if (canViewRules) {
    try { rules = await getIncidentRules(staff.id); } catch { rules = null; }
  }
  return <IncidentDetailView detail={detail} rules={rules} canViewRules={canViewRules} />;
}
