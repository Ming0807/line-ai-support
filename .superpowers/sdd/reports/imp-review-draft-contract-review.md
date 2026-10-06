# IMP-03A review-draft contract review

Date: 6 October 2026
Reviewer: `m7_review_contract` (independent contract review)
Scope: current docs, existing staging/extraction/schema/API invariants. This is not an implementation acceptance report.

## Checkpoint and evidence

The current design and Task4A plan define a separate append-only encrypted review receipt; saving may be incomplete and must not publish or alter extraction state. The review/API/schema implementation was not present at this source checkpoint: `lib/imports/review-draft.ts` is the bounded text/cell extraction editor, and there is no `review-schema.ts`, `import-review.ts`, review route, or review receipt migration yet. Therefore findings below are contract requirements and risks to check when those files land, not claims that a particular implementation fails.

Reviewed `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, linked requirements matrix rows CH009/016/036–040/045/049/050/061/062/USR-IMPORT5/USR-AMENDS, master §§9–10/39–42/46–50/60–64, `docs/requirements/sources/original-document-versioning.th.md`, `docs/architecture/YRU_V1_DESIGN.md`, `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`, the Task4A section in `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`, and current import/document schema and service code.

## Prioritized contract findings

### P1 — CAS must bind all three independent revisions

The import job revision and extraction revision are not interchangeable. `markImportFailed` increments `knowledge_import_jobs.revision`; preview deliberately returns the latest extraction revision at or below that job revision, so a failed receipt can leave a readable prior extraction. Review drafts add a third independent counter. A save that checks only one or two can accept a stale editor or overwrite another admin's latest draft.

Require exact `expectedJobRevision`, `expectedExtractionRevision`, and `expectedReviewRevision` on save (`0` for no saved review). In the final active-admin transaction, lock the job row, recheck current job revision, verify that the exact extraction row exists and is still the preview target, and compare latest review revision before insert. Append `latestReviewRevision + 1` and safe activity in that same transaction. A single concurrent writer succeeds; the loser returns a fixed conflict and may reload. GET must return the job and extraction revisions separately and identify a saved receipt as stale when it binds another extraction revision. Never silently transplant a stale draft onto a newer extraction.

### P1 — Review history needs its own immutable receipt table and crypto binding

`private.knowledge_import_revisions.review_encrypted` already stores extraction-edit evidence (`reason`, changed pages/cells/title) under the `REVIEW` envelope purpose. Reusing that column for review metadata would conflate two histories and break the existing `(job_id, extraction_revision)` meaning. Use a separate table with `(job_id, review_revision)` primary key, exact `extraction_revision`, actor and timestamp, canonical payload digest, and encrypted payload; add a composite FK to `(job_id, revision)` in immutable `knowledge_import_revisions`. Enable RLS, deny browser roles, grant only server `SELECT, INSERT`, reject updates with an immutable trigger, and expose no application delete path.

The current staging envelope AAD has only one `revision` field. Review ciphertext must be authenticated against job ID, immutable original checksum, extraction revision, review revision, and the review purpose. Extend the envelope context safely for this receipt type or introduce a distinct review-receipt envelope; do not rely on a ciphertext value being in the “right” row without cryptographically binding both counters. Serialize/encrypt before SQL; keep the bounded decrypted draft within the envelope's reviewed size limit.

### P1 — Warning dispositions cannot turn sensitive-risk evidence into PUBLIC approval

Recompute warning references server-side from the exact extracted report and current analysis; reject duplicate/unknown supplied keys; preserve parser evidence and ordering. Omitted dispositions remain unresolved. Require a non-empty bounded reason for each supplied disposition, and keep receipt actor/time/revision provenance. Saving a disposition must not edit the extraction report or clear `requiresReview`.

An admin's `FALSE_POSITIVE` or acknowledgement cannot by itself make a document containing detected personal data PUBLIC. PUBLIC publication must separately re-evaluate current extracted text/analysis and block known sensitivity until it is redacted/re-extracted and reanalyzed, or the human chooses an allowed non-public visibility. An acknowledged parser/quality warning similarly is not proof of correction; later approval must revalidate source and extraction requirements against the exact current extraction. Do not let an analysis proposal, confidence, family suggestion, or warning dismissal satisfy authority/provenance/scope attestations.

### P1 — Make the five actions and optional target a strict discriminated union

Keep exactly `NEW_FAMILY`, `ADD_ADDITIONAL`, `REPLACE_CURRENT`, `ADD_HISTORICAL`, and `AMEND_EXISTING`; never accept an approve/publication boolean or caller SQL/table/model name. Validate action/target combinations rather than storing a free action plus loosely optional target fields:

| Action | Draft target contract | Publication invariant to preserve |
|---|---|---|
| `NEW_FAMILY` | No existing target; reviewed family code/name/category. New family codes are allowed data and never DDL. | Insert family/document only under approved metadata and normal unique/current rules. |
| `ADD_ADDITIONAL` | No replacement target by default; optional `CANCELS` instrument subobject only with exact target ID and target revision. | Additional document never supersedes the base. Cancellation is a separate source-to-target whole-document relationship, only for matching reviewed applicability scope and effective interval. |
| `REPLACE_CURRENT` | Exact current target ID and target revision; same family, version stream and reviewed applicability scope. | Lock family/target, recheck current+revision+scope, supersede only that target and atomically insert the replacement. |
| `ADD_HISTORICAL` | No current target required unless a separate explicit relation is part of a later contract. | Preserve history; do not change current status implicitly. |
| `AMEND_EXISTING` | Exact base target ID and target revision; no ambiguous amendment-chain target. | New source `AMENDS` the base; base stays active/current and retrieval includes base plus every applicable active amendment. |

Represent CANCELS only as a typed `ADD_ADDITIONAL` relationship object with a literal whole-document scope and exact target revision; reject standalone/partial cancellation and all non-`ADD_ADDITIONAL` combinations. Its effective date/scope must later be revalidated at publication. These constraints follow the existing `document_relationships` relation type and the 6 October design decision; they do not authorize publication in the draft API.

### P2 — Preserve existing document scope and version-stream semantics

Use fields already present on `public.documents`: family, department, title/type/version, `version_stream`, academic year, semester, audience, student type, program/curriculum, cohort, effective dates, authority level, source URL, visibility, and archive/current flags as applicable. Preserve nullable fields while drafting; do not guess dates, authority, family, or source provenance from extraction. Keep `version_stream` separate from academic year: replacement requires the exact reviewed stream/scope; `ADD_ADDITIONAL`, `ADD_HISTORICAL`, and `AMEND_EXISTING` must not accidentally flip another row's `is_current`.

Keep `storageMode` limited to RAG/STRUCTURED/BOTH and `datasetType` to the seven fixed codes. Draft may preserve a structured proposal when a mapper is absent, but later publication must fail closed unless a server-installed mapper exists. Family suggestions and the initial 19 family codes are proposal/coverage, not a closed allowlist. A PUBLIC source/authority remains an explicit reviewer decision and is rechecked at approval; `sourceUrl` syntax alone does not certify official authority.

### P2 — Stale receipts, retries and activity need explicit behavior

Retain old review receipts when extraction advances; mark them stale by exact `extraction_revision` mismatch and require an intentional copy/re-save against the new extraction if the UI offers recovery. A job failure that advances job revision but leaves extraction unchanged is distinct from an extraction change; the client must reload and save against the current job revision.

Concurrent PUT is naturally protected by expected-review-revision CAS and should have an actual-PG single-winner test. For a response lost after commit, either document that a retry receives conflict and the client reconciles by GET, or add a request ID with unique per-job replay semantics; do not blindly create duplicate review receipts. Audit insert and receipt insert must roll back together on injected failure. Activity metadata should contain actor, job ID, review/extraction revision and safe action only, never title, authority/source text, dispositions/reasons, extracted text, source checksum, or encrypted payload.

## Proposed smallest coherent slice and checks

The minimal Task4A slice is private draft `GET` + append-only `PUT` only: strict schema/DTO, warning key binding, encrypted separate receipt, active-admin/same-origin/no-store bounded route, CAS/append/audit transaction, UI that can save null/false incomplete choices and visibly labels the result as a saved draft. It must not create/update `documents`, chunks, vectors, structured rows, approval state or extraction/job status. Root owns `review-schema.ts`, `import-review.ts`, route, migration/grants/trigger, DB helpers and integration; independent helper/UI ownership stays on the exact files assigned in the plan.

Acceptance tests should prove: null/false incomplete draft persists without changing job/extraction or creating public rows; all five actions and invalid target/CANCELS combinations are schema-tested; unknown/duplicate warning keys reject and missing keys remain unresolved; `FALSE_POSITIVE`/ack cannot authorize public sensitive content; encrypted round-trip is bound to job/checksum/extraction/review revisions; browser/anon cannot read/write; inactive/revoked admin fails at final transaction; stale job/extraction/review revisions conflict; two concurrent saves yield one winner; immutable trigger rejects update/delete path is absent; injected activity failure rolls back receipt; same-origin/admin checks precede bounded body read; GET and PUT have private no-store responses without ciphertext/checksum/original URLs. These checks establish draft persistence only. IMP-03B still needs version resolver, conflict preview, approval/idempotency, full publication rollback/race tests, E5 location retention through chunks/citations, retrieval/delivery invalidation and actual corpus evidence.

## Verdict at this checkpoint

**Contract review: actionable requirements recorded; implementation verdict pending.** The plan is directionally consistent with the source contract, provided the independent counters, separate receipt/encryption context, strict action-target combinations, and non-bypassable sensitivity gate above are implemented and verified. No code or DB mutation was performed for this review.

## Follow-up: DTO/schema review

Date: 6 October 2026. Root added `lib/imports/review-schema.ts` and `tests/import-review-schema.test.ts` after the contract-only checkpoint. Read-only review found the DTO aligned with the frozen Task4A contract: strict nested objects; explicitly present nullable metadata and false attestations; five actions; exact target requirements for replacement/amendment/CANCELS; CANCELS only with ADD_ADDITIONAL; fixed dataset codes; official YRU URL validation; real calendar dates and bounded intervals; reason-required resolved dispositions; three distinct expected counters; and canonical payload byte cap. No concrete schema/spec mismatch found.

Independent verification: `npx vitest run tests/import-review-schema.test.ts` — **1 file, 9 tests passed**. This verifies the pure schema only; it does not establish route, persistence, encryption, authorization, or publication acceptance.

Service-side checks remain essential by design: recompute warning references from the exact current preview and reject unknown keys while leaving omitted warnings unresolved; keep the review revision monotonic per job across stale receipts; and never allow `FALSE_POSITIVE` or a true attestation to waive current sensitivity evidence for PUBLIC publication. Root's stated AAD scheme (domain-separated context digest binding job/checksum/extraction and independent review revision) addresses cross-extraction and edit-evidence transplantation if encoded as an unambiguous tuple and verified on decrypt. Service, migration, route and actual-PG review remain pending.

## Follow-up: service, migration and route review

Date: 6 October 2026. Reviewed `lib/imports/import-review.ts`, `app/api/knowledge/imports/[id]/review/route.ts`, `supabase/migrations/20261005185744_private_knowledge_review_receipts.sql`, `tests/import-review-routes.test.ts`, and `tests/database/import-review.integration.ts`. No concrete contract or security defect found in this scoped source review.

The service reads the authorized latest preview outside SQL, validates all three expected counters, recomputes current warning references and rejects unknown/duplicate keys, serializes/hashes/encrypts before the write transaction, then reauthorizes and locks the job before rechecking job/extraction/latest-review revisions. Receipt insert and safe activity insert share one transaction; edit/failure receipts make prior review records stale without deleting history. The receipt AAD uses a domain-separated context checksum over original checksum plus job/extraction revisions, with review revision and job ID in the staging envelope context; payload digest is verified after decrypt. The route enforces same-origin, active-admin preflight before bounded body reads, strict JSON schema, private no-store responses and sanitized failures. The migration uses a separate receipt table with exact extraction FK, private RLS, browser denial, service-role SELECT/INSERT only, and an update-rejecting trigger; no application delete path was found.

Verification run by this reviewer:

- `npx vitest run tests/import-review-schema.test.ts tests/import-review-routes.test.ts` — **2 files, 15 tests passed**.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-review.integration.ts` — **12 tests passed**, including encrypted roundtrip, role/RLS denial, incomplete-draft non-publication, three-counter CAS, concurrent single winner, final actor revocation, stale extraction/failure behavior, audit rollback, ciphertext transplant rejection, and cancellation.

These checks verify the review-draft persistence slice only. They do not establish publication approval, warning policy at publication, version resolver behavior, source-location-to-citation continuity, delivery invalidation, real corpus acceptance, or full M7/V1 completion.
