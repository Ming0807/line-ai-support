# IMP-01/02 import contract review

Date: 2026-10-05
Reviewer: `/root/prv_compatible_review`
Scope: source-grounded review of the import requirements, updated design, and current source/analyzer/CSV helper contracts. I changed only this report. No DB, storage, authenticated API, live URL, AI, PDF/DOCX/XLSX/HTML parser, or publication acceptance was exercised.

## Status

The revised [knowledge import design](../../../docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md) now resolves the major design questions from the first review: it specifies the private `OriginalRef` and access audit, a per-format source-location union, warning/report metadata, all seven dataset identifiers and 19 initial families, whole-document `CANCELS` behavior, and the Node heap/RSS distinction plus full DNS-answer and redirect/body limits. The [execution plan](../../../docs/superpowers/plans/2026-10-04-yru-knowledge-import.md) now points to the shared all-format source type and labels PDF/HTML as a partial first slice. Those are sound design resolutions; code, database, storage, retrieval, and browser acceptance remain pending.

The current shared code contains `types.ts`, `source.ts`, `analyzer.ts`, and a custom `csv-parser.ts`. I ran:

```text
pnpm exec vitest run tests/import-source.test.ts tests/import-analysis.test.ts tests/import-csv-parser.test.ts
3 files passed; 37 tests passed
```

This is focused component evidence only. The current types still lack the revised `SourceLocation` and `ExtractionReport`; there is no PDF/DOCX/XLSX/HTML extraction, official URL fetcher, private-original staging/auth/storage, persisted location/citation path, or amendment retrieval implementation in this reviewed slice. Passing these suites does not establish format or M7 acceptance.

## Scope and sources

Read `AGENTS.md`; [project index](../../../docs/PROJECT_INDEX.md), [task board](../../../docs/tasks/V1_TASK_BOARD.md), [decision log](../../../docs/decisions/DECISION_LOG.md), master guide §§2.3–2.4, 9–11, 35–50, 61–64, [original document-versioning](../../../docs/requirements/sources/original-document-versioning.th.md) §§1–20, [system design](../../../docs/architecture/YRU_V1_DESIGN.md), requirements matrix CH035–050/061–064, current and prior import plans/design, `lib/knowledge/chunking.ts`, the existing RAG migration, and the current import source/types/analyzer/CSV files and focused tests.

The governing requirements remain all five inputs PDF/DOCX/XLSX/CSV/URL; private original retention; exact source and citation provenance; human-reviewed dates, authority, sensitivity, and publication; a fixed seven-dataset registry with unknown data preserved for review and no DDL; 19 initial family seeds; and base plus applicable active amendments. Original versioning §16 says an amendment supplements its base and retrieval returns the base plus all active amendments. The master schema includes `CANCELS`, so cancellation semantics must coexist with that rule.

## What is already represented

- `types.ts` defines formats PDF/DOCX/XLSX/CSV/HTML, fixed extraction bounds, and all seven dataset IDs: `academic_calendar_events`, `tuition_fees`, `transfer_courses`, `university_services`, `university_systems`, `service_forms`, and `announcements`.
- `source.ts` copies bytes, computes SHA-256, checks the extension/MIME pair and preliminary PDF/ZIP signatures, requires UTF-8 for CSV/HTML, and requires official YRU provenance for URL acquisition. It explicitly documents that ZIP magic does not validate an Office document.
- `analyzer.ts` returns proposals only, leaves published/effective dates and authority null, keeps review pending, preserves safe sensitivity category codes, and recommends RAG for unknown/uninstalled structured data. `csv-parser.ts` preserves literal quoted cells, embedded newlines, blank cells, and ragged rows while applying row/cell/column/output limits and warning on formulas/table shape.
- The new design resolves the formerly underspecified design gates for opaque encrypted originals and active-admin streaming audit, per-format source locations, warning dispositions and parser fingerprints, fixed catalogs, and cancellation direction. Implementation and test evidence for those contracts is still required.

## Findings for implementation and acceptance

### IMP-R1 — Match the implementation to the new provenance contract (P1)

The new design requires a discriminated location for every extracted block and requires it to survive parsing → staging → chunk/dataset → citation. Current `Extraction` instead has `pages[{pageNumber,text,sectionTitle,…}]` and `tables[{pageNumber,sectionTitle,sheetName,firstRow,rows}]`. It has no PDF block/table index; DOCX block/table index or heading path; XLSX sheet index and row/column range; CSV logical-record/column range; or HTML final URL, block and table index. The CSV parser sets `firstRow:1` for the whole table, which does not distinguish logical records when a quoted value spans physical lines. Current `ImportSource` has one `sourceUrl`, so it cannot separately preserve original acquisition URL and reviewed/final source URL as the design requires. Existing chunk storage only provides page/section fields.

Implement the agreed `SourceLocation` union and `ExtractionReport` before format parser acceptance. Preserve exact locations and the sanitized final URL through preview, edits, chunking, persistence and citation; do not manufacture DOCX pages or infer CSV record numbers from physical line breaks. Add round-trip tests for each format, quoted multiline CSV, multi-sheet workbooks, and multiple same-named HTML tables. The design is resolved; the current type and storage path do not yet implement it.

### IMP-R2 — Implement the frozen original-reference and authorization boundary (P1)

The revised design specifies `OriginalRef`, AES-256-GCM envelopes, private DB/Storage backends, no browser object access or durable signed URL, an active SUPER_ADMIN check before backend streaming, a content-free `KNOWLEDGE_ORIGINAL_READ` audit, and indefinite retention until a separately designed deletion operation. Current `ImportSource` contains bytes and provenance but no opaque reference, and this slice has no import job schema, storage backend, authorization endpoint, or audit path. The design is good; there is no implementation evidence for privacy, failure retention, key rotation, or decrypt/stream controls.

Before claiming staging complete, test guessed object IDs and ordinary-staff/browser denial, authorized streaming with no-store, failed parse preserving the original, checksum immutability across reanalysis, encryption-context mismatch rejection, and explicit audit fields. Test both configured backends if both are advertised. No public or durable signed URL should escape the backend boundary.

### IMP-R3 — Carry the revised warning and sensitivity evidence into review (P1)

The revised design adds versioned `ExtractionReport` counters and bounded warnings with location, severity, count, disposition, actor/revision/reason, and unresolved-publication blocking. Current `Extraction` has nine broad flags, but no parser/schema fingerprint, counts, warning disposition, or actor-bound resolution. The analyzer’s six safe categories are a useful start (`STUDENT_RECORDS`, `PHONE`, `PERSONAL_EMAIL`, `GRADES`, `MEDICAL`, `PERSONAL_FINANCE`), but its regexes are evidence of a heuristic, not a no-PII guarantee: student records require phrases such as “รายชื่อนักศึกษา”/“รหัสนักศึกษา”; an unlabelled person name is not detected; and emails on `yru.ac.th` are excluded from `PERSONAL_EMAIL`, even though a university-domain mailbox can still identify a person. The tests use labeled sample phrases and external-domain email only.

Keep detection as a review signal. Add adversarial and Thai fixtures for names/IDs/phones/emails, including university mailboxes; ensure no raw match appears in logs, audit metadata, preview DTOs outside authorized content, public chunks, or embedding input. Require explicit human review for source/sensitivity and unresolved extraction warnings. A false-positive disposition must not authorize detected unredacted sensitive material for PUBLIC, as the new design already specifies.

### IMP-R4 — Keep the fixed catalogs complete while treating analyzer rules as partial (P2)

All seven dataset identifiers are now in the shared type, and the design enumerates the 19 required family seeds. Current analyzer rules recognize eight family proposals: `ACADEMIC_CALENDAR`, `TUITION_FEE`, `TRANSFER_COURSE_TABLE`, `TRANSFER_REGULATION`, `WIFI_GUIDE`, `YRU_PASSPORT_GUIDE`, `SERVICE_FORM`, and `ANNOUNCEMENT`. They do not constitute the §64 19-family seed/coverage check. Dataset candidate rules cover six IDs and do not propose `university_services`. This is acceptable only while these values remain conservative proposals: unknown/conflicting family or dataset must stay unresolved/RAG and require reviewer choice. It must not be interpreted as complete catalog coverage.

Add a seed assertion for all 19 exact family codes and a fixed-code-to-installed-mapper test for all seven schemas when M8 installs them. Add analyzer coverage for `university_services` or keep it explicitly null until a safe rule exists. The old plan now correctly marks its PDF/HTML work as partial and references the canonical all-format type; retain that scope warning at the implementation checkpoint.

### IMP-R5 — Apply the new cancellation rule in resolver and retrieval (P1)

The updated design now defines relation direction (new document is source; older/base document is target), permits `AMENDS` to target a base in V1, defines `CANCELS` as reviewed whole-document/version cancellation, preserves a base when cancelling one amendment, excludes a cancelled base from active rule groups, and leaves partial/provision cancellation pending manual resolution. This resolves the earlier ambiguity at the design level.

The current helper slice has no version resolver or retrieval implementation. Add database and retrieval tests for two active amendments, inactive/out-of-effective amendments, audience/year mismatch, cancellation of one amendment, cancellation of the base, and historical retrieval immediately before/after cancellation. Assert that amendments never supersede or change the base’s current flag implicitly. Do not claim this rule is operational until publication and retrieval implement it.

### IMP-R6 — Tighten URL provenance and the still-unimplemented acquisition gate (P1)

Current `source.ts` enforces HTTPS, rejects userinfo/nondefault ports/fragments/IP or single-label hosts, and checks YRU suffix boundaries for URL acquisition. It preserves the canonical full URL, including permitted query strings. Query rejection is based on sensitive-looking *parameter names*; a secret in a parameter named `download`, `id`, or another ordinary key can still be stored. Use a reviewed allowlist or strip query parameters from stored provenance; do not assume the name check proves a query has no credentials. Also split request/acquisition URL from the sanitized reviewed/final source URL.

The design now correctly requires whole-set A/AAAA public-address validation, pinning, redirect revalidation, and decoded streamed byte caps. No URL fetcher exists in this slice, so DNS rebinding, redirect, certificate-hostname/SNI, timeout, abort, body-limit, and secret-redaction behavior remain untested. Ensure every redirect hop checks the full answer set and pins the selected public address while TLS verifies the original hostname. Never log URL query values, resolved IPs, source bytes, or credentials.

### IMP-R7 — Make CSV encoding support explicit (P2)

The current source validator and CSV parser both use fatal UTF-8 decoding. The CSV parser correctly accepts UTF-8 BOM and preserves exact cell strings; it rejects legacy Thai encodings such as TIS-620/Windows-874 rather than flagging or decoding them. The plan calls for Thai encoding fixtures and the design requires encoding warnings to remain reviewable. Choose a bounded explicit encoding policy: supported encodings must be detected/selected without silent text corruption, while ambiguous or unsupported input remains staged with an unresolved warning or a fixed rejection. Add round-trip Thai-byte fixtures and keep the original SHA-256 over the original bytes.

## Parser and worker guidance from primary documentation

These are candidate implementation references, not claims that the parsers are installed or accepted. `parse5@8.0.1` is present in the current worktree per the root-owned dependency change; the other format parser/worker paths remain unimplemented in this slice.

- **PDF:** Mozilla’s [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) exposes page-level document/text APIs suitable for bytes-in extraction and page provenance. Treat table extraction as heuristic and review-required; do not let PDF.js fetch arbitrary URLs.
- **DOCX:** [Mammoth’s official README](https://github.com/mwilliamson/mammoth.js/blob/master/README.md) supports headings/tables and conversion warnings, and explicitly says it does not sanitize source documents and is imperfect for complex DOCX. Extract safe text/structure only; never render converted HTML as trusted content. Do not claim stable page locations.
- **XLSX:** [ExcelJS’s official README](https://github.com/exceljs/exceljs#streaming-xlsx-reader) documents a streaming XLSX reader and shared-string caching behavior. Bound rows/cells and archive expansion before object growth; retain formula/cached values as literal evidence, never evaluate formulas or follow external references, and flag hidden data/formulas.
- **CSV:** The current custom parser has its own row/cell bounds and quotes handling. If it is replaced or extended with `csv-parse`, its [official options](https://csv.js.org/parse/options/) and [`max_record_size`](https://csv.js.org/parse/options/max_record_size/) documentation show strict column handling and that record-size bounds need to be set explicitly. Preserve logical record/column provenance and do not auto-cast.
- **HTML:** Root pinned [parse5 8.0.1](https://parse5.js.org/); its [parse API](https://parse5.js.org/functions/parse5.parse.html) parses markup without executing script. Walk the tree as inert text/tables, omit scripts/styles/frames and resource references, and do not fetch embedded resources.
- **Worker boundary:** Node’s [v24.20 child-process docs](https://nodejs.org/download/release/v24.20.0/docs/api/child_process.html) document `spawn`/`execFile`, `shell:false`, cancellation, timeouts, and output limits; avoid `exec`/shell interpolation. Its [v24.20 worker-thread docs](https://nodejs.org/download/release/v24.20.0/docs/api/worker_threads.html) define `resourceLimits` as JS-engine limits, not total RSS/native or `ArrayBuffer` memory. Follow the revised design’s production OS/container RSS/CPU/network/filesystem supervision requirement; a child process alone is not a sandbox.

## Acceptance evidence still needed

| Gate | Evidence required |
|---|---|
| All five inputs | Good, malformed, oversized, Thai, table, warning, and abort cases for PDF/DOCX/XLSX/CSV/URL acquisition; URL is a method, not a sixth format. |
| Provenance | Request and final source URLs separated and sanitized; format-specific location survives parser, preview, edits, chunk/table persistence, and citation. |
| Private originals | Actual DB/storage/RLS tests for opaque references, encryption/key-version handling, active-admin streaming audit, staff/browser denial, and failed-parse retention. |
| Quality/sensitivity | Versioned counters and located warnings; unresolved PUBLIC block; Thai/adversarial personal-data cases; no unsafe match leakage into logs/public output/embeddings. |
| Catalogs and versioning | All 19 family seeds, all seven fixed dataset mappers when installed, no DDL, atomic same-revision BOTH; base plus every applicable active amendment and exact cancellation/history cases. |
| URL and worker | Whole mixed DNS set rejected, every redirect re-resolved/revalidated/pinned, HTTPS certificate hostname verified, streamed decoded-byte cap, timeout/abort tears down work; process RSS/CPU/network/filesystem limits demonstrated. |

This review confirms the revised design is materially more precise and identifies concrete mismatches in the current helper slice. It does not claim parser, storage, migration, retrieval, UI, or M7 acceptance. Root owns those contracts and integration gates; no permission question or new gate is introduced here.
