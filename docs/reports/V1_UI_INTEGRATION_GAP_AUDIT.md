# V1-UI-INTEGRATION-01 — Pre-integration audit and baseline correction

Date: 8 October 2026. Owner: root-authorized delegated UI implementation. This replaces the earlier audit claim about merge risk, which used a raw root-to-external diff rather than the merge base.

## Corrected source comparison

`git merge-base e0a9385 458c76f` is `f2aea758453b182e62a2520a764d8972b19f5ae1`. The external author's actual change set is the 100-path `f2aea758..458c76f` diff. The previously reported 218-path diff `e0a9385..458c76f` spans divergent history and is not evidence that a three-way merge would remove files untouched on the root side. No merge or cherry-pick is authorized here; files are selectively ported by this task.

The new managed worktree is based exactly on `e0a9385`, branch `codex/v1-dashboard-integration`. Its `node_modules` is a junction to root's dependency tree and is read-only. The working scope and acceptance are in [the isolated implementation plan](../superpowers/plans/2026-10-08-v1-dashboard-integration.md).

## Integration findings that still govern

- Do not replace root's Knowledge UI/catalog work. This task excludes all `app/(dashboard)/knowledge/**` and `app/knowledge.css` files.
- Ticket query/page UI is a good selective port because root now owns the matching scoped q/page/pageSize backend contract. Port presentation only and remove external casts against root DTOs.
- Activities and Logs remain fixture-only; the external report accurately marks real APIs and browser acceptance pending. Keep their production state unavailable until root accepts a read contract.
- Root-accepted data/auth contracts remain authoritative. Do not port external APIs, `lib/**`, SQL/migrations, services, package files, or proposed Activities/Logs endpoint paths.
- Dashboard shell and the remaining surfaces should keep Gemini `443c227`'s approved visual direction while presenting no-contract modules as honest pending/unavailable states.
- Historical review findings about the structured mapping panel's source disposition, mode-switch data preservation, acknowledgment invalidation and API binding remain relevant to Knowledge, but are explicitly outside this implementation task.

## Evidence and limits

External `458c76f` was documented as fixture-behavior pass for Activities/Logs and includes root repairs. Those source/test results are not root integration evidence. This implementation will report only commands actually run in this isolated worktree. Browser/API/live verification and combined root acceptance remain with root.

## Selective implementation and current contract map

| Dashboard module | Surface in this port | Root-accepted data available on this baseline | Current truthful behavior / integration gap |
| --- | --- | --- | --- |
| Overview | `/dashboard` | Scoped ticket list (default up to 100), import jobs, providers, embedding observation | Ticket-derived counts are labeled as latest loaded rows; read failures show unknown. Questions-today, AI-resolved, escalation, active-incident, common-problem and global aggregates still need an accepted summary contract. |
| Tickets | `/tickets`, `/tickets/[id]` | `TicketFilters` (`q`, page, pageSize, selectors), matching pagination, detail permissions/action DTOs | Selective root-contract integration; server query/pagination only, URL filters preserved. Definitive rejects retain text; 5xx/lost-response retry retains the same idempotency request. |
| Incidents | `/incidents` | None | Filters disabled with a pending notice; “cannot read records” state explicitly avoids claiming there are none. |
| Departments | `/departments` | Ticket picker can return only the caller-scoped filter options; no accepted directory/management read | Synthetic nine-row catalog and false “in database” labels were removed. General directory and assignment policy remain unavailable. |
| Knowledge | `/knowledge/**` | Root-owned work in progress | Excluded entirely from this port and from this worktree’s checks; root retains mapping/review/publication work. |
| Activities | `/activities` | None accepted | Fixture tests only; production adapter stays unavailable and guesses no endpoint. |
| AI Providers | `/providers` | Existing root provider/model administration and embedding observation | Provider/model UI keeps existing APIs; provider count and embedding status distinguish unknown from known values. Models are a provider section. |
| Fallback Rules | `/providers#fallback` | Existing provider ordering/preview surface; no independent new mutation contract added | Discoverable tab on Providers. Treat preview as preview; no new route/API assumed. |
| Usage | `/usage` | Per-model observations surfaced by existing provider page; no aggregate ledger | No invented token/cost totals. Dedicated page remains explicitly pending. |
| Analytics | `/analytics` | None accepted | No fabricated charts/aggregate values; long-range metrics remain pending. |
| Logs | `/logs` | None accepted | Fixture tests only; production adapter unavailable and content remains scoped by root follow-up. |
| Settings | `/settings` | Authenticated staff identity; SUPER_ADMIN embedding observation | Shows current session and explicitly pending checks/mutations; no general health or settings API inferred. |
| Models | `/providers#models` | Existing provider/model admin DTOs | Discoverable tab on Providers; preserved contract. |

The rail now exposes all route-backed modules according to role labels; Activities remains available to staff with its read-scope pending, while Logs, Usage, Knowledge and Providers are Super Admin-only. Models and Fallback remain provider sections, yielding the required 13-module coverage. Root has since accepted the Activities/Logs read scope under ADV03A; root must wire server authorization and adapters to those accepted DTOs. Route-page guards for several admin-only pending surfaces still call only `requireStaff`; navigation filtering is presentation, not authorization. The ticket list route is protected by existing scoped `listTickets` behavior.

## Implementation evidence (isolated worktree)

- Applied approved Gemini shell, dashboard, ticket and provider presentation plus Activities, Logs, Incidents, Departments, Settings, Usage and Analytics scaffolds. Excluded Knowledge and backend/API files.
- Removed the stale ticket compatibility casts and passed validated root `TicketFilters` and pagination DTO values directly. Removed unused local-array filtering and local-slicing pagination helpers so the list contract cannot imply client-only search/count semantics.
- Changed failed dashboard list reads to unknown states, labeled all ticket-derived overview data as the latest up-to-100 rows, and surfaced the unavailable aggregate metrics. Replaced synthetic departments and false empty incidents with pending/unavailable states. Preserved fixture loaders only for tests.
- Focused command `pnpm exec vitest run tests/opencode-operator-activities.test.ts tests/opencode-operator-logs.test.ts tests/opencode-operator-races.test.ts tests/opencode-operator-root-repairs.test.ts tests/opencode-operator-state.test.ts tests/opencode-ticket-pilot.test.ts tests/opencode-ticket-review.test.ts tests/ui-workflows-regression.test.ts`: **8 files, 85 tests passed**. Obsolete local-array search/slicing tests were removed because production list reads are server-side; Knowledge structured-mapping assertions were omitted because Knowledge is outside this worktree and root-owned. Neither area is represented as passing here.
- `pnpm typecheck`: passed once on the isolated UI scope, then fails after unowned Knowledge contract files appeared in this worktree. Current diagnostics are confined to `tests/fixtures/structured-client-contract.ts`, `tests/structured-client-contract.test.ts`, and missing `app/(dashboard)/knowledge/import/structured-client-contract`; see parent handoff. `pnpm lint`: exit 0 with 9 unused-parameter warnings in that same unowned Knowledge stub. No full unit suite or build run, per root ownership of combined gates. No browser QA, screenshot, live API, or manual responsive evidence was run.
- Impeccable detector on changed UI targets after final UI edits: **failed with 267 findings**, primarily inline palette/radius literals outside current `DESIGN.md` tokens. This is a real remaining visual-system cleanup blocker; the scan was static and is not browser QA.
- Scoped ESLint over the owned UI routes/styles/tests: exit 0 (four CSS files were reported ignored because ESLint has no CSS rule configuration). Full `pnpm lint` exit 0 with the 9 unrelated Knowledge-stub warnings listed above.
- Source scope: isolated branch `codex/v1-dashboard-integration` at baseline `e0a9385`, external presentation source `458c76f`, merge base `f2aea758453b182e62a2520a764d8972b19f5ae1`; no root/shared-checkout or external worktree edits.
- At final status inspection, unowned untracked Knowledge artifacts (including `docs/ui/V1_STRUCTURED_MAPPING_UI_PLAN.md` and the structured-client-contract test/stub files) had appeared in this isolated worktree. They were not edited or staged by this task and are excluded from the implementation scope; the parent was notified because they affect workspace-wide typecheck/lint evidence.

## Root integration blockers and acceptance still required

1. Resolve route-level authorization on Activities, Logs, Analytics, Departments, Settings and Usage before attaching sensitive data. Role-based navigation alone cannot enforce the documented scope.
2. Root must supply/approve aggregate API contracts for required Overview/Analytics metrics, department directory, incidents, system health/settings, usage aggregation and Activities/Logs; do not infer endpoint paths or shapes from these UI proposals.
3. Root must integrate its current Knowledge mapping/publication/preview work and reconcile schema-3 RAG mode, publication availability and structured mapping previews against the real backend preview/commit contract.
4. Run combined root type/lint/unit/build and endpoint tests after integration; then browser-check authorized roles and states at desktop/mobile widths, including keyboard navigation, query+pagination and mutation error/ambiguous retry behavior. None of these combined/browser checks is claimed here.
5. Clear or explicitly accept the Impeccable detector palette/radius findings against the approved design system before calling UI review complete.

## ADV-03A root-contract integration update — 8 October 2026

The preceding Activities/Logs findings describe the pre-contract audit state and are superseded for those two surfaces by root's accepted ADV-03A read contract (`docs/architecture/OPERATIONS_READ_DESIGN.md`) and implementation. Root owns SQL, authorization, endpoint code and final integration. This isolated UI now consumes the root `readActivities`/`readLogs` functions on SSR and uses only the accepted browser routes `/api/activities` and `/api/logs` for explicit retries; it does not infer additional endpoints or log sources.

- Activities uses the accepted activity groups (including CREATE, REOPEN, IMPORT, PROVIDER and OTHER), root-fixed labels, active-staff authentication and root department/sensitivity scoping. Logs is guarded by a route-level `SUPER_ADMIN` check, including direct navigation.
- Both surfaces pass the root parser's strict selectors and Bangkok last-seven-civil-day default, show the returned date window and `Asia/Bangkok`, and validate the complete `{items,pagination,window}` envelope against the active request. Browser retries pass an `AbortSignal`, use same-origin credentials/no-store, and preserve current filters. Only root DTO fields and fixed summaries/labels are projected.
- Logs options are limited to the accepted `ai-gateway` and `line-delivery` components and root code list. The UI does not imply health/quota from observed HTTP status or claim queue/import/webhook/RAG logs.
- The strict DTO support copies `lib/operations/contracts.ts` and `lib/operations/reads.ts` were copied byte-for-byte from root solely for isolated-worktree type/test support. They are root-owned and are not part of this UI staging scope.
- Focused verification after this integration: five operator test files, **71 tests passed**; scoped ESLint over the route/view/operator modules and related tests exited 0. No `pnpm typecheck`, full suite/build, browser run, screenshot or live endpoint check is claimed here; the structured-mapping agent is still working in the shared UI worktree and root owns combined gates and browser/API acceptance.

Activities/Logs remain subject to root's combined authorization, actual database, API and browser verification. The contract implementation is accepted design/input for this UI, not proof of production browser behavior.
