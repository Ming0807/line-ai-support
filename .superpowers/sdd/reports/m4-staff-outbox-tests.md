# M4 Staff Outbox Integration Tests

Added `tests/database/staff-outbox.integration.ts` with controlled local PostgreSQL tests for the real outbox worker and fake LINE HTTP only. The suite covers Staff notification recipient/token selection, per-recipient ordering, 503-to-409 retry key/body stability, scope revocation before first send, binding-change suppression against the frozen original recipient, expired unused Student Reply fallback with pre-HTTP persistence visible from another connection, and database channel/kind check constraints.

Fixtures use generated IDs and an in-memory encryption key, purpose-separated Student and Staff identity hashes, one active test department, only the required Staff/auth/session/conversation/ticket rows, and exact FK-ordered cleanup in `finally`. Fake fetch handlers do not call external services. They assert on booleans and metadata so assertion output does not print raw LINE identities, credentials, or request bodies.

**Execution:** After root's GO and local database replay, `pnpm exec tsx --test --test-concurrency=1 tests/database/staff-outbox.integration.ts` completed successfully: 6 tests passed, 0 failed, 0 skipped. The root-owned test runner has not yet been updated to include this file.

Post-run local cleanup counts were all zero: fixture sessions, Staff profiles, inbox rows, outbox rows, delivery attempts, departments, Staff LINE bindings, and Student LINE bindings. The check returned counts only and did not display fixture identifiers.

**Static checks:** ESLint passed for the new test file. `pnpm exec tsc --noEmit` was run but the project check remains blocked by errors in the concurrently edited `scripts/qa/ticket-flow-http.ts`; it reported no errors in `staff-outbox.integration.ts`.
