# V1-UI-INTEGRATION-01 — Dashboard and ticket UI integration

Date: 8 October 2026. Owner: root-authorized delegated UI implementation; root owns final integration and backend/API acceptance. Requirements: CH051 (ticket dashboard), USR-UX, USR-DASHBOARD, USR-UI-R2; preserve task order and root contracts. Baseline: `e0a9385` on `codex/v1-dashboard-integration`, isolated managed worktree `C:/Users/NOTEBOOK/.codex/worktrees/v1-dashboard-integration/line-ai-yru`. Dependency `node_modules` is a junction to the root checkout and is read-only: no install, lockfile or dependency mutation.

## Source correction and selection

Actual `git merge-base e0a9385 458c76f` is `f2aea758453b182e62a2520a764d8972b19f5ae1`. The historical audit's raw root-to-external 218-path deletion count was not evidence that a three-way merge would delete untouched root files. This task uses the actual ancestor-to-external diff (`f2aea758..458c76f`, 100 paths) to identify authored work, then selectively ports only the authorized app presentation and UI tests. No merge/cherry-pick is performed.

## Scope and files

Port and adapt from the external local-only `458c76f` branch:

- `app/(dashboard)/layout.tsx`, `nav-bar.tsx`, `dashboard/**`, `tickets/**`, `providers/**`, `activities/**`, `logs/**`, `operator-workflows/**`, `departments/**`, `settings/**`, `usage/**`, `analytics/**`, `incidents/**`.
- `app/globals.css`, `app/tickets.css`, `app/providers.css`, `app/operator-workflows.css`.
- UI-only operator/ticket fixtures and tests under `tests/fixtures/opencode-operator-fixtures.ts`, `tests/opencode-operator-*.test.ts`, `tests/opencode-ticket-*.test.ts`, and `tests/ui-workflows-regression.test.ts` as they remain valid against root source.
- This plan and an isolated audit/report correction in this worktree only.

Do not change `app/(dashboard)/knowledge/**`, `app/knowledge.css`, API routes, `lib/**`, service/SQL/migrations, provider or ticket backend contracts, package files, or shared root documentation. Root baseline ticket types/auth/server APIs are authoritative; remove external compatibility casts. Activities/Logs and every module without an accepted backend remain truthful unavailable/pending, never synthetic production records. Keep local embedding health read-only and distinguish unknown from disabled/failed. Keep dates, counts and role/scope labels tied to real root DTOs. Visuals inherit Gemini `443c227`: dark rail, alabaster canvas, warm white surfaces, coral overview, blue actions. No green baseline or institutional brand/endorsement claim.

## Dependencies

Current root ticket contract and DTOs (`types/tickets.ts`, `lib/tickets/reads.ts`, `/api/tickets`) including scoped q/page/pageSize and matching totals; existing staff authentication/permissions; root provider APIs/UI; current Dashboard data services; no accepted Activities/Logs, incidents, analytics, usage, or general Settings read/write endpoints. Use no guessed API paths or request shapes.

## Acceptance

1. Dashboard shell/navigation is responsive and keeps selected route and access boundaries clear. All 13 source modules have discoverable surface coverage; blank backend domains show honest pending/unavailable states with no made-up values.
2. Ticket list uses root `TicketFilters` and pagination DTO directly, preserves filters/size in links and reset, and distinguishes invalid, zero-result, out-of-range, unavailable and real empty states. No cast, local-array search, or fabricated count.
3. Ticket actions preserve entered text after failed/unknown outcomes, clear on confirmed success and honor server permission/state results. No change to backend transitions.
4. Provider/model surface uses existing APIs unchanged; status is per-model, UNKNOWN remains explicit, embedding is infrastructure health only, and fallback preview is not presented as a new rules-management contract.
5. Activities/Logs fixture workflows remain isolated in tests; production adapter is unavailable until root accepts an API. Other stub modules use explicitly labelled unavailable/empty states rather than placeholder values presented as live.
6. Run target UI tests, `pnpm typecheck`, and full `pnpm lint`; inspect real output. Avoid running the root's concurrent full unit/build gates. Do not claim browser QA; root owns later combined browser/API acceptance. Review only staged scoped files before any local commit; no push or integration to root.

## Work sequence

1. Copy approved presentation routes, operator components and UI tests from `458c76f` while excluding Knowledge/API/backend/shared files.
2. Adapt navigation, ticket filters/pagination/actions and all no-contract pages to the baseline `e0a9385` DTOs and real backend truth; remove stale compatibility casts and check production paths for fixtures.
3. Run the focused test set, typecheck, lint and one mechanical Impeccable detector pass. Fix implementation issues within this worktree; do not touch root's Knowledge WIP.
4. Write dated results/limitations to the isolated report and leave combined browser, live endpoints and final root gates to root.
