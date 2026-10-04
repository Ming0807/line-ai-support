# M4 Student routing fixture report

## Result

Added five rollback-only integration cases against `processStudentContent` and the dedicated local PostgreSQL database. The fixtures exercise the neutral Student menu and explicit IT escalation, encrypted outbox payload recovery (including the event reply token), opaque choice binding and invalidation, HUMAN new-topic isolation followed by explicit Library escalation, WAITING_USER continuation, and CLOSED-ticket isolation.

Choice safety coverage includes forged data, a different Student session, stale conversation revision, expiry, replay, and invalidation of alternative choices for the same pending message. The tests also verify that all active contexts are selectable and that a pending Student reply attached to a HUMAN ticket does not create an automatic AI response.

## Verification

- `pnpm exec tsx --test --test-concurrency=1 tests/database/student-ticket.integration.ts`: **5 passed, 0 failed**.
- `pnpm exec eslint tests/database/student-ticket.integration.ts`: passed.
- `git diff --check` for the assigned files: passed.
- Full `pnpm exec tsc --noEmit` currently reports two errors in the root-owned `tests/database/ticket-security.integration.ts` at lines 405–406 (`Object is possibly 'undefined'`). The new fixture file has no type errors.

Every database case used a transaction and rolled back its fixture rows. Only the dedicated local database was used; no remote writes or LINE calls were made.
