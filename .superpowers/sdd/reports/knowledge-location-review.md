# IMP-LOC-01 scoped review

Date: 2026-10-06
Task: IMP-LOC-01 / Task4C-3a
Reviewed source checkpoint: `HEAD 33710b7009ace1566a4ab6fcccabd601e16efa35` plus the current working-tree implementation. The migration and product changes were uncommitted during review.

## Finding

No concrete privacy, location-equality, or SQL-kind finding in the reviewed Task4C-3a scope.

The additive migration adds `source_locations jsonb not null default '[]'` and nullable `passage_token_count smallint`, with checks for at most 16 locations, at most 65,536 serialized bytes, object entries with one of the five known kinds, and token counts in 1–512 when present. It contains no grants, RLS changes, explicit backfill, vector changes, or publication behavior. The existing table migration already denies browser roles and grants the server role; the new migration does not widen that access.

At the application boundary, `sourceLocationSchema` is a strict five-kind discriminated union with bounded coordinates and ordered ranges. Citation validation bounds/copies the array, rejects mixed kinds and invalid page-number combinations, and checks HTML location URLs before output. Citation rendering uses the proven format coordinates and does not add page numbers for non-PDF locations. Missing legacy locations normalize to `[]`; output locations are deep-copied. Delivery equality parses both evidence records and compares the normalized strict arrays along with the existing document/content/source fields. The retrieval query carries `source_locations` through both the eligible-chunk and result projections.

The earlier retrieval test failure caused by an omitted intermediate projection is resolved in the reviewed source: `eligible_chunks` selects `c.source_locations`, and `matches` returns it as `sourceLocations`.

## Verification

- `pnpm exec vitest run tests/knowledge-citations.test.ts` — **16 tests passed**.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/knowledge-locations.integration.ts` — **3 actual PostgreSQL tests passed**: legacy empty/null defaults with vector retention; all five location kinds through retrieval, citation, and change invalidation; malformed SQL shape/kind/size/token rejection and no browser writes.

The test commands used the configured Node runtime at `C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`. This review did not apply a migration; the PostgreSQL suite ran against the already provisioned local schema and rolls back each fixture transaction.

## Scope and limits

This review covered `supabase/migrations/20261006044000_knowledge_source_locations.sql`, `lib/knowledge/types.ts`, `lib/knowledge/citations.ts`, `lib/knowledge/retrieval.ts`, `tests/knowledge-citations.test.ts`, `tests/fixtures/knowledge-locations.ts`, and `tests/database/knowledge-locations.integration.ts`, against the Task4C-3a plan and Postgres schema/security guidance. No product, test, board, or design files were changed by this reviewer; this report is the only file written.

The run did not include the full unit suite, build, migration replay, DEVELOPMENT apply, or production checks. Root reports a broader focused result of 16 citation-unit plus 11 actual PostgreSQL tests; this reviewer independently reran the 16 citation tests and the 3 new location integration tests. Task4C-2 located plan generation, nonempty format-matched new-approval guarantees, Task4 publication/AMENDS behavior, approved-corpus acceptance, and full M7/V1 acceptance remain separate and are not claimed here.
