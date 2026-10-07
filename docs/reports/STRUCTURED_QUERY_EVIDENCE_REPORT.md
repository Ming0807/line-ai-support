# STR-00Q-1 — query/reference preparation evidence

7 October 2026. Parent `44b20ede6b2368b02853b3478d88301c90ad381a`. Requirements CH012/018/031/041/050. [Frozen design](../architecture/STRUCTURED_QUERY_EVIDENCE_DESIGN.md), [execution plan](../superpowers/plans/2026-10-07-yru-structured-query-evidence.md). Status **BACKEND_COMPONENT_PASS**, unused pure preparation; M8/V1 integration remains pending.

## Changes and limits

Root authored strict seven-dataset Query1 validators, explicit missing-context assessment and literal/exact decimal/date/timestamp predicates in `lib/knowledge/structured-query.ts`. Own-descriptor snapshots reject getters/proxies/non-JSON input without invoking accessors. Results are detached/frozen; no implicit dates, context, SQL identifiers or coercion. Root authored internal strict row-reference parsing, payload-hash recomputation and all-field equality in `structured-row-reference.ts`. Coordinates match actual extraction/mapper contracts, including noncontiguous logical fragments; unkeyed hashes are consistency checks only.

No SQL/migration, route, registered tool, LINE/provider behavior, public source projection, installed flag or publication change. Existing free-text structured hook stays unavailable. These modules cannot provide authorization, current/history eligibility, bounded complete contradiction context or live source authenticity. Future DB retrieval/finalization/dispatch must implement those gates. Fee bounds without currency compare nominal source values only.

## Actual verification

| Command/check | Result |
|---|---|
| Initial root and Luna high focused RED | Missing modules failed collection before implementation; no executed-test claim |
| Root form URL Unicode C1 regression | 1 failed / 15 passed before added Cc refinement; reproduced defect and fixed |
| `pnpm exec vitest run tests/structured-query.test.ts tests/structured-row-reference.test.ts tests/structured-query-adversarial.test.ts --maxWorkers=2` | 40 tests / 3 files PASS |
| `pnpm exec vitest run --maxWorkers=2` | 1,621 tests / 112 files PASS; exit0 |
| `pnpm typecheck` | PASS; exit0 |
| `pnpm lint` | PASS; exit0 |

Root reference tests include 35 actual mapper outputs (seven datasets × five formats) within one compatibility test, plus exact payload/dataset/hash/location/revision/drift/proxy checks. Do not count these fixtures as 35 extra Vitest tests. Query coverage includes clarification, nullable major, leading-zero course codes, exact money/credit boundaries, reversed ranges, civil/UTC intervals, malformed/control text and bounded inputs. Full suite includes the focused tests; counts are not additive. Ignored local logs are `.superpowers/staging/structured-query-reference-{focused,unit-final,type-final,lint-final}.log` and the URL-control RED log.

Luna high authored only the 10-test adversarial file, ran its final tests/typecheck and reported PASS. Three draft expectation errors were corrected against the frozen contract; they were not implementation regressions. Luna max performed a read-only source/spec audit and ran no commands/tests. Its one bounded finding was an overstrong claim that arbitrary HTML source locations contain no tokens; root narrowed the design to dedicated fields and explicitly deferred safe public URL projection/persisted-source binding. Existing upstream mapper source validation remains unchanged. This is a documentation resolution, not a new URL sanitization implementation. Root owns final test results, integration and acceptance; no independent full-suite/build/live verdict is attributed to either agent.

PG/build/browser checks were not repeated for these unused pure modules. Parent ticket checkpoint's 213 PG tests/build/HTTP evidence remains dated parent evidence, not a STR-00Q-1 live pass. No real corpus, OA, remote free-model or deployment acceptance is claimed. No new human setup is required by this slice.

## Remaining work

STR-00 provenance grants/retention and lifecycle projections; document-first typed retrieval, selection/ranking, complete bounded contradiction context; additive row evidence through finalization/dispatch; fixed tables and atomic STRUCTURED/BOTH publication/rollback/history; combined Gemini mapping/draft usability; approved corpus and Flow A–F acceptance. Current [task board](../tasks/V1_TASK_BOARD.md) owns those statuses.

Before commit, root checks exact owned-file links, staged diff/credential scan and preserves unrelated UI/corpus WIP. Git outcome is reported after the actual commit/push/remote comparison, not inferred here.
