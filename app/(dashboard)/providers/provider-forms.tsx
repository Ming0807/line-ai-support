'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ProviderHealth } from '@/lib/ai/types';
import type { ModelView, ProviderView } from '@/types/providers';

type Notice = { kind: 'success' | 'error'; text: string } | null;
type ApiResult = Record<string, unknown> | null;
type ApiController = {
  pending: boolean;
  notice: Notice;
  send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, successText: string): Promise<ApiResult>;
};

const healthLabels: Record<ProviderHealth, string> = {
  HEALTHY: 'พร้อมใช้งาน', DEGRADED: 'ตอบสนองช้า', RATE_LIMITED: 'จำกัดคำขอ',
  OFFLINE: 'ยังเชื่อมต่อไม่ได้', UNKNOWN: 'ยังไม่ตรวจสอบ',
};

function errorMessage(status: number): string {
  if (status === 400) return 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบช่องที่กรอก';
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์จัดการผู้ให้บริการ';
  if (status === 404) return 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว';
  if (status === 409) return 'ข้อมูลมีการเปลี่ยนแปลงหรือซ้ำกัน กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง';
  if (status === 503) return 'บริการยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง';
  return 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
}

function useApiController(): ApiController {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, successText: string): Promise<ApiResult> {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setNotice({ kind: 'error', text: errorMessage(response.status) });
        if (response.status === 409) router.refresh();
        return null;
      }
      const payload: unknown = await response.json().catch(() => null);
      setNotice({ kind: 'success', text: successText });
      router.refresh();
      return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
    } catch {
      setNotice({ kind: 'error', text: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง' });
      return null;
    } finally {
      setPending(false);
    }
  }

  return { pending, notice, send };
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <p className={`provider-notice provider-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>;
}

function Field({ id, label, children, hint }: { id?: string; label: string; children: ReactNode; hint?: string }) {
  return <label className="provider-field" htmlFor={id}>{label}{children}{hint && <span className="provider-field-hint">{hint}</span>}</label>;
}

function NumberField({ id, label, name, defaultValue, min, max, step = 1, hint, required = true }: {
  id: string; label: string; name: string; defaultValue?: number; min: number; max: number; step?: number | 'any'; hint?: string; required?: boolean;
}) {
  return <Field id={id} label={label} hint={hint}><input id={id} name={name} type="number" min={min} max={max} step={step} defaultValue={defaultValue} required={required} /></Field>;
}

function CheckField({ id, label, name, defaultChecked }: { id: string; label: string; name: string; defaultChecked: boolean }) {
  return <label className="provider-check" htmlFor={id}><input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} /><span>{label}</span></label>;
}

function priceValue(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? '').trim();
  return raw === '' ? null : Number(raw);
}

function commonModelValues(form: FormData) {
  return {
    modelId: String(form.get('modelId') ?? '').trim(),
    displayName: String(form.get('displayName') ?? '').trim(),
    supportsTools: form.has('supportsTools'),
    supportsJson: form.has('supportsJson'),
    supportsVision: form.has('supportsVision'),
    enabled: form.has('enabled'),
    priority: Number(form.get('priority')),
    timeoutMs: Number(form.get('timeoutMs')),
    inputPricePerMillion: priceValue(form, 'inputPricePerMillion'),
    outputPricePerMillion: priceValue(form, 'outputPricePerMillion'),
  };
}

function formatPrice(value: number | null): string {
  return value === null ? 'ยังไม่ระบุ' : `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 }).format(value)} USD`;
}

function formatHealthDate(value: string | null): string {
  if (!value) return 'ยังไม่มีผลตรวจ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ยังไม่มีผลตรวจ';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function CreateProviderForm() {
  const api = useApiController();
  const [apiKey, setApiKey] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const result = await api.send('/api/providers', 'POST', {
      name: String(form.get('name') ?? '').trim(),
      adapter: 'OPENAI',
      baseUrl: String(form.get('baseUrl') ?? ''),
      enabled: form.has('enabled'),
      priority: Number(form.get('priority')),
      apiKey,
    }, 'เพิ่มผู้ให้บริการแล้ว');
    if (result) {
      element.reset();
      setApiKey('');
    }
  }

  return (
    <details className="provider-add-panel" open>
      <summary><span>เพิ่มผู้ให้บริการ</span><span className="provider-summary-hint">OpenAI</span></summary>
      <form className="provider-form" onSubmit={submit}>
        <div className="provider-fields provider-fields-provider">
          <Field id="new-provider-name" label="ชื่อผู้ให้บริการ"><input id="new-provider-name" name="name" maxLength={100} required placeholder="เช่น OpenAI ฝ่ายบริการ" /></Field>
          <Field id="new-provider-base-url" label="Base URL"><select id="new-provider-base-url" name="baseUrl" defaultValue="https://api.openai.com/v1"><option value="https://api.openai.com/v1">https://api.openai.com/v1</option><option value="https://api.openai.com/v1/">https://api.openai.com/v1/</option></select></Field>
          <NumberField id="new-provider-priority" label="ลำดับความสำคัญ" name="priority" defaultValue={100} min={0} max={1000} hint="เลขน้อยจะถูกเลือกก่อน" />
          <Field id="new-provider-key" label="API key"><input id="new-provider-key" name="apiKey" type="password" autoComplete="new-password" minLength={8} maxLength={512} required value={apiKey} onChange={event => setApiKey(event.target.value)} /></Field>
        </div>
        <div className="provider-form-actions"><CheckField id="new-provider-enabled" name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked /><button className="provider-button provider-button-primary" type="submit" disabled={api.pending}>{api.pending ? 'กำลังบันทึก…' : 'เพิ่มผู้ให้บริการ'}</button></div>
        <NoticeLine notice={api.notice} />
      </form>
    </details>
  );
}

function ProviderSettings({ provider, api }: { provider: ProviderView; api: ApiController }) {
  const [apiKey, setApiKey] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.send(`/api/providers/${encodeURIComponent(provider.id)}`, 'PATCH', {
      name: String(form.get('name') ?? '').trim(),
      adapter: 'OPENAI',
      baseUrl: String(form.get('baseUrl') ?? ''),
      enabled: form.has('enabled'),
      priority: Number(form.get('priority')),
      revision: provider.revision,
      apiKey: apiKey.trim() === '' ? null : apiKey,
    }, 'บันทึกการตั้งค่าแล้ว');
    if (result) setApiKey('');
  }

  return (
    <form className="provider-form provider-settings-form" onSubmit={submit}>
      <div className="provider-fields provider-fields-provider">
        <Field id={`${provider.id}-name`} label="ชื่อผู้ให้บริการ"><input id={`${provider.id}-name`} name="name" defaultValue={provider.name} maxLength={100} required /></Field>
        <Field id={`${provider.id}-base-url`} label="Base URL"><select id={`${provider.id}-base-url`} name="baseUrl" defaultValue={provider.baseUrl}><option value="https://api.openai.com/v1">https://api.openai.com/v1</option><option value="https://api.openai.com/v1/">https://api.openai.com/v1/</option></select></Field>
        <NumberField id={`${provider.id}-priority`} label="ลำดับความสำคัญ" name="priority" defaultValue={provider.priority} min={0} max={1000} hint="เลขน้อยจะถูกเลือกก่อน" />
        <Field id={`${provider.id}-api-key`} label="API key">
          <input id={`${provider.id}-api-key`} name="apiKey" type="password" autoComplete="new-password" placeholder="เว้นว่างเพื่อเก็บคีย์เดิม" minLength={8} maxLength={512} value={apiKey} onChange={event => setApiKey(event.target.value)} />
        </Field>
      </div>
      <div className="provider-form-actions"><CheckField id={`${provider.id}-enabled`} name="enabled" label="เปิดใช้งานผู้ให้บริการ" defaultChecked={provider.enabled} /><button className="provider-button provider-button-secondary" type="submit" disabled={api.pending}>{api.pending ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button></div>
      <p className="provider-field-hint">{provider.keyConfigured ? 'มีคีย์ที่บันทึกไว้แล้ว' : 'ยังไม่ได้ตั้งค่า API key'} · คีย์ที่กรอกใหม่จะแทนที่คีย์ปัจจุบัน</p>
    </form>
  );
}

function ModelForm({ providerId, model, api }: { providerId: string; model?: ModelView; api: ApiController }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const values = commonModelValues(form);
    if (model) {
      await api.send(`/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(model.id)}`, 'PATCH',
        { ...values, revision: model.revision }, 'บันทึกการตั้งค่า Model แล้ว');
    } else {
      const result = await api.send(`/api/providers/${encodeURIComponent(providerId)}/models`, 'POST', values, 'เพิ่ม Model แล้ว');
      if (result) element.reset();
    }
  }

  const prefix = `${providerId}-${model?.id ?? 'new-model'}`;
  return (
    <form className="provider-form model-form" onSubmit={submit}>
      <div className="provider-fields provider-fields-model">
        <Field id={`${prefix}-model-id`} label="รหัส Model ใน API"><input id={`${prefix}-model-id`} name="modelId" defaultValue={model?.modelId ?? ''} maxLength={200} required placeholder="เช่น gpt-4.1-mini" /></Field>
        <Field id={`${prefix}-display-name`} label="ชื่อที่แสดง"><input id={`${prefix}-display-name`} name="displayName" defaultValue={model?.displayName ?? ''} maxLength={100} required placeholder="ระบุชื่อสำหรับทีมงาน" /></Field>
        <NumberField id={`${prefix}-priority`} label="ลำดับความสำคัญ" name="priority" defaultValue={model?.priority ?? 100} min={0} max={1000} hint="เลขน้อยจะถูกเลือกก่อน" />
        <NumberField id={`${prefix}-timeout`} label="หมดเวลาตอบสนอง (มิลลิวินาที)" name="timeoutMs" defaultValue={model?.timeoutMs ?? 15000} min={1000} max={45000} step={1000} />
        <NumberField id={`${prefix}-input-price`} label="ราคา Input / 1M tokens (USD)" name="inputPricePerMillion" defaultValue={model?.inputPricePerMillion ?? undefined} min={0} max={10000} step="any" hint="เว้นว่างเพื่อไม่ระบุราคา" required={false} />
        <NumberField id={`${prefix}-output-price`} label="ราคา Output / 1M tokens (USD)" name="outputPricePerMillion" defaultValue={model?.outputPricePerMillion ?? undefined} min={0} max={10000} step="any" hint="เว้นว่างเพื่อไม่ระบุราคา" required={false} />
      </div>
      <div className="provider-checks">
        <CheckField id={`${prefix}-tools`} name="supportsTools" label="รองรับ Tools" defaultChecked={model?.supportsTools ?? false} />
        <CheckField id={`${prefix}-json`} name="supportsJson" label="รองรับ JSON mode" defaultChecked={model?.supportsJson ?? false} />
        <CheckField id={`${prefix}-vision`} name="supportsVision" label="รองรับภาพ" defaultChecked={model?.supportsVision ?? false} />
        <CheckField id={`${prefix}-enabled`} name="enabled" label="เปิดใช้งาน Model" defaultChecked={model?.enabled ?? true} />
      </div>
      <button className="provider-button provider-button-secondary" type="submit" disabled={api.pending}>{api.pending ? 'กำลังบันทึก…' : model ? 'บันทึก Model' : 'เพิ่ม Model'}</button>
    </form>
  );
}

function ModelList({ provider, api }: { provider: ProviderView; api: ApiController }) {
  const models = provider.models.slice().sort((first, second) => first.priority - second.priority || first.modelId.localeCompare(second.modelId));
  if (models.length === 0) return <div className="provider-empty-models"><h3>ยังไม่มี Model</h3><p>เพิ่ม Model และกำหนดลำดับก่อนระบบจึงจะเลือกใช้ได้</p></div>;
  return (
    <div className="provider-model-list">
      {models.map(model => (
        <article className="provider-model" key={model.id}>
          <header className="provider-model-heading">
            <div><h3>{model.displayName}</h3><p><code>{model.modelId}</code></p></div>
            <span className={`provider-pill ${model.enabled ? 'provider-pill-on' : 'provider-pill-off'}`}>{model.enabled ? 'เปิด' : 'ปิด'}</span>
          </header>
          <dl className="provider-model-facts">
            <div><dt>ลำดับ</dt><dd>{model.priority}</dd></div>
            <div><dt>หมดเวลา</dt><dd>{new Intl.NumberFormat('th-TH').format(model.timeoutMs)} ms</dd></div>
            <div><dt>Input / 1M</dt><dd>{formatPrice(model.inputPricePerMillion)}</dd></div>
            <div><dt>Output / 1M</dt><dd>{formatPrice(model.outputPricePerMillion)}</dd></div>
            <div><dt>ความสามารถ</dt><dd>{[model.supportsTools && 'Tools', model.supportsJson && 'JSON', model.supportsVision && 'ภาพ'].filter(Boolean).join(' · ') || 'พื้นฐาน'}</dd></div>
          </dl>
          <details className="provider-edit-model">
            <summary>แก้ไข Model</summary>
            <ModelForm key={`${model.id}:${model.revision}`} providerId={provider.id} model={model} api={api} />
          </details>
        </article>
      ))}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderView }) {
  const api = useApiController();
  const [healthPending, setHealthPending] = useState(false);
  const health = provider.healthStatus;
  const preferredModel = provider.models.slice().sort((a, b) => a.priority - b.priority)[0];

  async function checkHealth() {
    if (!preferredModel || !provider.keyConfigured) return;
    setHealthPending(true);
    await api.send(`/api/providers/${encodeURIComponent(provider.id)}/health`, 'POST', { modelId: preferredModel.id }, 'ตรวจสอบผู้ให้บริการแล้ว');
    setHealthPending(false);
  }

  return (
    <article className="provider-card">
      <header className="provider-card-heading">
        <div><h2>{provider.name}</h2><p><span className="provider-adapter">OpenAI</span><span aria-hidden="true"> · </span>ลำดับ {provider.priority} <span className="provider-priority-hint">(เลขน้อยทำงานก่อน)</span></p></div>
        <span className={`provider-pill ${provider.enabled ? 'provider-pill-on' : 'provider-pill-off'}`}>{provider.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
      </header>
      <p className="provider-base-url"><span>Base URL</span><code>{provider.baseUrl}</code></p>
      <section className="provider-health" aria-label={`สถานะการเชื่อมต่อ ${provider.name}`}>
        <div><span className={`provider-health-dot provider-health-${health.toLowerCase()}`} aria-hidden="true" /><div><strong>{healthLabels[health]}</strong><span>ตรวจล่าสุด · {formatHealthDate(provider.lastHealthCheck)}</span></div></div>
        <button className="provider-button provider-button-tertiary" type="button" onClick={checkHealth} disabled={api.pending || healthPending || !preferredModel || !provider.keyConfigured}>
          {healthPending || api.pending ? 'กำลังตรวจ…' : 'ตรวจสอบสถานะ'}
        </button>
      </section>
      {!provider.keyConfigured && <p className="provider-inline-note">เพิ่ม API key ก่อนตรวจสอบการเชื่อมต่อ</p>}
      <NoticeLine notice={api.notice} />
      <details className="provider-settings">
        <summary>ตั้งค่าผู้ให้บริการ</summary>
        <ProviderSettings key={provider.revision} provider={provider} api={api} />
      </details>
      <section className="provider-models" aria-labelledby={`${provider.id}-models-title`}>
        <div className="provider-section-heading"><div><h3 id={`${provider.id}-models-title`}>Models</h3><p>ระบบพิจารณาตามลำดับความสำคัญจากเลขน้อยไปมาก</p></div><span>{provider.models.length} รายการ</span></div>
        <ModelList provider={provider} api={api} />
        <details className="provider-add-model">
          <summary>เพิ่ม Model</summary>
          <ModelForm providerId={provider.id} api={api} />
        </details>
      </section>
    </article>
  );
}

export default function ProviderForms({ providers }: { providers: ProviderView[] }) {
  const orderedProviders = providers.slice().sort((first, second) => first.priority - second.priority || first.name.localeCompare(second.name));
  return (
    <div className="provider-workspace">
      <CreateProviderForm />
      {orderedProviders.length === 0 ? (
        <section className="provider-empty" aria-labelledby="provider-empty-title">
          <span className="provider-empty-mark" aria-hidden="true">+</span>
          <h2 id="provider-empty-title">ยังไม่มีผู้ให้บริการ AI</h2>
          <p>เพิ่ม OpenAI เพื่อเริ่มกำหนด Model และการตั้งค่าที่ทีมของคุณใช้</p>
        </section>
      ) : (
        <section className="provider-list" aria-label="ผู้ให้บริการที่ตั้งค่าไว้">
          {orderedProviders.map(provider => <ProviderCard key={provider.id} provider={provider} />)}
        </section>
      )}
    </div>
  );
}
