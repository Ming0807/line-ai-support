import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'parse5';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LastGenerationView, ModelView, ProviderView } from '../types/providers';
import { buildGenerationPlan, GENERATION_PLAN_REGISTRY_LIMIT } from '../app/(dashboard)/providers/generation-plan';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import ProviderForms from '../app/(dashboard)/providers/provider-forms';

const providerA = '10000000-0000-4000-8000-000000000001';
const providerB = '20000000-0000-4000-8000-000000000002';
it('distinguishes account-confirmed free eligibility from catalog pricing',()=>{
 const now=Date.now(),p=provider(providerA,'Gemini',0,[model('lite','Lite',{accountFreeUntil:new Date(now+1000).toISOString()})]);
 expect(buildGenerationPlan([p],now).candidates[0].price).toBe('ACCOUNT_FREE');
 expect(buildGenerationPlan([p],now+2000).candidates[0].price).toBe('RECHECK');
});

function model(id: string, displayName: string, overrides: Partial<ModelView> = {}): ModelView {
  return {
    id,
    modelId: `vendor/${id}`,
    displayName,
    purpose: 'GENERATION',
    embeddingDimensions: null,
    supportsTools: false,
    supportsJson: true,
    supportsVision: false,
    enabled: true,
    priority: 10,
    timeoutMs: 15000,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    revision: 1,
    pricingStatus: 'UNKNOWN',
    pricingCheckedAt: null,
    apiFormat: 'CHAT',
    ...overrides,
  };
}

function provider(id: string, name: string, priority: number, models: ModelView[] = [], overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id,
    name,
    adapter: 'COMPATIBLE',
    baseUrl: 'https://api.example.test/v1',
    enabled: true,
    priority,
    costMode: 'FREE_ONLY',
    healthStatus: 'UNKNOWN',
    lastHealthCheck: null,
    keyConfigured: true,
    revision: 1,
    models,
    ...overrides,
  };
}

type FormProps = {
  providers: ProviderView[];
  choices: { adapter: ProviderView['adapter']; baseUrl: string }[];
  lastGeneration?: LastGenerationView | null;
  lastGenerationError?: boolean;
};

function render(props: Partial<FormProps> & Pick<FormProps, 'providers'>): string {
  const component = ProviderForms as unknown as ComponentType<Record<string, unknown>>;
  return renderToStaticMarkup(createElement(component, {
    providers: props.providers,
    choices: props.choices ?? [{ adapter: 'COMPATIBLE', baseUrl: 'https://api.example.test/v1' }],
    ...(Object.hasOwn(props, 'lastGeneration') ? { lastGeneration: props.lastGeneration } : {}),
    ...(props.lastGenerationError === undefined ? {} : { lastGenerationError: props.lastGenerationError }),
  }));
}

type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] };

function descendants(node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode[] {
  const found = predicate(node) ? [node] : [];
  return [...found, ...(node.childNodes ?? []).flatMap(child => descendants(child, predicate))];
}

function textContent(node: HtmlNode): string {
  return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(textContent).join('');
}

function hasClass(node: HtmlNode, name: string): boolean {
  return (node.attrs ?? []).some(attribute => attribute.name === 'class' && attribute.value.split(/\s+/).includes(name));
}

function generationPlan(markup: string): HtmlNode {
  const node = descendants(parse(markup) as unknown as HtmlNode, candidate => hasClass(candidate, 'provider-generation-plan'))[0];
  expect(node).toBeDefined();
  return node!;
}

describe('provider generation plan', () => {
  beforeEach(() => refresh.mockReset());

  it('shows the configured first choice and ordered backups separately from actual successful usage', () => {
    const providers = [
      provider(providerB, 'Backup provider', 2, [model('30000000-0000-4000-8000-000000000003', 'Later model', { priority: 1 })]),
      provider(providerA, 'Primary provider', 1, [
        model('40000000-0000-4000-8000-000000000004', 'First configured model', { priority: 20 }),
        model('50000000-0000-4000-8000-000000000005', 'Second configured model', { priority: 30 }),
      ]),
    ];
    const lastGeneration: LastGenerationView = {
      providerId: providerB,
      providerName: 'Backup provider',
      modelId: '30000000-0000-4000-8000-000000000003',
      modelName: 'Later model',
      requestType: 'SUPPORT_INTENT',
      observedAt: '2026-10-10T04:30:00.000Z',
      fallbackUsed: true,
      configurationChanged: true,
    };

    const plan = generationPlan(render({ providers, lastGeneration, lastGenerationError: false }));
    const content = textContent(plan);

    expect(content).toContain('ตัวแรกที่จะลอง');
    expect(content.indexOf('First configured model')).toBeLessThan(content.indexOf('Second configured model'));
    expect(content.indexOf('Second configured model')).toBeLessThan(content.indexOf('Later model'));
    expect(content).toContain('เรียกสำเร็จล่าสุด');
    expect(content).toContain('วิเคราะห์ความต้องการช่วยเหลือ');
    expect(content).toContain('มีการใช้รุ่นสำรอง');
    expect(content).toContain('การตั้งค่าปัจจุบันเปลี่ยนหลังการเรียกนี้');
    expect(content).toContain('ตรวจใหม่ก่อนใช้');
    expect(content).toContain('ไม่ยืนยันว่าข้อความถูกส่งถึงนักศึกษา');
    expect(content).toContain('ไม่เกิน 3 การเรียกจริง');
  });

  it('explains why disabled, non-JSON, and cooling models are skipped', () => {
    const providers = [
      provider(providerA, 'Primary provider', 1, [
        model('40000000-0000-4000-8000-000000000004', 'Disabled model', { enabled: false }),
        model('50000000-0000-4000-8000-000000000005', 'Text only model', { supportsJson: false }),
        model('60000000-0000-4000-8000-000000000006', 'Cooling model', { cooldownUntil: '2099-01-01T00:00:00.000Z' }),
      ]),
      provider(providerB, 'Paused provider', 2, [model('70000000-0000-4000-8000-000000000007', 'Provider paused model')], { enabled: false }),
    ];

    const content = textContent(generationPlan(render({ providers, lastGeneration: null, lastGenerationError: false })));

    expect(content).toContain('Disabled model');
    expect(content).toContain('Text only model');
    expect(content).toContain('Cooling model');
    expect(content).toContain('Provider paused model');
    expect(content).toContain('ปิดใช้งาน');
    expect(content).toContain('ไม่รองรับ JSON');
    expect(content).toContain('อยู่ระหว่างพัก');
  });

  it('matches the backend ordering and 64-row registry cap before JSON filtering', () => {
    const checkedAt = '2026-10-10T04:30:00.000Z';
    const capped = Array.from({ length: GENERATION_PLAN_REGISTRY_LIMIT }, (_, index) => {
      const id = `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return model(id, `Model ${index + 1}`, {
        priority: 1,
        supportsJson: index !== GENERATION_PLAN_REGISTRY_LIMIT - 1,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        pricingStatus: 'FREE',
        pricingCheckedAt: checkedAt,
      });
    });
    const outside = model('40000000-0000-4000-8000-000000000001', 'Outside registry');
    const plan = buildGenerationPlan([
      provider(providerB, 'Later provider', 2, [outside]),
      provider(providerA, 'First provider', 1, capped),
    ], Date.parse(checkedAt));

    expect(plan.candidates).toHaveLength(GENERATION_PLAN_REGISTRY_LIMIT - 1);
    expect(plan.candidates[0]?.modelId).toBe('vendor/30000000-0000-4000-8000-000000000001');
    expect(plan.candidates.at(-1)?.position).toBe(GENERATION_PLAN_REGISTRY_LIMIT - 1);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: outside.modelId, reason: 'REGISTRY_LIMIT' }),
      expect.objectContaining({ modelId: capped.at(-1)?.modelId, reason: 'JSON_UNSUPPORTED' }),
    ]));
  });

  it('does not present a Zen model without its required API format as callable', () => {
    const zen = provider(providerA, 'OpenCode Zen', 1, [model('50000000-0000-4000-8000-000000000005', 'Zen model', { apiFormat: null })], { adapter: 'ZEN' });
    const plan = buildGenerationPlan([zen]);

    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0]).toMatchObject({ reason: 'API_FORMAT_UNSET' });
  });

  it('does not promise a fresh price check when the provider explicitly allows paid calls', () => {
    const paidAllowed = provider(providerA, 'Paid allowed provider', 1, [model('60000000-0000-4000-8000-000000000006', 'Unpriced model')], { costMode: 'ALLOW_PAID' });
    const content = textContent(generationPlan(render({ providers: [paidAllowed], lastGeneration: null, lastGenerationError: false })));

    expect(content).toContain('ราคาไม่ทราบหรือข้อมูลเก่า · อาจมีค่าใช้จ่าย');
    expect(content).toContain('ALLOW_PAID อนุญาตให้เกิดค่าใช้จ่าย');
    expect(content).not.toContain('ราคาไม่ทราบหรือข้อมูลเก่า · ตรวจใหม่ก่อนใช้');
  });

  it('keeps missing, empty, and failed latest-usage states distinct', () => {
    const providers = [provider(providerA, 'Primary provider', 1, [])];

    const unknown = textContent(generationPlan(render({ providers })));
    const empty = textContent(generationPlan(render({ providers, lastGeneration: null, lastGenerationError: false })));
    const error = textContent(generationPlan(render({ providers, lastGeneration: null, lastGenerationError: true })));

    expect(unknown).toContain('ยังไม่มีข้อมูลการเรียกสำเร็จล่าสุด');
    expect(empty).toContain('ยังไม่มีการเรียกสร้างคำตอบที่สำเร็จ');
    expect(error).toContain('โหลดข้อมูลการเรียกสำเร็จล่าสุดไม่ได้');
    expect(new Set([unknown, empty, error]).size).toBe(3);
  });
});
