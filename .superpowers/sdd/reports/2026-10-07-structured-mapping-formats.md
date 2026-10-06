# STR-01B-0 — synthetic mapping format tests

Date: 2026-10-07
Task: STR-01B-0, scoped Luna high fixture and format test work
Parent source checkpoint: `ff4c3b9`
Status: scoped format test and lint pass

## Scope and provenance

This report covers only `tests/fixtures/structured-mapping.ts` and `tests/structured-mapper-formats.test.ts`. The fixture factory uses `createImportSource` and manually constructs `LocatedExtraction` values with `report.parser.name = "synthetic-mapping-fixture"`. It does not invoke or claim execution of PDF, DOCX, XLSX, CSV, or HTML parsers. CSV fixture bytes and extraction cells include a quoted CRLF multiline logical record. XLSX table locations use worksheet row 9 and column D origins.

The tests exercise all seven fixed payload datasets in each of five accepted source format labels, source-cell versus labelled-constant evidence, exact per-format row and column coordinates, Buddhist date conversion, comma-grouped decimal lexeme preservation (`1,234.50` → `1234.50`), fixed +07 timestamp conversion, review-revision artifact binding, canonical mapping order, deterministic digests, and detached frozen output.

## Checks

After the root mapper and contract modules appeared, the first scoped run passed; no behavioral RED was observed in this delegated test file. The root's own focused mapper tests established its RED before implementation.

- `pnpm exec vitest run tests/structured-mapper-formats.test.ts` — exit 0; 1 file / 39 tests passed.
- `pnpm exec eslint tests/structured-mapper-formats.test.ts tests/fixtures/structured-mapping.ts` — exit 0; no diagnostics.

No whole-project typecheck, full suite, build, DB or browser command was run under this delegated scope. Dataset-union payload assertions use structural matchers to avoid unguarded field access.

## Limits

No parser execution, source-original equivalence, database/schema installation, HTTP/UI route, approval, publication, retrieval, atomic mode, or V1/Flow A–F acceptance is asserted. Only the parent/root can resolve contract mismatches or claim integrated acceptance.
