# IMP-03B-1 Backend Review

Date: 2026-10-06
Reviewer: `/root/imp_versions_backend_review`
Verdict: **PASS after corrections; no open findings in the reviewed slice.**

## Scope and sources

Reviewed the current assigned working-tree files against the accepted source context `7ca60e292458533781cf7b8f12b4546acfcfcae9` and IMP-03B-1 / Task4B: `lib/imports/version-candidates.ts`, `version-resolver.ts`, `family-catalog.ts`, `family-seed.ts`, `app/api/knowledge/imports/[id]/versions/route.ts`, `scripts/database/seed-document-families-development.ts`, `tests/import-version-candidates.test.ts`, `tests/import-version-routes.test.ts`, `tests/import-family-catalog.test.ts`, `tests/database/import-versions.integration.ts`, and `tests/database/import-family-seed.integration.ts`.

Requirements checked: master guide §§39, 40, 64; CH009/039/040/046/047/050/064 and USR-AMENDS; Task4B; the original document-versioning source; and the current Knowledge Import design/decision clarification. This was a scoped file review, not a branch-wide Git diff or a review of UI/publication implementation.

## Standards

No actionable standards finding remains. The route performs active-admin preflight before parsing private lookup inputs, uses bounded strict counters, and returns the private no-store response. Review decryption is outside SQL; the final short transaction reauthorizes and binds the result to the current job, extraction, and review counters. Candidate SQL returns an allowlisted metadata DTO and does not mutate publication state. The family seeder uses the fixed catalog, parameterized data input, conflict-safe inserts, and a development-target guard.

## Spec

Two concrete issues were found and corrected during review:

- **Stale review counter after a row-lock wait — corrected.** The original final counter query combined `FOR SHARE` with scalar counter subqueries. Because review saves lock the job row without changing its tuple, a resolver could wait for a concurrent review append and then evaluate the subqueries using the statement-start snapshot. Root reported an actual PostgreSQL reproduction where review 2 committed during the observed lock wait but the old path returned review 1. The resolver now acquires the job `FOR SHARE` lock in one statement and checks all three counters in a fresh statement while that lock is held. The family/candidate/relationship read remains one MVCC statement. The permanent test observes the lock wait, appends a valid encrypted review, commits it, and requires a conflict.
- **Occupancy flag with more than 100 family documents — corrected.** The original flag was inferred from the bounded first 101 candidate rows, so a matching current stream beyond that slice could be reported free. The resolver now obtains occupancy with a full-family `EXISTS` inside the same candidate MVCC statement. The regression fixture creates 102 rows and puts the current matching stream in the last row; it verifies `limitExceeded`, no actions/candidates, and `currentStreamOccupied=true`.

The remaining reviewed behavior matches Task4B: null audience/student type remain missing rather than becoming ALL; target eligibility requires exact department/type/non-year scope; replacement may cross academic years but must match the current stream; amendments require the same year and cannot chain; cancellation targets an exact approved matching-scope/year document and cancellation instruments/chains are excluded. Cross-scope rows remain visible for conflict awareness but are not offered as targets. Additional-stream occupancy is family-wide. The 19 master §64 family codes are fixed initial data, while explicitly reviewed custom families remain supported.

The seed helper changes reference data only. Its integration test exercises dry-run, apply, idempotent replay, preservation of existing family metadata, and no document/chunk publication, all inside a transaction that rolls back. The separate DEVELOPMENT dry-run/apply was reported by the root and was not repeated by this reviewer.

## Verification

- `pnpm exec vitest run tests/import-version-candidates.test.ts tests/import-version-routes.test.ts tests/import-family-catalog.test.ts --maxWorkers=1` — exit 0; 3 files, 22 tests passed after the final source correction.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-versions.integration.ts tests/database/import-family-seed.integration.ts` — exit 0; 10 tests passed against local PostgreSQL, including the observed lock-wait regression and the 102-row occupancy case. Fixtures used synthetic random IDs and cleaned their own rows.
- Root-reported pre-fix lock-wait reproduction: stale review 1 was returned after review 2 committed. This reviewer independently ran the corrected permanent regression and observed it pass.
- Root-reported guarded DEVELOPMENT seed: dry-run found 0 existing initial families; apply inserted 19. This reviewer did not repeat that remote operation.

## Limits

This review does not accept approval/publication, family/document locking for publication, retrieval invalidation, UI/browser behavior, real corpus use, or M7/V1. No migration or DEVELOPMENT data operation was run by this reviewer. No full typecheck, lint, build, or broad test suite was run as part of this scoped review.
