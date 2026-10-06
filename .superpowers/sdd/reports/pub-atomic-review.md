# PUB-02 atomic publication review

Reviewed 6 October 2026. This is an independent, read-only review of the root-owned PUB-02 publication service and its additive persistence boundary. I changed no product, test, migration, plan, or board files; this report is the only file I own.

## Scope and disposition

Reviewed `lib/imports/import-publication.ts`, `lib/imports/chunk-preparation.ts`, `supabase/migrations/20261006054515_knowledge_import_publication.sql`, and `tests/database/import-publication.integration.ts` plus `tests/import-publication-request.test.ts`. I also traced the referenced review policy, chunk-plan and E5 helpers, version candidate/resolution logic, import staging authorization, original storage, and delivery-fence lock names. The additive runtime retention grant in `supabase/migrations/20261006060151_knowledge_original_retention.sql` was checked because it closes a receipt-cascade path found during review.

**Final disposition: no unresolved blocker found in this reviewed slice.** The service has no API/UI publication route in this slice, and this review does not accept PUB-03 retrieval/dispatch invalidation, M8 structured publication, or overall V1.

## Findings and resolution

An earlier version started the 45-second timer after initial preview/review loading. That left the source reads needed for the approval preflight outside the frozen shared source/count/encode deadline. I reported the gap; root moved the deadline/controller before `getImportPreview` and `getImportReview` in `prepare` and passes the remaining budget into plan construction and embedding (`import-publication.ts:58–83`). The final database regression uses a reduced internal 1,000 ms budget, confirms the encoder receives only the remaining time, and confirms a provider that ignores cancellation cannot publish (`import-publication.integration.ts:109–116`). Production remains capped at 45 seconds. Caller-abort coverage separately verifies a nonsettling counter is canceled and no publication state is written (`:117–122`).

The receipt FK cascades on parent-job deletion, and the pre-existing staging migration grants `service_role` broad job-table privileges. Direct receipt `UPDATE`/`DELETE` are denied, but deleting a parent job could otherwise erase its receipt and source history. Root added `20261006060151_knowledge_original_retention.sql` to revoke runtime `service_role` job deletion. The final privilege test verifies that deletion is denied along with browser receipt access and direct receipt mutation (`import-publication.integration.ts:103–107`). Privileged database-owner fixture cleanup remains possible and is not an application runtime path.

I initially questioned authorization freshness across a final job-lock wait. That is not a finding: staging authorization selects the active staff row `FOR SHARE` (`import-staging.ts:28–34`), so the final transaction retains the role-row lock while waiting; a revocation committed first is observed and denied, while a concurrent revocation waits for the transaction.

## Contract evidence

- The request schema is strict and contains only normalized UUID, three bounded positive revisions, and literal `confirmPublication:true` (`import-publication.ts:15–16`). The route-independent request tests reject source text, vectors, locations, provider/test seams, invalid counters, and missing confirmation (19 tests total).
- `approveImport` authorizes before parsing or receipt access. Exact counter-bound receipt replay returns before preview, counting, or embedding; a changed binding conflicts (`:32–35`, `:132–142`). The database retry regression verifies the receipt is identical and provider call counts do not change (`import-publication.integration.ts:52–60`).
- Provider work occurs before `finalize`; the integration provider checks that no publication SQL transaction is idle in-transaction during encoding (`:44–49`). Finalization takes a separate job `FOR UPDATE` statement, then reads fresh counters/checksum/review hash, locks the family and sorted document keys using delivery-fence helpers, and rechecks target/action/stream eligibility before writing (`import-publication.ts:85–105`). The lock-wait regression appends a newer review while finalization is waiting and verifies conflict/no document (`:123–140`).
- Document/version effects, exact located chunks/vectors, relationship, safe activity, private receipt, and `publication_status='COMPLETED'` are in one transaction. Four injected failure points verify rollback; action coverage checks replacement history, additional, historical, amendment, and whole cancellation effects (`import-publication.ts:106–128`; integration `:74–107`).
- The receipt table is private, UPDATE-trigger protected, browser-denied, and service-role SELECT/INSERT only (`20261006054515_knowledge_import_publication.sql:28–54`). The completion guard requires a receipt and prevents reversing `COMPLETED` (`:37–48`). Runtime job deletion is revoked by the separate additive retention migration noted above.
- The service deliberately leaves STRUCTURED/BOTH blocked by the referenced root policy. It inserts no arbitrary request SQL or caller-supplied vectors, and the receipt response contains identifiers, revisions, action/mode, digest and time rather than source material or embeddings.

## Verification performed

Commands run from `D:\project-next\line-ai-yru`:

- `& 'C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules/.pnpm/vitest@5.0.3_@types+node@24_b661ddaee0a3525594f82f0819be8b1c/node_modules/vitest/vitest.mjs' run tests/import-publication-request.test.ts` — **1 file, 19 tests passed**.
- `& 'C:\Users\NOTEBOOK\AppData\Roaming\npm\pnpm.cmd' exec eslint --no-cache lib/imports/import-publication.ts lib/imports/chunk-preparation.ts tests/import-publication-request.test.ts` — **passed, exit 0**.
- `& 'C:\Users\NOTEBOOK\AppData\Roaming\npm\pnpm.cmd' exec tsx --test --test-concurrency=1 tests/database/import-publication.integration.ts` — **14 tests passed, 0 failed**, against the configured local PostgreSQL test database (48.8 seconds). This includes atomic rollback, sequential/concurrent retries, all five actions/CANCELS, authorization/revocation, receipt privileges, timeout/abort, and the fresh-read lock-wait case.

I did not run the full database/unit suites, full build, browser acceptance, real-model end-to-end publication, or DEVELOPMENT/DEV migration gates. Root separately owns those checks and any final acceptance claims.
