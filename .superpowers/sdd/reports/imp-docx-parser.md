# IMP-02C-DOCX parser checkpoint

Date: 5 October 2026
Owner: `/root/docs_provider_review` (Luna max assignment)
Requirements: CH036, CH048, CH061, USR-IMPORT5
Status: parser component GREEN; root integration review and full-project typecheck remain pending.

## Result

Added `parseDocxSource(source, signal?)` in `lib/imports/docx-parser.ts`. It verifies the immutable source, consumes the root-owned `readOfficePackage` API, and selects the Word main story by validated content type and package relationship rather than assuming `word/document.xml`. Transitional and Strict WordprocessingML namespaces are supported.

The parser walks direct body paragraphs and tables in source order. Each body block has a stable DOCX `blockStart`/`blockEnd` location and current heading path; page numbers remain `null` because DOCX layout is not rendered. Tables retain exact physical cell strings, blank cells, tab characters, and paragraph breaks. It recognizes built-in heading names, related style outline levels, inherited heading styles, and hidden character/paragraph styles. It preserves `w:t`, tabs, line breaks, carriage returns, nonbreaking hyphens, and soft hyphens without normalizing source text.

Fields are not evaluated. Paragraphs containing field markup or complex moved-revision ranges are withheld with unresolved `HIDDEN_DATA_REVIEW`. Hidden runs and inserted/deleted revisions are withheld and warned. Media is not OCRed and receives `OCR_REQUIRED`; merged cell properties, ragged rows, and explicit page-break hints receive shape or page-review warnings. Nested tables and unsupported table/body wrappers are not flattened into clean text. External relationship targets remain unavailable through the package API and are never fetched; the extraction records `EXTERNAL_LINKS_REVIEW`. Related header/footer/footnote/endnote/comment stories are not merged into body text and cause a blocking review warning. Empty or fully withheld bodies receive `LOW_TEXT_QUALITY` and remain marked for review.

Output is checked by the shared extraction schema and `validateLocatedExtraction`. Parsing fails with fixed `IMPORT_PARSE_INVALID` on wrong format, malformed package/XML, abort, schema mismatch, or exceeded page, table, row, cell, column, per-cell, and character limits. No network, filesystem access, subprocess, external fetch, or AI call is introduced. Production parser-child isolation remains a separate IMP-01B-CHILD gate.

## Evidence

The initial test-first RED run was `pnpm exec vitest run tests/import-docx-parser.test.ts --maxWorkers=1`; it failed because `lib/imports/docx-parser` did not exist. Added generated ZIP fixtures using the shared `tests/fixtures/import-office.ts` and ZIP byte generator. Follow-up RED cases exposed missing handling for styled hidden text, move-revision ranges, and unsupported table wrappers; the implementation was corrected before the final GREEN run.

Final focused checks:

- `pnpm exec vitest run tests/import-docx-parser.test.ts --maxWorkers=1` — 1 file, 18 tests passed.
- `pnpm exec vitest run tests/import-docx-parser.test.ts tests/import-office-package.test.ts tests/import-safe-xml.test.ts --maxWorkers=1 --testTimeout=15000` — 3 files, 60 tests passed.
- `pnpm exec eslint lib/imports/docx-parser.ts tests/import-docx-parser.test.ts` — passed with no warnings.
- Focused strict typecheck over the parser and its test passed:
  `pnpm exec tsc --noEmit --strict --target ES2017 --lib "dom,dom.iterable,esnext" --esModuleInterop --skipLibCheck --module esnext --moduleResolution bundler --resolveJsonModule --isolatedModules lib/imports/docx-parser.ts tests/import-docx-parser.test.ts`.

The shared safe-XML stress test that parses 200,000 CDATA segments exceeded Vitest’s default five-second per-test timeout once while checks were running concurrently. The same three-file suite passed with a 15-second test timeout; no parser or safe-XML code was changed for that timeout.

An earlier project-wide `pnpm exec tsc --noEmit --pretty false` run was blocked by malformed generated `.next/dev/types/validator.ts` (TS1109, lines 63–67). Root regenerated the installed Next-generated types after that snapshot; the project-wide integrated typecheck is root-owned and is not claimed here. No full suite, build, database test, live provider call, or production runtime isolation test was run by this slice.

## Remaining review boundary

Root’s integration review found and test-first coverage now resolves these additional cases: non-whitespace text directly inside body/paragraph/run or element children inside `w:t` is rejected with the fixed error; foreign-namespace body markers are warned, and foreign table/row/cell children generate blocking unsupported-content warnings; extracted U+FFFD replacement characters produce `LOW_TEXT_QUALITY` with measured count/location; `docDefaults` hidden runs are withheld with blocking `HIDDEN_DATA_REVIEW`; wrong-root and duplicate-ID styles parts are rejected instead of silently ignored. These follow-up RED fixtures produced eight failures before the fixes, then passed in the final 18-test DOCX suite.

The component tests cover main-part selection through the package API, Transitional and Strict namespaces, generated body-order paragraphs/tables, heading/style relationships, tabs and breaks, hidden/default styles, tracked revisions, fields, media, external relationships, header-story warning, merged/nested table warnings, malformed/wrong-format input, structural and foreign namespace content, replacement characters, style-part ambiguity, and output limits. Root still owns shared API integration, report/board/matrix status, end-to-end staging and child-process acceptance. Parser success does not establish review/publication safety without honoring the returned unresolved warnings and locations through staging and citations.

The Word body/paragraph/run structure follows Microsoft’s [WordprocessingML structure guide](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document); table cell and row elements follow Microsoft’s [WordprocessingML tables guide](https://learn.microsoft.com/en-us/office/open-xml/word/working-with-wordprocessingml-tables). These sources describe the markup model; parser behavior and limits are verified by the local generated-ZIP tests above.
