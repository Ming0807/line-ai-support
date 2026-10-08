# RAG-01B grounded support workflow implementation plan

> Agentic execution: root performs the contract/DB/integration tasks under continuous user authorization. Use the existing executing-plans/TDD/verification workflow. Requested Luna high/max agents are unavailable at limit; record actual review provenance.

**Goal:** complete grounded multi-turn first-level support and explicit solved/confirmed escalation behavior required by FlowB/C.

**Architecture:** source-bound semantic proposals through the configured free gateway; private encrypted context and immutable owned outcomes; existing AI result, confirmation receipt and outbox fences. [Frozen design](../../architecture/AI_SUPPORT_WORKFLOW_DESIGN.md), master§§24/27–28/31/57/69 and original§§5–12/19/30. RAG-01A acceptance precedes runtime integration. Local CPU E5/384 and reviewed internal source precedence remain.

**Stack:** existing TypeScript/Zod/pg/Vitest/Next16; no new provider/model/package.

## B1 — source-bound proposal preparation

Files: create `lib/ai/support-contracts.ts`, `lib/ai/support-classifier.ts`, `tests/ai-support-contracts.test.ts`, `tests/ai-support-classifier.test.ts`; evidence `docs/reports/AI_SUPPORT_PROPOSAL_REPORT.md`.

- [x] Write failing tests for strict proposal, ephemeral USER projection, exact quote/source/field validation, canonical active department/category mapping, unsupported/conflicting intent/flags, requested missing facts and backend priority/risk. Missing modules and unrelated-quote impact elevation reproduced RED.
- [x] Implement pure contracts/validation and fixed Thai clarification templates. Interfaces consume actual USER strings plus active public departments; return an interpreted proposal or safe clarification, never a ticket/action token/database command.
- [x] Write failed/cancelled/tool-bearing/oversized generation tests; bind bounded FREE_ONLY gateway callback without an alternate provider path or SQL. Final16focused/1918full unit/type/full lint PASS; root source self-review.
- [ ] Focused/type/lint/full appropriate gates, root source review, update design/task/matrix/report. This unused preparation is not FlowB/C or live acceptance.

## B2 — durable source and outcome boundary

Files: additive `supabase/migrations/*_grounded_support_outcomes.sql`; create `lib/ai/support-state.ts`, `tests/database/ai-support-state.integration.ts`; extend owned schema runner. Change normal/DEVELOPMENT only after isolated migration/RLS/advisors gates and documented activation.

- [ ] Read installed Supabase/PG guidance and relevant constraints; freeze exact encrypted payload/key/foreign constraints and source digest before migration authoring.
- [ ] RED actual PG tests for encryption/ownership/source-change/mode/lease/directory fences, immutable outcomes and idempotent receipts.
- [ ] Implement private persistence helpers and owned outcome mutation within existing transaction boundaries. No provider/LINE HTTP in SQL; no student personal records schema.
- [ ] Owned replay/RLS/advisors/full regressions; documented guarded local/DEVELOPMENT activation. Update coverage/setup/evidence; production manual activation remains distinct.

## B3 — integrated producer, actions, escalation and Analytics

Files: `lib/knowledge/answer-producer.ts`, `lib/knowledge/configured.ts`, `lib/ai/jobs.ts`, `lib/ai/run-worker.ts`, `lib/conversation/student-processing.ts`, `lib/ai/backend-tools.ts`, `lib/tickets/create-ticket.ts`, `lib/operations/metrics.ts`, relevant DTO/UI, actual worker/outbox/role tests and controlled FlowB/C/E runner.

- [ ] RED multi-turn tests: ask relevant device/error once, reuse actual problem/facts, reviewed guide, explicit solved outcome/no ticket; unresolved confirmed IT ticket carries collected facts/category/priority/sensitivity; no personal-data guesses.
- [ ] Bind classifier and optional strict support metadata; exact USER/directory digest at finalization and delivery. Preserve legacy results and private Staff knowledge projection.
- [ ] Replace unconditional normal AI quick replies with context-appropriate owned actions. Validate solved/escalated confirmation, source, actual delivered guide, revision/lease/ownership; reuse existing tool receipts and HUMAN guards.
- [ ] Scope observed outcome counts/rate by current department/sensitivity and explicit Bangkok window; null when there are no observed confirmations. Add honest UI copy and role/privacy tests; read installed Next guides before UI/API changes.
- [ ] Full unit/type/lint/owned PG/build, actual controlled FlowB/C/E and compiled relevant browser checks; source review, reports/decisions/matrix/task/index/setup, exact staged scan/diff/commit/root push verification. Live approved corpus/free/OA checks remain separate evidence.

Do not silently bundle worker heartbeat, incident context enrichment or bounded web implementation into this slice; their board entries remain pending and must be completed before whole V1 acceptance.
