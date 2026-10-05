'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FallbackPreviewView, ModelPurpose, ModelView, ProviderKind, ProviderView } from '@/types/providers';
import { isModelCoolingDown } from '@/lib/ai/model-selection';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type ApiResult = Record<string, unknown> | null;
type ProviderChoice = { adapter: ProviderKind; baseUrl: string };
type ApiController = {
  notice: Notice;
  pending(key: string): boolean;
  send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, successText: string, key: string, refresh?: boolean): Promise<ApiResult>;
};

const adapterLabels: Record<ProviderKind, string> = { ZEN: 'OpenCode Zen', OPENROUTER: 'OpenRouter', OPENAI: 'OpenAI', COMPATIBLE: 'อื่น ๆ · OpenAI compatible' };
const purposeLabels: Record<ModelPurpose, string> = { GENERATION: 'สร้างคำตอบ', EMBEDDING: 'Embedding' };
const errorMessage = (status: number) => status === 400 ? 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบรายการที่กรอก'
  : status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    : status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์จัดการผู้ให้บริการ'
      : status === 404 ? 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว'
        : status === 409 ? 'ข้อมูลอาจเปลี่ยนหรือมีคำขอกำลังทำงาน โหลดข้อมูลล่าสุดแล้ว กรุณารอสักครู่และลองอีกครั้ง'
          : status === 429 ? 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง'
            : status === 503 ? 'บริการยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง'
              : 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง';

function useApiController(): ApiController {
  const router = useRouter();
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const activeRequests = useRef(new Set<string>());
  const [notice, setNotice] = useState<Notice>(null);
  async function send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, successText: string, key: string, refresh = true): Promise<ApiResult> {
    if (activeRequests.current.has(key)) return null;
    activeRequests.current.add(key);
    setPendingKeys(current => new Set(current).add(key));
    setNotice(null);
    try {
      const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        const endpointUnavailable = failure && typeof failure === 'object' && 'error' in failure && failure.error === 'ENDPOINT_UNAVAILABLE';
        setNotice({ kind: 'error', text: endpointUnavailable ? 'ตรวจสอบปลายทางไม่ได้ กรุณาใช้ HTTPS ของผู้ให้บริการที่เข้าถึงได้จากอินเทอร์เน็ต' : errorMessage(response.status) });
        if (response.status === 409) router.refresh();
        return null;
      }
      const payload: unknown = await response.json().catch(() => null);
      const observation = payload && typeof payload === 'object' && 'observation' in payload ? payload.observation : null;
      const failedProbe = observation && typeof observation === 'object' && 'result' in observation && observation.result !== 'SUCCESS';
      setNotice({ kind: failedProbe ? 'error' : 'success', text: failedProbe ? 'ตรวจเสร็จแล้ว แต่ Model ยังไม่ผ่าน ดูผลและรหัสเหตุผลในรายการ' : successText });
      if (refresh) router.refresh();
      return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    } catch {
      setNotice({ kind: 'error', text: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง' });
      return null;
    } finally {
      activeRequests.current.delete(key);
      setPendingKeys(current => { const next = new Set(current); next.delete(key); return next; });
    }
  }
  return { notice, pending: key => pendingKeys.has(key), send };
}

function NoticeLine({ notice }: { notice: Notice }) {
  return notice ? <p className={`provider-notice provider-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null;
}

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return <label className="provider-field" htmlFor={id}>{label}{children}{hint && <span className="provider-field-hint">{hint}</span>}</label>;
}

function CheckField({ id, label, name, defaultChecked, checked, onChange, disabled }: {
  id: string; label: string; name: string; defaultChecked?: boolean; checked?: boolean; onChange?: (event: ChangeEvent<HTMLInputElement>) => void; disabled?: boolean;
}) {
  return <label className="provider-check" htmlFor={id}><input id={id} name={name} type="checkbox" defaultChecked={checked === undefined ? defaultChecked : undefined} checked={checked} onChange={onChange} disabled={disabled} /><span>{label}</span></label>;
}

function NumberField({ id, label, name, defaultValue, min, max, step = 1, hint, required = true }: {
  id: string; label: string; name: string; defaultValue?: number; min: number; max: number; step?: number | 'any'; hint?: string; required?: boolean;
}) {
  return <Field id={id} label={label} hint={hint}><input id={id} name={name} type="number" min={min} max={max} step={step} defaultValue={defaultValue} required={required} /></Field>;
}

function priceValue(form: FormData, name: string): number | null {
  const value = String(form.get(name) ?? '').trim();
  return value === '' ? null : Number(value);
}

function commonModelValues(form: FormData) {
  const dimensions = String(form.get('embeddingDimensions') ?? '').trim();
  return {
    modelId: String(form.get('modelId') ?? '').trim(), displayName: String(form.get('displayName') ?? '').trim(),
    purpose: String(form.get('purpose') ?? 'GENERATION'), embeddingDimensions: dimensions === '' ? null : Number(dimensions),
    supportsTools: form.has('supportsTools'), supportsJson: form.has('supportsJson'), supportsVision: form.has('supportsVision'),
    enabled: form.has('enabled'), priority: Number(form.get('priority')), timeoutMs: Number(form.get('timeoutMs')),
    inputPricePerMillion: priceValue(form, 'inputPricePerMillion'), outputPricePerMillion: priceValue(form, 'outputPricePerMillion'),
  };
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'ยังไม่มีข้อมูล';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ยังไม่มีข้อมูล' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusText(model: ModelView): string {
  const observation = model.latestObservation;
  if (!observation) return 'ยังไม่ทดสอบ';
  const action = observation.action === 'METADATA' ? 'Metadata' : observation.action === 'GENERATION_TEST' ? 'ทดสอบสร้างคำตอบ' : observation.action === 'EMBEDDING_TEST' ? 'ทดสอบ Embedding' : 'Runtime';
  const result = observation.result === 'SUCCESS' ? 'ผ่าน' : observation.result === 'BLOCKED' ? 'ถูกข้าม' : observation.result === 'UNKNOWN' ? 'ไม่ทราบผล' : 'ไม่ผ่าน';
  return `${action} · ${result}${observation.httpStatus === null ? '' : ` · HTTP ${observation.httpStatus}`}`;
}

function priceStatus(model: ModelView, now: number): ModelView['pricingStatus'] {
  const age = model.pricingCheckedAt ? now - Date.parse(model.pricingCheckedAt) : Infinity;
  return Number.isFinite(age) && age >= -1000 && age <= 60_000 ? model.pricingStatus : 'UNKNOWN';
}

function useObservationTime(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  return now;
}

function priceLabel(model: ModelView, now: number): string {
  const status = priceStatus(model, now);
  return status === 'FREE' ? 'ฟรี · ตรวจจากผู้ให้บริการ' : status === 'PAID' ? 'มีค่าใช้จ่าย' : 'ราคาไม่ทราบ';
}

function reasonLabel(reason: FallbackPreviewView['rows'][number]['reason']): string {
  switch (reason) {
    case 'DISABLED': return 'ปิดใช้งาน';
    case 'KEY_MISSING': return 'ยังไม่มี API key';
    case 'PRICE_UNKNOWN': return 'ราคาไม่ทราบ';
    case 'PAID_BLOCKED': return 'นโยบายไม่อนุญาตรุ่นที่มีค่าใช้จ่าย';
    case 'CAPABILITY_UNSUPPORTED': return 'ไม่รองรับความสามารถที่เลือก';
    case 'COOLDOWN': return 'รอให้ครบเวลาที่ผู้ให้บริการแจ้ง';
    case 'VECTOR_COHORT_MISMATCH': return 'ไม่ตรงกับชุด Embedding';
    case 'REGISTRY_LIMIT': return 'เกินขอบเขต 64 รุ่นที่ระบบพิจารณา';
    case 'ATTEMPT_LIMIT': return 'เกินขอบเขตสูงสุด 3 การลอง';
    default: return 'อยู่ในตัวเลือกตาม catalog ล่าสุด';
  }
}

type OrderedRow = { id: string; revision: number };
function OrderEditor<T extends OrderedRow>({ rows, onSave, label, children, controls = true }: {
  rows: T[]; label: (row: T) => string;
  controls?: boolean;
  onSave: (rows: T[]) => Promise<boolean>; children: (row: T, index: number, count: number, move: (delta: -1 | 1) => void) => ReactNode;
}) {
  const initialIds = rows.map(row => row.id);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useLayoutEffect(() => {
    if (focusTarget) document.getElementById(focusTarget)?.focus();
  }, [draft, focusTarget]);
  const orderedIds = draft ?? initialIds;
  const orderedRows = orderedIds.map(id => rows.find(row => row.id === id)).filter((row): row is T => Boolean(row));
  function move(id: string, delta: -1 | 1) {
    if (saving || saved) return;
    const index = orderedIds.indexOf(id);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
    const next = [...orderedIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraft(next);
    const row = rows.find(item => item.id === id);
    setAnnouncement(`${label(row as T)} อยู่ลำดับที่ ${nextIndex + 1} จาก ${next.length}`);
    setFocusTarget(`${id}-order-${nextIndex === 0 ? 'down' : 'up'}`);
  }
  const dirty = !saved && draft !== null && draft.some((id, index) => id !== initialIds[index]);
  return <>
    {orderedRows.map((row, index) => <div className="provider-ordered-item" key={row.id}>
      {children(row, index, orderedRows.length, delta => move(row.id, delta))}
      {controls && <div className="provider-order-controls" aria-label={`จัดลำดับ ${label(row)}`}>
        <button id={`${row.id}-order-up`} data-order-direction="up" className="provider-button provider-button-tertiary" type="button" aria-label={`เลื่อน ${label(row)} ขึ้นหนึ่งลำดับ`} onClick={() => move(row.id, -1)} disabled={saving || saved || index === 0}>ขึ้น</button>
        <button id={`${row.id}-order-down`} data-order-direction="down" className="provider-button provider-button-tertiary" type="button" aria-label={`เลื่อน ${label(row)} ลงหนึ่งลำดับ`} onClick={() => move(row.id, 1)} disabled={saving || saved || index === orderedRows.length - 1}>ลง</button>
      </div>}
    </div>)}
    <p className="provider-sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    {dirty && <div className="provider-draft-actions"><span>มีการเปลี่ยนลำดับที่ยังไม่บันทึก</span><div>
      <button className="provider-button provider-button-secondary" type="button" disabled={saving} onClick={() => { setDraft(null); setAnnouncement('ยกเลิกการเปลี่ยนลำดับแล้ว'); setFocusTarget(null); }}>ยกเลิก</button>
      <button className="provider-button provider-button-primary" type="button" disabled={saving} onClick={async () => {
        if (saving) return;
        setSaving(true);
        try { const ok = await onSave(orderedRows); if (ok) { setSaved(true); setAnnouncement('บันทึกลำดับแล้ว'); } }
        finally { setSaving(false); }
      }}>{saving ? 'กำลังบันทึก…' : 'บันทึกลำดับ'}</button>
    </div></div>}
  </>;
}

function CreateProviderForm({ choices }: { choices: ProviderChoice[] }) {
  const api = useApiController();
  const [adapter, setAdapter] = useState<ProviderKind>('ZEN');
  const [baseUrl, setBaseUrl] = useState(choices.find(choice => choice.adapter === 'ZEN')?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const urls = choices.filter(choice => choice.adapter === adapter);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const result = await api.send('/api/providers', 'POST', {
      name: String(form.get('name') ?? '').trim(), adapter, baseUrl: String(form.get('baseUrl') ?? ''),
      enabled: form.has('enabled'), priority: Number(form.get('priority')), apiKey, costMode: String(form.get('costMode') ?? 'FREE_ONLY'),
    }, 'เพิ่มผู้ให้บริการแล้ว', 'create');
    if (result) { element.reset(); setApiKey(''); setAdapter('ZEN'); setBaseUrl(choices.find(choice => choice.adapter === 'ZEN')?.baseUrl ?? ''); }
  }
  return <details className="provider-add-panel">
    <summary><span>เพิ่มผู้ให้บริการ</span><span className="provider-summary-hint">ค่าเริ่มต้น: ฟรีเท่านั้น</span></summary>
    <form className="provider-form" onSubmit={submit}>
      <div className="provider-fields provider-fields-provider">
        <Field id="new-provider-name" label="ชื่อที่แสดง"><input id="new-provider-name" name="name" maxLength={100} required placeholder="เช่น OpenCode Zen" /></Field>
        <Field id="new-provider-adapter" label="ผู้ให้บริการ"><select id="new-provider-adapter" value={adapter} onChange={event => { const next = event.target.value as ProviderKind; setAdapter(next); setBaseUrl(choices.find(choice => choice.adapter === next)?.baseUrl ?? ''); }}>{choices.map(choice => <option key={choice.adapter} value={choice.adapter}>{adapterLabels[choice.adapter]}</option>)}</select></Field>
        <Field id="new-provider-base-url" label="Base URL" hint={adapter === 'COMPATIBLE' ? 'HTTPS สำหรับ Chat Completions และ Embedding เช่น https://api.provider.com/v1' : undefined}>
          {adapter === 'COMPATIBLE'
            ? <input id="new-provider-base-url" name="baseUrl" type="url" maxLength={2048} required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.provider.com/v1" />
            : <select id="new-provider-base-url" name="baseUrl" value={urls.some(choice => choice.baseUrl === baseUrl) ? baseUrl : urls[0]?.baseUrl} onChange={event => setBaseUrl(event.target.value)}>{urls.map(choice => <option key={choice.baseUrl} value={choice.baseUrl}>{choice.baseUrl}</option>)}</select>}
        </Field>
        <NumberField id="new-provider-priority" label="ลำดับเดิม" name="priority" defaultValue={100} min={0} max={1000} hint="จัดลำดับด้านบนได้หลังเพิ่ม" />
        <Field id="new-provider-cost-mode" label="นโยบายค่าใช้จ่าย"><select id="new-provider-cost-mode" name="costMode" defaultValue="FREE_ONLY"><option value="FREE_ONLY">ใช้เฉพาะรุ่นฟรี (แนะนำ)</option><option value="ALLOW_PAID">อนุญาตรุ่นที่มีค่าใช้จ่าย</option></select></Field>
        <Field id="new-provider-key" label="API key"><input id="new-provider-key" name="apiKey" type="password" autoComplete="new-password" minLength={8} maxLength={512} required value={apiKey} onChange={event => setApiKey(event.target.value)} /></Field>
      </div>
      <div className="provider-form-actions"><CheckField id="new-provider-enabled" name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked /><button className="provider-button provider-button-primary" type="submit" disabled={api.pending('create')}>{api.pending('create') ? 'กำลังบันทึก…' : 'เพิ่มผู้ให้บริการ'}</button></div>
      {api.notice && <NoticeLine notice={api.notice} />}
      <p className="provider-field-hint">ระบบไม่แสดง API key ที่บันทึกไว้แล้ว และจะไม่ใช้คีย์กับปลายทางนอก Base URL ที่กำหนด</p>
      {adapter === 'COMPATIBLE' && <p className="provider-field-hint">ระบบยังยืนยันราคาของผู้ให้บริการอื่นไม่ได้ นโยบายฟรีเท่านั้นจึงข้ามการสร้างคำตอบและ Embedding แม้กรอกราคาเป็นศูนย์</p>}
    </form>
  </details>;
}

function ProviderSettings({ provider, api, choices }: { provider: ProviderView; api: ApiController; choices: ProviderChoice[] }) {
  const [apiKey, setApiKey] = useState('');
  const key = `${provider.id}:settings`;
  const [adapter, setAdapter] = useState(provider.adapter);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const urls = choices.filter(choice => choice.adapter === adapter);
  const replacementRequired = adapter !== provider.adapter || baseUrl.replace(/\/$/, '') !== provider.baseUrl.replace(/\/$/, '');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}`, 'PATCH', {
      name: String(form.get('name') ?? '').trim(), adapter, baseUrl: String(form.get('baseUrl') ?? ''), enabled: form.has('enabled'),
      priority: Number(form.get('priority')), revision: provider.revision, apiKey: apiKey.trim() === '' ? null : apiKey,
      costMode: String(form.get('costMode') ?? 'FREE_ONLY'),
    }, 'บันทึกการตั้งค่าแล้ว', key);
    if (result) setApiKey('');
  }
  return <form className="provider-form provider-settings-form" onSubmit={submit}>
    <div className="provider-fields provider-fields-provider">
      <Field id={`${provider.id}-name`} label="ชื่อที่แสดง"><input id={`${provider.id}-name`} name="name" defaultValue={provider.name} maxLength={100} required /></Field>
      <Field id={`${provider.id}-adapter`} label="ผู้ให้บริการ"><select id={`${provider.id}-adapter`} value={adapter} onChange={event => { const next = event.target.value as ProviderKind; setAdapter(next); setBaseUrl(choices.find(choice => choice.adapter === next)?.baseUrl ?? ''); }}>{choices.map(choice => <option key={choice.adapter} value={choice.adapter}>{adapterLabels[choice.adapter]}</option>)}</select></Field>
      <Field id={`${provider.id}-base-url`} label="Base URL" hint={adapter === 'COMPATIBLE' ? 'HTTPS สำหรับ Chat Completions และ Embedding' : undefined}>
        {adapter === 'COMPATIBLE'
          ? <input id={`${provider.id}-base-url`} name="baseUrl" type="url" maxLength={2048} required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
          : <select id={`${provider.id}-base-url`} name="baseUrl" value={urls.some(choice => choice.baseUrl === baseUrl) ? baseUrl : urls[0]?.baseUrl} onChange={event => setBaseUrl(event.target.value)}>{urls.map(choice => <option key={choice.baseUrl} value={choice.baseUrl}>{choice.baseUrl}</option>)}</select>}
      </Field>
      <NumberField id={`${provider.id}-priority`} label="ลำดับเดิม" name="priority" defaultValue={provider.priority} min={0} max={1000} hint="ใช้ปุ่มขึ้น/ลงเพื่อจัดลำดับ" />
      <Field id={`${provider.id}-cost-mode`} label="นโยบายค่าใช้จ่าย"><select id={`${provider.id}-cost-mode`} name="costMode" defaultValue={provider.costMode}><option value="FREE_ONLY">ใช้เฉพาะรุ่นฟรี</option><option value="ALLOW_PAID">อนุญาตรุ่นที่มีค่าใช้จ่าย</option></select></Field>
      <Field id={`${provider.id}-api-key`} label="เปลี่ยน API key"><input id={`${provider.id}-api-key`} name="apiKey" type="password" autoComplete="new-password" placeholder="เว้นว่างเพื่อเก็บคีย์เดิม" minLength={8} maxLength={512} value={apiKey} onChange={event => setApiKey(event.target.value)} /></Field>
    </div>
    <div className="provider-form-actions"><CheckField id={`${provider.id}-enabled`} name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked={provider.enabled} /><button className="provider-button provider-button-secondary" type="submit" disabled={api.pending(key) || (replacementRequired && apiKey.trim() === '')}>{api.pending(key) ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button></div>
    <p className="provider-field-hint">{provider.keyConfigured ? 'มี API key บันทึกไว้' : 'ยังไม่มี API key'} · คีย์ใหม่จะแทนที่คีย์ปัจจุบัน{replacementRequired ? ' · เปลี่ยนผู้ให้บริการหรือ Base URL ต้องกรอกคีย์ใหม่' : ''}</p>
    {adapter === 'COMPATIBLE' && <p className="provider-field-hint">ราคาไม่ทราบ · นโยบายฟรีเท่านั้นข้ามการสร้างคำตอบและ Embedding จนกว่าจะยืนยันราคาได้</p>}
  </form>;
}

function ModelForm({ provider, model, api, initialPurpose = 'GENERATION' }: { provider: ProviderView; model?: ModelView; api: ApiController; initialPurpose?: ModelPurpose }) {
  const [purpose, setPurpose] = useState<ModelPurpose>(model?.purpose ?? initialPurpose);
  const [dimensions, setDimensions] = useState(model?.embeddingDimensions?.toString() ?? '');
  const [tools, setTools] = useState(model?.supportsTools ?? false);
  const [json, setJson] = useState(model?.supportsJson ?? false);
  const [vision, setVision] = useState(model?.supportsVision ?? false);
  const key = `${provider.id}:${model?.id ?? 'new-model'}:save`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const values = commonModelValues(new FormData(element));
    if (model) await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}`, 'PATCH', { ...values, revision: model.revision }, 'บันทึก Model แล้ว', key);
    else {
      const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models`, 'POST', values, 'เพิ่ม Model แล้ว', key);
      if (result) { element.reset(); setPurpose(initialPurpose); setDimensions(''); setTools(false); setJson(false); setVision(false); }
    }
  }
  const prefix = `${provider.id}-${model?.id ?? 'new-model'}`;
  const embedding = purpose === 'EMBEDDING';
  return <form className="provider-form model-form" onSubmit={submit}>
    <div className="provider-fields provider-fields-model">
      <Field id={`${prefix}-model-id`} label="Model ID ใน API"><input id={`${prefix}-model-id`} name="modelId" defaultValue={model?.modelId ?? ''} maxLength={200} required placeholder="เช่น รุ่นที่ผู้ให้บริการระบุ" /></Field>
      <Field id={`${prefix}-display-name`} label="ชื่อที่แสดง"><input id={`${prefix}-display-name`} name="displayName" defaultValue={model?.displayName ?? ''} maxLength={100} required /></Field>
      <Field id={`${prefix}-purpose`} label="ประเภทการใช้งาน"><select id={`${prefix}-purpose`} name="purpose" value={purpose} onChange={event => {
        const next = event.target.value as ModelPurpose; setPurpose(next); setDimensions('');
        if (next === 'EMBEDDING') { setTools(false); setJson(false); setVision(false); }
      }}><option value="GENERATION">สร้างคำตอบ</option><option value="EMBEDDING">Embedding</option></select></Field>
      {embedding && <Field id={`${prefix}-dimensions`} label="Embedding dimensions" hint="ระบุตามเอกสารของรุ่น Model"><input id={`${prefix}-dimensions`} name="embeddingDimensions" type="number" min={1} max={4096} step={1} value={dimensions} onChange={event => setDimensions(event.target.value)} required /></Field>}
      <NumberField id={`${prefix}-priority`} label="ลำดับเดิม" name="priority" defaultValue={model?.priority ?? 100} min={0} max={1000} hint="ใช้ปุ่มขึ้น/ลงในรายการ" />
      <NumberField id={`${prefix}-timeout`} label="หมดเวลาตอบสนอง (ms)" name="timeoutMs" defaultValue={model?.timeoutMs ?? 15000} min={1000} max={45000} step={1000} />
      <NumberField id={`${prefix}-input-price`} label="ราคา Input / 1M tokens (USD)" name="inputPricePerMillion" defaultValue={model?.inputPricePerMillion ?? undefined} min={0} max={10000} step="any" required={false} />
      <NumberField id={`${prefix}-output-price`} label="ราคา Output / 1M tokens (USD)" name="outputPricePerMillion" defaultValue={model?.outputPricePerMillion ?? undefined} min={0} max={10000} step="any" required={false} />
    </div>
    <div className="provider-checks">
      <CheckField id={`${prefix}-tools`} name="supportsTools" label="รองรับ Tools" checked={tools} disabled={embedding} onChange={event => setTools(event.target.checked)} />
      <CheckField id={`${prefix}-json`} name="supportsJson" label="รองรับ JSON mode" checked={json} disabled={embedding} onChange={event => setJson(event.target.checked)} />
      <CheckField id={`${prefix}-vision`} name="supportsVision" label="รองรับภาพ" checked={vision} disabled={embedding} onChange={event => setVision(event.target.checked)} />
      <CheckField id={`${prefix}-enabled`} name="enabled" label="เปิดใช้งาน Model" defaultChecked={model?.enabled ?? true} />
    </div>
    <button className="provider-button provider-button-secondary" type="submit" disabled={api.pending(key)}>{api.pending(key) ? 'กำลังบันทึก…' : model ? 'บันทึก Model' : 'เพิ่ม Model'}</button>
  </form>;
}

function quotaState(counter: NonNullable<ProviderView['quota']>['counters'][number], now = Date.now()) {
  const observed = new Date(counter.observedAt).getTime();
  const reset = counter.resetAt ? new Date(counter.resetAt).getTime() : null;
  if (!Number.isFinite(observed) || observed > now || now - observed >= 5 * 60_000 || (reset !== null && (!Number.isFinite(reset) || reset <= observed || reset <= now)) || counter.window === 'UNKNOWN') return 'UNKNOWN';
  if (counter.limit === null || counter.remaining === null || !Number.isFinite(counter.limit) || !Number.isFinite(counter.remaining) || counter.limit < 0 || counter.remaining < 0 || counter.remaining > counter.limit) return 'UNKNOWN';
  if (counter.unit === 'CREDITS' ? counter.currency !== 'USD' : counter.currency !== null) return 'UNKNOWN';
  if (counter.unit === 'REQUESTS' && (!Number.isSafeInteger(counter.limit) || !Number.isSafeInteger(counter.remaining))) return 'UNKNOWN';
  if (counter.remaining === 0) return 'EXHAUSTED';
  if (counter.limit <= 0) return 'UNKNOWN';
  return counter.remaining / counter.limit <= .1 ? 'NEAR_LIMIT' : 'AVAILABLE';
}

function QuotaSummary({ provider, api }: { provider: ProviderView; api: ApiController }) {
  const now = useObservationTime();
  const quota = provider.quota;
  const key = `${provider.id}:quota`;
  const supported = quota?.supported === true;
  const validCounters = supported ? quota.counters.filter(counter => counter.scope !== 'MODEL') : [];
  const unassociatedModelCounters = supported ? quota.counters.filter(counter => counter.scope === 'MODEL' && !counter.modelId) : [];
  return <section className="provider-quota" aria-label={`โควต้าที่รายงานของ ${provider.name}`}>
    <div className="provider-quota-heading"><div><h3>โควต้าที่ผู้ให้บริการรายงาน</h3><p>ข้อมูลนี้อาจใช้ร่วมกันในระดับคีย์หรือบัญชี</p></div>
      <button className="provider-button provider-button-tertiary" type="button" onClick={() => api.send(`/api/providers/${encodeURIComponent(provider.id)}/quota`, 'POST', { providerRevision: provider.revision }, 'ตรวจโควต้าแล้ว', key)} disabled={api.pending(key)}>{api.pending(key) ? 'กำลังตรวจ…' : 'ตรวจโควต้า'}</button>
    </div>
    {!quota ? <p className="provider-unknown">ยังไม่ตรวจโควต้า · กดตรวจเพื่อขอข้อมูลจากผู้ให้บริการ</p>
      : !supported ? <p className="provider-unknown">ผู้ให้บริการไม่รายงานโควต้าที่รองรับ · ตรวจล่าสุด {dateLabel(quota.observedAt)}</p>
        : validCounters.length === 0 ? <p className="provider-unknown">ไม่มีตัวนับโควต้าพร้อมใช้ · ตรวจล่าสุด {dateLabel(quota.observedAt)}</p>
          : <ul className="provider-quota-list">{validCounters.map((counter, index) => {
            const state = quotaState(counter, now);
            const scope = counter.scope === 'ACCOUNT' ? 'บัญชีร่วม' : 'คีย์ผู้ให้บริการ';
            const unit = counter.unit === 'REQUESTS' ? 'คำขอ' : counter.unit === 'TOKENS' ? 'tokens' : counter.currency ? counter.currency : 'credits';
            const display = state === 'UNKNOWN' ? 'ไม่ทราบ · ข้อมูลเก่าหรือไม่ครบ' : `${counter.remaining} / ${counter.limit} ${unit}${state === 'NEAR_LIMIT' ? ' · ใกล้ถึงขีดจำกัด' : state === 'EXHAUSTED' ? ' · ถึงขีดจำกัด' : ''}`;
            return <li key={`${counter.scope}:${counter.unit}:${counter.window}:${index}`}><strong>{display}</strong><span>{scope} · {counter.window === 'UNKNOWN' ? 'ช่วงเวลาไม่ทราบ' : `ช่วง ${counter.window}`} · {counter.source === 'OPENROUTER_KEY' ? 'ข้อมูลคีย์ OpenRouter' : 'rate-limit headers'}</span><span>ตรวจ {dateLabel(counter.observedAt)}{counter.resetAt ? ` · รีเซ็ต ${dateLabel(counter.resetAt)}` : ''}{counter.retryAfterSeconds !== null ? ` · ลองใหม่ได้ใน ${counter.retryAfterSeconds} วินาที` : ''}</span></li>;
          })}</ul>}
    {unassociatedModelCounters.length > 0 && <p className="provider-unknown">มีตัวนับระดับ Model แต่ไม่มีรหัส Model ที่ยืนยันได้ จึงไม่ผูกตัวเลขกับแถวใด</p>}
    {quota?.supported && quota.errorCode && <p className="provider-notice provider-notice-error">ตรวจโควต้าไม่สำเร็จ · {quota.errorCode}{quota.httpStatus === null ? ' · ไม่มี HTTP response' : ` · HTTP ${quota.httpStatus}`} · ตรวจ {dateLabel(quota.observedAt)}</p>}
  </section>;
}

function ModelRow({ provider, model, api }: { provider: ProviderView; model: ModelView; api: ApiController }) {
  const now = useObservationTime();
  const rowKey = `${provider.id}:${model.id}`;
  const pricingKey = rowKey;
  const testKey = rowKey;
  const metadataKey = rowKey;
  const observation = model.latestObservation;
  const modelQuota = provider.quota?.supported ? provider.quota.counters.find(counter => counter.scope === 'MODEL' && counter.modelId === model.id) : undefined;
  const rowBusy = api.pending(rowKey);
  const pricingStatus = priceStatus(model, now);
  const cooling = isModelCoolingDown(model, now);
  const canTest = !cooling && provider.keyConfigured && pricingStatus === 'FREE' && model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0
    && (model.purpose === 'EMBEDDING' ? model.embeddingDimensions !== null : model.supportsJson);
  async function action(action: 'METADATA' | 'GENERATION_TEST' | 'EMBEDDING_TEST') {
    await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}/test`, 'POST', {
      providerRevision: provider.revision, modelRevision: model.revision, action,
    }, action === 'METADATA' ? 'ตรวจ Model แล้ว' : 'ทดสอบ Model แล้ว', action === 'METADATA' ? metadataKey : testKey);
  }
  return <article className={`provider-model ${model.enabled ? '' : 'provider-model-disabled'}`}>
    <div className="provider-model-main">
      <div className="provider-model-identity"><h3>{model.displayName}</h3><code>{model.modelId}</code><span className={`provider-pill ${model.enabled ? 'provider-pill-on' : 'provider-pill-off'}`}>{model.enabled ? 'เปิด' : 'ปิด'}</span></div>
      <div className="provider-model-status"><span className={`provider-pricing provider-pricing-${pricingStatus.toLowerCase()}`}>{priceLabel(model, now)}</span><span>{model.purpose === 'EMBEDDING' ? `Embedding · ${model.embeddingDimensions ?? 'ไม่ระบุมิติ'}` : 'สร้างคำตอบ'}</span><strong>{statusText(model)}</strong><span>ตรวจ {dateLabel(observation?.observedAt)}{model.pricingCheckedAt ? ` · ราคา ${dateLabel(model.pricingCheckedAt)}` : ''}</span></div>
      <div className="provider-row-actions" aria-label={`การทำงานกับ ${model.displayName}`}>
        <button className="provider-button provider-button-tertiary" type="button" onClick={() => api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}/pricing`, 'POST', { providerRevision: provider.revision, modelRevision: model.revision }, 'ตรวจราคาแล้ว', pricingKey)} disabled={rowBusy}>{rowBusy ? 'กำลังตรวจ…' : 'ตรวจราคา'}</button>
        <button className="provider-button provider-button-secondary" type="button" onClick={() => action('METADATA')} disabled={rowBusy}>{rowBusy ? 'กำลังตรวจ…' : 'ตรวจ Metadata'}</button>
        <button className="provider-button provider-button-primary" type="button" onClick={() => action(model.purpose === 'GENERATION' ? 'GENERATION_TEST' : 'EMBEDDING_TEST')} disabled={!canTest || rowBusy} title={cooling ? `รอจนถึง ${dateLabel(model.cooldownUntil)}` : !canTest ? 'ต้องตั้งค่า API key ความสามารถของ Model และมีหลักฐานราคา FREE ภายในหนึ่งนาทีก่อนทดสอบ' : undefined}>{rowBusy ? 'กำลังทดสอบ…' : 'ทดสอบ Model'}</button>
      </div>
    </div>
    {cooling && <p className="provider-model-quota" role="status">รออีก {Math.max(0, Math.ceil((Date.parse(model.cooldownUntil!) - now) / 1000))} วินาที · ลองได้หลัง {dateLabel(model.cooldownUntil)}</p>}
    {!cooling && !observation?.retryEvidence && (observation?.httpStatus === 429 || observation?.errorCode === 'SERVER_ERROR') && <p className="provider-model-quota">เวลาที่ลองใหม่ได้ยังไม่ทราบ · ผู้ให้บริการไม่ได้แจ้งเวลารอ</p>}
    <details className="provider-edit-model"><summary>แก้ไข Model</summary><ModelForm key={`${model.id}:${model.revision}`} provider={provider} model={model} api={api} /></details>
    <details className="provider-model-details"><summary>รายละเอียดการตั้งค่าและผลตรวจ</summary>
      <dl className="provider-model-facts"><div><dt>API format</dt><dd>{model.apiFormat ?? 'ยังไม่ทราบ'}</dd></div><div><dt>ลำดับที่บันทึก</dt><dd>{model.priority}</dd></div><div><dt>หมดเวลา</dt><dd>{new Intl.NumberFormat('th-TH').format(model.timeoutMs)} ms</dd></div><div><dt>ราคา Input / 1M USD</dt><dd>{model.inputPricePerMillion ?? 'ยังไม่ระบุ'}</dd></div><div><dt>ราคา Output / 1M USD</dt><dd>{model.outputPricePerMillion ?? 'ยังไม่ระบุ'}</dd></div><div><dt>ความสามารถ</dt><dd>{[model.supportsTools && 'Tools', model.supportsJson && 'JSON', model.supportsVision && 'ภาพ'].filter(Boolean).join(' · ') || 'พื้นฐาน'}</dd></div><div><dt>ผลตรวจ</dt><dd>{observation?.errorCode ?? 'ไม่มีรหัสเหตุผล'}</dd></div><div><dt>เวลาตอบสนอง</dt><dd>{observation ? `${observation.latencyMs} ms` : 'ยังไม่มีข้อมูล'}</dd></div></dl>
      <p className="provider-field-hint">ราคาที่กรอกเป็นข้อมูลประกอบ ระบบตรวจราคาจากผู้ให้บริการอีกครั้งก่อนใช้งาน</p>
    </details>
    <p className="provider-model-quota">{modelQuota ? `โควต้า Model: ${quotaState(modelQuota) === 'UNKNOWN' ? 'ไม่ทราบหรือข้อมูลเก่า' : `${modelQuota.remaining} / ${modelQuota.limit} ${modelQuota.unit.toLowerCase()}${quotaState(modelQuota) === 'NEAR_LIMIT' ? ' · ใกล้ถึงขีดจำกัด' : quotaState(modelQuota) === 'EXHAUSTED' ? ' · ถึงขีดจำกัด' : ''}`} · ${modelQuota.window} · ตรวจ ${dateLabel(modelQuota.observedAt)}` : 'ใช้ข้อมูลโควต้าที่แสดงในกลุ่มผู้ให้บริการ · ไม่มีตัวนับเฉพาะ Model ที่ยืนยันได้'}</p>
  </article>;
}

function ModelPurposeList({ provider, purpose, api }: { provider: ProviderView; purpose: ModelPurpose; api: ApiController }) {
  const current = provider.models.filter(model => model.purpose === purpose).slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const orderKey = `${provider.id}:${purpose}:order`;
  const rows = current.map(model => ({ ...model }));
  return <OrderEditor key={`${orderKey}:${provider.revision}:${current.map(model => `${model.id}.${model.revision}`).join(',')}`} rows={rows} label={model => model.displayName || model.modelId} onSave={async ordered => {
    const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/reorder`, 'POST', { providerRevision: provider.revision, purpose, order: ordered.map(model => ({ id: model.id, revision: model.revision })) }, 'บันทึกลำดับ Model แล้ว', orderKey);
    return result !== null;
  }}>
    {model => <ModelRow provider={provider} model={model} api={api} />}
  </OrderEditor>;
}

function ProviderGroup({ provider, purpose, choices }: { provider: ProviderView; purpose: ModelPurpose; choices: ProviderChoice[] }) {
  const api = useApiController();
  const modelCount = provider.models.filter(model => model.purpose === purpose).length;
  return <section className="provider-card" aria-labelledby={`${provider.id}-${purpose}-title`}>
    <header className="provider-card-heading">
      <div><h2 id={`${provider.id}-${purpose}-title`}>{provider.name}</h2><p><span className="provider-adapter">{adapterLabels[provider.adapter]}</span></p></div>
      <span className={`provider-pill ${provider.enabled ? 'provider-pill-on' : 'provider-pill-off'}`}>{provider.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
    </header>
    <QuotaSummary provider={provider} api={api} />
    {api.notice && <NoticeLine notice={api.notice} />}
    <details className="provider-settings"><summary>ตั้งค่าผู้ให้บริการ · {provider.costMode === 'FREE_ONLY' ? 'ใช้ฟรีเท่านั้น' : 'อนุญาตค่าใช้จ่าย'}</summary><ProviderSettings key={`${provider.revision}:${provider.adapter}`} provider={provider} api={api} choices={choices} /></details>
    <section className="provider-models" aria-label={`${purposeLabels[purpose]} ของ ${provider.name}`}>
      <div className="provider-section-heading"><div><h3>Models สำหรับ{purpose === 'GENERATION' ? 'สร้างคำตอบ' : ' Embedding'}</h3><p>{modelCount} รายการ · ลำดับแยกตามประเภทการใช้งาน</p></div></div>
      {modelCount === 0 ? <div className="provider-empty-models"><h3>ยังไม่มี Model ในกลุ่มนี้</h3><p>เพิ่ม Model นี้เมื่อมีรหัสและความสามารถจากผู้ให้บริการ</p></div>
        : <div className="provider-model-list"><ModelPurposeList provider={provider} purpose={purpose} api={api} /></div>}
      <details className="provider-add-model"><summary>เพิ่ม Model</summary><ModelForm key={`${provider.id}:new:${purpose}`} provider={provider} api={api} initialPurpose={purpose} /></details>
    </section>
  </section>;
}

function isFallbackPreview(value: unknown): value is FallbackPreviewView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FallbackPreviewView>;
  return candidate.pricingEvidence === 'LAST_CATALOG_OBSERVATION' && candidate.maxInferenceAttempts === 3 && Array.isArray(candidate.rows) && typeof candidate.generatedAt === 'string' && Boolean(candidate.profile);
}

function FallbackPreview({ providers, purpose }: { providers: ProviderView[]; purpose: ModelPurpose }) {
  const api = useApiController();
  const [requiresTools, setRequiresTools] = useState(false);
  const [preview, setPreview] = useState<FallbackPreviewView | null>(null);
  const [previewError, setPreviewError] = useState('');
  async function load() {
    setPreview(null); setPreviewError('');
    const profile = purpose === 'GENERATION' ? { purpose, requiresJson: true, requiresTools } : { purpose, requiresJson: false, requiresTools: false };
    const result = await api.send('/api/providers/preview', 'POST', profile, 'สร้างตัวอย่างลำดับแล้ว', 'preview', false);
    if (result && isFallbackPreview(result)) setPreview(result);
    else if (result) setPreviewError('รูปแบบข้อมูลตัวอย่างไม่ตรงกับที่คาดไว้ กรุณาลองโหลดอีกครั้ง');
  }
  const modelMap = new Map(providers.flatMap(provider => provider.models.map(model => [`${provider.id}:${model.id}`, { provider, model }] as const)));
  return <section className="provider-preview" aria-labelledby="provider-preview-title">
    <div className="provider-preview-heading"><div><h2 id="provider-preview-title">ลำดับสำรองสำหรับ{purpose === 'GENERATION' ? 'สร้างคำตอบ' : 'เอกสารใหม่'}</h2><p>อิงการตั้งค่าที่บันทึกและราคาที่ตรวจล่าสุด</p></div>
      {purpose === 'GENERATION' && <div className="provider-preview-options"><span className="provider-preview-fixed">ตรวจ JSON output</span><CheckField id="preview-tools" name="requiresTools" label="ต้องการ Tools" checked={requiresTools} onChange={event => { setRequiresTools(event.target.checked); setPreview(null); }} /></div>}
      <button className="provider-button provider-button-secondary" type="button" onClick={load} disabled={api.pending('preview')}>{api.pending('preview') ? 'กำลังจัดลำดับ…' : 'ดูตัวอย่างลำดับ'}</button>
    </div>
    <p className="provider-field-hint">บันทึกลำดับก่อนดูตัวอย่าง · {purpose === 'EMBEDDING' ? 'สำหรับนำเข้าเอกสารใหม่ การค้นหาใช้ Model ที่ตรงกับชุดเอกสารเดิม' : 'ราคาและความพร้อมอาจเปลี่ยน ระบบตรวจอีกครั้งก่อนใช้งาน'}</p>
    {previewError && <p className="provider-notice provider-notice-error" role="alert">{previewError}</p>}
    <NoticeLine notice={api.notice} />
    {preview && <div className="provider-preview-result"><p>ตรวจเมื่อ {dateLabel(preview.generatedAt)} · อนุญาตไม่เกิน {preview.maxInferenceAttempts} การลอง · ราคาอิง catalog ที่สังเกตล่าสุด</p>
      {preview.rows.length === 0 ? <p className="provider-unknown">ยังไม่มี Model ที่อยู่ในรายการ preview</p> : <ol>{preview.rows.map((row, index) => {
        const found = modelMap.get(`${row.providerId}:${row.modelId}`);
        return <li key={`${row.providerId}:${row.modelId}:${index}`}><strong>{found?.model.displayName ?? 'Model ที่ไม่อยู่ในรายการปัจจุบัน'}</strong><code>{found?.model.modelId ?? row.modelId}</code><span>{found?.provider.name ?? 'ผู้ให้บริการที่ไม่อยู่ในรายการปัจจุบัน'}</span><span>{row.position === null ? reasonLabel(row.reason) : `ลำดับ ${row.position} · ${reasonLabel(row.reason)}`}{row.reason === 'COOLDOWN' && row.cooldownUntil ? ` · หลัง ${dateLabel(row.cooldownUntil)}` : ''}</span></li>;
      })}</ol>}
      <p className="provider-field-hint">ตัวอย่างนี้ไม่ยืนยันว่า Model พร้อมใช้งาน ระบบตรวจราคาและความสามารถอีกครั้งก่อนเรียกใช้</p>
    </div>}
  </section>;
}

export default function ProviderForms({ providers, choices, loadError = false }: { providers: ProviderView[]; choices: ProviderChoice[]; loadError?: boolean }) {
  const [purpose, setPurpose] = useState<ModelPurpose>('GENERATION');
  const api = useApiController();
  const router = useRouter();
  const globalRows = providers.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const scopeKey = globalRows.map(provider => `${provider.id}.${provider.revision}`).join(',');
  return <div className="provider-workspace">
    <div className="provider-toolbar"><span className="provider-policy"><strong>ค่าเริ่มต้น</strong> · ใช้โมเดลฟรีเท่านั้น</span><CreateProviderForm choices={choices} /></div>
    {loadError ? <section className="provider-empty provider-load-error" role="alert"><h2>โหลดรายการผู้ให้บริการไม่สำเร็จ</h2><p>รายการยังไม่พร้อมแสดง กรุณาลองโหลดอีกครั้ง</p><button className="provider-button provider-button-secondary" type="button" onClick={() => router.refresh()}>ลองอีกครั้ง</button></section>
      : providers.length === 0 ? <section className="provider-empty" aria-labelledby="provider-empty-title"><h2 id="provider-empty-title">ยังไม่มีผู้ให้บริการ AI</h2><p>เพิ่ม OpenCode Zen หรือ OpenRouter แล้วบันทึกคีย์ของผู้ให้บริการเพื่อเริ่มตั้งค่า Model</p><button className="provider-button provider-button-primary" type="button" onClick={() => document.querySelector<HTMLDetailsElement>('.provider-add-panel')?.setAttribute('open', '')}>เพิ่มผู้ให้บริการ</button></section>
      : <>
        <div className="provider-purpose-tabs" role="tablist" aria-label="ประเภท Model">
          {(['GENERATION', 'EMBEDDING'] as const).map((item, index, tabs) => <button key={item} type="button" role="tab" id={`provider-tab-${item}`} tabIndex={purpose === item ? 0 : -1} aria-selected={purpose === item} aria-controls="provider-purpose-panel" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
            const next = tabs[nextIndex]; setPurpose(next); document.getElementById(`provider-tab-${next}`)?.focus();
          }} onClick={() => setPurpose(item)}>{purposeLabels[item]}</button>)}
        </div>
        <FallbackPreview key={purpose} providers={providers} purpose={purpose} />
        <section id="provider-purpose-panel" role="tabpanel" aria-labelledby={`provider-tab-${purpose}`} className="provider-list" aria-label={`ผู้ให้บริการสำหรับ${purposeLabels[purpose]}`}>
          <div className="provider-list-title"><h2>ผู้ให้บริการและ Models</h2><span>ลำดับผู้ให้บริการใช้ร่วมกันทั้งสองประเภท</span></div>
          <OrderEditor key={`providers:${scopeKey}`} rows={globalRows} label={provider => provider.name} onSave={async ordered => {
            const result = await api.send('/api/providers/reorder', 'POST', { order: ordered.map(provider => ({ id: provider.id, revision: provider.revision })) }, 'บันทึกลำดับผู้ให้บริการแล้ว', 'provider-order');
            return result !== null;
          }}>
            {(provider, index, count) => <div className="provider-group-row"><div className="provider-group-order"><span>ผู้ให้บริการ {index + 1} จาก {count}</span></div><ProviderGroup provider={provider} purpose={purpose} choices={choices} /></div>}
          </OrderEditor>
          {api.notice && <NoticeLine notice={api.notice} />}
        </section>
      </>}
  </div>;
}
