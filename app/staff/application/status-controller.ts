/**
 * Controller for the self-service application status page (/staff/application).
 * Presentation is derived only from GET /api/staff/onboarding (server truth):
 * no resubmit commands are invented, and reasons show only when the server
 * includes them.
 */
import type {StaffApplicationContext,StaffApplicationItem} from '@/types/staff-applications';

export type StatusPhase =
  | 'loading'|'unavailable'|'login'|'linkLine'|'alreadyStaff'
  | 'noApplication'|'pending'|'approved'|'rejected'|'suspended';

export type StatusView = {phase:StatusPhase; application:StaffApplicationItem|null};

export function resolveStatusView(
  context:StaffApplicationContext,
  application:StaffApplicationItem|null,
): StatusView {
  if (!context.authenticated) return {phase:'login', application:null};
  if (!context.lineLinked) return {phase:'linkLine', application:null};
  if (context.staffActive) return {phase:'alreadyStaff', application:null};
  if (!application) return {phase:'noApplication', application:null};
  switch (application.status) {
    case 'PENDING': return {phase:'pending', application};
    case 'APPROVED': return {phase:'approved', application};
    case 'REJECTED': return {phase:'rejected', application};
    case 'SUSPENDED': return {phase:'suspended', application};
    default: return {phase:'pending', application};
  }
}

const STATUS_LABELS: Record<'pending'|'approved'|'rejected'|'suspended', string> = {
  pending:'อยู่ระหว่างพิจารณา', approved:'อนุมัติแล้ว', rejected:'ไม่อนุมัติ', suspended:'ระงับการใช้งาน',
};

export function statusLabel(phase:StatusPhase): string|null {
  return phase in STATUS_LABELS ? STATUS_LABELS[phase as keyof typeof STATUS_LABELS] : null;
}

/** Thai stamp for display; returns null for missing/invalid values so callers can omit the row. */
export function formatThaiStamp(value:string|null): string|null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('th-TH', {dateStyle:'long', timeStyle:'short'}).format(date);
}
