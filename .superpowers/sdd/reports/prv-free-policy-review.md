# PRV-01 free policy review

Review date: 2026-10-04  
Scope: read-only review of the free-price reader, cost gate, generation and embedding gateways, provider adapters, and focused policy tests. No keys, live inference, database writes, code edits, or test runs were used for this review.

## Verdict

The inspected PRV-01 runtime gate is fail-closed for the startup `FREE_ONLY` path. A missing `costMode` defaults to `FREE_ONLY`; invalid mode, unknown/paid price, nonzero or incomplete prices, stale/malformed check time, unsupported protocol, and catalog failures do not reach credential decryption or inference. The gate checks again after awaiting the catalog reader, so a reader that ignores abort cannot later proceed to decrypt or start inference. Generation and embedding share one deadline across catalog lookup and inference, and blocked candidates do not consume the three adapter-call attempts. This is a code-review verdict, not a test-pass or full PRV acceptance claim.

Evidence: [cost-policy.ts](../../../lib/ai/cost-policy.ts:6), [pricing.ts](../../../lib/ai/pricing.ts:43), [gateway.ts](../../../lib/ai/gateway.ts:51), [embedding-gateway.ts](../../../lib/ai/embedding-gateway.ts:121), [ai-free-policy.test.ts](../../../tests/ai-free-policy.test.ts:36), [ai-pricing.test.ts](../../../tests/ai-pricing.test.ts:9).

The price reader only calls fixed public catalog hosts, sends no provider key, rejects redirects, disables cache, caps response bodies, and bounds the catalog operation. Verified catalog prices replace manual display prices for the attempt's estimated cost. The OpenRouter chat/embedding and Zen Responses paths return upstream HTTP status on success and retain HTTP 200 on adapter-level invalid output; gateway-level output validation retains the returned status when recording an attempt.

## Follow-up boundaries

- Add direct policy tests for missing, malformed, stale, and future `checkedAt` values. The current guard rejects these cases at [cost-policy.ts](../../../lib/ai/cost-policy.ts:15), but the focused tests do not assert them yet.
- Durable successful HTTP observation is still held for PRV-04. `AIAttempt` carries HTTP status, but [store.ts](../../../lib/ai/store.ts:49) omits it from `ai_usage_logs`; only error rows write HTTP status to `ai_errors`. Do not expose a persisted per-model success status until the observation storage work lands.
- The native OpenAI embedding adapter still omits successful HTTP status at [openai-embeddings.ts](../../../lib/ai/providers/openai-embeddings.ts:190). This does not affect the free OpenRouter embedding route, but must be addressed before claiming status coverage for paid/native embedding providers.
- No quota observation is produced by this gate. UI quota claims remain dependent on provider-reported scope, unit, window, source, and observation time as specified in the provider design; application usage logs or HTTP 429 alone do not establish remaining quota.

Focused suite and typecheck evidence were pending from the root implementation run at review time. This report does not claim those checks passed.
