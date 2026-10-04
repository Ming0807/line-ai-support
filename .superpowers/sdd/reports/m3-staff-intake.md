# M3 Staff intake implementation report

## Result

Staff-channel text events now enter `private.staff_inbound_messages` as authenticated ciphertext. The intake path validates the event's hashed identity against the claimed Staff inbox row, applies an arrival-based limit of 20 message events per user per minute, and safely ignores unsupported events. It does not create Student identities, sessions, conversations, or public messages. Duplicate processing is a no-op.

## Verification

- Captured RED before the dispatcher change: processing a claimed Staff text event created a Student LINE identity (expected 0, observed 1).
- After the root connected Staff dispatch, the focused rollback-only local PostgreSQL suite passed all 5 cases with `pnpm exec tsx --test --test-concurrency=1 tests/database/staff-ingress.integration.ts`. It covered encrypted persistence and replay, Student/Staff channel isolation, unsupported events, rate limiting, forged channel rejection, and private-table ACL/FK behavior.
- `pnpm typecheck` passed after correcting a test assertion to use its declared plaintext fixture.
- `pnpm exec eslint lib/queue/staff-inbox.ts tests/database/staff-ingress.integration.ts` passed.
- `git diff --check` passed.

The PostgreSQL fixture used the dedicated local database at port 54422 and rolled back its test data. No remote writes were performed. The focused PostgreSQL suite finished before the root's actual HTTP pipeline test began.

## Contract

`persistStaffInboxEvent(client, job, event, key)` returns `null` when it stores the event or detects a duplicate, `UNSUPPORTED_EVENT` for non-message or non-text events, and `RATE_LIMITED` after 20 prior qualifying Staff message arrivals in the preceding minute. Identity and source-row mismatches throw bounded error codes for the caller to handle.
