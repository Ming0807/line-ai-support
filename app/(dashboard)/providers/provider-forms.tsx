'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FallbackPreviewView, LastGenerationView, ModelPurpose, ModelView, ProviderKind, ProviderView } from '@/types/providers';
import FreeAccountForm from './free-account-form';
import { isModelCoolingDown } from '@/lib/ai/model-selection';
import {modelTestBlockReason} from './model-test-availability';
import { buildGenerationPlan, type GenerationPlanEntry, type GenerationPlanSkipReason } from './generation-plan';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type ApiResult = Record<string, unknown> | null;
type CreatedProvider = { id: string; name: string };
type ProviderChoice = { adapter: ProviderKind; baseUrl: string };
type ApiController = {
  notice: Notice;
  pending(key: string): boolean;
  send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, successText: string, key: string, refresh?: boolean): Promise<ApiResult>;
};

const adapterLabels: Record<ProviderKind, string> = { ZEN: 'OpenCode Zen', OPENROUTER: 'OpenRouter', OPENAI: 'OpenAI', COMPATIBLE: 'อื่น ๆ · OpenAI compatible' };
const purposeLabels: Record<ModelPurpose, string> = { GENERATION: 'สร้างคำตอบ', EMBEDDING: 'Embedding' };
const providerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorMessage = (status: number) => status === 400 ? 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบรายการที่กรอก'
  : status === 401 ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    : status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์จัดการผู้ให้บริการ'
      : status === 404 ? 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว'
        : status === 409 ? 'ข้อมูลอาจเปลี่ยนหรือมีคำขอกำลังทำงาน · กำลังโหลดข้อมูลล่าสุด ตรวจคำเตือนในฟอร์มก่อนลองอีกครั้ง'
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

function safeProviderHostname(baseUrl: string): string {
  try {
    const endpoint = new URL(baseUrl);
    return endpoint.protocol === 'https:' || endpoint.protocol === 'http:' ? endpoint.hostname : 'ไม่ทราบ host';
  } catch {
    return 'ไม่ทราบ host';
  }
}

function focusModelFormAfterDisclosure(summary: HTMLElement) {
  const details = summary.parentElement as HTMLDetailsElement | null;
  if (!details || details.open) return;
  requestAnimationFrame(() => {
    if (details.open) details.querySelector<HTMLElement>('[data-model-form-heading]')?.focus();
  });
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

function setFormControlValue(form: HTMLFormElement, name: string, value: string | number | null): void {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
    control.value = value === null ? '' : String(value);
  }
}

function setFormControlChecked(form: HTMLFormElement, name: string, checked: boolean): void {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = checked;
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
  if(model.accountFreeUntil&&Date.parse(model.accountFreeUntil)>now)return `บัญชี Free · ยืนยันถึง ${dateLabel(model.accountFreeUntil)}`;
  const status = priceStatus(model, now);
  return status === 'FREE' ? 'ฟรี · ตรวจจากผู้ให้บริการ' : status === 'PAID' ? 'มีค่าใช้จ่าย' : 'ราคาไม่ทราบ';
}

function generationPriceLabel(entry: GenerationPlanEntry): string {
  if(entry.price==='ACCOUNT_FREE')return 'บัญชี Free · ผู้ดูแลยืนยันว่าไม่เปิดคิดเงิน';
  if (entry.price === 'FREE') return entry.costMode === 'FREE_ONLY'
    ? 'Catalog ล่าสุดระบุ 0 · ตรวจใหม่ก่อนเรียก' : 'Catalog ล่าสุดระบุ 0 · ราคาอาจเปลี่ยนได้';
  if (entry.price === 'PAID') return 'Catalog ล่าสุดพบว่ามีค่าใช้จ่าย';
  return entry.costMode === 'FREE_ONLY'
    ? 'ราคาไม่ทราบหรือข้อมูลเก่า · ตรวจใหม่ก่อนใช้' : 'ราคาไม่ทราบหรือข้อมูลเก่า · อาจมีค่าใช้จ่าย';
}

function generationSkipLabel(reason: GenerationPlanSkipReason, cooldownUntil: string | null): string {
  switch (reason) {
    case 'PROVIDER_DISABLED': return 'ผู้ให้บริการปิดใช้งาน';
    case 'MODEL_DISABLED': return 'Model ปิดใช้งาน';
    case 'REGISTRY_LIMIT': return 'อยู่นอกขอบเขต 64 รุ่นที่ระบบอ่าน';
    case 'KEY_MISSING': return 'ผู้ให้บริการยังไม่มี API key';
    case 'COOLDOWN': return `อยู่ระหว่างพัก${cooldownUntil ? ` · ถึง ${dateLabel(cooldownUntil)}` : ''}`;
    case 'JSON_UNSUPPORTED': return 'ไม่รองรับ JSON ของคำขอนี้';
    case 'API_FORMAT_UNSET': return 'ต้องกำหนดรูปแบบ API ของ Zen ก่อนใช้งาน';
    case 'PAID_BLOCKED': return 'มีค่าใช้จ่ายและผู้ให้บริการใช้ FREE_ONLY';
  }
}

const generationRequestLabels: Record<string, string> = {
  CONVERSATION_ROUTE: 'จัดประเภทการสนทนา',
  SUPPORT_INTENT: 'วิเคราะห์ความต้องการช่วยเหลือ',
  SUPPORT_SOCIAL: 'ตอบการทักทายและอธิบายการช่วยเหลือ',
  STAFF_ASSIST: 'ช่วยเจ้าหน้าที่ร่างคำตอบ',
  KNOWLEDGE_SCOPE: 'กำหนดขอบเขตการค้นข้อมูล',
  KNOWLEDGE_METHOD: 'เลือกวิธีค้นข้อมูล',
  KNOWLEDGE_EXACT_ANSWER: 'ตอบจากข้อมูลที่ตรวจแล้ว',
  KNOWLEDGE_WEB_PLAN: 'วางแผนค้นข้อมูลเว็บ',
  KNOWLEDGE_ANSWER: 'เรียบเรียงคำตอบ',
};

function generationRequestLabel(requestType: string): string {
  return generationRequestLabels[requestType] ?? 'คำขอจากระบบ';
}

function GenerationPlanPanel({ providers, loadError, lastGeneration, lastGenerationError }: {
  providers: ProviderView[];
  loadError: boolean;
  lastGeneration?: LastGenerationView | null;
  lastGenerationError: boolean;
}) {
  const now = useObservationTime();
  const plan = buildGenerationPlan(providers, now);
  const first = plan.candidates[0] ?? null;
  const backups = plan.candidates.slice(1);
  const latestState = lastGenerationError ? 'ERROR'
    : lastGeneration === undefined ? 'UNKNOWN'
      : lastGeneration === null ? 'EMPTY' : 'AVAILABLE';
  const latestTime = lastGeneration ? new Date(lastGeneration.observedAt) : null;
  const hasLatestTime = latestTime !== null && Number.isFinite(latestTime.getTime());

  return <section className="provider-generation-plan" aria-labelledby="provider-generation-plan-title">
    <div className="provider-generation-plan-heading">
      <div>
        <h2 id="provider-generation-plan-title">ลำดับที่ระบบจะใช้</h2>
        <p>ลำดับที่บันทึกสำหรับคำขอสร้างคำตอบแบบ JSON · เรียงผู้ให้บริการ → Model → รหัสรายการ</p>
      </div>
      <span className="provider-generation-plan-scope">ลำดับตั้งค่า · ตรวจสิทธิ์ก่อนเรียก</span>
    </div>

    <div className="provider-generation-plan-main">
      <div className="provider-generation-plan-order">
        <div className="provider-generation-plan-first">
          <p className="provider-generation-plan-label">ตัวแรกที่จะลอง</p>
          {loadError ? <p className="provider-generation-plan-empty">อ่านลำดับที่บันทึกไว้ไม่ได้ กรุณาลองโหลดหน้าใหม่</p>
            : first ? <>
              <h3>{first.modelName}</h3>
              <p>{first.providerName} · อันดับ 1</p>
              <code>{first.modelId}</code>
              <span className={`provider-generation-cost provider-generation-cost-${first.price.toLowerCase()}`}>{generationPriceLabel(first)}</span>
            </> : <p className="provider-generation-plan-empty">ยังไม่มี Model สร้างคำตอบแบบ JSON ที่อยู่ในลำดับปัจจุบัน</p>}
        </div>

        <div className="provider-generation-plan-backups">
          <h3>ลำดับสำรอง</h3>
          {loadError ? <p className="provider-field-hint">ข้อมูลลำดับยังโหลดไม่ได้</p>
            : backups.length === 0 ? <p className="provider-field-hint">ยังไม่มี Model สำรองในลำดับนี้</p>
              : <ol aria-label="Model สำรองตามลำดับ">
                {backups.map(entry => <li key={`${entry.providerId}:${entry.modelRecordId}`}>
                  <span className="provider-generation-plan-rank">อันดับ {entry.position}</span>
                  <div><strong>{entry.modelName}</strong><span>{entry.providerName}</span><code>{entry.modelId}</code></div>
                  <span className={`provider-generation-cost provider-generation-cost-${entry.price.toLowerCase()}`}>{generationPriceLabel(entry)}</span>
                </li>)}
              </ol>}
        </div>
      </div>

      <div className="provider-generation-plan-runtime">
        <h3>เรียกสำเร็จล่าสุด</h3>
        {latestState === 'ERROR' ? <p className="provider-generation-plan-empty" role="alert">โหลดข้อมูลการเรียกสำเร็จล่าสุดไม่ได้</p>
          : latestState === 'UNKNOWN' ? <p className="provider-generation-plan-empty">ยังไม่มีข้อมูลการเรียกสำเร็จล่าสุด</p>
            : latestState === 'EMPTY' ? <p className="provider-generation-plan-empty">ยังไม่มีการเรียกสร้างคำตอบที่สำเร็จ</p>
              : lastGeneration && <>
                <strong>{lastGeneration.modelName}</strong>
                <p>{lastGeneration.providerName} · {generationRequestLabel(lastGeneration.requestType)}</p>
                <p>{hasLatestTime ? <time dateTime={lastGeneration.observedAt}>{dateLabel(lastGeneration.observedAt)}</time> : 'เวลาไม่ทราบ'}</p>
                <p>{lastGeneration.fallbackUsed ? 'มีการใช้รุ่นสำรอง' : 'สำเร็จโดยไม่ใช้รุ่นสำรอง'}</p>
                <p>{lastGeneration.configurationChanged ? 'การตั้งค่าปัจจุบันเปลี่ยนหลังการเรียกนี้' : 'การตั้งค่าปัจจุบันยังตรงกับตอนเรียก'}</p>
              </>}
        <p className="provider-generation-plan-proof">รายการนี้ยืนยันว่าการเรียก AI สำเร็จ ไม่ยืนยันว่าข้อความถูกส่งถึงนักศึกษา</p>
      </div>
    </div>

    <div className="provider-generation-plan-guidance">
      <p>FREE_ONLY ใช้โมเดลราคาศูนย์ที่ตรวจสอบแล้ว หรือบัญชี Free ที่ผู้ดูแลยืนยันและยังไม่หมดอายุ ส่วน ALLOW_PAID อนุญาตให้เกิดค่าใช้จ่าย ราคาจากผู้ให้บริการอาจเปลี่ยนได้</p>
      <p>สลับสำรองอัตโนมัติเมื่อพบข้อผิดพลาดที่ลองซ้ำได้ · หากได้รับ 429 จะลองผู้ให้บริการอื่นก่อนโมเดลถัดไปของเจ้าเดิม · ไม่เกิน 3 การเรียกจริงภายในเวลาของคำขอ · 401/403 ข้อผิดพลาดที่ลองซ้ำไม่ได้ หรือหมดเวลาจะหยุด</p>
    </div>

    {plan.skipped.length > 0 && <details className="provider-generation-plan-skipped">
      <summary>Model ที่ถูกข้ามจากลำดับนี้ · {plan.skipped.length} รุ่น</summary>
      <ul>{plan.skipped.map(entry => <li key={`${entry.providerId}:${entry.modelRecordId}`}>
        <div><strong>{entry.modelName}</strong><span>{entry.providerName}</span><code>{entry.modelId}</code></div>
        <span>{generationSkipLabel(entry.reason!, entry.cooldownUntil)}</span>
      </li>)}</ul>
    </details>}
  </section>;
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
type ScopedOrderState = { signature: string; draft: string[] | null; saved: boolean };
type ScopedAnnouncement = { signature: string; text: string };
function OrderEditor<T extends OrderedRow>({ rows, scopeSignature, onSave, label, children, controls = true }: {
  rows: T[]; label: (row: T) => string;
  scopeSignature: string;
  controls?: boolean;
  onSave: (rows: T[]) => Promise<boolean>; children: (row: T, index: number, count: number, move: (delta: -1 | 1) => void) => ReactNode;
}) {
  const initialIds = rows.map(row => row.id);
  const [orderState, setOrderState] = useState<ScopedOrderState>(() => ({ signature: scopeSignature, draft: null, saved: false }));
  const activeOrderState = orderState.signature === scopeSignature ? orderState : { signature: scopeSignature, draft: null, saved: false };
  const [announcement, setAnnouncement] = useState<ScopedAnnouncement>(() => ({ signature: scopeSignature, text: '' }));
  const [focusRequest, setFocusRequest] = useState<{ signature: string; target: string } | null>(null);
  const currentScope = useRef(scopeSignature);
  const focusTarget = focusRequest?.signature === scopeSignature ? focusRequest.target : null;
  const activeAnnouncement = announcement.signature === scopeSignature ? announcement.text : '';
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    currentScope.current = scopeSignature;
    if (focusTarget) document.getElementById(focusTarget)?.focus();
  }, [activeOrderState.draft, focusTarget, scopeSignature]);
  const orderedIds = activeOrderState.draft ?? initialIds;
  const orderedRows = orderedIds.map(id => rows.find(row => row.id === id)).filter((row): row is T => Boolean(row));
  function updateOrderState(update: (current: ScopedOrderState) => ScopedOrderState) {
    setOrderState(current => {
      const currentScope = current.signature === scopeSignature ? current : { signature: scopeSignature, draft: null, saved: false };
      return update(currentScope);
    });
  }
  function move(id: string, delta: -1 | 1) {
    if (saving || activeOrderState.saved) return;
    const index = orderedIds.indexOf(id);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
    const next = [...orderedIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateOrderState(current => ({ ...current, draft: next }));
    const row = rows.find(item => item.id === id);
    setAnnouncement({ signature: scopeSignature, text: `${label(row as T)} อยู่ลำดับที่ ${nextIndex + 1} จาก ${next.length}` });
    setFocusRequest({ signature: scopeSignature, target: `${id}-order-${nextIndex === 0 ? 'down' : 'up'}` });
  }
  const dirty = !activeOrderState.saved && activeOrderState.draft !== null && activeOrderState.draft.some((id, index) => id !== initialIds[index]);
  return <>
    {orderedRows.map((row, index) => <div className="provider-ordered-item" key={row.id}>
      {children(row, index, orderedRows.length, delta => move(row.id, delta))}
      {controls && <div className="provider-order-controls" aria-label={`จัดลำดับ ${label(row)}`}>
        <button id={`${row.id}-order-up`} data-order-direction="up" className="provider-button provider-button-tertiary" type="button" aria-label={`เลื่อน ${label(row)} ขึ้นหนึ่งลำดับ`} onClick={() => move(row.id, -1)} disabled={saving || activeOrderState.saved || index === 0}>ขึ้น</button>
        <button id={`${row.id}-order-down`} data-order-direction="down" className="provider-button provider-button-tertiary" type="button" aria-label={`เลื่อน ${label(row)} ลงหนึ่งลำดับ`} onClick={() => move(row.id, 1)} disabled={saving || activeOrderState.saved || index === orderedRows.length - 1}>ลง</button>
      </div>}
    </div>)}
    <p className="provider-sr-only" aria-live="polite" aria-atomic="true">{activeAnnouncement}</p>
    {dirty && <div className="provider-draft-actions"><span>มีการเปลี่ยนลำดับที่ยังไม่บันทึก</span><div>
      <button className="provider-button provider-button-secondary" type="button" disabled={saving} onClick={() => { updateOrderState(current => ({ ...current, draft: null, saved: false })); setAnnouncement({ signature: scopeSignature, text: 'ยกเลิกการเปลี่ยนลำดับแล้ว' }); setFocusRequest(null); }}>ยกเลิก</button>
      <button className="provider-button provider-button-primary" type="button" disabled={saving} onClick={async () => {
        if (saving) return;
        const savingSignature = scopeSignature;
        setSaving(true);
        try {
          const ok = await onSave(orderedRows);
          if (ok && currentScope.current === savingSignature) {
            setOrderState(current => current.signature === savingSignature ? { ...current, saved: true } : current);
            setAnnouncement({ signature: savingSignature, text: 'บันทึกลำดับแล้ว' });
          }
        }
        finally { setSaving(false); }
      }}>{saving ? 'กำลังบันทึก…' : 'บันทึกลำดับ'}</button>
    </div></div>}
  </>;
}

function CreateProviderForm({ choices, onCreated }: { choices: ProviderChoice[]; onCreated: (provider: CreatedProvider) => void }) {
  const api = useApiController();
  const [adapter, setAdapter] = useState<ProviderKind>('ZEN');
  const [baseUrl, setBaseUrl] = useState(choices.find(choice => choice.adapter === 'ZEN')?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const urls = choices.filter(choice => choice.adapter === adapter);
  const saving = api.pending('create');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const name = String(form.get('name') ?? '').trim();
    const result = await api.send('/api/providers', 'POST', {
      name, adapter, baseUrl: String(form.get('baseUrl') ?? ''),
      enabled: form.has('enabled'), priority: Number(form.get('priority')), apiKey, costMode: String(form.get('costMode') ?? 'FREE_ONLY'),
    }, 'เพิ่มผู้ให้บริการแล้ว', 'create');
    if (result) {
      if (typeof result.id === 'string' && providerIdPattern.test(result.id)) onCreated({ id: result.id, name });
      element.reset();
      setApiKey('');
      setAdapter('ZEN');
      setBaseUrl(choices.find(choice => choice.adapter === 'ZEN')?.baseUrl ?? '');
    }
  }
  return <details className="provider-add-panel">
    <summary><span>เพิ่มผู้ให้บริการ</span><span className="provider-summary-hint">ค่าเริ่มต้น: ฟรีเท่านั้น</span></summary>
    <form className="provider-form" onSubmit={submit}>
      <fieldset className="provider-form-fieldset" disabled={saving}>
        <div className="provider-fields provider-fields-provider">
          <Field id="new-provider-name" label="ชื่อผู้ให้บริการ"><input id="new-provider-name" name="name" maxLength={100} required placeholder="เช่น GroqCloud" /></Field>
          <Field id="new-provider-adapter" label="รูปแบบการเชื่อมต่อ"><select id="new-provider-adapter" value={adapter} onChange={event => { const next = event.target.value as ProviderKind; setAdapter(next); setBaseUrl(choices.find(choice => choice.adapter === next)?.baseUrl ?? ''); }}>{choices.map(choice => <option key={choice.adapter} value={choice.adapter}>{adapterLabels[choice.adapter]}</option>)}</select></Field>
          <Field id="new-provider-base-url" label="Base URL" hint={adapter === 'COMPATIBLE' ? 'HTTPS สำหรับ Chat Completions และ Embedding เช่น https://api.provider.com/v1' : undefined}>
            {adapter === 'COMPATIBLE'
              ? <input id="new-provider-base-url" name="baseUrl" type="url" maxLength={2048} required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.provider.com/v1" />
              : <select id="new-provider-base-url" name="baseUrl" value={urls.some(choice => choice.baseUrl === baseUrl) ? baseUrl : urls[0]?.baseUrl} onChange={event => setBaseUrl(event.target.value)}>{urls.map(choice => <option key={choice.baseUrl} value={choice.baseUrl}>{choice.baseUrl}</option>)}</select>}
          </Field>
          <NumberField id="new-provider-priority" label="ลำดับเดิม" name="priority" defaultValue={100} min={0} max={1000} hint="จัดลำดับด้านบนได้หลังเพิ่ม" />
          <Field id="new-provider-cost-mode" label="นโยบายค่าใช้จ่าย"><select id="new-provider-cost-mode" name="costMode" defaultValue="FREE_ONLY"><option value="FREE_ONLY">ใช้เฉพาะรุ่นฟรี (แนะนำ)</option><option value="ALLOW_PAID">อนุญาตรุ่นที่มีค่าใช้จ่าย</option></select></Field>
          <Field id="new-provider-key" label="API key"><input id="new-provider-key" name="apiKey" type="password" autoComplete="new-password" minLength={8} maxLength={512} required value={apiKey} onChange={event => setApiKey(event.target.value)} /></Field>
        </div>
        <div className="provider-form-actions"><CheckField id="new-provider-enabled" name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked /><button className="provider-button provider-button-primary" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'เพิ่มผู้ให้บริการ'}</button></div>
      </fieldset>
      {api.notice && <NoticeLine notice={api.notice} />}
      <p className="provider-field-hint">ระบบไม่แสดง API key ที่บันทึกไว้แล้ว และจะไม่ใช้คีย์กับปลายทางนอก Base URL ที่กำหนด</p>
      {adapter === 'COMPATIBLE' && <p className="provider-field-hint">ระบบยังยืนยันราคาของผู้ให้บริการอื่นไม่ได้ นโยบายฟรีเท่านั้นจึงข้ามการสร้างคำตอบและ Embedding แม้กรอกราคาเป็นศูนย์</p>}
    </form>
  </details>;
}

function ProviderSettings({ provider, api, choices }: { provider: ProviderView; api: ApiController; choices: ProviderChoice[] }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [apiKey, setApiKey] = useState('');
  const key = `${provider.id}:settings`;
  const settingsSignature = JSON.stringify([provider.id, provider.name, provider.adapter, provider.baseUrl, provider.enabled, provider.priority, provider.costMode, provider.keyConfigured]);
  const [formRevision, setFormRevision] = useState(() => ({ signature: settingsSignature, revision: provider.revision }));
  const [adapter, setAdapter] = useState(provider.adapter);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const urls = choices.filter(choice => choice.adapter === adapter);
  const replacementRequired = adapter !== provider.adapter || baseUrl.replace(/\/$/, '') !== provider.baseUrl.replace(/\/$/, '');
  const draftConflict = provider.revision > formRevision.revision && (settingsSignature !== formRevision.signature || apiKey.trim() !== '');
  const saving = api.pending(key);
  function useLatestProviderSettings() {
    const form = formRef.current;
    if (form) {
      setFormControlValue(form, 'name', provider.name);
      setFormControlValue(form, 'priority', provider.priority);
      setFormControlValue(form, 'costMode', provider.costMode);
      setFormControlChecked(form, 'enabled', provider.enabled);
    }
    setAdapter(provider.adapter);
    setBaseUrl(provider.baseUrl);
    setApiKey('');
    setFormRevision({ signature: settingsSignature, revision: provider.revision });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftConflict) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const submittedBaseUrl = String(form.get('baseUrl') ?? '');
    const enabled = form.has('enabled');
    const priority = Number(form.get('priority'));
    const costMode = String(form.get('costMode') ?? 'FREE_ONLY');
    const submittedSettingsSignature = JSON.stringify([provider.id, name, adapter, submittedBaseUrl, enabled, priority, costMode, provider.keyConfigured || apiKey.trim() !== '']);
    const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}`, 'PATCH', {
      name, adapter, baseUrl: submittedBaseUrl, enabled,
      priority, revision: formRevision.signature === settingsSignature ? provider.revision : formRevision.revision, apiKey: apiKey.trim() === '' ? null : apiKey,
      costMode,
    }, 'บันทึกการตั้งค่าแล้ว', key);
    if (result) {
      setApiKey('');
      if (typeof result.revision === 'number') setFormRevision({ signature: submittedSettingsSignature, revision: result.revision });
    }
  }
  return <form ref={formRef} className="provider-form provider-settings-form" onSubmit={submit}>
    <fieldset className="provider-form-fieldset" disabled={saving}>
      <div className="provider-fields provider-fields-provider">
        <Field id={`${provider.id}-name`} label="ชื่อผู้ให้บริการ"><input id={`${provider.id}-name`} name="name" defaultValue={provider.name} maxLength={100} required /></Field>
        <Field id={`${provider.id}-adapter`} label="รูปแบบการเชื่อมต่อ"><select id={`${provider.id}-adapter`} value={adapter} onChange={event => { const next = event.target.value as ProviderKind; setAdapter(next); setBaseUrl(choices.find(choice => choice.adapter === next)?.baseUrl ?? ''); }}>{choices.map(choice => <option key={choice.adapter} value={choice.adapter}>{adapterLabels[choice.adapter]}</option>)}</select></Field>
        <Field id={`${provider.id}-base-url`} label="Base URL" hint={adapter === 'COMPATIBLE' ? 'HTTPS สำหรับ Chat Completions และ Embedding' : undefined}>
          {adapter === 'COMPATIBLE'
            ? <input id={`${provider.id}-base-url`} name="baseUrl" type="url" maxLength={2048} required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
            : <select id={`${provider.id}-base-url`} name="baseUrl" value={urls.some(choice => choice.baseUrl === baseUrl) ? baseUrl : urls[0]?.baseUrl} onChange={event => setBaseUrl(event.target.value)}>{urls.map(choice => <option key={choice.baseUrl} value={choice.baseUrl}>{choice.baseUrl}</option>)}</select>}
        </Field>
        <NumberField id={`${provider.id}-priority`} label="ลำดับเดิม" name="priority" defaultValue={provider.priority} min={0} max={1000} hint="ใช้ปุ่มขึ้น/ลงเพื่อจัดลำดับ" />
        <Field id={`${provider.id}-cost-mode`} label="นโยบายค่าใช้จ่าย"><select id={`${provider.id}-cost-mode`} name="costMode" defaultValue={provider.costMode}><option value="FREE_ONLY">ใช้เฉพาะรุ่นฟรี</option><option value="ALLOW_PAID">อนุญาตรุ่นที่มีค่าใช้จ่าย</option></select></Field>
        <Field id={`${provider.id}-api-key`} label="เปลี่ยน API key"><input id={`${provider.id}-api-key`} name="apiKey" type="password" autoComplete="new-password" placeholder="เว้นว่างเพื่อเก็บคีย์เดิม" minLength={8} maxLength={512} value={apiKey} onChange={event => setApiKey(event.target.value)} /></Field>
      </div>
      <div className="provider-form-actions"><CheckField id={`${provider.id}-enabled`} name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked={provider.enabled} /><button className="provider-button provider-button-secondary" type="submit" disabled={saving || draftConflict || (replacementRequired && apiKey.trim() === '')}>{saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button></div>
    </fieldset>
    {draftConflict && <div className="provider-form-conflict"><p role="alert">เวอร์ชันข้อมูลผู้ให้บริการต่างจากร่างนี้ จึงยังบันทึกไม่ได้ ปุ่มด้านล่างจะทิ้งเฉพาะร่างนี้และแทนด้วยค่าปัจจุบัน</p><button className="provider-button provider-button-primary" type="button" disabled={saving} onClick={useLatestProviderSettings}>ใช้ค่าล่าสุดแทนร่างนี้</button></div>}
    <p className="provider-field-hint">{provider.keyConfigured ? 'มี API key บันทึกไว้' : 'ยังไม่มี API key'} · คีย์ใหม่จะแทนที่คีย์ปัจจุบัน{replacementRequired ? ' · เปลี่ยนผู้ให้บริการหรือ Base URL ต้องกรอกคีย์ใหม่' : ''}</p>
    {adapter === 'COMPATIBLE' && <p className="provider-field-hint">ราคาไม่ทราบ · นโยบายฟรีเท่านั้นข้ามการสร้างคำตอบและ Embedding จนกว่าจะยืนยันราคาได้</p>}
  </form>;
}

function ModelForm({ provider, model, api }: { provider: ProviderView; model?: ModelView; api: ApiController }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [tools, setTools] = useState(model?.supportsTools ?? false);
  const [json, setJson] = useState(model?.supportsJson ?? false);
  const [vision, setVision] = useState(model?.supportsVision ?? false);
  const modelSignature = model ? JSON.stringify([provider.id, model.id, model.modelId, model.displayName, model.purpose, model.embeddingDimensions, model.supportsTools, model.supportsJson, model.supportsVision, model.enabled, model.priority, model.timeoutMs, model.inputPricePerMillion, model.outputPricePerMillion]) : null;
  const [formRevision, setFormRevision] = useState(() => ({ signature: modelSignature, revision: model?.revision ?? null }));
  const draftConflict = Boolean(model && formRevision.revision !== null && model.revision > formRevision.revision && modelSignature !== formRevision.signature);
  const revisionForSubmit = model
    ? (formRevision.signature === modelSignature ? model.revision : formRevision.revision ?? model.revision)
    : null;
  const key = `${provider.id}:${model?.id ?? 'new-model'}:save`;
  const saving = api.pending(key);
  const prefix = `${provider.id}-${model?.id ?? 'new-model'}`;
  const headingId = `${prefix}-context`;
  const modelLabel = model?.displayName || model?.modelId;
  function useLatestModel() {
    const form = formRef.current;
    if (form && model) {
      setFormControlValue(form, 'modelId', model.modelId);
      setFormControlValue(form, 'displayName', model.displayName);
      setFormControlChecked(form, 'enabled', model.enabled);
      setFormControlValue(form, 'priority', model.priority);
      setFormControlValue(form, 'timeoutMs', model.timeoutMs);
      setFormControlValue(form, 'inputPricePerMillion', model.inputPricePerMillion);
      setFormControlValue(form, 'outputPricePerMillion', model.outputPricePerMillion);
    }
    if (model) {
      setTools(model.supportsTools);
      setJson(model.supportsJson);
      setVision(model.supportsVision);
      setFormRevision({ signature: modelSignature, revision: model.revision });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftConflict) return;
    const element = event.currentTarget;
    const values = commonModelValues(new FormData(element));
    if (model) {
      const nextModelSignature = JSON.stringify([provider.id, model.id, values.modelId, values.displayName, values.purpose, values.embeddingDimensions, values.supportsTools, values.supportsJson, values.supportsVision, values.enabled, values.priority, values.timeoutMs, values.inputPricePerMillion, values.outputPricePerMillion]);
      const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.id)}`, 'PATCH', { ...values, revision: revisionForSubmit ?? model.revision }, `บันทึก Model ${values.displayName || values.modelId} ใน ${provider.name} แล้ว`, key);
      if (result && typeof result.revision === 'number') setFormRevision({ signature: nextModelSignature, revision: result.revision });
    }
    else {
      const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models`, 'POST', values, `เพิ่ม Model ${values.displayName || values.modelId} ใน ${provider.name} แล้ว`, key);
      if (result) { element.reset(); setTools(false); setJson(false); setVision(false); }
    }
  }
  return <form ref={formRef} className="provider-form model-form" aria-labelledby={headingId} onSubmit={submit}>
    <header className="provider-model-form-context">
      <h4 id={headingId} tabIndex={-1} data-model-form-heading>{model ? `แก้ไขโมเดลใน ${provider.name}${modelLabel ? ` · ${modelLabel}` : ''}` : `เพิ่มโมเดลใน ${provider.name}`}</h4>
      <p>ชื่อผู้ให้บริการ: <strong>{provider.name}</strong> · รูปแบบการเชื่อมต่อ: {adapterLabels[provider.adapter]} · Host: {safeProviderHostname(provider.baseUrl)}</p>
    </header>
    <fieldset className="provider-form-fieldset" disabled={saving}>
      <input type="hidden" name="purpose" value="GENERATION" />
      <div className="provider-fields provider-fields-model provider-fields-model-essential">
        <Field id={`${prefix}-model-id`} label="Model ID ใน API"><input id={`${prefix}-model-id`} name="modelId" defaultValue={model?.modelId ?? ''} maxLength={200} required placeholder="เช่น รุ่นที่ผู้ให้บริการระบุ" /></Field>
        <Field id={`${prefix}-display-name`} label="ชื่อที่แสดง"><input id={`${prefix}-display-name`} name="displayName" defaultValue={model?.displayName ?? ''} maxLength={100} required /></Field>
      </div>
      <div className="provider-checks">
        <CheckField id={`${prefix}-tools`} name="supportsTools" label="รองรับ Tools" checked={tools} onChange={event => setTools(event.target.checked)} />
        <CheckField id={`${prefix}-json`} name="supportsJson" label="รองรับ JSON mode" checked={json} onChange={event => setJson(event.target.checked)} />
        <CheckField id={`${prefix}-vision`} name="supportsVision" label="รองรับภาพ" checked={vision} onChange={event => setVision(event.target.checked)} />
        <CheckField id={`${prefix}-enabled`} name="enabled" label="เปิดใช้งาน Model" defaultChecked={model?.enabled ?? true} />
      </div>
      <details className="provider-model-details provider-model-advanced">
        <summary>การตั้งค่าขั้นสูง</summary>
        <div className="provider-fields provider-fields-model">
          <NumberField id={`${prefix}-priority`} label="ลำดับเดิม" name="priority" defaultValue={model?.priority ?? 100} min={0} max={1000} hint="ใช้ปุ่มขึ้น/ลงในรายการ" />
          <NumberField id={`${prefix}-timeout`} label="หมดเวลาตอบสนอง (ms)" name="timeoutMs" defaultValue={model?.timeoutMs ?? 15000} min={1000} max={45000} step={1000} />
          <NumberField id={`${prefix}-input-price`} label="ราคา Input / 1M tokens (USD)" name="inputPricePerMillion" defaultValue={model?.inputPricePerMillion ?? undefined} min={0} max={10000} step="any" required={false} />
          <NumberField id={`${prefix}-output-price`} label="ราคา Output / 1M tokens (USD)" name="outputPricePerMillion" defaultValue={model?.outputPricePerMillion ?? undefined} min={0} max={10000} step="any" required={false} />
        </div>
      </details>
      <button className="provider-button provider-button-secondary" type="submit" disabled={saving || draftConflict}>{saving ? 'กำลังบันทึก…' : model ? `บันทึก Model ใน ${provider.name}` : `เพิ่ม Model ใน ${provider.name}`}</button>
    </fieldset>
    {draftConflict && model && <div className="provider-form-conflict"><p role="alert">Model นี้มีเวอร์ชันใหม่กว่าร่างที่เปิดอยู่ จึงยังบันทึกไม่ได้ ปุ่มด้านล่างจะทิ้งเฉพาะร่างนี้และแทนด้วยค่าล่าสุดจากระบบ</p><button className="provider-button provider-button-primary" type="button" disabled={saving} onClick={useLatestModel}>ใช้ค่าล่าสุดแทนร่างนี้</button></div>}
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
  const testBlockReason=modelTestBlockReason({keyConfigured:provider.keyConfigured,cooling,pricingStatus,purpose:model.purpose,supportsJson:model.supportsJson,embeddingDimensions:model.embeddingDimensions,accountFreeUntil:model.accountFreeUntil},now);
  const testHintId=`model-test-hint-${model.id}`;
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
        <button className="provider-button provider-button-primary" type="button" onClick={() => action(model.purpose === 'GENERATION' ? 'GENERATION_TEST' : 'EMBEDDING_TEST')} disabled={testBlockReason!==null || rowBusy} aria-describedby={testHintId}>{rowBusy ? 'กำลังทดสอบ…' : 'ทดสอบ Model'}</button>
      </div>
      <p id={testHintId} className="provider-field-hint">{testBlockReason??'กดทดสอบได้เลย ระบบจะตรวจสิทธิ์บัญชี Free หรือราคาล่าสุดก่อนเรียกโมเดล ไม่ต้องกดตรวจราคาแยก'}</p>
    </div>
    {cooling && <p className="provider-model-quota" role="status">รออีก {Math.max(0, Math.ceil((Date.parse(model.cooldownUntil!) - now) / 1000))} วินาที · ลองได้หลัง {dateLabel(model.cooldownUntil)}</p>}
    {!cooling && !observation?.retryEvidence && (observation?.httpStatus === 429 || observation?.errorCode === 'SERVER_ERROR') && <p className="provider-model-quota">เวลาที่ลองใหม่ได้ยังไม่ทราบ · ผู้ให้บริการไม่ได้แจ้งเวลารอ</p>}
    <details className="provider-edit-model"><summary onClick={event => focusModelFormAfterDisclosure(event.currentTarget)}>แก้ไขโมเดลใน {provider.name}</summary><ModelForm provider={provider} model={model} api={api} /></details>
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
  const scopeSignature = `${provider.id}:${purpose}|${provider.revision}|${current.map(model => `${model.id}.${model.revision}`).join(',')}`;
  return <OrderEditor scopeSignature={scopeSignature} rows={rows} label={model => model.displayName || model.modelId} onSave={async ordered => {
    const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}/models/reorder`, 'POST', { providerRevision: provider.revision, purpose, order: ordered.map(model => ({ id: model.id, revision: model.revision })) }, 'บันทึกลำดับ Model แล้ว', orderKey);
    return result !== null;
  }}>
    {model => <ModelRow provider={provider} model={model} api={api} />}
  </OrderEditor>;
}

function ProviderGroup({ provider, purpose, choices, focusAfterCreation, recentlyCreated }: {
  provider: ProviderView; purpose: ModelPurpose; choices: ProviderChoice[];
  focusAfterCreation: boolean; recentlyCreated: boolean;
}) {
  const api = useApiController();
  const providerCardRef = useRef<HTMLElement | null>(null);
  const addModelRef = useRef<HTMLDetailsElement | null>(null);
  const focusHandledRef = useRef(false);
  const modelCount = provider.models.filter(model => model.purpose === purpose).length;
  useLayoutEffect(() => {
    const details = addModelRef.current;
    if (!focusAfterCreation || focusHandledRef.current || !details) return;
    focusHandledRef.current = true;
    details.open = true;
    providerCardRef.current?.scrollIntoView({ block: 'center' });
    details.querySelector<HTMLElement>('[data-model-form-heading]')?.focus();
  }, [focusAfterCreation]);
  const modelsTitleId = `${provider.id}-${purpose}-models-title`;
  return <section ref={providerCardRef} data-provider-id={provider.id} className={`provider-card${recentlyCreated ? ' provider-card-created' : ''}`} aria-labelledby={`${provider.id}-${purpose}-title`}>
    <header className="provider-card-heading">
      <div><h2 id={`${provider.id}-${purpose}-title`}>{provider.name}</h2><p><span className="provider-adapter">{adapterLabels[provider.adapter]}</span></p></div>
      <span className={`provider-pill ${provider.enabled ? 'provider-pill-on' : 'provider-pill-off'}`}>{provider.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
    </header>
    <QuotaSummary provider={provider} api={api} />
    {provider.adapter === 'COMPATIBLE' && <FreeAccountForm key={`${provider.revision}:${JSON.stringify(provider.freeAccount ?? null)}`} provider={provider} view={provider.freeAccount} />}
    {api.notice && <NoticeLine notice={api.notice} />}
    <details className="provider-settings"><summary>ตั้งค่าผู้ให้บริการ · {provider.costMode === 'FREE_ONLY' ? 'ใช้ฟรีเท่านั้น' : 'อนุญาตค่าใช้จ่าย'}</summary><ProviderSettings provider={provider} api={api} choices={choices} /></details>
    <section className="provider-models" aria-labelledby={modelsTitleId}>
      <div className="provider-section-heading"><div><h3 id={modelsTitleId}>Models สำหรับ{purpose === 'GENERATION' ? 'สร้างคำตอบ' : ' Embedding'}</h3><p>{modelCount} รายการ · ลำดับแยกตามประเภทการใช้งาน</p></div></div>
      {modelCount === 0 ? <div className="provider-empty-models"><h3>ยังไม่มี Model ในกลุ่มนี้</h3><p>เพิ่ม Model นี้เมื่อมีรหัสและความสามารถจากผู้ให้บริการ</p></div>
        : <div className="provider-model-list"><ModelPurposeList provider={provider} purpose={purpose} api={api} /></div>}
      <details ref={addModelRef} className="provider-add-model" aria-label={`เพิ่มโมเดลใน ${provider.name}`}>
        <summary onClick={event => focusModelFormAfterDisclosure(event.currentTarget)}>เพิ่มโมเดลใน {provider.name}</summary>
        <ModelForm provider={provider} api={api} />
      </details>
    </section>
  </section>;
}

function isFallbackPreview(value: unknown): value is FallbackPreviewView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FallbackPreviewView>;
  return (candidate.pricingEvidence === 'LAST_CATALOG_OBSERVATION'||candidate.pricingEvidence==='ACCOUNT_CONFIRMATION_OR_CATALOG') && candidate.maxInferenceAttempts === 3 && Array.isArray(candidate.rows) && typeof candidate.generatedAt === 'string' && Boolean(candidate.profile);
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
  return <section id="fallback" tabIndex={-1} className="provider-preview" aria-labelledby="provider-preview-title">
    <div className="provider-preview-heading"><div><h2 id="provider-preview-title">ลำดับสำรองสำหรับ{purpose === 'GENERATION' ? 'สร้างคำตอบ' : 'เอกสารใหม่'}</h2><p>อิงการตั้งค่าที่บันทึกและราคาที่ตรวจล่าสุด</p></div>
      {purpose === 'GENERATION' && <div className="provider-preview-options"><span className="provider-preview-fixed">ตรวจ JSON output</span><CheckField id="preview-tools" name="requiresTools" label="ต้องการ Tools" checked={requiresTools} onChange={event => { setRequiresTools(event.target.checked); setPreview(null); }} /></div>}
      <button className="provider-button provider-button-secondary" type="button" onClick={load} disabled={api.pending('preview')}>{api.pending('preview') ? 'กำลังจัดลำดับ…' : 'ดูตัวอย่างลำดับ'}</button>
    </div>
    <p className="provider-field-hint">บันทึกลำดับก่อนดูตัวอย่าง · {purpose === 'EMBEDDING' ? 'สำหรับนำเข้าเอกสารใหม่ การค้นหาใช้ Model ที่ตรงกับชุดเอกสารเดิม' : 'ราคาและความพร้อมอาจเปลี่ยน ระบบตรวจอีกครั้งก่อนใช้งาน'}</p>
    {previewError && <p className="provider-notice provider-notice-error" role="alert">{previewError}</p>}
    <NoticeLine notice={api.notice} />
    {preview && <div className="provider-preview-result"><p>ตรวจเมื่อ {dateLabel(preview.generatedAt)} · อนุญาตไม่เกิน {preview.maxInferenceAttempts} การลอง · {preview.pricingEvidence==='ACCOUNT_CONFIRMATION_OR_CATALOG'?'อิงการยืนยันบัญชี Free ที่ยังไม่หมดอายุ หรือราคาที่ตรวจพบล่าสุด':'อิงราคาที่ตรวจพบล่าสุด'}</p>
      {preview.rows.length === 0 ? <p className="provider-unknown">ยังไม่มี Model ที่อยู่ในรายการ preview</p> : <ol>{preview.rows.map((row, index) => {
        const found = modelMap.get(`${row.providerId}:${row.modelId}`);
        return <li key={`${row.providerId}:${row.modelId}:${index}`}><strong>{found?.model.displayName ?? 'Model ที่ไม่อยู่ในรายการปัจจุบัน'}</strong><code>{found?.model.modelId ?? row.modelId}</code><span>{found?.provider.name ?? 'ผู้ให้บริการที่ไม่อยู่ในรายการปัจจุบัน'}</span><span>{row.position === null ? reasonLabel(row.reason) : `ลำดับ ${row.position} · ${reasonLabel(row.reason)}`}{row.reason === 'COOLDOWN' && row.cooldownUntil ? ` · หลัง ${dateLabel(row.cooldownUntil)}` : ''}</span></li>;
      })}</ol>}
      <p className="provider-field-hint">ตัวอย่างนี้ไม่ยืนยันว่า Model พร้อมใช้งาน ระบบตรวจราคาและความสามารถอีกครั้งก่อนเรียกใช้</p>
    </div>}
  </section>;
}

export default function ProviderForms({ providers, choices, loadError = false, lastGeneration, lastGenerationError = false }: {
  providers: ProviderView[]; choices: ProviderChoice[]; loadError?: boolean;
  lastGeneration?: LastGenerationView | null; lastGenerationError?: boolean;
}) {
  const purpose:ModelPurpose = 'GENERATION';
  const api = useApiController();
  const router = useRouter();
  const [createdProvider, setCreatedProvider] = useState<CreatedProvider | null>(null);
  const refreshedCreatedProvider = !loadError && createdProvider ? providers.find(provider => provider.id === createdProvider.id) ?? null : null;
  const globalRows = providers.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const providerOrderSignature = globalRows.map(provider => `${provider.id}.${provider.revision}`).join(',');
  const handleProviderCreated = useCallback((provider: CreatedProvider) => {
    setCreatedProvider(provider);
  }, []);
  return <div className="provider-workspace">
    <GenerationPlanPanel providers={providers} loadError={loadError} lastGeneration={lastGeneration} lastGenerationError={lastGenerationError} />
    <div className="provider-toolbar"><span className="provider-policy"><strong>ค่าเริ่มต้น</strong> · ใช้โมเดลฟรีเท่านั้น</span><CreateProviderForm choices={choices} onCreated={handleProviderCreated} /></div>
    {createdProvider && <p className="provider-created-continuation" role="status">{refreshedCreatedProvider ? `เพิ่มผู้ให้บริการแล้ว · ตั้งค่า Model สำหรับ ${refreshedCreatedProvider.name}` : `เพิ่มผู้ให้บริการแล้ว · กำลังโหลด ${createdProvider.name} เพื่อเปิดฟอร์ม Model`}</p>}
    {loadError ? <section className="provider-empty provider-load-error" role="alert"><h2>โหลดรายการผู้ให้บริการไม่สำเร็จ</h2><p>รายการยังไม่พร้อมแสดง กรุณาลองโหลดอีกครั้ง</p><button className="provider-button provider-button-secondary" type="button" onClick={() => router.refresh()}>ลองอีกครั้ง</button></section>
      : providers.length === 0 ? <section className="provider-empty" aria-labelledby="provider-empty-title"><h2 id="provider-empty-title">ยังไม่มีผู้ให้บริการ AI</h2><p>เพิ่ม OpenCode Zen หรือ OpenRouter แล้วบันทึกคีย์ของผู้ให้บริการเพื่อเริ่มตั้งค่า Model</p><button className="provider-button provider-button-primary" type="button" onClick={() => document.querySelector<HTMLDetailsElement>('.provider-add-panel')?.setAttribute('open', '')}>เพิ่มผู้ให้บริการ</button></section>
      : <>
        <FallbackPreview key={purpose} providers={providers} purpose={purpose} />
        <section id="models" tabIndex={-1} className="provider-list" aria-label={`ผู้ให้บริการสำหรับ${purposeLabels[purpose]}`}>
          <div className="provider-list-title"><h2>ผู้ให้บริการและ Models สำหรับสร้างคำตอบ</h2><span>ใช้กับ Chat และ Reasoning</span></div>
          <OrderEditor scopeSignature={providerOrderSignature} rows={globalRows} label={provider => provider.name} onSave={async ordered => {
            const result = await api.send('/api/providers/reorder', 'POST', { order: ordered.map(provider => ({ id: provider.id, revision: provider.revision })) }, 'บันทึกลำดับผู้ให้บริการแล้ว', 'provider-order');
            return result !== null;
          }}>
            {(provider, index, count) => <div className="provider-group-row"><div className="provider-group-order"><span>ผู้ให้บริการ {index + 1} จาก {count}</span></div><ProviderGroup provider={provider} purpose={purpose} choices={choices} focusAfterCreation={refreshedCreatedProvider?.id === provider.id} recentlyCreated={refreshedCreatedProvider?.id === provider.id} /></div>}
          </OrderEditor>
          {api.notice && <NoticeLine notice={api.notice} />}
        </section>
      </>}
  </div>;
}
