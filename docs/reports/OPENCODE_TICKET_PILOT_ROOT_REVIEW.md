# OC-UI-01 actual review and root repair

7 October 2026. Original source pinned 045daa5ee9e57ca7766c83c318f0c3aef2815262...e5c022e20e942cf7cca679e8b0e99294e95fdbf2, implementation beee535, external branch codex/opencode-ticket-pilot. No remote operation/merge for the external branch. Latest human authorizes root to fix small defects directly and assign a substantial batch next.

## Standards axis

Actual Luna high read-only source audit: unknown empty incorrectly shown as no matches; valid custom page size absent from form; original report overstates zero/out-of-range/literal/reset assertions; unverified harness family is not verified model provenance. Auth concern was rejected after root inspected dashboard/layout.tsx, which awaits requireStaff for the actual route. Parent authentication remains intact. These reviews ran no tests/browser commands.

## Spec axis

Actual separate Luna max read-only audit: empty missing pagination is unknown; present empty page/pageSize and loose UUID grammar diverge from root parser; nine tests omit several claimed acceptance cases; optional runtime DTO cast lacks validation. Scope is UI/tests/docs, backend sync is explicitly pending. Pilot cannot close CH051 or all V1 with fixture forwarding alone.

## Root execution and repairs

Original focused36 tests:35PASS/1FAIL (pre-existing positive dept-123 fixture). Original typecheck/changedESLint/fixeddiff PASS. Root repairs in **9437654c5ce550a6dad864a6c0354da82bd11098**, same external worktree, local-only/clean:

- unknown-empty/retry; strict matching/coherent pagination and expected row count, no clamp or invented total;
- canonical present-empty page/size failure and installed Zod UUID grammar;
- custom selected size and reset preservation; zero returned count on out-of-range;
- old positive fixture uses a synthetic valid UUID, negative invalid UUID remains;
- eight actual production SSR tests, RED6failed/2pass → focused44/44.

Final actual root commands in the repaired worktree: full Vitest1499/1499 across98files, pnpm typecheck, full pnpm lint, pnpm build (Next16.3.8 Turbopack), owned staged credential check and whitespace PASS. A first fixture patch matched an earlier URL fixture and was corrected before final gates. Actual Luna high final repair source verdict noP1/P2; no reviewer command result is attributed. External report `docs/reports/OPENCODE_TICKET_ROOT_REPAIR_REPORT.md` is retained on branch9437654 in the external worktree; it is not a portable root repository file.

No browser/mobile/keyboard run, backend merge, actual SQL search, OA or V1 acceptance occurred. Root changes are not OpenCode authorship. FIXTURE_BEHAVIOR_PASS after root repair; LIVE_INTEGRATION_PENDING. The report's unverified family claim supplies no basis to rank OpenCode/Gemini models.

## Next assignment

[OC-UI-02 ready 12-package prompt](../agents/OPENCODE_OPERATOR_WORKFLOWS_PROMPT.md) assigns Activities + Logs real fixture state/controllers/rendered interactions/race/privacy/accessibility evidence while production honestly awaits an accepted backend adapter. Root keeps backend ownership; user relays this prompt to their chosen OpenCode agent. A substantial new workflow yields better acceptance evidence than another small parser-only comparison. Small pilot defects are already repaired by root, not passed back as a new external assignment.
