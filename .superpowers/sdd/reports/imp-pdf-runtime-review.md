# PDF supervised runtime review — IMP-02D-PDF

Date: 6 October 2026
Verdict: **Scoped parser/runtime PASS on deterministic fixtures; M7 and real-corpus PDF acceptance remain partial.**
Source checkpoint: `05da65c46f27d1df7d2312cd7a45fa4b1e446cfb` (`HEAD`).
Reviewer: delegated read-only agent `/root/m7_pdf_runtime`, separate from the PDF implementation work. This report records this scoped review only; it does not claim a second external audit.

Requirements reviewed: CH043, CH035/036/048/061 and USR-IMPORT5. Relevant contract: [Knowledge Import design](../../../docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md), especially bounded child parsing, PDF page/block/table locations, unresolved quality warnings, and the requirement to keep scanned/low-text material in review.

## Findings

The supervised route works end to end for the generated PDF fixtures. `parseImportSource` verifies and encodes the source, starts the checked-in child, and validates its response; the child dispatches PDF bytes to `parsePdfSource`. The added test exercises that process path without mocking the child or parser.

The two-page fixture returned both expected text passages, page locations, one verbatim ruled table and its one-based table location. The report identified `pdf-parse` 2.4.5, exact input byte length, page/table/cell counts, measured text characters and `truncated: false`. The detected table retained an unresolved `TABLE_SHAPE_REVIEW` warning.

The image-only fixture returned no extracted text and kept `OCR_REQUIRED`, `LOW_TEXT_QUALITY` and `PAGE_REVIEW_REQUIRED` as unresolved page-one review evidence; no OCR result was claimed. The malformed fixture returned only the fixed `IMPORT_PARSER_FAILED` error through the process wrapper. Existing direct-parser cases also confirm the parser is destroyed after malformed input and cover replacement-character and size-limit evidence.

No actionable parser or child-dispatch defect was found in the exercised path. One location-granularity note remains for integration review: `TABLE_SHAPE_REVIEW` is counted and attached to a page location, while the table itself has a separate indexed location. That matches the current per-page warning contract, though a preview that needs to jump directly to one of several tables on the same page would need a table-indexed warning.

## Checks run

With Node from `C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` and pnpm from `C:\Users\NOTEBOOK\AppData\Roaming\npm`:

- `pnpm exec vitest run tests/import-pdf-parser.test.ts tests/import-parse-source-pdf.test.ts --maxWorkers=1` — **2 files, 10 tests passed** (Vitest duration 13.02s).
- `pnpm exec eslint tests/import-parse-source-pdf.test.ts` — **exit 0**, no diagnostics (completed after about 68 seconds).

The first command covers the existing in-process PDF parser suite and the new actual-child cases in [import-parse-source-pdf.test.ts](../../../tests/import-parse-source-pdf.test.ts). No full suite, typecheck, build, live source fetch or database/API/UI test was run for this scoped review. No production file was changed.

## Limits and remaining acceptance

Fixtures are synthetic ASCII PDFs from [import-pdf.ts](../../../tests/fixtures/import-pdf.ts), including a minimal one-pixel image for the scan-like case. They do not establish behavior on actual YRU PDFs, Thai font encodings, broken-font samples, varied scanned documents, or real table layouts; OCR is not implemented. The runtime test proves the fixed child dispatch and response validation, not production process supervision. As the design states, a Node heap cap is not an RSS or OS sandbox, so deployment CPU/RSS/network/filesystem supervision remains pending.

Extraction persistence, encrypted-original retention after parser failure, review/edit UI, warning disposition, publication, chunk-location persistence, citation/delivery equality and the all-format Flow A–F acceptance remain outside this report. The repository's earlier combined 1197-unit checkpoint was not rerun here and is not claimed as this review's evidence.
