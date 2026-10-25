'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FreeAccountView, ProviderView } from '@/types/providers';

type Action = 'save' | 'revoke' | null;
type FormNotice = { kind: 'success' | 'error'; text: string } | null;

const statusText: Record<FreeAccountView['status'], string> = {
  ACTIVE: 'มีการยืนยันที่บันทึกไว้และยังไม่หมดอายุ',
  EXPIRED: 'การยืนยันเดิมหมดอายุแล้ว',
  REVOKED: 'การยืนยันเดิมถูกยกเลิกแล้ว',
  STALE: 'ข้อมูลผู้ให้บริการหรือ endpoint เปลี่ยนหลังการยืนยันเดิม',
  LEGACY: 'พบการยืนยันจาก environment เดิม ยังไม่มีรายการที่บันทึกในหน้านี้',
  NONE: 'ยังไม่มีการยืนยัน Free account ที่บันทึกไว้',
};

function dateLabel(value: string | null): string {
  if (!value) return 'ไม่มีข้อมูล';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ไม่มีข้อมูล' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function buildFreeAccountSavePayload(input: {
  providerRevision: number;
  grantRevision: number | null;
  selectedModels: string[];
  validForDays: number;
  confirmFreeTier: boolean;
  billingDisabled: boolean;
  eligibleModels: string[];
}): Record<string, unknown> | null {
  const selected = new Set(input.selectedModels);
  const models = [...new Set(input.eligibleModels)].filter(model => selected.has(model));
  if (!input.confirmFreeTier || !input.billingDisabled || models.length === 0
    || !Number.isInteger(input.validForDays) || input.validForDays < 1 || input.validForDays > 30) return null;
  return {
    providerRevision: input.providerRevision,
    grantRevision: input.grantRevision,
    models,
    validForDays: input.validForDays,
    confirmFreeTier: true,
    billingDisabled: true,
  };
}

export default function FreeAccountForm({ provider, view }: { provider: ProviderView; view?: FreeAccountView }) {
  const router = useRouter();
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [validForDays, setValidForDays] = useState('');
  const [confirmFreeTier, setConfirmFreeTier] = useState(false);
  const [billingDisabled, setBillingDisabled] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [notice, setNotice] = useState<FormNotice>(null);
  const [conflictSignature, setConflictSignature] = useState<string | null>(null);
  const [refreshSignature, setRefreshSignature] = useState<string | null>(null);
  const signature = useMemo(() => JSON.stringify({ providerRevision: provider.revision, view }), [provider.revision, view]);
  const staleAfterConflict = conflictSignature === signature;
  const awaitingFreshView = refreshSignature === signature;
  const schemaReady = view?.schemaReady === true;
  const eligibleModels = view?.eligibleModels ?? [];
  const grantRevision = view?.revision ?? null;
  const disabled = !schemaReady || staleAfterConflict || awaitingFreshView || action !== null;
  const savePayload = view ? buildFreeAccountSavePayload({
    providerRevision: provider.revision,
    grantRevision,
    selectedModels,
    validForDays: Number(validForDays),
    confirmFreeTier,
    billingDisabled,
    eligibleModels,
  }) : null;
  const canRevoke = !disabled && view?.status !== 'NONE';

  async function submit(method: 'PUT' | 'DELETE', body: Record<string, unknown>, nextAction: Exclude<Action, null>) {
    setAction(nextAction);
    setNotice(null);
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/free-account`, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setSelectedModels([]);
          setValidForDays('');
          setConfirmFreeTier(false);
          setBillingDisabled(false);
          setConflictSignature(signature);
          setNotice({ kind: 'error', text: 'ข้อมูลเปลี่ยนระหว่างตรวจสอบ ระบบล้างคำยืนยันและกำลังโหลดข้อมูลล่าสุด ตรวจทุกช่องอีกครั้งก่อนบันทึกใหม่' });
          router.refresh();
          return;
        }
        setNotice({ kind: 'error', text: response.status === 503
          ? 'ระบบจัดการสิทธิ Free ยังไม่พร้อม กรุณาลองใหม่ภายหลัง'
          : response.status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์จัดการผู้ให้บริการ'
            : response.status === 404 ? 'ไม่พบผู้ให้บริการนี้ กรุณาโหลดหน้าปัจจุบันอีกครั้ง'
              : response.status === 400 ? 'ข้อมูลไม่ครบหรือ Model ไม่อยู่ในรายการที่อนุญาต กรุณาตรวจรายการแล้วลองใหม่'
                : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
        return;
      }
      setNotice({ kind: 'success', text: nextAction === 'save'
        ? 'บันทึกการยืนยันผู้ดูแลแล้ว ระบบจะยังตรวจสิทธิ์ก่อนเรียก Model'
        : 'ยกเลิกการยืนยันผู้ดูแลแล้ว' });
      setSelectedModels([]);
      setValidForDays('');
      setConfirmFreeTier(false);
      setBillingDisabled(false);
      setRefreshSignature(signature);
      router.refresh();
    } catch {
      setNotice({ kind: 'error', text: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจเครือข่ายแล้วลองใหม่' });
    } finally {
      setAction(null);
    }
  }

  function toggleModel(model: string, checked: boolean) {
    setSelectedModels(current => checked
      ? current.includes(model) ? current : [...current, model]
      : current.filter(value => value !== model));
  }

  return <section className="provider-form" aria-labelledby={`${provider.id}-free-account-title`}>
    <div>
      <h3 id={`${provider.id}-free-account-title`}>ยืนยันสิทธิ Free account</h3>
      <p className="provider-field-hint">การยืนยันนี้เป็นคำรับรองของผู้ดูแล ไม่ใช่หลักฐานการเรียกเก็บเงินหรือโควต้าจากผู้ให้บริการ (ซึ่งอาจยังไม่ทราบ) ระบบยังต้องตรวจสิทธิ์ก่อนใช้งาน</p>
    </div>
    {awaitingFreshView && <p className="provider-field-hint" role="status">กำลังโหลดสถานะล่าสุดก่อนรับคำขอถัดไป</p>}
    {(awaitingFreshView || staleAfterConflict) && <button type="button" className="provider-button provider-button-secondary" onClick={() => router.refresh()} disabled={action !== null}>โหลดสถานะล่าสุด</button>}

    {!view ? <p className="provider-notice provider-notice-error" role="status">ยังอ่านสถานะ Free account ไม่ได้ จึงยังเปลี่ยนแปลงสิทธิไม่ได้ กรุณาโหลดข้อมูลผู้ให้บริการใหม่</p>
      : <>
        <div aria-live="polite">
          <p><strong>สถานะ:</strong> {statusText[view.status]}</p>
          {view.models.length > 0 && <p><strong>Model ที่มีการบันทึก:</strong> {view.models.join(', ')}</p>}
          {view.status === 'LEGACY' && <p className="provider-field-hint">ข้อมูลนี้มาจาก environment เดิม ไม่ใช่ managed grant ในหน้านี้</p>}
          {view.confirmedAt && <p className="provider-field-hint">ยืนยันเมื่อ {dateLabel(view.confirmedAt)}</p>}
          {view.expiresAt && <p className="provider-field-hint">หมดอายุ {dateLabel(view.expiresAt)}</p>}
        </div>

        {!schemaReady ? <div className="provider-notice" role="status"><strong>ยังจัดการไม่ได้</strong><p>โครงสร้างจัดเก็บการยืนยันยังไม่พร้อม โปรดให้ผู้ดูแลระบบเตรียม schema ก่อน ไม่มีการเปลี่ยนแปลงใดถูกส่ง</p></div>
          : eligibleModels.length === 0 ? <p className="provider-field-hint">ยังไม่มี Model สร้างคำตอบที่เข้าเกณฑ์ใน endpoint นี้ เพิ่มหรือแก้ไข Model ก่อน</p>
            : <fieldset className="provider-form-fieldset" disabled={disabled}>
              <legend>เลือก Model ที่ยืนยันทีละรายการ</legend>
              <div className="provider-checks">
                {eligibleModels.map((model, index) => {
                  const id = `${provider.id}-free-account-model-${index}`;
                  return <label className="provider-check" htmlFor={id} key={model}>
                    <input id={id} type="checkbox" checked={selectedModels.includes(model)} onChange={event => toggleModel(model, event.target.checked)} />
                    <span>{model}</span>
                  </label>;
                })}
              </div>
              <label className="provider-field" htmlFor={`${provider.id}-free-account-days`}>
                ระยะเวลาที่รับรอง (วัน)
                <input id={`${provider.id}-free-account-days`} type="number" min={1} max={30} step={1} inputMode="numeric" value={validForDays} onChange={event => setValidForDays(event.target.value)} required />
                <span className="provider-field-hint">1–30 วัน · ต้องยืนยันใหม่เมื่อหมดอายุ</span>
              </label>
              <label className="provider-check" htmlFor={`${provider.id}-free-tier-confirm`}>
                <input id={`${provider.id}-free-tier-confirm`} type="checkbox" checked={confirmFreeTier} onChange={event => setConfirmFreeTier(event.target.checked)} />
                <span>ฉันตรวจสอบบัญชีแล้วว่า Model ที่เลือกอยู่ใน Free tier</span>
              </label>
              <label className="provider-check" htmlFor={`${provider.id}-billing-disabled-confirm`}>
                <input id={`${provider.id}-billing-disabled-confirm`} type="checkbox" checked={billingDisabled} onChange={event => setBillingDisabled(event.target.checked)} />
                <span>ฉันยืนยันว่าปิดการเรียกเก็บเงินไว้</span>
              </label>
              <div className="provider-form-actions">
                <button className="provider-button provider-button-primary" type="button" disabled={!savePayload || disabled} onClick={() => savePayload && void submit('PUT', savePayload, 'save')}>
                  {action === 'save' ? 'กำลังบันทึก…' : 'บันทึกการยืนยัน'}
                </button>
              </div>
            </fieldset>}
        {canRevoke && <button className="provider-button provider-button-secondary" type="button" disabled={disabled} onClick={() => void submit('DELETE', { providerRevision: provider.revision, grantRevision }, 'revoke')}>
          {action === 'revoke' ? 'กำลังยกเลิก…' : 'ยกเลิกการยืนยัน'}
        </button>}
        {staleAfterConflict && <div className="provider-form-conflict" role="alert">
          <p>คำยืนยันและค่าที่กรอกเดิมถูกยกเลิกแล้ว รอข้อมูล revision ล่าสุดก่อนเริ่มใหม่</p>
          <button className="provider-button provider-button-secondary" type="button" onClick={() => router.refresh()}>โหลดข้อมูลล่าสุด</button>
        </div>}
      </>}
    {notice && <p className={`provider-notice provider-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
  </section>;
}
