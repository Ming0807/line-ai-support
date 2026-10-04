# M4 Backend Security and Spec Review

**Scope:** Read-only review of M4 ticket authorization, lifecycle, Student context choices, Staff commands, dashboard APIs/reads, and outbox persistence/dispatch. `lib/line/delivery.ts` and its tests were excluded because I authored that transport slice and root reviews it separately. No credentials, `.env` contents, remote database, or PostgreSQL test suite were accessed for this review.

## Findings

No actionable backend finding remains in the latest reviewed source.

The review identified three concrete defects during iteration; the current source addresses them:

- `WAITING_STAFF` reassignment previously assigned a ticket while keeping it unaccepted, after which both ACCEPT and STAFF_REPLY were unavailable. The transition now permits reassignment only in `STAFF_HANDLING` and `WAITING_USER`, and both the ticket-core plan and authoritative M3/M4 brief state that `WAITING_STAFF` remains unassigned until ACCEPT.
- Route-choice and Staff-command expiry previously depended on the application host clock. Both now check expiry against PostgreSQL time when selecting and consuming the token. Staff commands recheck the active actor, acquire the conversation lock before locking the command row, and use a savepoint so a denied action rolls token consumption back.
- A transient outbox processing/finalization failure previously marked Push jobs DEAD. The latest worker counts processing failures separately, retries Push with the frozen recipient and existing retry key/body while within its bounds, and keeps attempted Reply jobs UNKNOWN. The migration tracks the separate counter.

The ticket API also previously buffered the full request before checking its 24 KB limit. It now reads through `readBoundedBody`, which stops and cancels the stream once the bound is exceeded. Same-origin enforcement uses a dedicated helper that accounts for Next’s internal URL normalization and the request’s external host/proxy scheme.

## Verification and verdict

I independently ran `pnpm exec vitest run tests/request-body.test.ts tests/origin.test.ts`: **2 test files, 5 tests passed**. Source and the updated M4 plan/brief agree on ticket state transitions, authorization boundaries, expiry, and retry behavior. The reviewed API reads and mutations recheck active staff and scope; Student and Staff delivery identities remain channel-specific; Staff free text remains isolated from Student conversations; and the outbox keeps HTTP outside SQL transactions with lease, retry, recipient, and HUMAN-mode fences.

Root reports that the focused PostgreSQL checks pass (17 tests) and the production build passes. The dashboard action-browser rerun is still pending, and the complete M4 end-to-end acceptance flow has not been independently verified in this review. Do not treat M4 as fully accepted until root records that remaining browser evidence and any outstanding final gates.

**Spec verdict:** Current reviewed backend behavior matches the M4 contracts checked here, including post-accept-only reassignment. **Quality/security verdict:** No open actionable backend defect found in the current source; complete acceptance remains open pending the browser action run and root’s final gates.
