# M4 Ticket dashboard UI report

## Delivered

Added the scoped ticket list and detail views. The list provides GET filters for department, status, priority, assignee, date range, and sensitivity, with empty and invalid-filter states. The detail page presents the HUMAN/AI handling mode, ordered messages and history, scoped delivery status, and only the lifecycle actions enabled by the read DTO's permissions.

Action forms post to the dedicated ticket endpoints with the current revision and a UUID request ID. If the connection drops, retry reuses the exact request body and ID; editing the payload creates a fresh request ID. Stale-revision responses prompt the staff member to refresh. Errors shown to staff are bounded and do not expose server internals.

Added route loading and error states plus responsive styling in `app/tickets.css`. The UI uses only the ticket DTO and read service, and does not render raw LINE identifiers, private tokens, delivery error codes, or database identifiers.

## Verification

- Installed Next.js 16.3.8 App Router docs were consulted for promise-based `params` and `searchParams`, loading boundaries, and client error boundaries.
- Focused ESLint passed for all assigned TypeScript UI files.
- The Impeccable detector returned no findings for the assigned UI files.
- `git diff --check` passed for the assigned files.
- `pnpm typecheck` reached one unrelated error in `tests/line-delivery.test.ts` where the test reads `errorCode` without narrowing the delivery result union. The ticket UI files produced no remaining type errors; rerun after that root-owned test fix.

Browser verification is owned by the root integration pass and is pending.
