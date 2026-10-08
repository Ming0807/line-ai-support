/** Strict projection of the root-owned, privacy-safe Activities and Logs DTOs. */

import {
  activityItemSchema,
  activityLabels,
  logCodes,
  logItemSchema,
  type ActivityItem,
  type LogItem,
} from '@/lib/operations/contracts';

export type { ActivityItem, LogItem };
export type ProjectionResult<T> = { ok: true; item: T } | { ok: false; error: string };

export const ACTIVITY_ACTION_LABELS = activityLabels;
export const LOG_SEVERITY_LABELS: Record<'ERROR' | 'WARN' | 'INFO', string> = {
  ERROR: 'ข้อผิดพลาด',
  WARN: 'คำเตือน',
  INFO: 'ข้อมูลทั่วไป',
};
export const LOG_CODES = logCodes;
export const LOG_COMPONENTS = ['ai-gateway', 'line-delivery'] as const;

export function projectActivityFields(raw: unknown): ProjectionResult<ActivityItem> {
  const parsed = activityItemSchema.safeParse(raw);
  if (!parsed.success || parsed.data.actionLabel !== activityLabels[parsed.data.action] ||
      parsed.data.summary !== activityLabels[parsed.data.action]) {
    return { ok: false, error: 'แถวข้อมูลกิจกรรมไม่ผ่านสัญญาที่อนุมัติ' };
  }
  return { ok: true, item: parsed.data };
}

export function projectLogFields(raw: unknown): ProjectionResult<LogItem> {
  const parsed = logItemSchema.safeParse(raw);
  if (!parsed.success || /[\u0000-\u001f\u007f-\u009f]/u.test(parsed.data.label)) {
    return { ok: false, error: 'แถวข้อมูลบันทึกไม่ผ่านสัญญาที่อนุมัติ' };
  }
  return { ok: true, item: parsed.data };
}
