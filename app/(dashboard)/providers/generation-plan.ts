import type { ModelView, ProviderView } from '@/types/providers';

export const GENERATION_PLAN_REGISTRY_LIMIT = 64;
const PRICE_FRESH_MS = 60_000;

export type GenerationPlanSkipReason =
  | 'PROVIDER_DISABLED'
  | 'MODEL_DISABLED'
  | 'REGISTRY_LIMIT'
  | 'KEY_MISSING'
  | 'COOLDOWN'
  | 'JSON_UNSUPPORTED'
  | 'API_FORMAT_UNSET'
  | 'PAID_BLOCKED';

export type GenerationPlanPrice = 'FREE' | 'ACCOUNT_FREE' | 'PAID' | 'RECHECK';

export interface GenerationPlanEntry {
  providerId: string;
  providerName: string;
  modelRecordId: string;
  modelId: string;
  modelName: string;
  providerPriority: number;
  modelPriority: number;
  costMode: ProviderView['costMode'];
  price: GenerationPlanPrice;
  pricingCheckedAt: string | null;
  cooldownUntil: string | null;
  position: number | null;
  reason: GenerationPlanSkipReason | null;
}

export interface GenerationPlan {
  candidates: GenerationPlanEntry[];
  skipped: GenerationPlanEntry[];
}

function priceEvidence(model: ModelView, now: number): GenerationPlanPrice {
  if(model.accountFreeUntil&&Date.parse(model.accountFreeUntil)>now)return 'ACCOUNT_FREE';
  const checkedAt = model.pricingCheckedAt === null ? NaN : Date.parse(model.pricingCheckedAt);
  const age = now - checkedAt;
  const fresh = Number.isFinite(age) && age >= -1000 && age <= PRICE_FRESH_MS;
  if (!fresh || model.pricingStatus === 'UNKNOWN') return 'RECHECK';
  if (model.pricingStatus === 'PAID') return 'PAID';
  if (model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0) return 'FREE';
  return 'RECHECK';
}

function compareOrder(
  a: { provider: ProviderView; model: ModelView },
  b: { provider: ProviderView; model: ModelView },
): number {
  return a.provider.priority - b.provider.priority
    || a.model.priority - b.model.priority
    || a.model.id.localeCompare(b.model.id);
}

function rowFor(provider: ProviderView, model: ModelView, now: number): GenerationPlanEntry {
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelRecordId: model.id,
    modelId: model.modelId,
    modelName: model.displayName || model.modelId,
    providerPriority: provider.priority,
    modelPriority: model.priority,
    costMode: provider.costMode,
    price: priceEvidence(model, now),
    pricingCheckedAt: model.pricingCheckedAt,
    cooldownUntil: model.cooldownUntil ?? null,
    position: null,
    reason: null,
  };
}

/**
 * Builds a browser-safe view of the saved JSON-generation order. This is a
 * configuration summary: runtime still checks the fresh catalog and deadline.
 */
export function buildGenerationPlan(providers: readonly ProviderView[], now = Date.now()): GenerationPlan {
  const rows = providers.flatMap(provider => provider.models
    .filter(model => model.purpose === 'GENERATION')
    .map(model => ({ provider, model, entry: rowFor(provider, model, now) })))
    .sort(compareOrder);

  // Match createAIStore: enabled generation rows are ordered and capped before
  // the gateway filters for the requested JSON capability.
  const registered = new Set(rows
    .filter(row => row.provider.enabled && row.model.enabled)
    .slice(0, GENERATION_PLAN_REGISTRY_LIMIT)
    .map(row => `${row.provider.id}:${row.model.id}`));

  const candidates: GenerationPlanEntry[] = [];
  const skipped: GenerationPlanEntry[] = [];
  for (const row of rows) {
    const key = `${row.provider.id}:${row.model.id}`;
    let reason: GenerationPlanSkipReason | null = null;
    if (!row.provider.enabled) reason = 'PROVIDER_DISABLED';
    else if (!row.model.enabled) reason = 'MODEL_DISABLED';
    else if (!registered.has(key)) reason = 'REGISTRY_LIMIT';
    else if (!row.provider.keyConfigured) reason = 'KEY_MISSING';
    else if (typeof row.model.cooldownUntil === 'string' && Date.parse(row.model.cooldownUntil) > now) reason = 'COOLDOWN';
    else if (!row.model.supportsJson) reason = 'JSON_UNSUPPORTED';
    else if (row.provider.adapter === 'ZEN' && !row.model.apiFormat) reason = 'API_FORMAT_UNSET';
    else if (row.provider.costMode === 'FREE_ONLY' && row.entry.price === 'PAID') reason = 'PAID_BLOCKED';

    if (reason) skipped.push({ ...row.entry, reason });
    else candidates.push({ ...row.entry, position: candidates.length + 1 });
  }
  return { candidates, skipped };
}
