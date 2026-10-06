# Dashboard knowledge backend contracts

6 October 2026. CAT-01 / UX-01A. These are backend contracts for the Gemini UI handoff; UI integration and usability acceptance remain separate. Read the [catalog design](../architecture/KNOWLEDGE_CATALOG_DESIGN.md), [assistance design](../architecture/IMPORT_ASSISTANCE_DESIGN.md) and [current board](../tasks/V1_TASK_BOARD.md). Root owns these API/server files. Gemini may consume these contracts without changing them.

## Private read APIs

All four routes require an authenticated, active `SUPER_ADMIN`. Anonymous callers receive 401; ordinary or inactive staff receive 403 before private selectors are processed. GET responses, including handled errors, carry `Cache-Control: private, no-store, max-age=0`, `Vary: Cookie` and `X-Content-Type-Options: nosniff`. Missing or invalid IDs return 404, invalid query selectors 400, a changed import revision 409 and an unavailable backend 503. Unsupported POST returns 405. Avoid displaying raw backend exceptions.

| GET path | Allowed selectors | Response root | Browser-safe parser |
|---|---|---|---|
| `/api/knowledge/catalog` | `q`, `departmentCode`, `status`, `page`, `pageSize` | `{catalog}` | `catalogEnvelopeSchema.safeParse(body)` |
| `/api/knowledge/families/[id]` | `page`, `pageSize` | `{history}` | `parseCatalogHistoryForFamily(body, selectedFamilyId)` |
| `/api/knowledge/documents/[id]` | `relationsPage`, `relationsPageSize` | `{document}` | `parseCatalogDetailForDocument(body, selectedDocumentId)` |
| `/api/knowledge/imports/[id]/assistance` | None | `{assistance}` | `parseAssistanceEnvelope(body, previewBinding)` |

Catalog schemas/parsers are exported by `lib/knowledge/catalog-types.ts`; assistance schemas/helpers by `lib/imports/assistance-contract.ts`. Both modules are pure browser contracts. Do not import `catalog.ts`, `assistance.ts`, original storage, server auth or encryption into client components.

## Catalog facts and pagination

Pages are numbered 1–10000; page sizes 1–50. Defaults: catalog 10, family history 25, document relationships 25. Duplicate or unknown query keys fail validation. Search is literal and case-insensitive; `%` and `_` are ordinary characters. Department choices use actual `code`/Thai `name` rows. `status` is one of the seven existing document lifecycle states.

Only approved documents appear. An unfiltered catalog includes empty families. Department/status filters restrict the matching document population; totals and each maximum-five-version preview refer to that population. `hasMoreVersions` leads to the full paginated family history, which shows all approved versions, including parallel streams. Page/count come from one SQL statement. A valid out-of-range page is empty with truthful totals.

Show `isCurrent`, lifecycle status, effective dates and visibility separately. A current INTERNAL or future document is not proof of student-answer eligibility. `storageMode` and `lastImportAt` come from the immutable publication receipt and its import job. Legacy null means unknown; do not substitute `family.defaultStorageMode`. The default mode is separate family configuration.

Document detail includes stored scope/review facts and paginated relationship links. Related endpoints and `supersedesDocumentId` are exposed only when the referenced document is approved. Relationship direction/type is stored history, not a calculated claim that an amendment currently applies. No private source bodies, original storage paths, vectors, actor IDs or review ciphertext are returned.

## Assistance and draft preservation

Bind a proposal to the current preview's `{jobId: preview.job.id, jobRevision: preview.job.revision, extractionRevision: preview.extractionRevision}`. The parser returns null for a malformed, different-job or stale envelope. Abort or supersede earlier requests when selecting another job; never render one job's proposal under another heading.

`metadata` has the existing nullable review metadata shape. `origins` labels populated proposals as `EXTRACTED`, `CLASSIFIED` or `DEFAULT` with fixed Thai copy; there is no fabricated confidence score. Reference families/departments are actual database choices. Explicit unambiguous labelled dates may be proposed; absent, malformed or conflicting evidence stays null. Academic year/upload time must not become an effective date.

Editable operational defaults are `versionStream=main`, `visibility=INTERNAL`, `storageMode=RAG`. INTERNAL material is not student-answer knowledge. Authority, audience, student type, publication consent, version action/target, warning resolution and chunk acknowledgment are not defaulted. Assistance is deterministic preparation, not remote AI generation.

Use `applyImportAssistance(draft, assistance)` for an explicitly eligible draft: it fills missing metadata only, preserves human-entered fields and avoids creating a reversed effective interval. The UI must preserve saved drafts rather than applying proposals automatically on every load. `requiredReviewFields(metadata)` supplies named missing metadata; it is not a substitute for server review/publication validation. Existing receipt/source/draft revision locks and deliberate approval remain mandatory.

These GETs do not mutate business job/extraction/review/document/publication state. Reading a verified original can create the existing access audit record. Private original verification/decryption happens outside SQL; the final short transaction rechecks active role and extraction/job revisions before returning proposals. No model calls, DDL or automatic approval are involved.

## Integration acceptance

Root supplies backend unit, actual PostgreSQL and compiled authenticated HTTP evidence in the [backend report](../reports/KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md). Gemini still needs to implement the user workflow, exercise loading/error/stale/saved-draft handling, and submit its local commit report. Root then reviews and runs real combined desktop/mobile/keyboard acceptance. Existing source checkpoint reports cannot close those pending UI gates.
