# IMP-03B-2 / Task4C-2 — independent located chunk helper review

6 October 2026. Read-only source review against the frozen Task4C-2 contract in `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md` (lines 210–212) and root-owned `lib/knowledge/located-plan-types.ts`. Reviewed the current helper and tests after the builder reported its TypeScript narrowing and scanned-empty fixes. Base workspace commit: `33710b7009ace1566a4ab6fcccabd601e16efa35`; implementation/test files are untracked working-tree additions.

## Scope and findings

Reviewed `lib/knowledge/located-plan-types.ts`, `lib/knowledge/located-chunk-plan.ts`, `tests/knowledge-located-chunk-plan.test.ts`, and the existing `validateLocatedExtraction` / `sourceLocationSchema` as dependencies. No product or test files were changed. No scoped correctness finding.

- Input validation verifies the immutable source and parses a copied, format-consistent located extraction before counting. It enforces the fixed E5 model/revision/dimension/fingerprint and strict UUID/extraction revision. The pure helper imports no database or embedding-vector implementation and returns no vectors; its only model capability is the typed passage counter.
- Narrative chunks use exact UTF-16 half-open page slices. Paragraph/heading-aware splits precede grapheme fallback; overlap is limited to adjacent work in the same heading segment and is represented by an exact UTF-16 prefix length. The final overlap-inclusive text is byte-checked and recounted before drafts/digest are returned. Empty parser placeholder pages are skipped so separate tables remain usable; nonempty whitespace-only pages and valid scanned-empty/no-table extractions fail closed.
- Table drafts serialize each original row as a JSON string array with its original row number, retaining cell order and blanks. Splits occur between rows. Coverage ranges are inclusive zero-based offsets within the table. CSV/XLSX location narrowing uses `table.firstRow + row offset` while spreading the original location, preserving its proven column range and other coordinates. PDF/DOCX/HTML retain their parser-provided table location.
- Count batches are capped at 16, raw input at 6,000 UTF-8 bytes, final passages at 512 tokens, plans at 2,000 chunks, and operation time at the configured maximum of 45 seconds. Cancellation/timeout races settle even if the injected counter ignores cancellation; malformed counter output fails with a fixed error and no plan is returned. The digest includes source checksum, binding, fixed E5 identity, ordered text, coverage, locations, counts, review flags, and copied warnings.
- The builder calls only `countPassageTokens`; it has no encode/vector or download call. Its fixed production adapter uses the local `/tokens/count` API. Offline-cache model startup/live inference was not run here; that gate remains with root.

One nonblocking fixture limitation: the all-format table tests use row/column origins of 1. Source review confirms non-1 CSV/XLSX row origins are offset from `firstRow` and original column coordinates are retained, but no focused assertion currently exercises a sparse/non-1 row-and-column origin.

## Verification

Using the bundled Node runtime and pnpm on PATH, after the builder completed its fixes:

- `pnpm exec vitest run tests/knowledge-located-chunk-plan.test.ts` — 1 file, 23/23 tests passed.
- `pnpm exec tsc --noEmit` — exit code 0.

No live E5 model/service request, offline-cache gate, full suite/build, publication integration, or global V1/Flow A–F acceptance was run or is claimed. The builder's separate implementation report records its own scoped checks; those are not attributed to this independent run.
