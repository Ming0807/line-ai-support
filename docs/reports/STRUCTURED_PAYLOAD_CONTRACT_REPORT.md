# STR-01A-0 — fixed structured payload and registry

7 October 2026, parent `91be14569b2bc562ac229346dd50745137203290`, branch `feat/yru-helpdesk-v1`.
Status: COMPONENT_PASS for pure payload/registry; checks recorded below. No structured schema, mapper, publication, search, UI or full V1 acceptance.

## Source and implementation

Root read the project index/board/matrix/decisions, master§12/18/37–42/49/50/60–62, original versioning, system/import/embedding designs, prior M8 proposal and actual new source audit. [Design](../architecture/STRUCTURED_DATA_DESIGN.md) and [bounded plan](../superpowers/plans/2026-10-07-yru-structured-payload-contract.md) distinguish exact master field names from root choices about nullability, bounds, date era/timezone, decimal strings and inert URLs. DEC-037 permits this independent preparation; DEC-038 explicitly resolves the earlier generic publication/vector conflict with mode-specific effects, keeping outside-SQL preparation and existing RAG behavior.

New `lib/knowledge/structured-payload.ts` validates source-only payloads for all seven named datasets. It preserves leading-zero identifiers, accepted text and exact decimal scale; rejects missing/extra/backend-owned fields, JS numeric fees/credits, implicit conversion, invalid/reversed dates, noncanonical timestamps and unsafe URL lexemes. Plain/null-prototype own data descriptors are snapshotted without invoking source getters. Fixed error codes omit original values/raw Zod issues. Text has explicit UTF-16 bounds and rejects unpaired surrogates without replacement/normalization.

New `lib/knowledge/structured-registry.ts` returns deeply frozen field metadata with exactly seven selectors and **installed:false** for every entry. It has no readiness setter, SQL identifier, database operation, network call, provider configuration or import/tool runtime integration. Registry types and payload source keys agree with the existing seven-code tuple; source-controlled lifecycle/provenance fields remain forbidden.

Root owns both modules, root tests, design/contracts and integration/acceptance. Actual user-authorized `gpt-6-luna` max agents authored [source/static audit](../../.superpowers/sdd/reports/2026-10-07-structured-spec-audit.md) and [adversarial tests/evidence](../../.superpowers/sdd/reports/2026-10-07-structured-adversarial-tests.md). Adversarial test authorship is separate from the auditor's static review; no database/browser review is implied.

## Verification and corrected failures

Commands run from the shared main checkout with configured Node24/pnpm10 runtime; unrelated main knowledge UI/`next-env.d.ts` WIP is preserved, while Gemini's tracked UI remains in its separate worktree.

| Check | Actual result |
|---|---|
| Root payload RED before module | Missing-module suite failure, then original9 focused tests PASS |
| Root registry RED before module | Missing-module suite failure, then5 registry tests PASS |
| Independent adversarial run before fixes |14tests:11PASS/3RED; scoped ESLint exit0 |
| Root surrogate regression before fix |12root tests:11PASS/1RED |
| Final focused three files |31tests PASS:12root payload+5registry+14independent adversarial |
| Whole suite before surrogate correction |1496unit/100files PASS; superseded by final rerun below |
| Final whole suite |`pnpm exec vitest run --maxWorkers=1`:1497unit/100files PASS,53.17s,exit0 |
| Final typecheck |`pnpm run typecheck` exit0 after final surrogate fix |
| Final lint |Scoped five-file ESLint and final `pnpm run lint` both exit0 |
| Link/diff/staged security |21control/evidence files265local links PASS; staged credential check PASS. Initial staged diff rejected two-space Markdown breaks in new agent reports; root removed them and reran the final checks before commit |

The three actual independent RED findings were inherited required-field access/acceptance, Unicode code-point versus UTF-16 length mismatch, and URL parser repair of an empty raw authority. Root rejected inherited/accessor/extra own keys before parsing, added explicit `.length`, and required raw authority. The auditor then identified a lone-surrogate persistence risk; root reproduced it RED and added `String.prototype.isWellFormed()` rejection, preserving valid supplementary characters. Additional root checks cover null prototypes, hidden/symbol extras, getter non-execution and trailing-line-break decimal/currency lexemes. No test assertion, bound or timeout was weakened to obtain passing results. The adversarial report intentionally preserves its earlier RED run as dated history; this report records subsequent root fixes and final verification. Actual final Luna max static review found no remaining findings in this bounded payload/registry slice; its report labels root-run test results separately and keeps broader M8 gates open.

No build, HTTP/browser, migration/advisor/DB suite or live provider/OA test is newly claimed: these modules have no runtime consumers or Next.js change. Final whole unit/type/lint are the relevant gates for this pure slice. Parent [catalog/assistance report](KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md) records the previous196actualPG/foundationRLS/defaultTurbopackbuild/7compiledHTTP gates; those are 6October evidence, not today's reruns. No local/DEVELOPMENT database or private original has been changed by this slice.

## Remaining implementation and user steps

Only the pure payload/immutable registry component can be accepted here. STR-00 mapping-v3 exact DTO/canonical digest/grouped-decimal grammar, one-source unmapped-table disposition, provenance grants/retention, action-specific lifecycle and strict typed query/row evidence through finalization/dispatch remain design gates. Then STR-01/02 require actual fixed tables/mappers/reviewed preview/atomic STRUCTURED+BOTH/exact query/proof/delivery/RLS/replay/HTTP/UI acceptance. Existing unsupported-mode rejection remains. Gemini Dashboard/import presentation has no reported final commits/combined acceptance yet; root did not edit/stage that work.

No new human configuration or upload is required. Existing pending real university source review, live free generation/OA flows and production setup are in the [final checklist](../operations/FINAL_SETUP_CHECKLIST.md). Schema implementation and UI integration are agent work. [Current board](../tasks/V1_TASK_BOARD.md) remains authoritative; this report does not complete M8 or Flow A–F/V1.
