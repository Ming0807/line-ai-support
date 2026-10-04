# M4 pure logic RED/GREEN report

## Scope and result

Implemented the frozen pure APIs in `lib/conversation/router.ts` and `lib/conversation/state-machine.ts`, with unit coverage in `tests/conversation-router.test.ts` and `tests/ticket-state-machine.test.ts`. The focused suite and targeted lint pass. These modules do not access the database, AI providers, Next routes, environment variables, or credentials.

## Frozen contract implemented

- `TicketStatus` and `TicketAction` are exported from `state-machine.ts`. `nextTicketStatus` allows only the specified transitions: `WAITING_STAFF + ACCEPT → STAFF_HANDLING`; `STAFF_HANDLING + STAFF_REPLY → WAITING_USER`; `STAFF_HANDLING + RESOLVE → RESOLVED`; `WAITING_USER + USER_REPLY → STAFF_HANDLING`; `RESOLVED + CLOSE → CLOSED`; and `CLOSED + REOPEN → WAITING_STAFF`. `REASSIGN` preserves only the three active HUMAN statuses. Every other pair returns `null`; `CANCELLED` has no outgoing transition.
- `RouteCandidate` and `routeConversation` use the frozen candidate/input/output fields and five route kinds. Routing examines server-resolved candidates and explicit flags only; it does not read message text or match topic labels as keywords.
- Explicit new-topic choice returns `AI_NEW` without candidate identifiers. A unique explicit server-resolved selection routes its matching AI conversation or active HUMAN ticket even if classifier confidence is absent or low; confidence is returned as normalized metadata. A missing confidence is `0`, and malformed/out-of-range confidence is also `0`.
- Automatic routing with candidates requires confidence `>= 0.8`. Missing/low confidence and multiple unselected candidates ask for context. A unique active AI candidate returns `AI_EXISTING`; a unique active HUMAN candidate requires a linked ticket and non-null status/revision. `RESOLVED`, `CLOSED`, and `CANCELLED` contexts ask for clarification and never silently resume a HUMAN ticket. Unknown or duplicate selected IDs also ask for context.
- Fixed reason codes contain no candidate labels, message text, or identifiers.

## Test evidence

The first behavioral run used callable placeholder exports after tests were written. RED produced 9 failing cases out of 17: valid state transitions/reassignment, new/existing/HUMAN routes, selected-candidate order independence, confidence threshold, explicit new topic, and spam behavior failed as expected.

After adding the missing-confidence edge cases, a second RED run produced 1 failing test out of 20: automatic routing incorrectly treated absent confidence as `1` and selected the sole HUMAN candidate. The explicit-selection-without-score case passed. The implementation was corrected so automatic routing treats absent confidence as undecided while a unique explicit server-resolved choice bypasses classifier confidence.

Final checks:

- `pnpm exec vitest run tests/conversation-router.test.ts tests/ticket-state-machine.test.ts` — 2 files, 20/20 tests passed.
- `pnpm exec eslint lib/conversation/router.ts lib/conversation/state-machine.ts tests/conversation-router.test.ts tests/ticket-state-machine.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` — still exits 1 on one diagnostic outside this ownership: `tests/line-delivery.test.ts:104`, where `errorCode` is accessed on a `DeliveryResult` union that does not guarantee the property. No type diagnostic points to the assigned router, state machine, or tests.
- No database, remote, environment, package, or provider operation was performed.

## Remaining integration responsibilities

These pure functions do not authorize or mutate a ticket. The ticket service/context resolver must validate any selection against its stored one-time, revision-bound choice; reload and lock candidate rows; check current revisions, active staff, department grants, assignment, and sensitivity; apply `nextTicketStatus` transactionally; and write history/activity/outbox atomically. Router IDs are outputs from server-resolved candidates, not permission to accept client-supplied identifiers. Database races, RLS, HUMAN mode persistence, and delivery behavior remain for integration tests and the acceptance gate.
