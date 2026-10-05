# IMP-01D Extraction Review

Date: 2026-10-06
Reviewer: `/root/m7_review_contract` (read-only source review)
Verdict: **The implemented extraction draft path has sound authorization, CAS, encrypted history, and preview revalidation. Two failure/cancellation edges still need fixes; failed-receipt audit linkage and rollback fault coverage also remain.** This review changed only this report and did not run tests.

## Scope and checkpoint

Reviewed `lib/imports/import-extraction.ts`, `import-staging.ts`, `original-storage.ts`, `review-draft.ts`, `staging-envelope.ts`, `types.ts`, `extraction.ts`, `source.ts`, `parse-source.ts`, `parser-process.ts`, `supabase/migrations/20261005172910_private_knowledge_extraction_revisions.sql`, and `tests/database/import-extraction.integration.ts`.

The implementation persists extraction and analysis drafts as encrypted append-only revision rows, preserves the original, supports bounded text/title/table-cell edits, and provides an admin-only preview. There is still no warning-disposition UI/schema, reviewed publication metadata, version resolver, or publication path in this slice; no review or M7/publication acceptance is implied. The task briefing reports eight actual PostgreSQL tests passed before the in-flight malformed-PDF regression/corrections. This reviewer did not rerun the suite, and no independent verdict is claimed for changes still being made.

## Findings

### P1 — Normalize child failures into durable, safe import failures

`parseImportSource()` can emit `IMPORT_PARSER_BUSY`; `executeParserChild()` can emit `IMPORT_PARSER_FAILED` and `IMPORT_PARSER_OUTPUT_LIMIT`. `analyzeImportJob()` currently persists only `IMPORT_PARSER_TIMEOUT`, `IMPORT_PARSER_UNAVAILABLE`, and `IMPORT_PARSE_INVALID` as failed receipts (`import-extraction.ts` around lines 92–96). The other codes fall through to `INTERNAL_ERROR` without calling `markImportFailed()`.

Reproduction: stage a malformed PDF and call `analyzeImportJob(actor, jobId, 0)`. The parser child exits with `IMPORT_PARSER_FAILED`; the service currently returns `INTERNAL_ERROR`, leaving the first-attempt job `READY` at revision 0 instead of a normalized failed status. An output-limit failure behaves the same. The working tree now contains a real malformed-PDF database regression expecting a normalized failure, so this branch is pending the corresponding mapper change and rerun.

Map deterministic child/process failures (`IMPORT_PARSER_FAILED`, `IMPORT_PARSER_OUTPUT_LIMIT`) to a fixed persisted code such as `IMPORT_PARSE_INVALID`; map parser timeout as already planned. Keep `IMPORT_PARSER_BUSY` retryable and controlled without stamping a failed receipt. Request cancellation should return the cancellation/conflict result without persisting a failure. Add focused tests for each class, including a busy retry that leaves revision/status unchanged.

### P1 — Propagate caller cancellation through private Storage reads

`ImportExtractionOptions.signal` is checked before and after `readImportOriginal()` (`import-extraction.ts` around lines 35–42), and is passed to the parser. But `readImportOriginal()` calls `OriginalStorage.download(jobId, ref)` without a signal (`import-staging.ts` around lines 118–128); the storage interface has no signal parameter and creates its own 15-second controller (`original-storage.ts` around lines 7–9, 54–63, 88–92). Canceling or disconnecting during a private Storage read therefore leaves that bounded download running until it completes or reaches its internal deadline. No draft is committed because the post-read signal check catches cancellation, but network and buffer work continue unnecessarily.

Thread an optional `AbortSignal` through `readImportOriginal` and `OriginalStorage.download` into the storage operation. Preserve the current authorization/revision recheck after the read and the bounded private/no-store behavior. Test with a blocked fake Storage response that caller cancellation rejects promptly, closes/cancels the response body, and creates no revision. This finding was sent to root; an in-flight fix was reported but is not independently verified here.

### P2 — Record the revision on failed-receipt audit events

`markImportFailed()` increments the job revision and returns the updated row, but writes `KNOWLEDGE_IMPORT_FAILED` metadata with only `{importJobId, errorCode}` (`import-staging.ts` around lines 133–140). A later successful retry clears the job’s current error and advances its revision again. The retained activity can no longer be matched to the independent failed-receipt revision described by the preview contract.

Include the returned `row.revision` in failure audit metadata and extend the audit type accordingly. Add a test for parse-success at revision 1 → failure receipt at revision 2 → retry at revision 3, asserting that the immutable failure activity identifies revision 2 and contains no extracted content.

### P2 — Add an injected rollback regression

`appendRevision()` inserts the immutable revision, advances the job pointer, and writes the activity inside `withImportAdminTransaction()`. `transaction()` rolls back on any callback error, so code inspection found no partial-commit path. The current actual-PG tests cover the successful atomic append and stale CAS, but do not inject a failure after the insert or pointer update.

Add a one-shot database trigger/failure on the matching `KNOWLEDGE_IMPORT_EDITED` activity insert. Assert that the call fails, the new revision row is absent, the job pointer/status/error are unchanged, and the old preview remains readable. This proves rollback across all three writes rather than relying only on the transaction wrapper’s structure.

## Safeguards verified by source inspection

- `withImportAdminTransaction()` checks an active `SUPER_ADMIN` within each transaction. Analyze checks before original access, runs the parser after committed snapshots, and reauthorizes before append. The database lock on the active staff row holds through the short transaction.
- `appendRevision()` locks the job `FOR UPDATE` and compares both loaded revision and immutable checksum before inserting; concurrent analyzers have one winner. Edits also compare the loaded job revision after loading the current preview.
- The migration binds each extraction/analysis/review ciphertext to job, checksum, revision, and purpose through the existing envelope. The revision table has a unique `(job_id, revision)`, a self-reference for edit base revision, an update-blocking trigger, RLS, and only service-role SELECT/INSERT grants. Service role has no UPDATE/DELETE grant; parent cascade is limited to explicit job deletion/authorized test cleanup, with no application delete path in this slice.
- Preview decrypts, verifies the serialized extraction digest, validates format/location alignment, then performs a final active-admin and current-revision check before returning. When a known parse failure increments the job revision independently, preview selects the latest extraction at or below that pointer and returns both `job.revision` and `extractionRevision`; the existing integration case exercises this behavior.
- `applyExtractionEdit()` accepts only bounded page text, table-cell text, and title changes. It retains source locations and parser evidence, requires a nonempty reason, marks edits for review, and the service reruns deterministic analysis before persisting the new snapshot. Audit entries store job/revision only; reasons and changed indexes are in the encrypted review payload. No parser-supplied warning disposition is accepted by the validator.

These checks establish the extraction draft foundation only. They do not supply the required manual warning dispositions, PUBLIC sensitivity gate, reviewed metadata/version action, source-location persistence in chunks/citations, or atomic publication. Those remain downstream contracts before approval or M7 completion.

## Verification addendum — 2026-10-06

Re-reviewed the corrected `import-extraction.ts`, `import-staging.ts`, and `original-storage.ts` paths, the extraction migration and integration suite, the route handlers, and the four focused unit suites. The reported fixes are present:

- `IMPORT_PARSER_FAILED` and `IMPORT_PARSER_OUTPUT_LIMIT` normalize to persisted `IMPORT_PARSE_INVALID`; timeout stays normalized; `IMPORT_PARSER_BUSY` returns the generic controlled 503 path without calling `markImportFailed` or advancing the job revision.
- The request signal now reaches `readImportOriginal()` and `OriginalStorage.download()`. Storage links caller cancellation to the operation controller; the staging service checks cancellation before/after download and before the final authorized read audit/return.
- `KNOWLEDGE_IMPORT_FAILED` audit metadata now contains the post-increment receipt revision.
- The new actual-PG tests inject an activity-write failure and prove both the new revision and job pointer roll back; the parallel-edit case preserves the winning prior ciphertext.

Commands run by this reviewer:

- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-extraction.integration.ts` — **11/11 passed**. This suite created and removed its scoped fixture rows and the temporary rollback trigger/function; no migration or production schema was applied.
- `pnpm exec vitest run tests/import-original-storage.test.ts tests/import-extraction-routes.test.ts tests/import-review-draft.test.ts tests/import-extraction.test.ts --maxWorkers=1` — **4 files, 23/23 tests passed** (Storage 7, routes 6, review edits 6, extraction validation 4).
- `pnpm exec tsc --noEmit` — **exit 0**.
- `pnpm exec eslint lib/imports/import-extraction.ts lib/imports/import-staging.ts lib/imports/original-storage.ts` — **exit 0**.

**Updated verdict:** the two P1 source issues and the failed-receipt audit gap are corrected and verified in the scoped tests above. The rollback path is verified by the injected failure. No remaining auth, CAS, immutable-history, preview revalidation, or cancellation defect was found in this slice. `BUSY` is safe and state-preserving but deliberately surfaces as generic `INTERNAL_ERROR`/HTTP 503 rather than a dedicated retry code.

Remaining limits: this is extraction, private preview, and text-edit acceptance only. The tests do not establish supervised end-to-end behavior for all five formats, real corpus quality, manual warning dispositions, the rule that a false-positive acknowledgment cannot expose public personal data, approval/version resolution, source locations through chunks and citations, publication locks, or complete M7/Flow A–F acceptance. Those remain open for root integration and final acceptance. No full suite or browser/corpus acceptance was run here.
