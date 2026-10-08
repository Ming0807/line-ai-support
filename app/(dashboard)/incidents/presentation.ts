import { parseIncidentQuery } from '@/lib/incidents/contracts';

export type IncidentSearchParams = Record<string, string | string[] | undefined>;

export function parseIncidentSearchParams(searchParams: IncidentSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') params.append(key, value);
    else if (Array.isArray(value)) for (const entry of value) params.append(key, entry);
  }
  return parseIncidentQuery(params);
}

export function nextIncidentStatuses(status: string): readonly string[] {
  switch (status) {
    case 'DETECTED': return ['INVESTIGATING'];
    case 'INVESTIGATING': return ['MONITORING', 'RESOLVED'];
    case 'MONITORING': return ['INVESTIGATING', 'RESOLVED'];
    case 'RESOLVED': return ['INVESTIGATING', 'CLOSED'];
    default: return [];
  }
}

export function isStatusActionResponse(value: unknown): value is { revision: number; replayed: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 2 && 'revision' in body && 'replayed' in body
    && Number.isInteger(body.revision) && (body.revision as number) >= 0 && typeof body.replayed === 'boolean';
}

export function isRulesActionResponse(value: unknown): value is { revision: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && 'revision' in body
    && Number.isInteger(body.revision) && (body.revision as number) >= 0;
}

export function incidentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DETECTED: 'ตรวจพบ', INVESTIGATING: 'กำลังตรวจสอบ', MONITORING: 'เฝ้าติดตาม', RESOLVED: 'แก้ไขแล้ว', CLOSED: 'ปิดเหตุการณ์',
  };
  return labels[status] ?? 'ไม่ทราบสถานะ';
}

export function incidentSeverityLabel(severity: string): string {
  const labels: Record<string, string> = { MEDIUM: 'ปานกลาง', HIGH: 'สูง', CRITICAL: 'วิกฤต' };
  return labels[severity] ?? 'ไม่ทราบระดับ';
}
