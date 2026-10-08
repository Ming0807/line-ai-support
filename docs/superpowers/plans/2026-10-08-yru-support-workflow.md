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
- [x] Focused/type/lint/full appropriate gates, root source review, update design/task/matrix/report. This unused preparation is not FlowB/C or live acceptance. Exact13staged files/credentials/whitespace PASS;68bf470f268c7091841824ec9277d5246daa7c70 pushed and remote SHA verified.

## B2 — durable source and outcome boundary

Files: additive `supabase/migrations/*_grounded_support_outcomes.sql`; create `lib/ai/support-state.ts`, `tests/database/ai-support-state.integration.ts`; extend owned schema runner. Change normal/DEVELOPMENT only after isolated migration/RLS/advisors gates and documented activation.

- [x] Read installed Supabase/PG guidance and relevant constraints; freeze [exact storage contract](../../architecture/AI_SUPPORT_STATE_DESIGN.md), encrypted payload/key/foreign constraints and source digest before migration authoring. Primary RLS/composite-key docs and changelogHTTP200 checked8October.
- [x] RED actual PG tests for encryption/ownership/source-change/mode/lease/directory fences and immutable schema receipts. Missing module RED; corrupt/privacy/department mirrors reproduced RED. Consumed outcome authorization/idempotency remains B3, not this schema test.
- [x] Implement private snapshot/persistence helpers and immutable fixed outcome/ticket-context storage. Canonical pending/SENT/altered guidance is tested through actual reviewed structured publication and real outbox with mock LINE transport. No provider/LINE HTTP in SQL; no student personal records schema. Owned outcome/ticket-copy mutation is B3.
- [x] Complete owned replay/RLS/advisors/full unit/type/lint/build and root source self-review:243ownedPG/34replay/RLS/advisors0ERROR0WARN,1918unit/type/full lint/fresh controlled buildPASS. Coverage/setup/evidence updated; exact handoff is recorded in the B2 report.
- [ ] Guarded local/DEVELOPMENT activation during B3 integration after isolated gates; root performs it, not a new human setup request. Production activation remains distinct.

## B3 — integrated producer, actions, escalation and Analytics

Files: `lib/knowledge/answer-producer.ts`, `lib/knowledge/configured.ts`, `lib/ai/jobs.ts`, `lib/ai/run-worker.ts`, `lib/conversation/student-processing.ts`, `lib/ai/backend-tools.ts`, `lib/tickets/create-ticket.ts`, `lib/operations/metrics.ts`, relevant DTO/UI, actual worker/outbox/role tests and controlled FlowB/C/E runner.

Execution checkpoints keep the final B3 acceptance intact. B3A connects source-bound classification to a support-aware knowledge producer, strict optional result metadata, short committed worker snapshots, finalization/delivery source fences and guarded existing development activation. Explicit files: new `lib/ai/support-producer.ts`, `tests/ai-support-producer.test.ts`, `tests/database/ai-support-worker.integration.ts`; existing support contracts, jobs, worker, configured producer, delivery fence, `scripts/ai-worker.ts` and owned runner. Existing Staff direct knowledge producer and legacy results remain compatible. Relevant DEVICE/ERROR clarification skips generic academic context; continuation retrieval uses literal source-selected problem/details. Classifier failure grants no advice/outcome authority. All provider calls remain outside SQL and the overall60-second deadline remains. Actual tests must cover new USER/directory/HUMAN/lease changes before finalization, saved-result retry, late source changes at outbox and canonical guidance; source metadata stays private. B3B then consumes owned choices for solved/recommended/alternate escalation, enriches ticket context and observes scoped confirmed metrics; B3A alone does not pass FlowB/C.

- [ ] RED multi-turn tests: ask relevant device/error once, reuse actual problem/facts, reviewed guide, explicit solved outcome/no ticket; unresolved confirmed IT ticket carries collected facts/category/priority/sensitivity; no personal-data guesses.
- [ ] Bind classifier and optional strict support metadata; exact USER/directory digest at finalization and delivery. Preserve legacy results and private Staff knowledge projection.
- [ ] Replace unconditional normal AI quick replies with context-appropriate owned actions. Validate solved/escalated confirmation, source, actual delivered guide, revision/lease/ownership; reuse existing tool receipts and HUMAN guards.
- [ ] Scope observed outcome counts/rate by current department/sensitivity and explicit Bangkok window; null when there are no observed confirmations. Add honest UI copy and role/privacy tests; read installed Next guides before UI/API changes.
- [ ] Full unit/type/lint/owned PG/build, actual controlled FlowB/C/E and compiled relevant browser checks; source review, reports/decisions/matrix/task/index/setup, exact staged scan/diff/commit/root push verification. Live approved corpus/free/OA checks remain separate evidence.

Do not silently bundle worker heartbeat, incident context enrichment or bounded web implementation into this slice; their board entries remain pending and must be completed before whole V1 acceptance.
