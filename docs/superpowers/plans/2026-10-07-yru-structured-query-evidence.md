# STR-00Q-1 — query and evidence preparation

> For agentic workers: use superpowers:subagent-driven-development with explicit file ownership. Root owns contracts/implementation/integration; user-requested Luna high/max owns bounded tests/read-only reviews.

7 October2026, parent44b20ed. Goal: strict all-seven query1/exact matcher and internal row-reference consistency checks before public M8 integration. Tech: current TypeScript/Zod/Node BigInt/existing pure mapping copy/hash/source-location/rule-proof contracts. [Design](../../architecture/STRUCTURED_QUERY_EVIDENCE_DESIGN.md), CH012/018/031/041/050, original versioning, existing [M8 gates](2026-10-06-yru-structured-data.md). User authorization continues independent implementation; no repeated approval interview.

Root creates `lib/knowledge/structured-query.ts`, `structured-row-reference.ts`, `tests/structured-query.test.ts`, `tests/structured-row-reference.test.ts`, design/plan/report and current controls. Luna high owns only `tests/structured-query-adversarial.test.ts`; Luna max owns read-only source/spec/adversarial audit after contract freeze. No shared files edited by multiple owners. Reuse current checkout, preserve unrelated catalog/corpus/Gemini work. No SQL/route/tool/provider/LINE/UI edits or installed flag changes.

- [x] Task1: root RED tests for seven queries, required clarification/literal labels/null major/leading-zero codes/exact money+credits/inclusive civil+UTC intervals/reversed ranges/limits; implement strict detached query validator and matcher. Luna high adds independent source-contract attacks, runs RED first, then final focused checks.
- [x] Task2: root RED reference/payload hash/location/canonical UUID/revision/control/proxy/drift tests. Implement safe internal reference parsing/equality only; never call it authorization or live source proof.
- [x] Task3: actual Luna max spec/code audit against frozen design/source and final corrections with regression tests. Record actual owner/commands/messages, no unavailable verdict claim.
- [x] Task4: affected tests then full unit/type/lint; inspect import boundaries/unchanged schema/tool/installed:false. No fullPG/build/live claim for unused pure modules; prior213PG/QA build belongs parent. Update report/board/matrix/design/DEC-045/index, exact staged links/diff/credentials; commit/push authorized root branch and verify remote identity.

Acceptance is bounded to pure prepared contracts. Missing/public schema, atomic modes, actual query/provenance/final-delivery, UI/corpus/freeOA/FlowA–F/deployment remain agent work; no new human configuration.

Verification outcomes are recorded in [the component report](../../reports/STRUCTURED_QUERY_EVIDENCE_REPORT.md): 40 focused / 1,621 full unit / 112 files, typecheck and full lint PASS. Task4 Git handoff is checked separately against the actual remote result; no public/runtime acceptance is implied.
