# Import source, analysis and CSV — 5 October 2026

Historical first-slice evidence. Newer acquisition/staging/API checks are recorded in [combined component checkpoint](IMP_ACQUISITION_STAGING_COMPONENT_REPORT.md); current status belongs to the task board. The pending statements below describe this earlier source checkpoint, not the later implementation.

Status: **PARTIAL / COMPONENT_GREEN** for IMP-01A/02A and CSV parsing. M7 import/staging/storage/review/publication is incomplete. Scope follows [Import design](../architecture/KNOWLEDGE_IMPORT_DESIGN.md) and [execution plan](../superpowers/plans/2026-10-04-yru-knowledge-import.md), with all five formats and amendments retained.

Root created source/types/analyzer/CSV/located-extraction modules and four behavioral test files. Source validation copies original bytes, computes immutable SHA256, bounds originals, verifies format/container/media/filename/provenance and checks checksum again at parsing/analysis. Office ZIP sniffing is preliminary; no DOCX/XLSX parser acceptance is claimed. Browser empty/generic/legacy CSV media types canonicalize only after format/content checks. Official URL provenance validates suffix boundaries and refuses credentials/private IP/nonHTTPS/non443, but actual DNS/pinned acquisition has not been implemented.

Analyzer returns conservative reviewed proposals, never approval/current state, dates/authority from fetch time, arbitrary SQL or provider calls. Fixed seven-dataset candidates default to RAG when their mapper is uninstalled; exact table strings remain available for later review. Sensitive categories and quality/provenance/year/family ambiguity warnings keep PENDING_REVIEW. This risk detector is not proof that all personal data is absent.

CSV parser preserves exact quoted/multiline/escaped/blank cells and logical row/column references; never casts fees/dates or evaluates formulas. It bounds characters/cells/rows/columns during parsing, rejects malformed quotes and flags formula/ragged-row review. Located output retains parser version, measured input/text/page/table/cell/replacement counts and unresolved warnings. Central validation rejects cross-format/omitted/range-invalid locations, inconsistent measurements, truncation and parser-supplied reviewer dispositions. These references are not yet persisted through chunks/citations; that remains a publication gate.

## Evidence and provenance

- Root RED→GREEN: initial missing source/analyzer modules; CSV stub positive failures; source host/proved-page/ragged-row negative failures; located-report stub failures; upload media auto-detection RED. A malformed formula fixture was corrected to properly quoted CSV rather than weakening grammar.
- Fresh `pnpm exec vitest run tests/import-source.test.ts tests/import-analysis.test.ts tests/import-csv-parser.test.ts tests/import-extraction.test.ts`: **41/41 tests, 4 files, exit0**.
- Fresh `pnpm typecheck`: exit0. Targeted ESLint for these source/test files: exit0.
- Luna max `/root/prv_compatible_review` read-only [contract review](../../.superpowers/sdd/reports/imp-contract-review.md): initial gaps in private original/access/location/warnings/catalog/cancellation/resource limits were incorporated into design. Its earlier independent source/analyzer/CSV37tests are a dated subset; final located validation is root evidence, not independently reviewed.
- Pinned parse5@8.0.1 installed after checking [primary parser API](https://parse5.js.org/functions/parse5.parse.html); lockfile updated. HTML parser is delegated in explicitly owned files, still pending; installed dependency does not prove HTML parser acceptance.

## Remaining gates

HTML/PDF/DOCX/XLSX actual parser fixtures, bounded child supervisor/termination and archive expansion guards; official pinned acquisition/redirect/decompressed limits and original/final provenance; private Storage/DB staging/original streaming and access audits; reviewed metadata/version/conflict/AMENDS/CANCELS/publication locks; source locations through chunks/dataset citations; all19 family seed coverage; import/list/detail UI and three-role browser; final source full regression/replay/DEV sync. No new schema/API/UI/storage backend was created in this pure slice and no university document was approved. Full provider919unit/92PG/build evidence applies to the preceding pushed checkpoint, not automatically to these later edits.

Production parser OS RSS/CPU/network/filesystem supervision remains explicitly pending; Node heap/child limits alone do not establish it. Root continues implementation while human live keys/corpus/OA gates remain deferred. Complete V1 remains active.
