# ADV-03B-UI — operations metrics surfaces

Owner: `/root/v1_ui_integration_audit`, 8 October 2026. Linked requirements: CH015, CH016, CH017, CH031, CH051, CH060, USR-UX, DASHBOARD. Source of truth: [metrics design](../../architecture/OPERATIONS_METRICS_DESIGN.md), accepted root contracts in `lib/operations/metrics-contracts.ts` and reads in `lib/operations/metrics.ts`. Preserve the selected dark rail, warm canvas, coral overview and existing navigation.

## Boundaries

Own `app/(dashboard)/dashboard/**`, `analytics/**`, `usage/**`, `departments/**`, `settings/**`, new `app/(dashboard)/operations-views/**`, `app/operations-metrics.css`, focused UI tests/fixtures and this plan/report only. Root owns metric SQL/contracts/API, auth/privacy decisions, integration and combined gates. Do not change navigation, tickets, Knowledge, shared contracts, backend or requirements/board documents.

## Intended behavior

- Authenticate staff before server reads. Usage and Settings return not-found for non-SUPER_ADMIN direct requests before operational reads.
- Use the accepted typed functions directly on the server: `readOperationsSummary`, `readOperationsAnalytics`, `readOperationsUsage`, `readOperationsDepartments`, and `readOperationsSettings`. Strict date forms use accepted `from`/`to`; only summary and analytics expose the accepted optional department UUID. No client API endpoint guesses.
- Dashboard status totals and date-bucket intake come from the scoped summary. Ticket rows/cards remain useful operational lists, clearly labeled as the current result page and never presented as totals.
- Analytics shows actual sampled response/resolution averages and counts, scoped distribution, and unavailable AI-resolution rate. Zero samples display “no samples,” not a zero duration.
- Usage shows actual observed calls, errors, fallback, latency, token totals with unknown-observation counts, cost with unknown count, grouped provider/model. Do not derive quota or cost from tokens.
- Departments displays only returned active scoped records and their visible counts. Settings displays observed DB/pool/queue/config-presence fields; worker liveness remains UNKNOWN. E5 health remains a separate existing authenticated HTTP probe and failures render UNKNOWN/unavailable without implying a database health failure.
- Every read has distinct safe error and empty states; date windows remain bounded by the backend contract. Data tables/cards remain readable at narrow widths and with keyboard/screen-reader semantics.

## RED → GREEN and acceptance

1. Add focused production-helper and rendered-surface tests first. Cover count source vs current ticket-page size, strict form fields, nullable/no-sample analytics, unknown tokens/cost, empty data, independent E5 status, role rejection before protected reads, and safe settings/department values.
2. Run the focused tests and confirm the missing behavior fails before implementation.
3. Implement server-only orchestration and browser-safe view adapters/components under the owned paths; keep labels, formatting, empty/error states and filters testable without database fixtures.
4. Run focused tests, scoped ESLint and typecheck after root-owned dependencies settle. Record exact commands/results and limitations in `docs/reports/OPERATIONS_METRICS_UI_REPORT.md`. No browser, PG, full-suite/build, live provider, or V1 completion claim unless actually run by the responsible integration owner.

## Review notes

Installed Next.js 16 page guidance requires `searchParams` to be awaited as a promise. Use server components for authorization and read adapters; no client-side private metrics fetch is introduced. Native GET forms preserve the backend’s strict query contract and clear filters on reset.
