# STR-01A-0 — strict structured payload contract implementation

> For agentic workers: execute this bounded plan inline or with isolated user-authorized Luna tasks; root owns contracts/integration. Latest continuous authorization covers this independent preparation. No routine approval gate is introduced.

**Goal:** Validate exact source-valued payloads for all seven fixed datasets without installing or enabling structured storage.

**Architecture:** Pure Zod payload schemas preserve source text/decimal strings and reject backend identities/lifecycle fields. A frozen registry names only those schemas and their fields, with `installed:false`; existing import/review/publication/tools remain untouched.

**Tech stack:** existing TypeScript5.9/Zod4.6/Vitest5 on Node24; no dependencies, Next.js/UI or SQL changes.

**Source:** [frozen design](../../architecture/STRUCTURED_DATA_DESIGN.md), master§12/41/42, DEC-027/037; existing `lib/imports/types.ts` seven-code tuple is type-only input. Parent91be145; broader [M8 gates](2026-10-06-yru-structured-data.md) continue independently.

## Task1 — root payload types and meaningful RED→GREEN

Files create `lib/knowledge/structured-payload.ts`, `tests/structured-payload.test.ts`. Interfaces: export `STRUCTURED_REGISTRY_VERSION='structured-v1'`, frozen `STRUCTURED_DATASETS`, `StructuredDataset`, `structuredPayloadSchemas`, `StructuredPayloads`, `StructuredPayloadError` with fixed codes `STRUCTURED_DATASET_UNSUPPORTED`/`STRUCTURED_PAYLOAD_INVALID`, and `validateStructuredPayload<K extends StructuredDataset>(dataset:K,input:unknown):StructuredPayloads[K]`. Runtime unknown codes reject before accessing input getters. Error has no input text or raw Zod issue message. Parsed payload is detached from caller and preserves all accepted lexemes.

- [x] Write RED fixtures for valid seven payloads and forbidden identities, JS float fee, overprecision, leading-zero course identity, explicit null/missing fields, civil date and end-before-start validation. Command `pnpm exec vitest run tests/structured-payload.test.ts --maxWorkers=1`; missing module RED observed.
- [x] Implement explicit strict schemas from the design table. Exact decimals use regex, no Number/coercion; source strings checked without trim output; civil/timestamps compare canonical valid dates. Fixed errors only.
- [x] Run focused test and scoped lint. Original9PASS, final12root tests PASS after own-property/lexeme/lone-surrogate regressions; no private lexeme output, accepted strings unchanged. See final report for RED corrections.

## Task2 — root immutable registry and independent adversarial tests

Create `lib/knowledge/structured-registry.ts`, `tests/structured-registry.test.ts`; isolated independent test author may write only `tests/structured-payload-adversarial.test.ts` against the frozen exports. Registry interface `getStructuredRegistryEntry(input:unknown)` returns fixed deeply frozen `{dataset,version,installed:false,fields:[{name,kind,nullable,maxLength?,precision?,scale?,min?,max?}]}`; kind is one of TEXT/INTEGER/DATE/TIMESTAMP/DECIMAL/CURRENCY/EMAIL/URL, integer bounds describe reviewed year/priority rules. Unknown input throws `StructuredPayloadError('STRUCTURED_DATASET_UNSUPPORTED')`. No source-supplied fields/table names/transforms or exposed readiness setters. Fields match exact payload schema keys; metadata contains no SQL/schema/storage/credentials. Every dataset entry returns current contract readiness without claiming installation.

- [x] RED registry tests assert fixed7membership, distinct nullable/key metadata, code/year/date/decimal classifications, identity rejection and immutable arrays/nodes; compare field keys with actual valid payloads and existing seven-code enums. Missing-module RED then5PASS observed.
- [x] Implement static registry metadata and lookup with unknown-key/prototype access denial (`__proto__`, `constructor`, `toString`); shallow-frozen root alone is insufficient.
- [x] Independent Luna max test author exercises malformed time/url/decimal and rejected private fields, returns exact14test evidence (11PASS/3RED before root fixes). Root fixes contract findings; actual final static audit also closes lone-surrogate risk. No unavailable reviewer claim.
- [x] Run all new focused unit files (31PASS), final typecheck/scoped lint(exit0). No DB suite needed for unchanged database; parent196PG remains dated evidence, not a new DB run.

## Task3 — final source verification, report and Git

Root receives read-only source/spec review, adjudicates findings and records exact provenance. Run `pnpm exec vitest run --maxWorkers=1`, `pnpm run typecheck`, scoped/full lint on isolated accepted parent frontend if main dev writes `.next`. Pure source has no API/UI/schema mutation; build required if integration adds a runtime import, otherwise type/lint/whole unit verify unused module contract. Preserve existing user/Gemini processes and use reusable root QA worktree only after confirming its status/base/source.

Update board/matrix/design/decision/evidence `docs/reports/STRUCTURED_PAYLOAD_CONTRACT_REPORT.md`, index and broad M8 plan with component-only status. Link scan/diff and `node scripts/security/check-staged.mjs`, selective local commit and existing authorized noninteractive push on feat/yru-helpdesk-v1. Do not stage main/Gemini UI/originals/output/env. Receipt source remains backward compatible; allstructured modes/tools remain unavailable until actual schema/mapper/publication/search acceptance.

- [x] Final whole unit1497/100files/full lint/type PASS, actual scoped static review closed, linked evidence/control documents and selective credential check PASS. Final staged diff rechecked after removing Markdown trailing whitespace; authorized commit/push receipt is verified from Git output after these checks, not inferred from this checkbox.
