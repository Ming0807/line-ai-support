# CAT-01 / PUB-06 catalog contract review

**Date:** 2026-10-06 (Asia/Bangkok)
**Review type:** read-only review of the frozen catalog design/plan, current database schema, browser-safe DTO types, and six root contract tests. This is not a route, service, database, browser, or acceptance review. No tests were run and no implementation/design files were edited.

## Source basis

Read `AGENTS.md`, `docs/PROJECT_INDEX.md`, the current task board, `docs/decisions/DECISION_LOG.md` (including DEC-033), `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` §§46/64, `docs/requirements/sources/original-document-versioning.th.md`, the installed schema in `supabase/migrations/20261004125859_knowledge_rag.sql` and publication/retention migrations, `docs/architecture/KNOWLEDGE_CATALOG_DESIGN.md`, `docs/superpowers/plans/2026-10-06-yru-knowledge-catalog.md`, `lib/knowledge/catalog-types.ts`, and `tests/knowledge-catalog-contract.test.ts`.

## Contract coverage that is aligned

The frozen design covers the master §46 catalog fields (family, current version, department, status, storage mode, effective date, source, last import, history) and preserves §64's family grouping. Its approved-only rule makes this catalog distinct from the private import-job queue and keeps M8 structured-data work separate. The original versioning requirements call for old versions to remain visible for history while normal answers use current/effective rules; the catalog correctly exposes retained facts without becoming a retrieval eligibility decision.

The design correctly separates the stored `is_current` stream flag from effective dates, visibility and answer eligibility. It includes future, archived, parallel-stream and relationship documents in history, and says relationships are stored links rather than proof that an amendment is presently applicable. No catalog query may change retrieval or publication state.

The receipt-backed mode/time rule is sound: a document's mode is derived from its immutable publication receipt, never `document_families.default_storage_mode`; legacy missing receipts remain `null`/unknown. Last import time is receipt-linked original job creation time and is also unknown for legacy documents. Existing private job deletion is revoked by the retention migration, so application runtime should preserve the receipt link. Current contract tests already prove `null` remains distinct from a family's RAG default.

The security boundary is appropriately narrow: SUPER_ADMIN active authorization before parsing/queries; approved documents only; no original bytes, content, vectors, storage key/path, checksum/hash, review plaintext, or actor fields in DTOs; no URL fetch; fixed parameterized filters; private no-store headers; bounded pages/previews; and no mutation. The strict object schemas reject unknown private fields. Source URLs are metadata only; the UI must use the frozen safe-link rule and otherwise render plain text.

Counts and pagination are specified at each layer: one-snapshot list totals/page, up to five matching previews with real family count and `hasMoreVersions`, complete paginated family history, and paginated stored relationships. The full family history—not the five-item preview—is the completeness path. Actual route/PG tests still need to prove true totals, stable ordering, no hidden truncation, and correct out-of-range pages.

## Findings for root adjudication

### P2 — Search schema does not implement the frozen trim rule

The API design says `q` is optional **trimmed** 1–120 Unicode characters (`KNOWLEDGE_CATALOG_DESIGN.md:19`). The current schema at `lib/knowledge/catalog-types.ts:10` uses `z.string().min(1).max(120).nullable()` through `nullableText`; it accepts whitespace-only strings and preserves leading/trailing whitespace. The six contract tests reject an overlong query but do not cover trim behavior (`tests/knowledge-catalog-contract.test.ts:22-24`). A whitespace-only query can become a literal no-match filter instead of the specified empty/invalid query behavior. Root should make the service/API normalization match the frozen contract and add whitespace/padded-query tests.

### P2 — DTO schemas do not reject cross-family identities; document identity needs request binding

The frozen DTO contract says cross-family/document results are rejected (`KNOWLEDGE_CATALOG_DESIGN.md:25`), and the UI contract requires abort/serial protection so an old detail never renders below a newly selected family. The current shapes are strict but not relationally refined:

- `familyPreview` accepts any `versionsPreview[].familyId` (`catalog-types.ts:15`); it does not require each summary's `familyId` to equal the enclosing family id.
- `historyEnvelopeSchema` accepts history summaries whose `familyId` differs from `history.family.id` (`:17`).
- `documentEnvelopeSchema` (`:21`) has no requested UUID in the response shape, so a response for document A can parse while the selected route/id is document B.
- The six contract tests cover strict keys, bounds, legacy nulls and basic summary validity, but no cross-family identity or stale-selection case (`knowledge-catalog-contract.test.ts:8-24`).

Add family-identity refinements to catalog/history parsing and an expected-request-ID comparison for document detail, with tests for mismatched family/document responses. At the UI boundary, preserve the design's abort/serial fencing and compare the resolved family/document IDs before assigning/rendering state; schema checks alone cannot protect against a late but otherwise valid response.

### P2 — The `supersedesDocumentId` field needs the same endpoint visibility rule as relationships

Document detail explicitly returns `supersedesDocumentId` (`KNOWLEDGE_CATALOG_DESIGN.md:23`), while the same contract says only stored links whose other endpoint is approved may be exposed. The schema at `catalog-types.ts:21` accepts the UUID without proving its target is approved. If this FK can reference an unapproved document, returning it reveals an otherwise hidden endpoint identifier and bypasses the approved-endpoint filter used for relationship items. Root should either return null unless that target is approved, or explicitly state why the bare ID is permitted; test both visible and hidden-target cases. This is a contract ambiguity, not a claim that a leak currently occurs (there is no catalog service yet).

The `totalRelationships` predicate should likewise count only the approved-to-approved links represented by the endpoint. Counting filtered-out/unapproved links would leak their existence through a number even if their IDs are omitted. The frozen phrase “true count” should mean the true count of the caller-visible relation set, not all raw links.

## Acceptance checks still needed in CAT-01/CAT-03

1. Auth tests prove anonymous and both staff roles are denied; SUPER_ADMIN is revalidated before malformed UUID/query parsing and before private family/document reads. Fixed errors/headers, duplicate/unknown query keys, and `q` normalization are exercised through real routes, not only schema helpers.
2. Real local PG proves only `approval_status='APPROVED'` enters inventory/history; records retain exact status/current/visibility/effective dates; current flag is not recomputed; future/expired/history and stored links are not relabeled as applicable. Missing/legacy publication receipt produces `storageMode=null,lastImportAt=null`, without default-mode fallback. Receipt-backed documents use the linked receipt/job, not another job from the same family.
3. Pagination integration checks page/count from the same snapshot; stable ordering; exact `totalFamilies`, `totalDocuments`, per-family `documentCount`, `hasMoreVersions`; all family history pages; and visible-link `totalRelationships` across page boundaries. Page number beyond the end is empty while counts remain real.
4. DTO tests reject preview/history family mismatches and expected document-ID mismatch; UI tests delay the response for selection A until after selecting B and prove no A data appears under B, including detail relationships.
5. URL rendering tests cover HTTPS without URL credentials, unsafe protocols, embedded userinfo, and any credential-like query handling chosen by root. DTO URL strings remain inert metadata and are never fetched.
6. Ensure total/department options/status filters follow the frozen approved-only semantics. If a status filter value cannot occur on an approved document, the UI should still show a truthful empty result rather than silently removing the filter or widening visibility.

## Verdict and limits

The frozen catalog scope is complete enough to implement and does not reduce master §46/64 or the original versioning requirement. Current DTO contracts are directionally aligned on private metadata, null legacy provenance, current/effective separation, bounded previews and paginated history. Resolve the query trimming and identity-binding gaps above before treating the response schemas as satisfying the frozen cross-selection contract. Clarify the visibility meaning of `supersedesDocumentId` and relation totals before route acceptance.

No route/service/migration/UI implementation exists in the reviewed tree at this checkpoint; I therefore cannot report runtime authorization, SQL filter correctness, exact count behavior, browser race handling, or database acceptance. Root owns those implementation and acceptance gates.

## CAT-01 DTO regression follow-up

Date: 6 October 2026. Per root's narrow ownership, I changed only `lib/knowledge/catalog-types.ts` and `tests/knowledge-catalog-contract.test.ts`, then appended this evidence. New test-first cases initially produced four expected failures: padded query text was retained, a cross-family preview parsed, inconsistent preview counts parsed, and the requested-ID parsing helpers were absent. After the minimal schema/helper implementation, `pnpm exec vitest run tests/knowledge-catalog-contract.test.ts` passed 1 file / 11 tests. `pnpm exec eslint lib/knowledge/catalog-types.ts tests/knowledge-catalog-contract.test.ts` passed with no diagnostics.

The DTO schema now trims `q` and rejects whitespace-only search. Family previews require every preview summary to carry the enclosing family ID and require exactly `min(documentCount, 5)` previews with `hasMoreVersions === (documentCount > 5)`. Catalog totals cannot be smaller than the visible family/document counts; history summaries must match the enclosing family and history totals/page size must cover the returned page; relationship totals/page size must cover the returned page. New pure exports `parseCatalogHistoryForFamily(input, expectedFamilyId)` and `parseCatalogDetailForDocument(input, expectedDocumentId)` return `null` on malformed DTOs or requested-ID mismatch. A regression keeps legacy `storageMode`/`lastImportAt` explicit null even when the family default is BOTH.

This does not implement approved-endpoint privacy filtering, routes/service/database queries, pagination echo, or UI stale-response fencing; root owns those contracts. The UI agent was told the helper signatures and should retain its family-selection check because the detail helper intentionally binds only the requested document ID. No routes/DB/browser/full-suite checks were run by this scoped change.
