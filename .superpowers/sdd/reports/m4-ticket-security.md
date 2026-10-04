# M4 ticket security and concurrency verification

## Scope

Added `tests/database/ticket-security.integration.ts`, an actual PostgreSQL fixture suite against the dedicated local database at `127.0.0.1:54422`. Rollback transactions contain ordinary fixtures. Two narrow committed fixtures—the concurrent accept race and caller-transaction escalation rollback—are removed by ID in `finally` blocks. No remote database, live LINE transport, environment credential, or production source was used or changed.

## Covered behavior

- `createEscalation` writes a `WAITING_STAFF`/`HUMAN` ticket, linked HUMAN conversation, `CREATED`/`ROUTED` history and activities, and one Student acknowledgement outbox row in the caller's transaction. Rolling back that transaction removes the ticket effects and restores the committed AI conversation.
- Two simultaneous authorized accepts produce one `STAFF_HANDLING` winner, one conflict, one assignment, and exactly one `ACCEPTED` history/activity/receipt.
- Wrong-department Staff, Admin without an explicit department grant, inactive Staff, and a Staff member without restricted access cannot accept. Each denial leaves status, revision, assignment, history, activity, receipt, and outbox unchanged.
- An ordinary non-assignee cannot reply, resolve, close, reassign, or reopen. The failures leave the relevant ticket state and audit tables unchanged.
- A duplicate staff reply with the same request and body returns the original result and creates one message, history/activity row, receipt, and Student outbox item. Reusing that request ID with a different body and retrying with a stale revision both conflict without extra effects.
- Resolve → close → reasoned supervisor reopen returns the ticket to `WAITING_STAFF`/`HUMAN`, clears its assignee, keeps the conversation HUMAN, writes `REOPENED` only as a history/activity action, and preserves the reopen reason.
- Reassignment accepts an active same-department target with the required restricted-access flag only after assignment, while the ticket is `STAFF_HANDLING`; inactive, wrong-department, insufficient-sensitivity, and `WAITING_STAFF` targets are denied without extra audit or assignment changes.
- Staff commands reject unbound identities, mismatched bindings, forged/expired tokens, and stale revisions. A bound active Staff identity can accept once; replay fails. Snapshot checks confirm command processing adds no Student session, identity, or message.
- `createEscalation` writes exactly one encrypted private Staff notification each for an active bound same-department Staff member, an active bound Admin with an explicit department grant, and a bound SUPER_ADMIN. Wrong-department Staff, an ungranted Admin, and inactive Staff are excluded. Every row has one Staff recipient, no Student session or conversation target, and an opaque one-time accept token stored by purpose-separated hash.
- Restricted notifications are sent only to active bound Staff with the right department and restricted flag, a scoped granted Admin with the flag, and SUPER_ADMIN. Ineligible recipients are excluded; the decrypted message contains only the generic dashboard notice. The encrypted payload contains no ticket summary, anonymous code, recipient LINE ID, Staff ID, or ticket ID.
- Effective grants and RLS are checked for M4 private activity, receipt, route-choice, Staff identity/token, outbox, and delivery-attempt tables: `anon` and `authenticated` have no table DML privileges, while `service_role` does; RLS is enabled. The `ticket_history_history_seq_seq` sequence also denies browser-role usage/select/update while granting service-role usage/select.

## Verification

- `pnpm exec tsx --test tests/database/ticket-security.integration.ts` — 12/12 tests passed against local PostgreSQL.
- `pnpm exec tsc --noEmit` — exit 0.
- `pnpm exec eslint tests/database/ticket-security.integration.ts` — exit 0.
- The initial run passed 9/10. The lifecycle assertion expected insertion order from `created_at,id`; all operations share a transaction timestamp, so UUID tie-breaking is arbitrary. The assertion now compares the status transition for each history action without assuming row order. Later focused runs also covered the revised `WAITING_STAFF` reassignment rule and notification privacy; the final run passed 12/12. No production defect surfaced in the tested cases.
