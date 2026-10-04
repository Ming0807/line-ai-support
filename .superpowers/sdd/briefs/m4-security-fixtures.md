# M4 actual PostgreSQL security/concurrency fixture

Owner: Luna MAX, only `tests/database/ticket-security.integration.ts` and `.superpowers/sdd/reports/m4-ticket-security.md`. Read M4 plan, root ticket service/authorization/create-ticket/Staff command source. Root owns fixes and migration. No schema/env/credentials/API/root files/commit/push/nested agents.

Use fixed dedicated local URL port54422 and fake random UUIDs; rollback fixtures wherever possible. Concurrent tests can commit narrowly scoped random fixtures but must clean only those IDs, including activities/receipts/choices/action tokens/outbox/history/messages/tickets/conversations/identities/sessions/profiles/auth users/departments in FK-safe order. No remote database or actual LINE transport.

Call `applyTicketAction(client,staffId,ticketId,action,{revision,requestId,...},key)` inside explicit transaction. `createEscalation(client,{sessionId,conversationId,departmentCode,summary},key)` shares caller transaction. `processStaffCommand(client,event,key)` validates binding/token and invokes service. `hashStaffLineUserId`/`hashOpaqueToken(...,'staff-command')` provide hash inputs; ciphertext uses encryptValue. Server fake subject ID is trusted only as fixture input.

Required behavioral cases: two concurrent authorized accepts yield exactly one winner and one ACCEPTED/activity row; wrong department, Admin without explicit grant, inactive actor and restricted flag denial have no success audit/mutation; ordinary wrong assignee cannot reply/resolve/close/reassign/reopen; reply duplicate request returns same result and one message/audit/outbox; same requestId different body conflicts; stale revision conflicts; lifecycle resolve→close→scoped supervisor reasoned reopen yields WAITING_STAFF/HUMAN with assignment cleared and history action REOPENED (no status of that name); reassign target must be active and eligible same scope.

Staff command cases: unbound, wrong binding, forged/expired/replayed/stale token do not accept; correctly bound active subject accepts once. Ensure no Student line identity/session/message is created by commands. Check private table effective anon/authenticated grants (RLS alone is insufficient).

Use a savepoint around expected failures if needed; transaction is not aborted by TicketError but database errors need rollback to savepoint. Don't weaken contracts to make tests pass; report actionable findings to root. Wait for root authorization to run the focused PostgreSQL file, because full queue suites share this local fixture database. Tests can be authored meanwhile.
