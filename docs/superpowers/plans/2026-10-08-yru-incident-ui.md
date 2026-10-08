# ADV-02-UI — incident operations surface

Owner: delegated Luna high UI implementation; root owns route/API/DB/auth/privacy contracts and integration. Date: 8 October 2026.

## Requirements and dependencies

- Requirements: CH013 (incidents and ticket links), CH052 (safe ticket detail links), CH055–057 (similar-issue context, detector policy and severity), and USR-DASHBOARD Incidents module.
- Source: master guide §§13, 55–57; subsystem behavior and thresholds remain defined by `docs/architecture/INCIDENTS_DESIGN.md`.
- Frozen read dependency: `lib/incidents/reads.ts` list/detail DTOs and `parseIncidentQuery`; root-owned API routes and same-origin/fresh-auth/role enforcement. UI does not invent an endpoint or expand the accepted selectors.
- Root additions `canManage` and Super Admin incident-rules read are pending. If unavailable, mutation/rules controls stay absent and the page remains useful for authorized reads.

## Scope

Owned files only: `app/(dashboard)/incidents/**`, new `app/incidents.css`, `tests/incident-ui.test.tsx`, this plan, and `docs/reports/INCIDENT_UI_REPORT.md`. Root layout import for the new global stylesheet is an integration dependency; no layout/nav, APIs, DB, auth, contract, shared docs, or other surface edits.

## Implementation

1. Replace the placeholder list with an SSR-authenticated page using the frozen strict query parser and `listIncidents`; support only status, severity, department UUID, page and pageSize. Keep filters keyboard accessible and maintain them in pagination links.
2. Add a detail route using `getIncident`, render the safe incident fields and authorized ticket links/counts only. Never show session IDs, vectors, similarity internals or raw technical payloads. Treat not-found as unavailable and read failures as errors, never as empty data.
3. If root supplies `canManage` and the accepted status endpoint, show only legal next-status actions and handle stale revision/error without optimistic success or ticket side-effects. If the root rules reader/control route is ready, expose its exact bounded controls only for Super Admin; otherwise render an honest unavailable note only to that role.
4. Add responsive CSS for warm canvas, white operational surfaces and coral accents within the existing dark-rail system, including 320px behavior. The root layout must import `app/incidents.css` during integration.
5. Add production-source tests for strict selector parsing/duplicate rejection, list states and filters/pagination, privacy-safe rendering, detail/ticket links, unavailable/error behavior and any accepted controls.

## Acceptance

- Focused Vitest for `tests/incident-ui.test.tsx` passes against production page/component/helper code.
- Scoped TypeScript and ESLint pass for owned TS/TSX paths; CSS detector runs once after UI edits.
- Inspect final diff for scope/privacy and report exact outputs. No full suite/build, database, API/browser or live-service acceptance is claimed by this slice; root owns combined gates and browser check after stylesheet import.
