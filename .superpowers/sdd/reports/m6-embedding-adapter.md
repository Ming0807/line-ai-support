# M6 OpenAI embeddings adapter report

## Result

Implemented `createOpenAIEmbeddingAdapter({fetchImpl?})` against the frozen `EmbeddingAdapter` interface. It posts to the exact OpenAI v1 `/embeddings` endpoint with `redirect: 'error'`, a Bearer authorization header, and `encoding_format: 'float'`. The API key is sent only in the request header; there is no logging.

The adapter requires an explicit expected dimension count and uses the shared `isEmbeddingDimensionAllowed()` policy before HTTP. Known native limits are enforced: `text-embedding-ada-002` is fixed at 1536, `text-embedding-3-small` allows at most 1536, and `text-embedding-3-large` allows at most 3072. The ada-002 request omits the unsupported `dimensions` parameter and verifies the returned vector has 1536 entries. Unknown future model IDs accept only an explicit size from 1 through 4096 and still require the response to match that size. OpenAI documents the legacy ada-002 vector size and that the `dimensions` parameter is supported only by text-embedding-3 and later models. See the [embedding guide](https://developers.openai.com/api/docs/guides/embeddings) and [embeddings API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create). The request is limited to 16 non-empty strings of at most 6000 UTF-8 bytes each and a serialized body of at most 512 KiB.

Successful responses must have HTTP 200, `object: 'list'`, a model ID matching the requested ID, and one `object: 'embedding'` entry per input. Indices must be unique and complete; vectors are restored to input order and must have the expected length, contain only finite numbers, and contain at least one non-zero value. Optional usage is returned as nullable prompt-token count, with both prompt and total counts validated as safe integers no larger than 300,000. Response bodies are bounded at 2 MiB and cancelled on overflow or abort. These request and response fields follow the [official embeddings API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

Errors use the existing fixed `AIProviderError` categories: 401/403 → `AUTH_ERROR`, 429 → `RATE_LIMITED`, 404 → `MODEL_UNAVAILABLE`, 5xx → `SERVER_ERROR`, other 4xx → `INVALID_REQUEST`, abort/timeout → `CANCELLED`/`TIMEOUT`, and network or stream failures → `PROVIDER_UNAVAILABLE`. Malformed or oversized successful responses produce `INVALID_OUTPUT`. Raw provider bodies and transport errors are not included in messages.

## RED→GREEN evidence

- The first focused run failed at module loading because `lib/ai/providers/openai-embeddings.ts` did not yet exist (one failed suite, zero tests collected).
- After the first implementation, three success cases failed because their fake API entries omitted the documented `object: 'embedding'` field. The fixture helper was corrected to produce the official response shape; the parser behavior stayed strict.
- The scoped TypeScript check first caught a readonly empty-input fixture inferred from `as const`; the case table was given the mutable `Partial<EmbeddingRequest>` type and the check passed.
- Before the shared dimension-policy fix, ada-002 size two reached fake HTTP. The added RED cases then demonstrated that small size 1537 and 4096, and large size 3073, also reached fake HTTP. The adapter now rejects all four unsupported known-model sizes as `INVALID_REQUEST` before HTTP; ada-002 success uses 1536 and omits the unsupported parameter.
- The stalled-reader abort test uses a body whose `read()` never settles and checks cancellation, `CANCELLED`, and abort-listener removal. It passes within the 100 ms bound.
- A boundary case confirms exactly 16 inputs, 6000 UTF-8 bytes per input, and 4096 dimensions are accepted for an unknown future model ID; the configured size remains explicit and the response is validated.
- Final combined focused run: `pnpm exec vitest run tests/embedding-gateway.test.ts tests/openai-embeddings.test.ts tests/embedding-model-dimensions.test.ts --maxWorkers=1` — 3 files, 91 tests passed.

## Verification

- Scoped ESLint for the adapter and gateway sources and tests — exit 0, no output or warnings.
- File-scoped strict TypeScript check for the adapter and gateway sources and tests — exit 0.

All HTTP tests use fake fetch. No database, provider credentials, live API calls, or paid requests were used. A response whose `model` is canonicalized to a different ID will be rejected as `INVALID_OUTPUT`; alias resolution needs an explicit integration rule before it is accepted.

## Integration boundary

This adapter implements only the provider HTTP boundary. Model registration, embedding fingerprints, durable jobs, corpus access, persistence, and retrieval remain with the registry and worker integration. Callers must set the model's expected dimensions explicitly and compare only vectors with the matching model fingerprint and dimensions.
