# M5 AI Gateway and Provider Dashboard

> **Historical component evidence; Provider acceptance REOPENED.** Tests below describe the OPENAI-only source checkpoint. It does not satisfy the original Zen/OpenRouter/free-startup scope or the latest up/down ordering/per-model HTTP/quota/test UX. Use [spec audit](AI_PROVIDER_SPEC_AUDIT.md), [current board](../tasks/V1_TASK_BOARD.md) and [provider design](../architecture/AI_PROVIDER_DESIGN.md) before further work; do not infer current all-green/live acceptance from this report.

Automated acceptance passed on4 October2026. Reviewed additive schema is on the selected development Supabase project. Live provider generation remains pending credentials and an available account model; full V1 remains incomplete.

## Implemented behavior

- Registered OpenAI Responses adapter: strict JSON/function schemas, bounded request/response bodies, abort-safe stream reads, fixed errors and model metadata health checks. Provider HTTP stays behind the registry interface.
- Enabled provider/model records determine priority and capabilities. At most three attempts share one overall deadline, with per-model timeouts and fallback for timeout,429,5xx,unavailable model/provider and invalid output. Authentication errors/cancellation stop attempts; persistence failure does not cause another generation.
- Private encrypted keys never appear in safe DTOs, browser HTML, usage or errors. Usage retains nullable tokens/cost and source configuration revisions; errors contain fixed codes/status without payloads.
- Super Admin `/providers` supports provider/model create/edit, key replacement, enabled state, priority, timeout, capabilities, prices and health check. Blank edit keys preserve ciphertext. Active server role, origin/body limits, optimistic revisions and safe audit protect every operation.
- Four controlled tool names use strict schemas and trusted session/conversation context. Provider-required nulls round-trip to optional backend arguments; unknown/context-overriding arguments fail. Real business executors are integrated in M6.

## Evidence

- Clean replay of all **10 migrations** on the dedicated local project, after proving application/Auth fixture tables empty.
- Full effective-role foundation privacy fixture and **57/57 PostgreSQL integration tests** pass: private browser denial, usage/error persistence, key rotation, active-role authorization, stale revisions and concurrency.
- **221/221 unit tests in21 files** pass, including39 adapter,15 gateway and12 tool cases. Existing Student/Staff webhook and ticket regressions pass.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` exit0. Local database advisors report no issues.
- Actual localproduction Next3001 with real development Auth/temporary trusted profile mirrors passes **12 browser cases**: provider/model CRUD, key privacy/preservation/rotation,403/409 guards, Staff denial and390px layout. Mobile screenshot visually inspected. Owned fixtures removed in finally; fake keys never reached provider HTTP.
- Guarded development deployment applies only three reviewed additive M5 migrations. Postflight: **10 migrations,22 RLS tables,9 departments**. Remote effective browser/server grants/privacy and actual three-subject scope fixtures pass and roll back.
- Actual main `http://localhost:3000` browser passes Super Admin Dashboard/provider/API and safe empty registry, IT/Library403/not-found, reload, logout and post-logout401. Existing ticket schema/read smoke passes all three accounts.

## Review corrections

Actual RED→GREEN cases prove old generation cannot overwrite health after configuration edits while usage remains recorded. Model changes advance the provider snapshot and invalidate health. A health check waiting behind a model writer reads fresh state after acquiring its parent lock; a newly preferred model invalidates an earlier probe. Adapter regressions prove stalled-body cancellation and200-character model IDs. Internal registry/observation failures become fixed gateway errors. Independent backend review has no open actionable finding in scope.

## Remaining evidence and setup

The registry starts with the OpenAI adapter; other vendors require registered implementations. No guessed model or production mock provider exists. The development registry is empty. Eventually Super Admin must enter the chosen account key, add an available model, enable its supported JSON/tools capabilities and run metadata health check. That check alone does not prove generation/billing access.

No live/paid AI call occurred. Student AI generation, RAG, approved knowledge, imports and actual business tools are subsequent milestones. Corpus sources remain pending review/unpublished. The user deferred live keys, document approval and complete OA acceptance to final manual setup, so implementation continues without claiming those gates passed.

Main development server/inbox/outbox workers were restored with reviewed source. No new public tunnel was created; the earlier temporary tunnel is not assumed reachable. Continue M6 RAG/durable AI orchestration with the M4 HUMAN/revision fence and AI HTTP outside business transactions.

Fresh main-server Student and Staff verification smoke also passes signed empty200, invalid signature401 and GET405.
