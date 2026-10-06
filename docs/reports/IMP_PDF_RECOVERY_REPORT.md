# IMP-PDF-01 — retained PDF Analyze/Preview recovery

6 October 2026, Asia/Bangkok. Root repaired the two actual user-reported failures after parent source `521d7185b6ee0a5a36cab5dafbd5fd404af4aaa2`. Status **COMPONENT_PASS** for retained extraction recovery. Requirements CH043/049 and original/history retention; [execution scope](../superpowers/plans/2026-10-06-yru-import-publication.md). This report approves no university document and does not certify OCR or every table's semantic correctness.

## Cause and change

The reported Preview409 job had no extraction after failed parsing. Its 105,655-byte one-page original decoded text successfully, but installed `pdf-parse@2.4.5` table geometry dereferenced a missing bottom line. The separate 1,891,757-byte 28-page Analyze400 input decoded successfully but returned a zero-row table and zero-cell rows that the adapter rejected. Neither failure exhausted configured byte/page/heap/time ceilings.

`lib/imports/pdf-parser.ts` now detects tables per physical page using the installed partial-page API. A table-stage exception retains independently decoded page text and other pages' successful tables, with unresolved blocking table/page review evidence. Empty table/row geometry is skipped explicitly with located warnings while all nonempty rows and every exact cell, including empty-string cells, remain. Nonempty runs separated by empty detector rows are separate fragments, each with its actual firstRow, so later UI/chunk row labels do not shift. Invalid types, incorrect page results, oversized content and cancellation still fail; no limit was increased. Original bytes, history, publication policy and migrations are unchanged.

## Verified results

Root regression-first tests failed for both actual geometry patterns before the repair, then passed. The direct PDF suite has 9 tests, and 3 supervised parser-dispatch tests make the focused 12-test gate. Actual Luna max independently re-read source and ran the direct 9 tests and scoped ESLint, finding no remaining scoped blocker. Its [diagnosis/review](../../.superpowers/sdd/reports/imp-pdf-diagnosis.md) clearly separates reviewer and root evidence.

Root recovered both immutable originals through authorized DEVELOPMENT access into ignored diagnostics, reproduced their bounded-child failures, then re-parsed the exact same bytes with the repair. Root signed in through actual DEVELOPMENT Auth and called the compiled application's Analyze, Preview, original download and publication receipt APIs. After the final row-ordinal refinement, root repeated bounded exact-original parsing and authenticated recovery on the rebuilt application. Both Analyze and Preview returned HTTP200; the table below is the final run:

| Retained input | Physical pages | Retained tables / cells | Preview state | Original byte comparison | Publication |
|---|---:|---:|---|---|---|
| Reported Preview input | 1 | 0 / 0 | READY, unresolved table warnings | Exact equality | No receipt |
| Latest Analyze input | 28 | 40 fragments / 122 | READY, unresolved geometry/page warnings | Exact equality | No receipt |

Both jobs advanced from revision1 to2 on first recovery and3 on final re-analysis, retaining earlier extraction history; originals were not replaced. The larger input's nonempty cell count remains122. Its40 contiguous fragments preserve rows from34 nonempty detector tables, separated at empty row gaps so ordinals stay faithful. All22,232 measured characters (20,389page text plus1,843table-cell characters) remain. Its63 warning entries include repeated located review evidence, not63 failed pages. The one-page input retains all1,093 decoded text characters; no table is claimed where detection failed.

Commands/evidence: independent final direct9PDF tests passed; whole-source `pnpm test --maxWorkers=1` passed1,439tests/93files including3supervised PDF tests after the row-ordinal refinement. Scoped ESLint, full lint, TypeScript and optimized Next build passed on final source. `pnpm test:db` passed187realPG tests plus foundationRLS before this parser-only refinement; DB/auth/publication contracts were unchanged afterward. The build compiled both existing LINE routes and new approval/receipt routes. Ignored original re-analysis and authenticated HTTP recovery scripts/results remain under `.superpowers/staging/import-preview/`; no source text, filenames, originals, credentials or private IDs are copied into this report.

An initial HTTP runner attempt failed after the user stopped the development server; a second attempt timed out because its login selector did not match the actual label. Root corrected the harness selector, started the owned compiled server and obtained the actual successful HTTP results above. These failed attempts were harness/runtime failures and were not counted as acceptance.

## Remaining scope

Root observed an additional ordinal-gap RED before final fragment refinement. A focused run concurrent with browser/E5 activity timed out the existing20s oversized-text PDF fixture after11/12 tests passed; the whole suite then passed with one worker without changing ceilings or assertions. One bounded original-recovery attempt returned fixed IMPORT_PARSER_FAILED during concurrent test activity; a subsequent separate run and rebuilt authenticated HTTP recovery passed both originals. Its transient process cause was not proven and is not claimed as a diagnosed parser defect. Safe failure retention and retry remain part of the bounded parser contract.

Reload the import page to view the recovered extraction; another upload is unnecessary. Review warnings against the retained original before publication. Low-quality tables remain explicit unresolved evidence; this repair performs no OCR and does not waive quality or publication gates. Real corpus review, M8 structured mapping, live generation/LINE and final V1 flows remain separately pending.
