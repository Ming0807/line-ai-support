# M6 bounded embedding gateway report

## Result

Implemented `embed()` on the frozen embedding interfaces. It validates query/document batches before reading the registry, enforces 16 inputs and 6000 UTF-8 bytes per input, and uses a 20-second default deadline capped at 45 seconds. Registry reads, each adapter call, and usage recording race against bounded timers and cancellation; late work cannot extend the call. Per-model timeout is capped by the remaining overall deadline.

The gateway selects at most three configured embedding models by provider priority, model priority, then stable ID. An optional SHA-256 fingerprint filters the registry before selection and fallback, so a retry never mixes vector spaces. Fingerprints hash the canonical JSON tuple `[adapter, baseUrl without trailing slash, modelId, dimensions]`; credentials, revisions, and registry IDs are excluded. Every returned vector is checked for count, configured dimensions, finite values, and non-zero content before it leaves the gateway.

Provider errors remain fixed `AIProviderError` values. Retryable provider failures can move to the next compatible candidate; cancellation and authentication errors stop. No response body, input text, encrypted key, decrypted key, or raw thrown error is logged or copied into the gateway's errors. Revision-aware attempts store nullable input tokens, zero output tokens, bounded latency, status and health. Cost is null if input usage or input price is unavailable. If recording an attempt fails or times out, fallback stops so the gateway cannot initiate another paid call without recording the first result.

## RED→GREEN evidence

- Test-first baseline: `tests/embedding-gateway.test.ts` failed during module loading because `lib/ai/embedding-gateway.ts` did not exist (one failed suite, zero tests collected).
- After implementation, all gateway contract cases passed, including canonical fingerprinting, input bounds, optional fingerprint filtering, no cross-fingerprint fallback, retryable versus terminal errors, output validation, cost handling, timeout/cancellation races, bounded registry and attempt-store operations, and fixed errors without raw store details.
- The embedding adapter follow-up added three native-dimension regression cases. Before the change, `text-embedding-3-small` dimensions 1537 and 4096, and `text-embedding-3-large` dimensions 3073 proceeded to fake HTTP instead of being rejected. The adapter now uses the shared `isEmbeddingDimensionAllowed()` rule. A future unknown model remains eligible for an explicitly configured size through 4096, with its response still checked against that exact size.
- Final focused run: `pnpm exec vitest run tests/embedding-gateway.test.ts tests/openai-embeddings.test.ts tests/embedding-model-dimensions.test.ts --maxWorkers=1` — 3 files, 91 tests passed.

## Verification and limits

- `pnpm exec eslint lib/ai/embedding-gateway.ts lib/ai/providers/openai-embeddings.ts tests/embedding-gateway.test.ts tests/openai-embeddings.test.ts` — exit 0, no output.
- `pnpm exec tsc --noEmit --pretty false --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --skipLibCheck --types node lib/ai/embedding-gateway.ts lib/ai/providers/openai-embeddings.ts tests/embedding-gateway.test.ts tests/openai-embeddings.test.ts` — exit 0.
- All HTTP and gateway tests use fake adapters/stores and fake fetch. No database, live provider, environment credential, or paid request was used. Registry configuration loading and durable store integration remain outside this gateway boundary.
