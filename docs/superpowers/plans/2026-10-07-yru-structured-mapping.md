# STR-01B-0 — exact mapping preparation implementation plan

> For agentic workers: use subagent-driven-development for bounded independent test/audit tasks; root implements contracts/code/integration. Existing continuous human authorization covers this independent backend work while Gemini owns UI; routine design/execute questions are not required.

**Goal:** Prepare exact source-bound typed rows for all7datasets, with private cell/constant evidence and deterministic digests, without installing or enabling a mapper.

**Architecture:** Strict Mapping1 DTO plus versioned pure transforms and verified located-source assembler. Reuse accepted source/extraction/payload/registry validators; preparation is detached/frozen and always requiresReview. Persisted v1/v2 review/publication and every installed:false flag remain unchanged.

**Tech stack:** installed TypeScript5.9/Zod4.6/Vitest5/Node24; node:crypto SHA256, no new dependency/Next.js/UI/DB/network/model.

**Source/dependencies:** parentff4c3b9; required index/board/decisions/master/source/matrix/system/import, [mapping design](../../architecture/STRUCTURED_MAPPING_DESIGN.md), accepted STR-01A-0. DEC-039 records this independent exception; remaining schema/mutation/integration gates stay held.

## Task1 — strict DTO and named transforms (root)

Create `lib/imports/structured-mapping-contract.ts` (types/schemas/safe JSON copy/canonical digest/error), `lib/imports/structured-transforms.ts` (transform compatibility/conversion); root tests `tests/structured-mapping-contract.test.ts`, `tests/structured-transforms.test.ts`. Exact public exports: `StructuredMapping`, `StructuredMappingBinding`, `StructuredMappingPlan`, `StructuredMappingError`, `validateStructuredMapping`, `computeStructuredMappingDigest`, `canonicalDigest(domain:string,input:unknown)`, `freezeStructuredData<T>(value:T):T`; transforms export `transformStructuredCell(binding:ColumnBinding,value:string):string|number|null` and `isStructuredTransformCompatible(transform:StructuredTransform,kind:StructuredFieldKind):boolean`.

- [x] RED tests for exact DTO/field keys/unknown input/descriptor copy, row ranges and no missing mappings; named conversion tests for `1,234.50`→`1234.50`, `01/03/2569`→`2026-03-01`, `2026-10-07 08:00:00.000`→`2026-10-07T01:00:00.000Z`, malformed grouping/era/overflow/null/unknown transform. Run each focused file; read failures before code.
- [x] Implement strict design DTO and canonical order/digest; fixed sanitized errors, mapping256KiB/20000nodes/depth16. Implement exact transform table; final payload validator owns per-field bounds. Example: grouped decimal uses checked canonical grouping before `replaceAll(',', '')`; no Number for money.
- [x] Focused tests and scoped ESLint/typecheck must pass; record concrete RED/fixes.

## Task2 — verified located-source mapper (root), scoped independent tests

Create `lib/imports/structured-mapper.ts`; root `tests/structured-mapper.test.ts`. Export `computeStructuredExtractionDigest(source:ImportSource,extraction:LocatedExtraction):string` and `buildStructuredMappingPlan(source:ImportSource,extraction:LocatedExtraction,binding:StructuredMappingBinding,mapping:unknown):StructuredMappingPlan`. Validate source/checksum/extraction, compare exact mapping source binding, reject unsafe quality flags, complete source coverage/no duplicates/row width/column bounds, prepare payload and private evidence for every data row, cap2000rows/16MiB and deeply freeze exact digest artifact. No source or caller object mutations.

- [x] Root RED synthetic calendar mapping verifies binding/source checksum/digest, own table/row/column identity, constants, skipped headers, no silent row drop and private fixed error. Run focused test before implementation.
- [x] Implement row assembly in registry field order, explicit exclusions and selected data rows, preserving extractedValue and original `firstRow` offsets. Check target payload/cross-field interval before appending; error carries only safe table/row/allowlisted field.
- [x] User-authorized Luna high owns ONLY `tests/structured-mapper-formats.test.ts` + `tests/fixtures/structured-mapping.ts` + its new dated report: meaningful all7/all5 synthetic fixtures, exact coordinates and values. Luna max owns ONLY `tests/structured-mapper-adversarial.test.ts` + its new report: stale source/bindings/coverage/limits/hostile DTO/digest/provenance. Separate ownership prevents code/UI conflicts. Root resolves failures.
- [x] Actual Luna max source/static audit report has actionable findings resolved or explicitly remaining broader integration gates; root adjudicates design choices before readiness claims.

## Task3 — fresh component acceptance and Git (root)

- [x] All new focused tests/scoped lint/type, then whole `pnpm exec vitest run --maxWorkers=1` and full `pnpm run lint` (serial after heavy checks to avoid existing parser deadline interference). Read results. No DB/build/HTTP rerun claimed because no runtime consumers/schema/routes change; disclose any attempt/failure/source scope.
- [x] Create `docs/reports/STRUCTURED_MAPPING_PREPARATION_REPORT.md`; update design/main structured design/board/matrix/index/broad plan/decisions/setup/ledger with bounded component-only evidence and actual owners. Existing quality, v1/v2 receipts, uninstalled modes and Gemini WIP remain explicit.
- [x] Link/diff/selective staged credential check; only task files, no UI/env/corpus/output. Commitc1160b9966975bd05fc77c213e9509236a646748 and existing authorized noninteractive push onfeat/yru-helpdesk-v1 exited0; verified remote full SHA. No full M8/V1/real-source/live claim.

Fresh implementation/check and actual Git evidence is in the [report](../../reports/STRUCTURED_MAPPING_PREPARATION_REPORT.md). Gemini443c227 review/prompt is a separate subsequent documentation task, not UI integration in this component.
