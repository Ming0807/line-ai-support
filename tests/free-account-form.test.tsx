import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderView } from '../types/providers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import FreeAccountForm, { buildFreeAccountSavePayload } from '../app/(dashboard)/providers/free-account-form';

const provider: ProviderView = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Example compatible provider',
  adapter: 'COMPATIBLE',
  baseUrl: 'https://api.example.test/v1',
  enabled: true,
  priority: 1,
  healthStatus: 'UNKNOWN',
  costMode: 'FREE_ONLY',
  lastHealthCheck: null,
  keyConfigured: true,
  revision: 7,
  models: [],
};

describe('FreeAccountForm', () => {
  it('does not expose actions or checked consent when schema is unavailable', () => {
    const markup = renderToStaticMarkup(createElement(FreeAccountForm, {
      provider,
      view: { schemaReady: false, status: 'NONE', revision: null, models: [], eligibleModels: ['vendor/model-a'], confirmedAt: null, expiresAt: null },
    }));

    expect(markup).toContain('โครงสร้างจัดเก็บการยืนยันยังไม่พร้อม');
    expect(markup).not.toContain('บันทึกการยืนยัน</button>');
    expect(markup).not.toContain('ยกเลิกการยืนยัน</button>');
  });

  it('shows managed status and leaves model and billing attestations unchecked', () => {
    const markup = renderToStaticMarkup(createElement(FreeAccountForm, {
      provider,
      view: { schemaReady: true, status: 'ACTIVE', revision: 3, models: ['vendor/model-a'], eligibleModels: ['vendor/model-a'], confirmedAt: '2026-10-15T00:00:00.000Z', expiresAt: '2026-10-22T00:00:00.000Z' },
    }));

    expect(markup).toContain('มีการยืนยันที่บันทึกไว้และยังไม่หมดอายุ');
    expect(markup).toContain('vendor/model-a');
    expect(markup).toContain('ไม่ใช่หลักฐานการเรียกเก็บเงินหรือโควต้า');
    expect(markup).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked(?:="")?/);
  });

  it('requires both attestations and an eligible selected model, and emits only CAS-bound API fields', () => {
    const base = { providerRevision: 7, grantRevision: null, selectedModels: ['vendor/model-b', 'vendor/model-a', 'vendor/model-a', 'unconfigured/model'],
      validForDays: 7, confirmFreeTier: true, billingDisabled: true, eligibleModels: ['vendor/model-a', 'vendor/model-b'] };

    expect(buildFreeAccountSavePayload({ ...base, confirmFreeTier: false })).toBeNull();
    expect(buildFreeAccountSavePayload({ ...base, billingDisabled: false })).toBeNull();
    expect(buildFreeAccountSavePayload({ ...base, selectedModels: [] })).toBeNull();
    expect(buildFreeAccountSavePayload({ ...base, validForDays: 31 })).toBeNull();
    expect(buildFreeAccountSavePayload(base)).toEqual({
      providerRevision: 7,
      grantRevision: null,
      models: ['vendor/model-a', 'vendor/model-b'],
      validForDays: 7,
      confirmFreeTier: true,
      billingDisabled: true,
    });
  });
});
