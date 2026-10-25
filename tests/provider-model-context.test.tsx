import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'parse5';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelView, ProviderView } from '../types/providers';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import ProviderForms from '../app/(dashboard)/providers/provider-forms';

const firstProviderId = '10000000-0000-4000-8000-000000000001';
const secondProviderId = '20000000-0000-4000-8000-000000000002';
const sharedModelId = '30000000-0000-4000-8000-000000000003';
const sharedModelApiId = 'vendor/shared-model';
const sharedModelName = 'Shared model';

function model(id = sharedModelId): ModelView {
  return {
    id,
    modelId: sharedModelApiId,
    displayName: sharedModelName,
    purpose: 'GENERATION',
    embeddingDimensions: null,
    supportsTools: false,
    supportsJson: true,
    supportsVision: false,
    enabled: true,
    priority: 100,
    timeoutMs: 15000,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    revision: 1,
    pricingStatus: 'UNKNOWN',
    pricingCheckedAt: null,
    apiFormat: 'CHAT',
  };
}

function provider(id: string, name: string, baseUrl: string, models: ModelView[] = []): ProviderView {
  return {
    id,
    name,
    adapter: 'COMPATIBLE',
    baseUrl,
    enabled: true,
    priority: id === firstProviderId ? 1 : 2,
    costMode: 'FREE_ONLY',
    healthStatus: 'UNKNOWN',
    lastHealthCheck: null,
    keyConfigured: true,
    revision: 1,
    models,
  };
}

function render(providers: ProviderView[]) {
  return renderToStaticMarkup(createElement(ProviderForms, {
    providers,
    choices: [{ adapter: 'COMPATIBLE', baseUrl: 'https://api.example.test/v1' }],
  }));
}

function modelForms(markup: string) {
  return [...markup.matchAll(/<form\b(?=[^>]*class="[^"]*\bmodel-form\b")[^>]*>([\s\S]*?)<\/form>/g)].map(match => match[1]);
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

function submitText(node: HtmlNode): string | undefined {
  const button = descendants(node, candidate => candidate.tagName === 'button'
    && Boolean(candidate.attrs?.some(attribute => attribute.name === 'type' && attribute.value === 'submit')))[0];
  return button && textContent(button);
}

describe('ProviderForms model ownership context', () => {
  beforeEach(() => refresh.mockReset());

  it('keeps add and edit forms attached to each provider when model labels repeat', () => {
    const markup = render([
      provider(firstProviderId, 'GroqCloud', 'https://api.groq.com/openai/v1', [model()]),
      provider(secondProviderId, 'Together AI', 'https://api.together.xyz/v1', [model('40000000-0000-4000-8000-000000000004')]),
    ]);
    const forms = modelForms(markup);

    expect(forms).toHaveLength(4);

    const cards = descendants(parse(markup) as unknown as HtmlNode, candidate => hasClass(candidate, 'provider-card'));
    expect(cards).toHaveLength(2);
    expect(cards.map(card => descendants(card, candidate => candidate.tagName === 'h3' && textContent(candidate) === sharedModelName).length))
      .toEqual([1, 1]);

    for (const [id, editedModelId, name, hostname] of [
      [firstProviderId, sharedModelId, 'GroqCloud', 'api.groq.com'],
      [secondProviderId, '40000000-0000-4000-8000-000000000004', 'Together AI', 'api.together.xyz'],
    ]) {
      const ownedForms = forms.filter(form => form.includes(`${id}-new-model-model-id`) || form.includes(`${id}-`));
      expect(ownedForms).toHaveLength(2);
      expect(ownedForms.join('')).not.toMatch(/name="providerId"|name="apiKey"|type="password"/);
      expect(markup).toContain(`${id}-new-model-model-id`);
      expect(markup).toContain(`${id}-${editedModelId}-model-id`);

      const card = cards.find(candidate => textContent(candidate).includes(name));
      expect(card).toBeDefined();
      const addDetails = descendants(card!, candidate => candidate.tagName === 'details' && hasClass(candidate, 'provider-add-model'))[0];
      const editDetails = descendants(card!, candidate => candidate.tagName === 'details' && hasClass(candidate, 'provider-edit-model'))[0];
      for (const [details, label] of [[addDetails, `เพิ่มโมเดลใน ${name}`], [editDetails, `แก้ไขโมเดลใน ${name}`]] as const) {
        expect(textContent(details)).toContain(label);
        expect(textContent(details)).toContain(name);
        expect(textContent(details)).toContain('OpenAI compatible');
        expect(textContent(details)).toContain(hostname);
        expect(textContent(details)).not.toContain(`https://${hostname}/`);
        expect(submitText(details)).toContain(name);
      }
    }

    expect(forms.join('')).not.toMatch(/<select\b/);
    expect(markup).not.toMatch(/<input\b(?=[^>]*type="password")(?=[^>]*value="[^"]+")[^>]*>/);
  });

  it('shows a genuine no-provider state without claiming model readiness', () => {
    const markup = render([]);

    expect(markup).toContain('ยังไม่มีผู้ให้บริการ AI');
    expect(modelForms(markup)).toHaveLength(0);
    expect(markup).not.toMatch(/พร้อมใช้งาน|ทดสอบผ่าน|ฟรี · ตรวจจากผู้ให้บริการ/);
  });

  it('keeps a zero-model provider scoped while its status and eligibility remain unknown', () => {
    const markup = render([
      {
        ...provider(firstProviderId, 'GroqCloud', 'https://api.groq.com/openai/v1'),
        enabled: false,
        keyConfigured: false,
      },
    ]);
    const forms = modelForms(markup);

    expect(markup).toContain('ยังไม่มี Model ในกลุ่มนี้');
    expect(markup).toContain('api.groq.com');
    expect(markup).not.toContain('พร้อมใช้งาน');
    expect(markup).not.toContain('ฟรี · ตรวจจากผู้ให้บริการ');
    expect(markup).not.toContain('ทดสอบผ่าน');
    expect(forms).toHaveLength(1);
    const card = descendants(parse(markup) as unknown as HtmlNode, candidate => hasClass(candidate, 'provider-card'))[0];
    const addDetails = descendants(card, candidate => candidate.tagName === 'details' && hasClass(candidate, 'provider-add-model'))[0];
    expect(textContent(addDetails)).toContain('GroqCloud');
    expect(textContent(addDetails)).toContain('api.groq.com');
    expect(textContent(addDetails)).toContain('เพิ่มโมเดลใน GroqCloud');
    expect(submitText(addDetails)).toContain('GroqCloud');
    expect(forms[0]).toContain(`${firstProviderId}-new-model-model-id`);
    expect(forms[0]).not.toMatch(/name="providerId"|name="apiKey"|type="password"/);
  });
});
