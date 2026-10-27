# ROOT-ROUTE-RECOVERY-01 — conversational routing above the quick-reply UI limit

Owner root; requirements original overview§§17–18, CH009–012/020–022/060–069. Latest human requests a full repair of the >12-context loop, review of OpenCode commits39276b1/4853b87, named clarification instead of remembered numbers, and C-disk recovery. Existing dirty Tavily/DDGS work is retained. Review uses the two-axis review skill with actual Luna high Standards and Luna max Spec reviewers if available; root owns integration.

## Evidence and design

LINE officially permits13 quick-reply items. Our semantic preflight/context/schema/selection and typed/HUMAN-focus paths wrongly reuse12 as an automatic-routing cap. Real report has13–15 contexts and overflow→low-confidence; separate tunnel/network timeouts are not the same bug. Raising to20 alone merely moves the failure. Keep UI at13 but allow up to64 complete current candidates per semantic call, with whole current question and topic/summary preserved, optional older whole history omitted to fit the unchanged19000-character budget. No keyword shortlist, latest-ticket default, silent candidate truncation, automatic closure, new provider or timeout increase. Compact history is context only; the original full snapshot digest still revalidates revisions and delivered history. If full topic/current-question context cannot fit or exceeds64, report explicit routing unavailability rather than a fake low-confidence semantic verdict.

Clarification remains necessary only for genuine competing contexts or unavailable inference. Show bounded named topic buttons and topic previews rather than requiring remembered numbers; retain safe legacy typed commands and exact snapshot/expiry/ownership checks. Typed NEW and unique named choices and explicit HUMAN focus must not fail merely because total candidates exceed12. Maximum UI button count does not change; 64 is an explicit engineering limit, not an unlimited capacity claim.

Telemetry best effort must catch synchronous validation/query failures as well as rejected promises. Never await observations inside business transactions; no raw errors/credentials. Root will reproduce a remaining synchronous-throw seam before repair.

## Files and execution

- `semantic-routing-contracts.ts`, `semantic-routing.ts`, `semantic-routing-provider.ts`: independent candidate capacity, compact whole-message history and typed capacity failures.
- `quick-reply.ts`, `explicit-focus.ts`: names/UI-only limit, total-candidate-independent explicit navigation/focus.
- `routing-telemetry.ts`: synchronous failure isolation and capacity vocabulary.
- focused routing/typed/telemetry tests and actual owned PG routing/choice suites, plus related designs/decision/board/matrix/checklist.
- Disk: verify and move uv cache to D via PowerShell and junction; inspect additional generated caches before moving, preserve models, original documents, Docker volumes and existing worktrees.

Acceptance: meaningful RED for C13–C15 automatic routing and typed recovery, compact prompt still maps exact candidate without losing question/source digest, >64/oversized gives explicit unavailable, no wrong/HUMAN recipients, fresh/stale/reordered offers, synchronous telemetry throw isolation,13-button ceiling and named labels. Run focused unit/type/lint, repair any preexisting root-DDGS type error minimally, relevant isolated PG suites, build when resources permit. Restart only canonical owned local session after checks; verify signed local/public routes and fresh worker check-ins. Actual model/OA evidence remains scoped and is never inferred from mocks. Record disk before/after and any failed checks. No push.

## Root review and verification ledger

Actual independent Luna high Standards review found synchronous-query throw and unbounded pending telemetry; root added RED tests and fixed both. Luna max Spec review confirmed snapshot/replay safety and found no-source paging was offered without a routable question; owned PG reproduced RED12offered-vs1expected, then root changed this path to a working NEW-only action. Review also requested direct C64/65 evidence and current task-board resolution; both are added. Earlier passing baseline: full3369tests/248files, affected ownedPG38cases with46 migrations and exact owned DB cleanup, typecheck/changed-file lint and full-source isolated Next build. First full run exposed a stale OpenCode log-component allowlist oracle and split emoji label boundary; both repaired with regression checks. Final-source checks are running after the no-source correction. No provider/LINE generation calls occur in these mocked model/transport tests.

Disk: C0.09→3.20GiB; six unused cached Codex runtime-history folders moved toD with original-pathjunctions. PNPM content/index moved toD; Move-Item hit a broken project-cache link, so remaining projectindexes are preserved at C:/Users/NOTEBOOK/AppData/Local/pnpm/store-projects-retained-20261028 and originalstore now verified junctions to D:/codex-cache/pnpm-store-20261028. UVpartialmove hit a lockedfile; both portions retained and future userUV_CACHE_DIR points D:/codex-cache/uv-cache-20261028. Active runtime, cached models, originals, Docker volumes and Windowsmanagedfiles untouched.

## Final current-source evidence — 28 October 2026 ~02:36 Bangkok

- `pnpm exec vitest run --maxWorkers=1`:3370/3370 tests,248/248files PASS.
- `pnpm typecheck` and explicit changed-file `pnpm exec eslint ...`:exit0.
- Owned harness `pnpm exec tsx .superpowers/staging/root-route-owned-tests.ts`:40/40 cases,46 migrations,exact owner/comment-verified DBcleanup PASS; model and LINE transport mocked. Includes direct65 CONTEXT_LIMIT, originalsource paging/replay and no-sourceNEW-to-nextquestion. C64 maps exactcandidate in the unit suite.
- `node .superpowers/staging/root-route-build.mjs`:full-source isolated Next16.3.8 build PASS;865 source hashes compared against current files,zero mismatches. Only isolated Turbopack root changed; running dev output untouched. Result/logs retained in ignored staging.
- Actual Luna max final scoped re-review reports no material safety finding; reviewers did not run root gates.
- Read-only actual15-context session projects into7627characters with fake generate/zeroHTTP; proves the formerly capped data fits, not model routing accuracy. First diagnostic resolved `@next/env` from the wrong pnpm level and stopped before DB access; corrected to installedNext dependency. Old telemetry lacks boundsession, so fallback looked up an existingowned active session by aggregate count without printing identity/content.
- Root canonical prior session stopped cleanly; new `pnpm local:ai --web-search` READY at ~02:35. OfflineE5/384, four new worker check-ins, local/public200valid and401invalid signatures for bothOAs PASS8. New temporary URLs are in FINAL_SETUP_CHECKLIST. No Gemini/model generation test, no normal inbox replay, no provider/key/timeout change, no automatic DEAD-event replay and no push.
- Cfree~3.16GiB after new runtime start. Fullscope remaining: actual OA naturalconversation, prior Wi-Fi procedural completeness, DDGS appintegration and finalFlowA–F are not passed by this change.
