# ADV-03B-UI — operations metrics UI report

**Date:** 8 October 2026
**Owner:** `/root/v1_ui_integration_audit` (`gpt-6-luna`, high)
**Status:** UI component implementation ready for root integration; this report is not V1 acceptance.

## Scope and source of truth

Implemented the approved dashboard/operations presentation against the accepted exports in `lib/operations/metrics-contracts.ts` and `lib/operations/metrics.ts`, plus [ADV-03B design](../architecture/OPERATIONS_METRICS_DESIGN.md). The implementation preserves the approved dark rail, warm canvas, coral overview, and existing ticket operations cards. The page does not infer API paths or change the contracts.

Owned UI files: dashboard, Analytics, Usage, Departments, Settings, shared operations views, `app/operations-metrics.css`, and `tests/operations-metrics-ui.test.tsx`. The execution plan is [ADV-03B-UI plan](../superpowers/plans/2026-10-08-yru-operations-metrics-ui.md). Requirements covered at UI component level: CH015, CH016, CH017, CH031, CH051, CH060, USR-UX, DASHBOARD.

## Behavior delivered

- Server pages call `requireStaff` before private reads. Usage and Settings call `notFound()` for non-SUPER_ADMIN requests before their protected data or E5 reads.
- Dashboard aggregate counts and daily intake come from `readOperationsSummary`; department/date filters use accepted strict query parsing. Ticket list cards remain operational, with current-page counts distinguished from aggregate totals. The notification count uses the scoped summary.
- Analytics presents observed response/resolution averages with sample counts, scoped department distribution, and the unresolved AI outcome as unavailable. A zero sample count renders as no samples, not zero duration.
- Usage displays gateway calls, outcomes, fallback, latency, known tokens/cost and explicit unknown-observation counts. Cost units are left as recorded because the accepted DTO does not specify a currency. Provider quotas remain linked to the Provider surface and are not estimated from tokens.
- Departments shows only returned active visible records and counts. Settings shows the observed database/pool/queue snapshot, LINE configuration-presence flags only, and worker liveness as UNKNOWN. The existing E5 HTTP health observation is rendered separately, including an HTTP status where available; a failed metrics snapshot does not suppress the separate E5 result.
- Shared native GET filters preserve the strict date/department contract. Unknown or repeated parameters render an invalid-filter state without calling the metrics read. Read failures display a safe generic state.

## Verification

- TDD evidence: the first focused run failed all 7 new UI assertions against the pending surfaces; after implementation, `pnpm exec vitest run tests/operations-metrics-ui.test.tsx tests/operations-metrics-contracts.test.ts` passed **11/11 tests**.
- Scoped ESLint passed with zero warnings for the owned TS/TSX files.
- Scoped TypeScript passed using a temporary config containing only the five owned pages, shared view, and focused tests; the temporary config was removed.
- `git diff --check` passed for owned implementation paths (Git printed only a CRLF normalization warning for the existing dashboard file).
- Repository-wide `pnpm exec tsc --noEmit --pretty false` was attempted and remains blocked by concurrent root-owned Knowledge import work: unresolved `./structured-mapping-panel` and `./structured-client-contract` imports in `app/(dashboard)/knowledge/import/review-form.tsx`. These paths are outside this assignment; the scoped TypeScript check passed.
- The Impeccable mechanical detector was run once over changed UI files. It reported palette/radius advisories; new metrics CSS colors/radii were adjusted to the approved DESIGN.md palette/scale. Existing dashboard inline colors also appeared in the findings. The detector was not rerun.

No browser QA, build, database integration suite, live provider/E5 check, or full acceptance run was performed by this agent. No files were staged, committed, or pushed.

## Root integration items

The installed Next.js 16 CSS guide (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`) directs global CSS imports to the app root. `app/operations-metrics.css` is intentionally provided without a page-level global import. Root should import it from the dashboard/app root layout during integration, then run the combined type/full lint/build gates and browser verification against the integrated backend. Knowledge, route/API wiring, PostgreSQL evidence, and final acceptance remain with root.
