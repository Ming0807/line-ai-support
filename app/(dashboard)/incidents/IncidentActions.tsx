'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { IncidentRulesView } from '@/lib/incidents/reads';
import { staffAlertSettingsSchema } from '@/lib/incidents/staff-alert-contracts';
import { isRulesActionResponse, isStatusActionResponse, nextIncidentStatuses } from './presentation';

export function IncidentStatusActions({ incidentId, revision, status, canManage }: {
  incidentId: string; revision: number; status: string; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const allowed = nextIncidentStatuses(status);

  async function submit(formData: FormData) {
    const nextStatus = formData.get('status');
    if (typeof nextStatus !== 'string' || !allowed.includes(nextStatus)) return;
    const verifyImpact = formData.get('verifyImpact') === 'on';
    const verificationNote = String(formData.get('verificationNote') ?? '').trim();
    if (verifyImpact && (verificationNote.length < 10 || verificationNote.length > 1000)) {
      setMessage('กรุณาระบุสิ่งที่ตรวจยืนยันแล้วอย่างน้อย 10 ตัวอักษร');
      return;
    }
    const impact = verifyImpact ? {
      campusWide: formData.get('campusWide') === 'on',
      criticalService: formData.get('criticalService') === 'on',
      confirmedOutage: formData.get('confirmedOutage') === 'on', verificationNote,
    } : undefined;
    setPending(true);
    setMessage('');
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/status`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision, requestId: crypto.randomUUID(), status: nextStatus, ...(impact ? { impact } : {}) }),
      });
      if (response.status === 409) {
        setMessage('ข้อมูลเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง');
        return;
      }
      if (!response.ok) {
        setMessage('เปลี่ยนสถานะไม่สำเร็จ โปรดลองอีกครั้ง');
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!isStatusActionResponse(body)) {
        setMessage('ระบบส่งผลบันทึกที่ตรวจสอบไม่ได้ โปรดโหลดข้อมูลล่าสุด');
        return;
      }
      router.refresh();
      setMessage('บันทึกสถานะแล้ว');
    } catch {
      setMessage('เชื่อมต่อเพื่อเปลี่ยนสถานะไม่ได้ โปรดลองอีกครั้ง');
    } finally {
      setPending(false);
    }
  }

  if (!canManage || allowed.length === 0) return null;
  return (
    <form className="incident-action-form" action={submit}>
      <label>
        <span>เปลี่ยนสถานะเหตุการณ์</span>
        <select name="status" defaultValue={allowed[0]} disabled={pending}>
          {allowed.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <details>
        <summary>ยืนยันผลกระทบเพื่อปรับระดับความรุนแรง</summary>
        <p>ระดับวิกฤตต้องยืนยันครบทั้งสามข้อ พร้อมระบุเหตุผลที่ตรวจสอบแล้ว</p>
        <label><input type="checkbox" name="verifyImpact" disabled={pending} /><span>ปรับระดับตามผลกระทบที่ฉันตรวจยืนยัน</span></label>
        <label><input type="checkbox" name="campusWide" disabled={pending} /><span>ส่งผลทั่วมหาวิทยาลัย</span></label>
        <label><input type="checkbox" name="criticalService" disabled={pending} /><span>เป็นบริการสำคัญ</span></label>
        <label><input type="checkbox" name="confirmedOutage" disabled={pending} /><span>ตรวจยืนยันว่าบริการใช้งานไม่ได้</span></label>
        <label><span>เหตุผลหรือหลักฐานที่ตรวจยืนยัน</span><textarea name="verificationNote" minLength={10} maxLength={1000} disabled={pending} /></label>
      </details>
      <button className="incident-primary-button" type="submit" disabled={pending}>{pending ? 'กำลังบันทึก…' : 'บันทึกสถานะ'}</button>
      {message && <p role="status" aria-live="polite">{message}</p>}
    </form>
  );
}

export function IncidentRulesEditor({ initial, canManage }: { initial: IncidentRulesView | null; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  if (!canManage) return null;
  if (!initial) return <p className="incident-inline-error" role="status">ยังอ่านกติกาการตรวจจับไม่ได้ การแสดงผลนี้ไม่ได้ใช้ค่าเริ่มต้นแทนข้อมูลจริง</p>;
  const save = createIncidentRulesSaveAction(initial, { fetcher: fetch, setPending, setMessage, refresh: router.refresh });

  return (
    <form className="incident-rules-form" action={save}>
      <label><span>จำนวนรายงานขั้นต่ำ</span><input name="minReports" type="number" min={2} max={100} required defaultValue={initial.rules.minReports} /></label>
      <label><span>ผู้รายงานไม่ซ้ำขั้นต่ำ</span><input name="minDistinctSessions" type="number" min={2} max={100} required defaultValue={initial.rules.minDistinctSessions} /></label>
      <label><span>ช่วงเวลาตรวจจับ (นาที)</span><input name="windowMinutes" type="number" min={1} max={1440} required defaultValue={initial.rules.windowMinutes} /></label>
      <label><span>ความคล้ายขั้นต่ำ (0.5–1)</span><input name="minSimilarity" type="number" min={0.5} max={1} step="0.01" required defaultValue={initial.rules.minSimilarity} /></label>
      {initial.notifications === null ? (
        <p className="incident-inline-error" role="status">ยังไม่ทราบการตั้งเวลารับแจ้งเตือนเจ้าหน้าที่ จึงยังไม่มีค่าที่แสดงหรือแก้ไขได้</p>
      ) : (
        <div className="incident-alert-settings">
          <label htmlFor="incident-alert-debounce"><span>เวลารอก่อนแจ้งเจ้าหน้าที่ (วินาที)</span></label>
          <input id="incident-alert-debounce" name="debounceSeconds" type="number" min={0} max={300} step={1} required
            aria-describedby="incident-alert-debounce-help" defaultValue={initial.notifications.debounceSeconds} disabled={pending} />
          <p id="incident-alert-debounce-help">
            เคสใหม่ในเหตุการณ์เดียวกันจะถูกรวมในกลุ่มระหว่างช่วงเวลานี้ก่อนแจ้งเจ้าหน้าที่; เหตุการณ์วิกฤตแจ้งทันทีโดยไม่รอ
            ระบบไม่รับเคสแทนเจ้าหน้าที่และไม่ทำเครื่องหมายว่าอ่านแล้ว
          </p>
        </div>
      )}
      <button className="incident-primary-button" type="submit" disabled={pending}>{pending ? 'กำลังบันทึก…' : 'บันทึกกติกา'}</button>
      {message && <p role="status" aria-live="polite">{message}</p>}
    </form>
  );
}

type IncidentRulesSaveDependencies = {
  fetcher: typeof fetch;
  setPending: (pending: boolean) => void;
  setMessage: (message: string) => void;
  refresh: () => void;
};

export function createIncidentRulesSaveAction(initial: IncidentRulesView, dependencies: IncidentRulesSaveDependencies) {
  const { fetcher } = dependencies;
  return async (formData: FormData) => {
    const minReports = Number(formData.get('minReports'));
    const minDistinctSessions = Number(formData.get('minDistinctSessions'));
    const windowMinutes = Number(formData.get('windowMinutes'));
    const minSimilarity = Number(formData.get('minSimilarity'));
    const rules = { minReports, minDistinctSessions, windowMinutes, minSimilarity };
    if (!Number.isInteger(minReports) || minReports < 2 || minReports > 100
      || !Number.isInteger(minDistinctSessions) || minDistinctSessions < 2 || minDistinctSessions > minReports
      || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440
      || !Number.isFinite(minSimilarity) || minSimilarity < 0.5 || minSimilarity > 1) {
      dependencies.setMessage('ตรวจช่วงค่าอีกครั้ง: ผู้รายงานไม่ซ้ำต้องไม่เกินจำนวนรายงาน');
      return;
    }

    let notifications: IncidentRulesView['notifications'] | undefined;
    if (initial.notifications !== null) {
      const rawDebounceSeconds = formData.get('debounceSeconds');
      const parsedNotifications = staffAlertSettingsSchema.safeParse({
        debounceSeconds: typeof rawDebounceSeconds === 'string' && rawDebounceSeconds.trim() !== ''
          ? Number(rawDebounceSeconds)
          : Number.NaN,
      });
      if (!parsedNotifications.success) {
        dependencies.setMessage('ระบุเวลารอเป็นจำนวนเต็มตั้งแต่ 0 ถึง 300 วินาที');
        return;
      }
      notifications = parsedNotifications.data;
    }

    dependencies.setPending(true);
    dependencies.setMessage('');
    try {
      const response = await fetcher('/api/incidents/rules', {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: initial.revision, rules, ...(notifications ? { notifications } : {}) }),
      });
      if (response.status === 409) {
        dependencies.setMessage('กติกาถูกแก้ไขแล้ว โหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง');
        return;
      }
      if (!response.ok) {
        dependencies.setMessage('บันทึกกติกาไม่สำเร็จ โปรดลองอีกครั้ง');
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!isRulesActionResponse(body)) {
        dependencies.setMessage('ระบบส่งผลบันทึกที่ตรวจสอบไม่ได้ โปรดโหลดข้อมูลล่าสุด');
        return;
      }
      dependencies.setMessage('บันทึกกติกาแล้ว');
      dependencies.refresh();
    } catch {
      dependencies.setMessage('เชื่อมต่อเพื่อบันทึกกติกาไม่ได้ โปรดลองอีกครั้ง');
    } finally {
      dependencies.setPending(false);
    }
  };
}
