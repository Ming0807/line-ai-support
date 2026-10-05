# PRV-02 OpenRouter embedding adapter report

**Scope:** `lib/ai/providers/openrouter-embeddings.ts` and `tests/openrouter-embeddings.test.ts` only. This is a fake-HTTP protocol implementation and test report; it does not establish live provider availability or V1 application acceptance.

The adapter posts to the fixed `https://openrouter.ai/api/v1/embeddings` endpoint, accepts slash-qualified model IDs, and requires an explicitly configured dimension. The request uses bearer authorization, `encoding_format: "float"`, and the supplied input/model/dimension. It does not add provider-routing or `max_price` fields. The [official embedding endpoint schema](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request) documents the endpoint, model/input/dimensions/encoding format, indexed vectors, model identity, and usage; it does not document `max_price` for embeddings. The known `costMode` value is accepted as an upstream policy signal, but this adapter does **not** verify model price or prove free eligibility. The gateway/catalog gate must reject PAID/UNKNOWN candidates before calling it in `FREE_ONLY` mode.

The request is bounded to 16 inputs, 6,000 UTF-8 bytes per input, 512 KiB serialized body, and dimensions 1–4,096. Response reading is streamed and capped at 2 MiB. Redirects are rejected, provider error bodies are canceled without parsing, and request/transport/output errors expose fixed safe messages. Successful and malformed-200 responses retain the actual HTTP 200; HTTP errors retain their status. A timeout/abort after headers keeps the known upstream status, while transport failure before a response has no HTTP status.

Response validation checks list envelope, exact model identity, one vector per input, complete unique indexes restored to input order, exact configured dimension, finite values, and nonzero vectors. Usage is either absent/null or a validated prompt/total token pair. HTTP 408 maps to retryable `TIMEOUT`, 429 to retryable `RATE_LIMITED`, 401/403 to `AUTH_ERROR`, 404 to retryable `MODEL_UNAVAILABLE`, and 5xx to retryable `SERVER_ERROR`; other 4xx responses remain `INVALID_REQUEST` with their status. The adapter does not interpret 402 body text or infer that it means exhausted quota.

Verification:

- **RED:** the focused Vitest command initially failed because `openrouter-embeddings.ts` did not exist.
- **GREEN:** `pnpm exec vitest run tests/openrouter-embeddings.test.ts --maxWorkers=1` — 39 tests passed, including request-shape, slash model, explicit dimensions, vector validation, safe HTTP mapping, bounded/aborted reads, and no error-body leakage.
- `pnpm exec eslint lib/ai/providers/openrouter-embeddings.ts tests/openrouter-embeddings.test.ts` — passed.
- `pnpm exec tsc --noEmit --pretty false` — blocked by the in-progress missing `lib/ai/pricing.ts` referenced from `tests/ai-free-policy.test.ts` and `tests/ai-pricing.test.ts`, plus the dependent implicit-`any` diagnostic in `tests/ai-free-policy.test.ts`. No diagnostics point to the adapter or its tests.

No live inference, real credential, database mutation, paid request, or public-service call was made. The fake tests verify the protocol boundary only; the caller's FREE_ONLY catalog gate and runtime/provider integration remain separate acceptance work.
