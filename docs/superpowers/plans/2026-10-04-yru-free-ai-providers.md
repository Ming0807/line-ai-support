# Free Zen/OpenRouter Provider Correction Implementation Plan

> **Current source control:** Read [task board](../../tasks/V1_TASK_BOARD.md), [provider design](../../architecture/AI_PROVIDER_DESIGN.md) and [Provider UX/observations execution plan](2026-10-04-yru-provider-management-ux.md) together. Latest user requires Provider AND Model up/down ordering, per-model actual HTTP/quota and selected-model test buttons, product minimal UX. Task3 below covers cost configuration only; PRV-03/04 are required before Task4 acceptance. Pricing/runtime cost/official transports and atomic persistence now have GREEN component evidence in [backend report](../../reports/PRV_BACKEND_COMPONENT_REPORT.md); UI/probe observations/compatible provider/final acceptance remain pending. Checkboxes below are execution criteria, not an assertion that all tasks passed.

> **For agentic workers:** Execute task-by-task with verification-before-completion. User authorizes continued development with live keys/manual configuration deferred. Root implements while assigned reviewers are usage-limited; do not claim an independent verdict without one.

**Goal:** Startup runtime AI uses only verified free Zen/OpenRouter generation and free embeddings; paid providers/models are later explicit university Dashboard opt-in.

**Architecture:** Preserve the gateway, encrypted registry, durable jobs and HUMAN fence. Each provider has a backend-enforced costMode default FREE_ONLY; ALLOW_PAID requires an authenticated active SuperAdmin configuration write and audit. Before inference, free candidates require a bounded public catalog price read; unknown/nonzero price fails closed. OpenRouter requests also carry zero price ceilings. Native OpenAI stays available for explicit later opt-in, rather than becoming the startup provider.

**Tech Stack:** Existing Node24/native fetch/TypeScript/Zod/Postgres17/Next16.3.8. Existing OpenAI Responses adapter is reused for the documented Zen Responses subset; a bounded Chat Completions adapter covers Zen/OpenRouter chat. No paid inference is used for tests.

## Authoritative requirements

- `docs/reports/AI_PROVIDER_SPEC_AUDIT.md` and the user's latest free-startup clarification override the original OPENAI-only M5 implementation decision.
- Deterministic configured priority, maximum3attempts and one total deadline remain unchanged. Catalog HTTP consumes the same deadline.
- FREE_ONLY denies PAID/UNKNOWN candidates including embeddings, even if enabled or manual price is0. A provider name or `:free` suffix alone proves nothing.
- No default model, API key, dimensions, corpus approval or paid permission is invented. Live selection remains explicit Dashboard configuration.
- Runtime catalog HTTP and inference remain outside SQL transactions. Credentials are sent only to the configured validated inference host, never to public pricing metadata endpoints.
- Model pricing observations are safe Dashboard DTOs. Catalog refresh cannot silently enable a model or paid mode.
- Existing deployed migrations are immutable; use additive constraint/column migrations.

### Task1: strict price discovery and gateway cost gates

Files: `lib/ai/pricing.ts`, `lib/ai/gateway.ts`, `lib/ai/embedding-gateway.ts`, `lib/ai/types.ts`, `lib/ai/embedding-types.ts`, `tests/ai-pricing.test.ts`, `tests/ai-free-policy.test.ts`.

Interface:
```ts
type CostMode='FREE_ONLY'|'ALLOW_PAID';
type PriceQuery={adapter:string;baseUrl:string;modelId:string;purpose:'GENERATION'|'EMBEDDING'};
type ModelPricing={status:'FREE'|'PAID'|'UNKNOWN';inputPricePerMillion:number|null;outputPricePerMillion:number|null;checkedAt:string;apiFormat:'CHAT'|'RESPONSES'|null};
type PriceReader=(query:PriceQuery,signal:AbortSignal)=>Promise<ModelPricing>;
function createPriceReader(options?:{fetchImpl?:typeof fetch}):PriceReader;
```

- [ ] RED: explicit0 strings accepted; missing/null/negative/NaN/duplicate/incomplete fee data unknown; `:free` priced nonzero is paid. Zen requires zero cost in OpenCode's linked Models.dev catalog plus actual availability from Zen's own models endpoint. Unsupported embedding/protocol is unknown. Redirect/overflow/abort/read failure remains bounded fixed error and never logs payload.
```ts
expect(await read({adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',modelId:'fixture/model:free',purpose:'GENERATION'},signal)).toMatchObject({status:'FREE'});
await expect(generate(request,{...options,priceReader:unknownPrice})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
expect(paidAdapter.generate).not.toHaveBeenCalled();
```
- [ ] Run focused Vitest, record RED; implement catalog readers and gates before credential decryption; recalculate remaining inference budget after catalog read. Set observed free prices0 from verified source, rather than manual display fields.
- [ ] GREEN: free429→nextfree with paidHTTP0; allfreeunavailable→fixed error; ALLOW_PAID works only when explicitly supplied by trusted model config. Update legacy fake tests to explicit ALLOW_PAID fixtures, preserving their existing gateway assertions.

### Task2: provider HTTP protocols

Files: `lib/ai/providers/chat-completions.ts`, `lib/ai/providers/openrouter-embeddings.ts`, `lib/ai/provider-registry.ts`, minimal factory-base extension in `lib/ai/providers/openai.ts`, tests `chat-completions.test.ts`, `openrouter-embeddings.test.ts`.

- [ ] RED tests assert model slug and JSON-schema/tool body, one assistant response, strict whole-content JSON, tool allowlist/duplicate rejection, refusal/length termination, usage normalization, HTTP errors, redirect/abort/byte limits, secret-only authorization header. OpenRouter FREE_ONLY sends `provider.max_price={prompt:0,completion:0}`, no paid plugins/model fallback list. Embeddings verify exact returned dimensions/index/model/finiteness/nonzero.
- [ ] Implement registered Zen/OpenRouter adapters with immutable official endpoints. Zen model-specific protocol follows catalog metadata; Responses uses only explicitly configured Zen factory base. Native OpenAI behavior is unchanged.
- [ ] GET health checks read catalog/model availability without generation. No hidden paid probe.

### Task3: additive persistence and Dashboard correction

Files: CLI-generated `supabase/migrations/<timestamp>_free_provider_policy.sql`, `types/providers.ts`, `lib/ai/store.ts`, `lib/ai/provider-admin.ts`, price-refresh route, existing provider page/form, actualPG `provider-free-policy.integration.ts`, browser QA.

- [ ] ActualPG RED proves old OPENAI-only constraints reject Zen/OpenRouter/slash IDs; FREE_ONLY is persisted default; only active SuperAdmin can enable ALLOW_PAID; price refresh outsideSQL cannot overwrite metadata after model/provider revision changed; private grants/RLS preserved.
- [ ] Add provider costMode, pricing status/checkedAt on models, and compatible protocol constraints; no credential or record overwrite. Generic future compatible endpoints require HTTPS/public DNS pinning/no redirect before they can be enabled, not arbitrary unvalidated URLs.
- [ ] UI provider selector defaults to free Zen/OpenRouter choice, costs default FREE_ONLY; explicit paid opt-in clearly labeled, no preselected paid mode. Display FREE/PAID/UNKNOWN/catalog check time and refresh action. Model slug supports `/`; embedding dimensions explicit; prices are observations and do not grant free eligibility.
- [ ] Read installed Next docs; actual login all3roles, provider changes/price refresh/no-keyreadback/paidtoggle audit/stale conflicts/mobile390px. Mock public metadata only in local controlled harness; never approve real resources or call paid inference.

### Task4: configured free RAG acceptance and checkpoint

- [ ] Update signedHTTP RAG harness to actual configured OpenRouter free fixture and fake Chat/embedding/catalog transport. Prove current/history/backend citations/dedup/takeover, cost0 and no paid native request. AllHTTP boundaries prove no open business transaction.
- [ ] Clean migration replay after safe empty preflight; fullRLS/PG/unit/type/lint/build/advisors; compare this plan to the original provider specification and record remaining external gates honestly.
- [ ] Guarded additive DEVELOPMENT synchronization and real3subject privacy verification, explicit staging/security scan/commit/noninteractive push with remote hash verification. Only then resume M7/M8/M9/fullV1 goal.

## Primary protocol references verified 4 October2026

[OpenCode Zen](https://opencode.ai/docs/zen/) documents chat/responses endpoints and temporary free models. [OpenCode models](https://opencode.ai/docs/models/) explicitly links Models.dev as model metadata; pricing reader cross-checks Zen's own live availability. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) uses response_format JSON schema and require_parameters; [provider price ceilings](https://openrouter.ai/docs/guides/routing/provider-selection) and [embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request) are backend-owned request settings.
