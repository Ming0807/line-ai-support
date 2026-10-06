# IMP-03B-2 / Task4C-2 — located chunk plan

Date: 6 October 2026
Status: scoped pure-helper GREEN; root type/build and integration acceptance remain pending.
Owner: `/root/located_chunk_builder` (three-file implementation scope).

## Scope

Implemented the no-vector `buildLocatedChunkPlan(source, extraction, binding, counter, options?)` helper under the frozen Task4C-2 contract. It validates the immutable source and located extraction with `verifyImportSource` / `validateLocatedExtraction`, checks the UUID/extraction revision and exact local E5 model/revision/dimension/fingerprint before any count request, and never encodes vectors, writes SQL, approves, or publishes.

The helper consumes narrative pages and separate tables. Narrative drafts use exact UTF-16 source slices with half-open `[start, end)` coverage. Overlap stays inside the same page heading section and is declared as a UTF-16 prefix length; the complete overlap-inclusive passage is recounted before return. Text and whitespace on nonblank narrative pages are reconstructed exactly after removing declared overlap. An explicitly nonempty whitespace-only page fails closed because the raw counter contract cannot count it; empty parser placeholder pages remain empty and do not hide table rows. A valid scanned-empty extraction (all pages empty, `LOW_TEXT_QUALITY`, and review required) fails closed with `KNOWLEDGE_PLAN_INPUT_INVALID` rather than yielding an empty plan; table-only evidence remains usable when tables are present.

Tables render each source row deterministically as `row N: ${JSON.stringify(row)}`. JSON string arrays retain cell order and empty cells without inferring a header. Rows remain atomic; groups split only between rows. CSV/XLSX locations narrow only the proved inclusive row span, leaving parser-provided columns and other format locations unchanged. Empty-page CSV/XLSX extractions still produce table drafts.

Parser warnings are copied to the plan, page review flags are retained, and relevant warnings set draft `requiresReview`; a warning with no location applies conservatively to every draft. Any page review flag conservatively marks table drafts for review as well. This helper's review signals do not resolve warnings or authorize publication. All returned bindings, warnings, locations and draft arrays are newly created values.

The plan digest is SHA-256 over the fixed chunker/E5 identity, job and extraction binding, source checksum, ordered draft text/token count/coverage/locations/compatibility fields/review state, and copied parser warnings. Narrative and table candidates are sent to the injected counter in batches of at most16, with the 6,000-byte request bound and 512-token final limit. The operation uses a maximum45-second deadline, passes remaining time and caller cancellation to the counter, and races the counter promise so an ignored abort cannot return a partial plan.

Compatibility `sectionTitle` values are capped at180 UTF-16 code units on grapheme boundaries to fit the current citation validator. The original page text and full parser `headingPath` remain unchanged in their source evidence. Root review also prompted explicit TS narrowing for untrusted numeric options and local narrowing of the preceding work item before page-overlap calculation.

## Evidence

- RED: `pnpm exec vitest run tests/knowledge-located-chunk-plan.test.ts` — failed before implementation with `Cannot find module '../lib/knowledge/located-chunk-plan'`; 0 tests ran.
- GREEN: `pnpm exec vitest run tests/knowledge-located-chunk-plan.test.ts` — 1 file, 23/23 tests passed after the type narrowing and scanned-empty regression fix.
- Scoped lint: `pnpm exec eslint lib/knowledge/located-chunk-plan.ts tests/knowledge-located-chunk-plan.test.ts` — exit0, no warnings or errors.
- Typecheck: `pnpm typecheck` — exit0 (`tsc --noEmit`).

The focused fixtures cover all five table location kinds, empty narrative pages with separate tables, blank table cells, CSV/XLSX row narrowing, exact page reconstruction and overlap, section/page boundaries, dense Unicode and UTF-8 byte splitting, final recount, deterministic digest binding, warning/review copying, UUID and E5 identity rejection, malformed counts, counter batching, chunk limits, and deadline/cancellation with a counter that never settles.

## Remaining acceptance

Root owns final typecheck/build, integration review, and the actual offline-cache/HTTP E5 and supervised format fixtures. No live embedding service or model was called from this task. Task4C-3 review-bound preview, vectors, persistence, citations and publication remain separate required work; this report is not publication, corpus, M7 or V1 acceptance.
