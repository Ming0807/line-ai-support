# IMP-03 Contract Review

Date: 2026-10-06
Reviewer: `/root/m7_review_contract` (read-only delegated review)
Verdict: **Contract direction is sound; preview/edit/publication are not implemented or accepted yet.** Root should freeze the contracts below before building those paths. This review changed only this report and ran no tests.

## Scope and evidence

Read `AGENTS.md`, `docs/agents/WORKING_PROTOCOL.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, master §§2.3–2.4, 35–50, 60–64, `docs/requirements/sources/README.md`, original overview and document-versioning sources, the import rows in `docs/requirements/V1_REQUIREMENTS_MATRIX.md`, `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`, `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`, and the assigned import types, extraction, analyzer, staging, and envelope modules.

Current code has a useful foundation: `types.ts` defines PDF/DOCX/XLSX/CSV/HTML source locations and extraction warnings; `extraction.ts` validates format-specific locations and requires parser warnings to start `UNRESOLVED`; `analyzer.ts` emits conservative proposals with dates/authority null; `import-staging.ts` protects original bytes and source metadata and authorizes active `SUPER_ADMIN`; `staging-envelope.ts` binds encrypted payloads to job, checksum, revision, and purpose. However, current staging exposes only `READY|FAILED`; persisted extraction, append-only review revisions, preview/edit, approval schema, version resolution, publication, and citation locations do not exist. Existing `knowledge_chunks` retain `page_number` and `section_title`, not the new location union. The board/matrix correctly keep M7 partial and all-five-format supervised runtime and real-corpus acceptance pending.

## Prioritized findings

### P0 — Preserve a revision chain; do not overwrite the reviewed snapshot

The immutable original checksum and bytes must remain independent from corrected extraction content. The plan/design require every extraction correction to change the staging revision while preserving the original checksum. A mutable `revision` integer plus one encrypted extraction column is insufficient for the requested immutable revision history: an edit could erase the exact text, analysis, or warning state that was previously reviewed.

Use an append-only private revision record keyed by `(job_id, revision)`, with `base_revision`, encrypted extraction, encrypted analysis/review snapshot (or separately immutable purpose records), normalized extraction digest, server-derived `created_by`, and timestamp. Keep a current-revision pointer on the job. Bind every ciphertext with the existing `StagingContext` AAD and the matching revision/purpose. Reject updates/deletes to prior revision payloads; corrections create a new record. Retain the source upload receipt/provenance and original bytes unchanged. Store review reasons and warning snapshots without copying matched personal values into activity logs.

Every extract/edit/preview-save/approve request carries `expectedRevision`. Parsing or embedding happens outside SQL after an authorized snapshot. Before saving, reauthorize the active actor and compare the expected revision under a short transaction; stale requests return a conflict and create no revision. Approval also carries the reviewed target document revision and rechecks it under the publication locks.

### P0 — A false-positive acknowledgment cannot clear a public sensitivity gate

The design says detection is risk evidence, not proof of absence, and that a false-positive disposition does not authorize unredacted personal data. Make the public gate depend on the **current exact extraction revision**, not just review booleans: unresolved blocking/extraction/source/applicability warnings, current sensitive-category hits, or unavailable sensitivity review keep `PUBLIC` ineligible. A false-positive entry alone cannot clear `sensitiveRisk` or set `requires_review=false`. To publish, redact or correct the current extraction, recompute analysis on that new revision, and require a reviewer to attest that the resulting content and provenance are suitable for public use. If sensitive content remains, keep it `INTERNAL`/`RESTRICTED` within existing access controls or leave it pending.

Allow `FALSE_POSITIVE` only as a recorded disposition for a specific warning, with a nonempty bounded reason and server-derived reviewer/revision. Preserve the original warning and its disposition history; do not let the client remove warnings, alter counts, or submit a clean report. Keep privacy-safe category codes in logs, never the matched name, ID, phone, or email.

### P1 — Separate parser warnings, analyzer findings, and reviewer dispositions

`ExtractionWarning` currently has a disposition union, while the parser validator correctly insists on `UNRESOLVED`. In contrast, `ImportAnalysis.flags` is `string[]`; it mixes derived findings such as `SOURCE_REVIEW_REQUIRED`, `FAMILY_AMBIGUOUS`, and `STRUCTURED_SCHEMA_UNAVAILABLE` with parser flags. `pages[].requiresReview` is also caller-provided. Define typed review items with stable IDs derived from a canonical warning/finding snapshot, code, severity, location, count, and initial `UNRESOLVED` state. Save disposition records separately with reason, reviewer ID, revision, and timestamp. Derive preview `requiresReview` from current findings and their eligible dispositions; never trust a client boolean to clear it.

Re-run deterministic analysis after any text/table edit. Keep analyzer output as a proposal: it cannot approve, choose final applicability/authority, supersede a version, or publish. No future AI result should be able to bypass the same strict review and approval schema.

### P1 — Preserve source locations end to end

Keep each `SourceLocation` attached through staged extraction, edits, chunking, structured rows, citations, and final delivery. Add an additive validated location column/field for chunks (an array, because a chunk may combine source blocks), and provenance on structured records when M8 adds those mappers. Validate the location kind against the source format and never fabricate PDF page numbers for DOCX/XLSX/CSV/HTML. HTML locations must retain the final sanitized source URL and stable block/heading path. A missing or mismatched location is a blocking provenance warning, not permission to publish without a citation.

Track immutable acquisition URL/final URL separately from the reviewer-approved citation URL. Correcting provenance must create a reviewed revision; never rewrite the original acquisition record or silently sanitize it into a different URL. `ImportPreview` may expose locations/content only to an active `SUPER_ADMIN`, and must omit ciphertext, `OriginalRef`, storage object keys, service credentials, and durable signed URLs.

### P1 — Freeze a strict preview/edit and approval DTO

Recommended minimal shapes (field names illustrative; reuse existing Zod conventions):

```ts
type ImportPreview = {
  jobId: string;
  expectedRevision: number;
  extraction: LocatedExtraction; // bounded, encrypted at rest, admin-only response
  analysisProposal: ImportAnalysis;
  review: { warningDispositions: WarningDisposition[]; editedFields: ReviewedMetadata };
  versionProposal: VersionProposal; // existing family/stream/target + their revisions
};

type WarningDisposition = {
  warningId: string; // digest of immutable code/location/count/parser snapshot
  disposition: 'CORRECTED' | 'FALSE_POSITIVE';
  reason: string;
}; // actor, time, and revision are server-derived; original warning remains retained

type ReviewedMetadata = {
  title: string; departmentCode: KnownDepartment; documentType: string;
  familyCode: KnownOrExplicitlyCreatedFamily; versionName: string; versionStream: string;
  academicYear: number | null; semester: string | null; audience: string;
  studentType: string; programCode: string | null; curriculumCode: string | null;
  cohort: number | null; publishedAt: ISODate | null; effectiveFrom: ISODate;
  effectiveTo: ISODate | null; authorityLevel: number; sourceUrl: string;
  officialSource: boolean; visibility: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  storageMode: 'RAG' | 'STRUCTURED' | 'BOTH';
  action: 'NEW_FAMILY' | 'ADD_ADDITIONAL' | 'REPLACE_CURRENT' | 'ADD_HISTORICAL' | 'AMEND_EXISTING';
  targetDocumentId: string | null; targetDocumentRevision: number | null;
  attestations: { extractionReviewed: true; sensitivityReviewed: true; provenanceReviewed: true };
};

type ReviewEditRequest = {
  expectedRevision: number;
  extractionEdits: BoundedLocatedEdits; // locations retained; caller cannot edit parser report/dispositions
  warningDispositions: WarningDisposition[];
  reviewedMetadata: Partial<ReviewedMetadata>;
};
```

Use strict schemas and exact date validation; reject impossible dates, `effectiveTo < effectiveFrom`, unknown department/family/dataset values, unsupported action/target combinations, and client-supplied actor IDs. Keep analyzer `publishedDate`, effective dates, and authority null until explicitly reviewed. The master §37 wording could be read as extracting trusted dates/authority; the current design correctly resolves this as human-reviewed metadata, never derived from fetch time or unverified text. Record that conflict/resolution in the decision log if the implementation changes this boundary.

### P1 — Make version action explicit and atomically guarded

Resolve the proposal against the same family, department, document type, and explicit `versionStream`; show the current target and its revision in preview. Approval must revalidate the selected action and target under sorted family-then-document locks. `REPLACE_CURRENT` supersedes the exact matching current document, keeps its records, and creates the superseding relationship. `ADD_ADDITIONAL` and `ADD_HISTORICAL` do not supersede. `AMEND_EXISTING` links to the exact base and leaves its current flag unchanged; applicability/effective dates are reviewed. Unknown families may be explicitly reviewed as data metadata, but must not create DDL. Unknown/uninstalled structured datasets fall back to RAG with a visible reason; `STRUCTURED`/`BOTH` require a fixed installed mapper.

Publication prepares local E5 vectors and validates structured rows outside the SQL transaction, then reauthorizes and atomically persists the document/version relation, chunks and locations, supported dataset rows, audit event, and idempotent completed receipt. The master §50 example places embedding creation inside its transaction, but current `AGENTS.md` and Import design require provider/network work outside SQL; follow the latter. The selected embedding default remains local CPU `intfloat/multilingual-e5-small`/384 from DEC-021; do not invent generation models, prices, or additional datasets. Any failure rolls back all publication effects; retries return the same receipt. No automatic DDL or old-version deletion.

## Acceptance checks to attach to IMP-03

- **Unit/schema:** parser output cannot set warning dispositions; format/location mismatch and missing location fail; edits preserve locations; flags/findings are typed; proposals always keep trust-sensitive fields null; false-positive disposition preserves the warning and cannot by itself make `PUBLIC` eligible; date, scope, dataset, action, and target schemas reject invalid combinations.
- **Revision/privacy actual PG:** only active `SUPER_ADMIN` can read/preview/edit/approve; original bytes/checksum/source acquisition remain immutable; each revision decrypts only with its job/checksum/revision/purpose; old revision snapshots remain byte-identical; edits/reanalysis create append-only snapshots; parallel stale save and stale approval return conflict; unauthenticated roles get no direct table/storage access; preview/audit do not leak `OriginalRef`, storage keys, source contents, or matched personal values.
- **Five-format provenance:** run supervised PDF, DOCX, XLSX, CSV, and HTML through original → parse → persisted revision → preview/edit → chunk/citation. Assert exact source-location retention and citation equality for each format. Parser unit passes alone are not this acceptance.
- **Version/publication actual PG:** replace/additional/historical/amendment paths; exact target and stream checks; two concurrent approvals; duplicate retry; stale target; date/authority/applicability filter; amendment retrieval; forced failure leaves no partial document/chunk/relationship/dataset/audit writes.
- **No network in SQL:** hold a parser/embedding callback at a barrier and verify no business transaction is open; after callback, reauthorize and compare staging/target revisions before the atomic write. Exercise the existing delivery/publication fence.
- **Full gates remain separate:** run required unit/PG/RLS/type/lint/build/replay/advisors on final source, then actual three-role browser review and corpus/manual gates. No component parser evidence or successful preview alone closes M7 or Flow A–F.

## References

- Current contract: `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md` §§ source location/warnings, analysis/review, staging/publication.
- Execution plan: `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md` Tasks 2–6.
- Requirements: master §§2.3–2.4, 36–50, 61–64; matrix CH009–012, CH035–050, CH061–064; current status in `docs/tasks/V1_TASK_BOARD.md`.
- Implemented base: `lib/imports/types.ts`, `extraction.ts`, `analyzer.ts`, `import-staging.ts`, `staging-envelope.ts`; existing tables in migrations `20261005093910_private_knowledge_import_staging.sql` and `20261004125859_knowledge_rag.sql`.
