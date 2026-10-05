# PRV-02C-PROTOCOL — compatible adapter evidence

**Date:** 2026-10-05  
**Owner:** Luna max (`/root/prv_retry_evidence`)  
**Scope:** Compatible Chat Completions generation/metadata and compatible embeddings adapters. This is a component report, not PRV-05 or V1 acceptance.

## Implemented

- Added `createCompatibleChatAdapter({transport})` with a fixed `chat/completions` request and metadata-only `models` health check. It preserves the configured model ID, emits strict JSON Schema and allowlisted strict function tools, rejects Responses format, and parses only one valid assistant completion or backend-allowlisted tool-call set.
- Added `createCompatibleEmbeddingAdapter({transport})` with the fixed `embeddings` route, explicit dimensions, batch/input limits, exact model and vector-count/index/dimension validation, finite nonzero vectors, and bounded usage parsing.
- Both adapters canonicalize the configured generic HTTPS base URL through `parseCompatibleBaseUrl`, validate the database model-ID grammar (ASCII, up to one optional slash, maximum 200 characters), pass the caller's cancellation signal to the supplied transport, preserve typed transport errors and true HTTP statuses, and normalize untyped transport failures without copying upstream messages.
- Retry hints are parsed only for HTTP 429 and 5xx using `readRetryEvidence`; unbounded or malformed hints produce no evidence. Compatible requests carry no OpenRouter routing/pricing fields. The official Zen/OpenRouter/native adapters were not edited, and no live provider call was made.

## Verification

- RED before adapter creation: `.\node_modules\.bin\vitest.cmd run tests/compatible-chat-completions.test.ts tests/compatible-embeddings.test.ts` failed both suites at module resolution because the two adapter modules did not exist (0 tests collected). This confirmed the new behavior was not already implemented.
- GREEN after implementation: `.\node_modules\.bin\vitest.cmd run tests/compatible-chat-completions.test.ts tests/compatible-embeddings.test.ts` — 2 files, 69 tests passed.
- Existing adapter regression: `.\node_modules\.bin\vitest.cmd run tests/chat-completions.test.ts tests/openrouter-embeddings.test.ts tests/provider-retry-transport.test.ts` — 3 files, 94 tests passed.
- Final combined scoped run: `.\node_modules\.bin\vitest.cmd run tests/compatible-chat-completions.test.ts tests/compatible-embeddings.test.ts tests/chat-completions.test.ts tests/openrouter-embeddings.test.ts tests/provider-retry-transport.test.ts` — 5 files, 163 tests passed.
- Scoped ESLint: `pnpm exec eslint lib/ai/providers/compatible-chat-completions.ts lib/ai/providers/compatible-embeddings.ts tests/compatible-chat-completions.test.ts tests/compatible-embeddings.test.ts` — exit 0, no warnings.
- Whole-project typecheck: an initial run exposed three typing issues in root-owned `scripts/qa/compatible-tls.ts`; root fixed them. The fresh `pnpm exec tsc --noEmit` rerun passed (exit 0).

Adapter tests use only an injected fake `CompatibleTransport`; they cover standard request bodies, strict response/tool parsing, identity and dimensions, safe HTTP mapping/retry evidence, metadata-only health checks, and pre-cancelled calls. Network resolution, pinned HTTPS, response byte bounds, and transport-level deadline enforcement are outside this adapter slice and must be assessed with the transport's own tests and root integration gate. Root separately reported its transport focused suite at 36/36; that result is parent-provided, not independently rerun as part of this report.

## Source scope and remaining gates

Owned source files: `lib/ai/providers/compatible-chat-completions.ts`, `lib/ai/providers/compatible-embeddings.ts`. Owned test files: `tests/compatible-chat-completions.test.ts`, `tests/compatible-embeddings.test.ts`. This report is the only documentation file changed for the slice. Root owns transport/network integration, pricing and FREE_ONLY authorization, probes/admin/UI/persistence, database and full project acceptance. No full V1 or PRV-05 completion is claimed.
