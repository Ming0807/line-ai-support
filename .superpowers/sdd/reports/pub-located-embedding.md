# PUB-01 — located embedding preparation

Date: 6 October 2026
Status: scoped pure helper GREEN; parent policy/integration and actual offline five-format acceptance remain pending.
Owner: `/root/located_chunk_builder` (three-file scope).

## Scope and behavior

Implemented `embedLocatedChunkPlan(input, provider, options?)` in `lib/knowledge/located-embedding-preparation.ts`. It first calls the root-owned `validateLocatedChunkPlan`, then checks the fixed local E5 model/revision/fingerprint/384 identity and runtime deadline options before any provider request. It embeds only cloned `chunk.content` strings from the validated plan, in original order and batches of at most 16. It does not rechunk, recount, query-embed, call a network directly, persist, or publish.

Each provider response must have the exact batch cardinality, 384 finite components per vector, and L2 norm within 0.001 of one. The helper clones the validated plan and vector arrays before returning, and discards accumulated embeddings on any later failure. Arbitrary provider errors are replaced with fixed `KNOWLEDGE_EMBEDDING_*` errors; the known provider timeout and abort codes map to their corresponding fixed helper errors.

The operation shares one monotonic deadline across all batches (default 45 seconds; caller values must be integer milliseconds from 1 through 45,000). Each provider call receives the remaining timeout and a helper-owned abort signal. Caller abort and deadline timeout race provider promises, including providers that ignore cancellation; the helper aborts its internal controller and removes its caller listener on completion or failure.

Tests use the existing `locatedPlanFixture()` to build a real located plan with a fake token counter, then exercise validator-accepted location variants for PDF, DOCX, XLSX, CSV and HTML. They verify unchanged ordered content/count/location evidence, 16+1 batching, identity checks before calls, invalid-plan precedence, malformed vector/cardinality rejection, copied output, sanitized late-batch failure, known error mapping, shrinking shared timeout, ignored-provider cancellation, and abort-listener cleanup. No actual E5 model/service or production provider was called.

## Evidence

- RED: `pnpm exec vitest run tests/knowledge-located-embedding-preparation.test.ts` failed before implementation with `Cannot find module '../lib/knowledge/located-embedding-preparation'`; zero tests ran.
- GREEN: `pnpm exec vitest run tests/knowledge-located-embedding-preparation.test.ts` — 1 file, 21/21 tests passed.
- Scoped lint: `pnpm exec eslint lib/knowledge/located-embedding-preparation.ts tests/knowledge-located-embedding-preparation.test.ts` — exit 0, no warnings or errors.
- Global typecheck: `pnpm typecheck` currently exits nonzero only in parent-owned in-progress files: missing `lib/imports/import-publication` imported by `tests/database/import-publication.integration.ts`, plus an implicit-any parameter at line 65 of that integration test. Typecheck reported no diagnostic in this helper or its test.

## Remaining acceptance

Root owns the publication policy, caller deadline composition, all-format actual offline preparation, and integration/acceptance. The current typecheck failure is parent-owned and was reported to root. This scoped helper report does not claim policy completion, database publication, approved corpus, M7 completion, or full V1 acceptance.
