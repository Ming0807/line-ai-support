# PRV-04B selected-model probe report

**Scope:** `lib/ai/model-probe.ts`, `tests/model-probe.test.ts`, and this report. This is a pure selected-model probe component; it does not establish database/API integration or V1 application acceptance.

`probeModel` returns only normalized result, error code, actual nullable upstream HTTP status, latency, and observation time. It tests the supplied snapshot and adapter only; it does not load other models, run fallback, mutate configuration, execute a tool call, write usage, or persist an observation. The API layer remains responsible for authorization, snapshot revisions, duplicate requests, leases, and durable persistence.

Generation and embedding tests clone the supplied model with `costMode: 'FREE_ONLY'` and reuse `authorizeModelCost` with the supplied price reader or a `createPriceReader` default. PAID, UNKNOWN, malformed, and stale price evidence is blocked before decrypting the stored provider key. `ALLOW_PAID` in the saved snapshot does not change that test policy. Zen protocol selection follows the catalog result's `apiFormat`; OpenRouter remains on its catalogued CHAT format. Native OpenAI adapter request fields are left unchanged.

Generation sends fixed nonpersonal JSON instructions and a strict `{ "ok": true }` schema. For a model configured with tools, the request adds one strict `probe_provider` tool with `{ "marker": "PROBE" }`, and success requires exactly that validated call; the probe never executes it. Without tool support, success requires the exact JSON result. Embedding sends only `YRU provider probe` with the configured dimensions and requires exactly one finite, nonzero vector of that length and actual HTTP 200. The embedding adapter validates the returned model identity before exposing its vector-only response contract.

Metadata is a bounded GET only: OpenRouter uses its generation or embedding catalog and requires one exact model ID; Zen uses its fixed model catalog; native OpenAI retrieves the exact model at `/models/{id}` and authenticates only with a bearer header. Public OpenRouter and Zen metadata requests carry no key. Metadata HTTP 200 is recorded only as a successful `METADATA` action by the caller; it is never treated as generation or embedding evidence.

One deadline uses `min(config.timeoutMs, 10,000 ms)` across price lookup, metadata fetch/body reads, and inference adapter calls. Outer cancellation propagates. Metadata fetch/body readers are canceled on timeout, and even injected work that ignores its signal cannot hold the returned promise open. HTTP errors expose fixed normalized codes without provider bodies; malformed content at HTTP 200 retains status 200, and work that receives no response reports `httpStatus: null`.

The metadata endpoints follow the [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/get-models), [OpenRouter embedding catalog](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models), [OpenCode Zen model listing](https://opencode.ai/docs/zen/), and [OpenAI model retrieval](https://platform.openai.com/docs/api-reference/models/object?lang=curl). These sources describe protocol endpoints only; they do not establish an account's live access, price eligibility, or inference success.

Verification:

- **RED:** the first focused run failed because `lib/ai/model-probe.ts` did not exist.
- **GREEN:** `pnpm exec vitest run tests/model-probe.test.ts` — 24 tests passed. Cases cover selected-only 429/no fallback, ALLOW_PAID forced FREE_ONLY, paid/unknown/stale price before decryption, strict JSON/tool validation, configured embedding dimensions and invalid vectors, exact metadata identity/duplicates, metadata-vs-inference separation, native OpenAI metadata auth, safe errors, HTTP status preservation, timeouts, external abort, and stalled-body cancellation.
- Related protocol verification: `pnpm exec vitest run tests/model-probe.test.ts tests/ai-pricing.test.ts tests/chat-completions.test.ts tests/openai-provider.test.ts tests/openrouter-embeddings.test.ts` — 154 tests passed across 5 files.
- `pnpm exec eslint lib/ai/model-probe.ts tests/model-probe.test.ts` — passed without diagnostics.
- Focused strict TypeScript check for the owned module and tests — passed.
- `pnpm run typecheck` — passed after the concurrent provider observation admin modules landed.

No live metadata request, inference, real credential, database mutation, or paid request was made. Route authorization, persistence/revision rechecks, lease/rate controls, quota persistence, browser UX, and end-to-end acceptance remain separate work.
