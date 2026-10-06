# M7 located preparation and private review checkpoint

6 October 2026. Task IDs **IMP-03B-2 / IMP-LOC-01 / IMP-PLAN-01**, execution Task4C-2/3a/3b. Parent source `33710b7009ace1566a4ab6fcccabd601e16efa35`. This report accompanies the implementation commit. Requirements CH010/035/043/045/049/050/061, USR-IMPORT5 and USR-EMB-LOCAL; [execution plan](../superpowers/plans/2026-10-04-yru-knowledge-import.md), [import design](../architecture/KNOWLEDGE_IMPORT_DESIGN.md), [embedding design](../architecture/EMBEDDING_SERVICE_DESIGN.md).

**COMPONENT_PASS: final14chunk,17version and21import browser groups passed.** No approval/publication, real-corpus, whole M7 or V1 acceptance is claimed.

## Result and source scope

The backend prepares a deterministic located chunk plan from the retained original and exact saved extraction. It consumes narrative and tables for all five formats, preserves exact narrative slices/declared overlap and lossless row JSON (including empty cells and sparse coordinates), counts the final passage text with the pinned local E5 tokenizer, and rejects unsplittable rows/graphemes and empty-only scanned input. Each final passage is at most512tokens/6,000UTF-8bytes; work is bounded by45seconds, batches16 and2,000chunks. Digests bind original checksum, job/extraction identity, ordered text, coverage, provenance, token evidence, warnings and E5 identity. This helper does not encode or publish.

Private GET `/api/knowledge/imports/[id]/chunks` requires active SUPER_ADMIN, a saved current review and exact job/extraction/review counters. Original recovery and counting run outside SQL; the final transaction locks the job before reading a fresh counter snapshot. Revocation, cancellation or changed counters return no plan. Only server-selected local counting is used; requests cannot choose text, model, provider, vectors, SQL or coordinates. Responses are private/no-store and errors/logs contain fixed codes.

The Import UI pages through actual chunks, exact token evidence and proven format coordinates. It never auto-selects an acknowledgment. An explicit private acknowledgment is saved as a strict review-v2 digest/chunker binding; the backend recomputes it before encrypted append/CAS. Old v1 ciphertext remains unchanged and readable. Clearing the acknowledgment saves nullable v2 data. Parent pending/dirty/reload/reset coordination prevents use of obsolete plans. A reviewed consent race was fixed by disabling withdrawal during parent saves/loads or pending preparation. Long text is an explicitly named keyboard-focusable region and warning labels are Thai.

Additive migration `20261006044000_knowledge_source_locations.sql` persists bounded JSONB locations and nullable1..512passage-token evidence. Legacy rows retain empty locations/null counts and their old vectors. SQL checks bounded array/object/known-kind shape; detailed ranges and same-format provenance are validated by the application. Retrieval/citations carry copied strict arrays and render proven PDF pages, DOCX blocks/headings, XLSX sheets/rows/columns, CSV rows/columns and HTML blocks/headings. Delivery comparison rejects changed/malformed locations; missing old serialized locations normalize to explicit legacy[]. No invented pagination, vector rewrite, browser grants or original deletion.

Key files: `lib/knowledge/located-chunk-plan.ts`, `lib/imports/chunk-preparation.ts`, `import-chunk-plan.ts`, `chunk-plan-types.ts`, review schema/service, private chunks route, parent review form/new panel and scoped CSS, knowledge types/retrieval/citations, additive migration, focused unit/PG fixtures and normal DB runner, `scripts/qa/located-chunk-plan.ts`, `knowledge-chunks-browser.mjs`.

## Verification

| Gate | Observed result |
|---|---|
| Full unit suite |1297tests/86files PASS on final consent/accessibility/copy source |
| Full local PostgreSQL/foundationRLS |154checks PASS through the final normal runner, including the6test chunk suite and final-job-lock barrier |
| Isolated migration replay |25migrations/foundationRLS PASS, disposable owned database; existing local database preserved |
| Advisors CLI2.119.0 |0ERROR/0WARN,86INFO:27RLSwithoutpolicy+12unindexedFK+47unusedindex; INFO retained and disclosed |
| Final-source lint/typecheck/Next16.3.8build |PASS after consent guard and accessibility/copy fixes; chunks route and both LINE routes compiled |
| Actual parser→local counter→embedding QA |5formats PASS, exact narrative/table recovery, sparse XLSX origin3/column2 retained, normalized384vectors, no SQL/generation/publication |
| Guarded DEVELOPMENT migration |25migrations/35RLS tables/9departments verified; originals and private Storage bucket preserved |
| Actual compiled browser |Final14groups including held-save withdrawal regression and named text-region keyboard focus PASS;17version/21import regression groups also PASS |

Actual local E5 observations: PDF2chunks/max31tokens; DOCX6/max372; XLSX1/max45; CSV1/max51; HTML6/max373. All16synthetic passages encoded as normalized384vectors. D:offline cached model was already loaded from the accepted token-service source; no cache download/deletion/provider registration or generation call was performed. These are controlled parser/infrastructure fixtures, not Thai-font/OCR/corpus quality certification or published knowledge.

The real PostgreSQL lock barrier holds the import job while appending a new review, observes the waiting lookup, commits, then confirms CONFLICT/no plan. The v2 acknowledgment test observes no open fixture business transaction during counting, rejects a false digest, preserves exact original bytes and earlier review ciphertext, and verifies zero publication effects. Role/preflight, three-counter staleness, revoked actor and aborted preparation checks passed.

## Failures and review provenance

Meaningful initial unit/PG REDs covered missing provenance and missing private plan implementation. Root corrected a PG fixture lacking mandatory version stream, a retrieval projection missing its intermediate locations column, and a STAFF fixture lacking a department; no schema/access limit was weakened. The builder corrected missing fixture fields, TypeScript numeric/union narrowing and a valid scanned-empty plan that initially returned empty success. The first browser run used an incorrect expected Thai error phrase; inspection confirmed the actual safe message and corrected the assertion. One later upload received a normalized503/INTERNAL_ERROR before a job was returned; its exact underlying cause was not established. Read-only checks subsequently passed for both DATABASE_URL/DIRECT_URL (796/742ms) and private Storage inspection. The first DEVELOPMENT connection failed with a fixed generic code; the guarded retry completed. Failed-run artifacts/private originals remain retained; no credentials were printed.

Root owns contracts, DB/auth/privacy, migration gates, backend/API/citations, parent integration and actual QA. User-requested Luna max implemented only the pure helper; Luna high implemented only the panel. Independent Luna max scopes actually ran23helpertests+tsc,16citationtests/3PG and15backendunit/5PG before the additional root lock barrier. No unavailable agent review is claimed. See [builder evidence](../../.superpowers/sdd/reports/imp-located-chunk-plan.md), [UI evidence](../../.superpowers/sdd/reports/imp-chunk-plan-ui.md), [helper review](../../.superpowers/sdd/reports/located-chunk-plan-review.md), [location review](../../.superpowers/sdd/reports/knowledge-location-review.md), [backend review](../../.superpowers/sdd/reports/import-chunk-plan-review.md), [UI review](../../.superpowers/sdd/reports/import-chunk-ui-review.md). The initial P2 consent finding and two UX notes are recorded; root corrected the consent guard, focusable text region and warning labels, with final14group browser evidence PASS and scoped reviewer source/lint follow-up closed.

## Required continuation

Task4C-3 approval integration and Task4 publication still require complete trusted metadata/warnings/privacy review, exact vectors outside SQL, immutable idempotent publication receipts, sorted family/document delivery locks, all five version actions, whole CANCELS, base-plus-applicable-AMENDS retrieval and obsolete queued-answer invalidation. New-publication nonempty-location/token guarantees are not implied by the legacy-compatible migration. M8 must implement all seven fixed datasets and atomic BOTH; M9, approved real corpus, live free-model/LINE quality, deployment and FlowA–F remain. [Publication preflight audit](../../.superpowers/sdd/reports/import-publication-preflight-audit.md) records source gaps and conflicting examples; the [publication continuation](../superpowers/plans/2026-10-06-yru-import-publication.md) resolves the next planned contracts in DEC-026…028. PUB implementation is not part of this checkpoint.

No new user configuration is needed for this checkpoint. Deferred live/university/production checks stay in the [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). The UI currently saves private review data; it does not approve, index or publish the university shortlist.
