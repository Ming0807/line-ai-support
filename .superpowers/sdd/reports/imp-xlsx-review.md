# IMP-02C XLSX review — 5 October 2026

**Reviewer:** Luna max, read-only IMP-02C-REVIEW
**Scope:** `lib/imports/xlsx-parser.ts`, `tests/import-xlsx-parser.test.ts`, and the generic Office/XML package boundary assumptions.

## Result

The parser follows workbook sheet relationships and their declared order, resolves optional shared strings and styles by relationship, validates explicit row/cell coordinates and rejects duplicates, out-of-range references, malformed cell types and sparse ranges that exceed output limits. It preserves Thai/rich/inline strings and the stored numeric text (including leading/trailing zeros) without evaluating formulas, applying locale formatting, or converting date serials. Formula caches remain literal and produce unresolved blocking `FORMULAS_PRESENT` warnings. Hidden sheets/rows/columns and default-hidden rows produce blocking review warnings; merged ranges, external links and unknown parts/features also remain review evidence. Table/page locations retain sheet name/index and row/column bounds. Strict and Transitional namespaces are covered.

Two silent-loss gaps were reproduced against generated package bytes. First, an inline string `<is>DROP<t>KEEP</t>DROP</is>` returned `KEEP` with no warning because the original helper ignored direct text children; the same behavior applied to shared strings. Second, `cellXfs` number-format inspection ignored the referenced `cellStyleXfs` record and `applyNumberFormat`, so a cell inheriting `numFmtId=14` returned `45292` with no review flag. Microsoft’s primary [MS-OI29500 `xf` description](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/68362a4b-5589-4504-b566-e8154dce1de3) documents that a false `applyNumberFormat` lets the cell format inherit from its referenced cell style.

Both fixes are now in the current implementation. `container()` rejects non-whitespace text in structural and rich-string containers instead of silently dropping it. Style processing reads bounded `cellStyleXfs`, validates `xfId` and the boolean `applyNumberFormat`, and carries a nonzero applicable inherited number format into `TABLE_SHAPE_REVIEW`; it still returns the exact stored cell string and does not format it. Regression tests cover both cases.

## Verification

- `pnpm exec vitest run tests/import-xlsx-parser.test.ts --maxWorkers=1`: **1 file, 30 tests passed** on the current source.
- `pnpm exec eslint lib/imports/xlsx-parser.ts tests/import-xlsx-parser.test.ts`: **passed with no warnings**.
- XML/package dependency run: `pnpm exec vitest run tests/import-safe-xml.test.ts tests/import-office-package.test.ts --maxWorkers=1`: **2 files, 41 tests passed**.
- The direct-text-loss case was observed to return `cell="KEEP", flags=[], warnings=[]` before the fix. The inherited-format case was observed to return `cell="45292", flags=[], warnings=[]` before the fix. Current regression tests reject the former and require the latter to carry `TABLE_SHAPE_REVIEW` while preserving `"45292"`.

## Limits

The parser records nonzero direct/inherited number formats for review; it does not implement Excel rendering or interpret custom format strings. It returns cached formula values only with blocking review evidence and never evaluates formulas. Unsupported/unknown content blocks clean extraction through unresolved warnings or a fixed parse error, depending on whether its structure can be safely traversed. No workbook content is fetched or executed.

XML parsing is synchronous inside the package call, so an `AbortSignal` cannot interrupt an individual parse. The bounded parser child, timeout/termination, and deployment resource supervision remain separate gates. This is component review evidence only; DOCX parser, all-format dispatch, staging, citations through the UI, review/publication, and full M7 acceptance are not inferred from these tests.
