# IMP-PLAN-01 / Task4C-3b — backend contract review

6 October 2026. Independent read-only review of the private chunk-plan preview and review-v2 acknowledgment backend. Reviewed against Task4C-3b in `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`, the local E5 counting contract in `docs/architecture/EMBEDDING_SERVICE_DESIGN.md`, and the working tree based on `33710b7009ace1566a4ab6fcccabd601e16efa35`.

## Scope

Reviewed `lib/imports/chunk-preparation.ts`, `lib/imports/import-chunk-plan.ts`, `lib/imports/review-schema.ts`, `lib/imports/import-review.ts`, `app/api/knowledge/imports/[id]/chunks/route.ts`, `tests/import-chunk-plan-routes.test.ts`, `tests/import-review-schema.test.ts`, and `tests/database/import-chunk-plan.integration.ts`. Inspected the shared authorization/original-read transaction helpers, `lib/knowledge/embedding-client.ts`, and the local embedding service's count route as dependencies. No product or test files were changed.

## Findings

No scoped blocking findings.

- The route authenticates and checks active SUPER_ADMIN before resolving the job path or reading query parameters. It accepts only three canonical positive revision counters, passes the request abort signal, wraps success in `{ snapshot }`, and uses the private no-store response helper. Failure responses and logs use fixed codes; source text/upstream exception messages are not emitted.
- The service requires a saved, non-stale review matching all three counters, checks the loaded preview against job/extraction revisions, prepares the plan before the final transaction, then takes the job share lock and rereads job status plus the latest extraction/review counters. Abort or changed counters return conflict without a plan. The shared authorization transaction applies a fresh active-role check.
- Preparation reauthorizes, reads/decrypts the original outside the business transaction, checks the job revision, and passes only the fixed local `PassageTokenCounter`, abort signal, and remaining portion of the 45-second counter deadline to the located planner. The client calls `/tokens/count`; the service tokenizer path adds `passage: `, counts with special tokens and no truncation under the shared non-queuing lock, and does not call `model.encode`. Model loading uses `local_files_only=True`.
- Review v2 requires an explicit nullable `chunkPlan`; a non-null acknowledgment is recomputed outside SQL and both digest and chunker identity are compared before append. The final transaction locks the job, rechecks job/checksum, extraction and latest review revision, then appends the encrypted receipt and safe activity atomically. The injected counter is an internal service option; the HTTP route supplies only the request signal.
- The discriminated schema retains strict v1 parsing without adding v2 fields to v1. The integration test verifies the earlier encrypted v1 receipt remains unchanged after a v2 append. The review test also rejects missing/extra acknowledgment fields and malformed digests/identities.

## Verification

Using the bundled Node runtime and pnpm on PATH:

- `pnpm exec vitest run tests/import-chunk-plan-routes.test.ts tests/import-review-schema.test.ts` — 2 files passed, 15 tests passed.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-chunk-plan.integration.ts` — 5 PostgreSQL integration tests passed against the already-migrated local database; no migration was applied.

These checks cover only this backend slice. I did not run the full suite/build, migration gates, browser acceptance, publication/action integration, or global V1/Flow A–F acceptance. No approval, publication, or Task4C-2/Task4C-3 completion is claimed.
