# STR-00 / STR-01B-0 — exact private mapping preparation

7October2026, parentff4c3b9. Root engineering design, independent of Gemini presentation. Sources: [master](../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md)§12/37–42/49/50, [original versioning](../requirements/sources/original-document-versioning.th.md), [structured payload design](STRUCTURED_DATA_DESIGN.md), [import design](KNOWLEDGE_IMPORT_DESIGN.md), [M8 plan](../superpowers/plans/2026-10-06-yru-structured-data.md), DEC-027/037/038. Status: freeze only the following pure mapping DTO/transforms/artifact; no saved schema3, installed SQL mapper, preview route or publication acceptance.

## Boundary and alternatives

Choose explicit deterministic mapping over header guessing or browser-normalized rows. The latter approaches would hide ambiguous dates/amounts and cannot provide trusted cell evidence. Pure preparation permits independent implementation now; authorization, receipt storage, SQL, actual mode readiness and UI remain later integration. Existing RAG/v1/v2 receipts and every installed:false flag stay intact. Root owns contracts/code; user-authorized Luna high/max can author scoped fixtures/tests/audit.

`buildStructuredMappingPlan(source:ImportSource,extraction:LocatedExtraction,binding:StructuredMappingBinding,mapping:unknown):StructuredMappingPlan` verifies original source/checksum, validates/copies located extraction, validates the strict mapping DTO and its exact source binding, prepares every selected row, then hashes/freezes the private artifact. No filesystem/network/model/embedding/current-clock/DB call or original mutation. It never certifies approval, source authority, applicability, staff access or readiness.

`computeStructuredExtractionDigest(source,extraction):string` hashes canonical verified format/checksum/sourceURL and complete validated extraction/report/locations with domain `structured-extraction-v1`. `validateStructuredMapping(input:unknown):StructuredMapping` copies JSON data descriptors, denies accessors/prototype/symbol/hidden keys/cycles/nonfinite numbers/ill-formed text, checks strict DTO and byte/node/depth bounds, then canonicalizes selection order. Fixed errors omit source values/raw Zod issues. `computeStructuredMappingDigest(mapping:StructuredMapping):string` hashes that validated canonical DTO with version domain `structured-mapping-v1`. `StructuredMappingError` codes: STRUCTURED_MAPPING_INVALID, STRUCTURED_SOURCE_INVALID, STRUCTURED_MAPPING_BINDING_MISMATCH, STRUCTURED_MAPPING_ROW_INVALID, STRUCTURED_MAPPING_LIMIT_EXCEEDED, STRUCTURED_MAPPING_UNSAFE_EXTRACTION; optional safe location `{tableIndex,rowIndex,field:string|null}` contains only allowlisted field names and zero-based positions.

## Mapping1 DTO (exact vocabulary)

All keys below are required. Indices are zero-based into the exact stored extraction, ranges inclusive. DTO has no rows supplied by the browser, table names, source IDs for typed rows, current flags or SQL.

```ts
type StructuredMappingBinding={jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number};
type MappingSource={jobId:string;jobRevision:number;extractionRevision:number;sourceChecksum:string;extractionDigest:string};
type RowRange={startRowIndex:number;endRowIndex:number};
type FieldBinding=
 | {kind:'COLUMN';columnIndex:number;transform:StructuredTransform;blank:'REJECT'|'NULL'}
 | {kind:'CONSTANT';value:string|number|null;note:string};
type ExcludedRows=RowRange&{reason:'HEADER'|'NON_DATA';note:string};
type TableMapping={tableIndex:number;dataRanges:RowRange[];excludedRanges:ExcludedRows[];fields:Record<string,FieldBinding>};
type StructuredMapping={version:1;registryVersion:'structured-v1';dataset:StructuredDataset;source:MappingSource;tables:TableMapping[];excludedTables:{tableIndex:number;reason:'NOT_THIS_DATASET'|'NON_DATA';note:string}[]};
```

UUID job, lowercase64hex hashes; counters0..999999999, extraction/review>=1. Mapping source has no reviewRevision to avoid a saved receipt acknowledging its own future counter; artifact binding includes the supplied saved-review counter. Mapping source must match job/jobRevision/extractionRevision plus original checksum and recomputed extraction digest. This is identity/revision validation, not authorization or proof of the database's current revision; a future server caller must reload the authorized current saved receipts and final-lock/recheck them. Pure preparation shape-checks/hashes reviewRevision but cannot independently reject an in-range stale review value without that future current-state query.

One dataset per import Mapping1, with1..64 selected tables and<=1000 excluded tables. Every extracted table is selected or explicitly excluded exactly once. Every row of a selected table is in a selected data range or an explicit HEADER/NON_DATA excluded range exactly once; no overlap, dropped row, duplicate table or heuristic header skip. Each table has1..100 data ranges,0..100 excluded ranges and exactly the dataset's source field keys in registry order. At least one nonnullable target has a COLUMN binding per selected table, and its valid non-null value must come from each selected row; binding only a nullable blank field cannot disguise a wholly constant row. Column index0..255; all selected rows have the table's maximum extracted width and every mapped column exists. Constants are deliberate reviewed values, nullable only where the payload permits, with a nonblank well-formed note1..500 UTF-16 units. They are labelled constants, not document-cell evidence.

Max2000 selected data rows, mapping DTO256KiB, private prepared artifact16MiB. Copying mapping input uses at most20000JSON nodes/depth16; source/canonical artifact copying uses32MiB/500000nodes/depth16, no arbitrary callbacks/getters/toJSON. Logical source row ordinals must fit1..100000; physical CSV/XLSX retain their existing validated format bounds. Excess fails before enabling any mode. Canonical order: selected/excluded tables by index, ranges by start/end, fields by fixed registry order; duplicate selections fail rather than deduplicate. Equivalent property/selection ordering produces the same digest; changed notes/constants/ranges/transform/blank policy or source binding change it.

## Explicit transform version1

No trimming, Thai-digit substitution, floating-point amount conversion, date-locale detection, implicit currency or rounding. Blank means only an empty/whitespace string; NULL is allowed only for a nullable target. The private CELL evidence always retains the exact extracted string, including blank/commas/era, alongside the result and transform. All final rows pass the accepted dataset payload validator, including interval checks.

| Transform | Target kind | Exact conversion |
|---|---|---|
| TEXT_V1 | TEXT/CURRENCY/EMAIL/URL | Preserve extracted string; payload enforces its field grammar/bounds |
| INTEGER_V1 | INTEGER | Canonical unsigned ASCII integer `0` or nonzero-leading digits, <=9 digits; safe integer then payload year/priority bounds |
| DECIMAL_V1 | DECIMAL | Preserve canonical decimal string; payload precision/scale applies |
| DECIMAL_COMMA_V1 | DECIMAL | Accept canonical ungrouped or first group1–3 nonzero-leading digits followed by one or more comma groups of exactly3 digits; optional fraction, remove only commas; no `0,001`, mixed separators, whitespace or rounding |
| DATE_GREGORIAN_V1 | DATE | Exact Gregorian YYYY-MM-DD |
| DATE_BUDDHIST_V1 | DATE | Exact Buddhist YYYY-MM-DD; explicitly subtract543, validate resulting Gregorian date |
| DATE_DMY_GREGORIAN_V1 | DATE | Exact DD/MM/YYYY explicitly reorder, validate Gregorian date |
| DATE_DMY_BUDDHIST_V1 | DATE | Exact DD/MM/YYYY explicitly reorder and subtract543 |
| TIMESTAMP_UTC_V1 | TIMESTAMP | Preserve exact canonical UTC milliseconds/Z; payload validates |
| TIMESTAMP_PLUS07_V1 | TIMESTAMP | Exact Gregorian YYYY-MM-DD HH:mm:ss.SSS with deliberately reviewed fixed +07:00; validate local civil value before subtracting7h |
| DATE_GREGORIAN_PLUS07_MIDNIGHT_V1 | TIMESTAMP | Deliberately choose midnight/fixed +07:00 from exact Gregorian YYYY-MM-DD, then UTC |
| DATE_BUDDHIST_PLUS07_MIDNIGHT_V1 | TIMESTAMP | Same, with explicitly selected Buddhist era |

Fixed+07 is deliberately named as an offset, not historical IANA Asia/Bangkok conversion; no assertion about historical zone offsets. Modern university date review may select it. Midnight is labelled an explicit reviewed policy, never claimed to be a time in the original source. Date outputs1800..2400; boundary offset that yields an out-of-range UTC result fails. ISO timestamps with another offset, date serials, Thai month names and unlisted conversions are unsupported and require corrected extraction/another reviewed transform later. No automatic fallback from an invalid transform.

## Private source evidence and artifact

Artifact fields: `schemaVersion:1`, `mapperVersion:'structured-mapper-v1'`, registryVersion, dataset, binding, sourceChecksum, sourceFormat, sourceUrl, extractionDigest, mappingDigest, canonical mapping, rows, unresolved source warnings/flags, `requiresReview:true`, digest. Every row has sequential index, tableIndex/rowIndex, sourceRow, coordinateKind, table sourceLocation, exact payload/payloadDigest and fields in registry order. CELL fields have field, columnIndex, sourceColumn, extractedValue, transform and blank; CONSTANT fields have field,value,note. Source location is copied from the matching validated table; one row never borrows another table's coordinates.

- XLSX: `WORKSHEET_CELL`, sourceRow=firstRow+rowIndex, sourceColumn=location.columnStart+columnIndex, with exact sheet/index. Sparse holes retain empty strings; missing/ragged cells fail selected data validation, not silently fill a required value.
- CSV: `CSV_RECORD`, sourceRow=firstRow+rowIndex and columnStart+columnIndex; this is a logical CSV record/field, not physical text line for multiline quoted cells.
- PDF: `EXTRACTED_LOGICAL`, detector-fragment firstRow+rowIndex, columnIndex+1 with page/table/block evidence; not measured visual cell geometry or globally unique row without its page/table.
- DOCX/HTML: `EXTRACTED_LOGICAL`, firstRow+rowIndex, columnIndex+1 with block/table evidence; hidden rows may have been omitted, so never assert an original XML/DOM row ordinal. HTML already normalizes text; extractedValue means exactly the saved extraction string, not byte-identical original markup text.

Original bytes/checksum stay available for deliberate review. Imported family/source authority/sensitivity/date applicability and publication eligibility remain existing review gates. FORMULAS_PRESENT, HIDDEN_DATA_REVIEW, UNSUPPORTED_TABLES or ENCRYPTED_SOURCE flags reject this strict first mapper; DOCX TABLE_SHAPE_REVIEW also rejects because its merged/grid evidence cannot be reconstructed from saved strings. PDF emits TABLE_SHAPE_REVIEW for every detected table and XLSX emits it for styles/dates, so it is not universally unsafe: PDF/CSV/HTML/XLSX retain that flag unresolved, with exact rectangular row/column checks and no numeric Excel-date inference. XLSX/HTML merged cells use UNSUPPORTED_TABLES and are blocked. No formula evaluation, hidden-row reindex inference or merged-cell extrapolation. Other source warnings/flags are copied unresolved and requiresReview is always true. A valid prepared artifact never overrides original review blockers or publishes knowledge. This resolves the actual source auditor's initial blanket-shape conflict under DEC-040 before implementation.

Payload digest uses domain structured-payload-v1 and canonical dataset+payload; artifact digest uses domain structured-plan-v1 and all fields except its own digest. Canonical JSON recursively sorts object keys, preserves array order/types/null and lexemes, uses native JSON number/string serialization after validated copying, then SHA256 of UTF-8. No custom objects/toJSON or Unicode repair. Returned artifact and nested objects/arrays are deeply frozen; deterministic repeated preparation is tested, not equated with a stored immutable receipt.

## Acceptance and remaining integration

Pure component: all7 valid datasets, original identifiers/decimal lexemes, all5 located formats, source/job/extraction drift rejection, explicit coverage and exclusion, transforms/era/time/precision, safe row errors, limits and deterministic digests/frozen detached evidence. Independent audit/test provenance must be actual. Existing1497unit and196PG are parent evidence, not new runs. Final unit/type/lint/security/link checks are fresh; no build/HTTP/DB claim for unimported pure modules.

Mapping1 does not close review-v3 acknowledgment/storage/digest replay, privacy-authorized preview API, fixed SQL/provenance grants/retention/lifecycle, atomic STRUCTURED/BOTH, exact query/row citation/finalization/dispatch or combined Gemini UI acceptance. Those remain STR-00/01/02. [Execution plan](../superpowers/plans/2026-10-07-yru-structured-mapping.md) names files/dependencies/checks. No new user configuration or real-source approval is required to implement this pure slice.

7October component acceptance: [report](../reports/STRUCTURED_MAPPING_PREPARATION_REPORT.md) records1561unit/105files,64focused/type/full lint PASS, actual scoped authors/audit and root RED fixes. Complete artifact bound includes its digest: exactly16MiB accepted, +1 rejected. No saved receipt/current-state authorization or runtime installation claim.
