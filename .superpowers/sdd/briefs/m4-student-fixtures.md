# M4 Student route/choice integration fixture

Owner: Luna HIGH, only `tests/database/student-ticket.integration.ts` and `.superpowers/sdd/reports/m4-student-routing.md`. Root owns Student implementation and all schema/services. No remote DB, environment/credential reads, packages/commit/push/nested agents.

Use dedicated local port54422 and rollback-only fake Student/session identity rows. Import `processStudentContent` directly with `{sessionId,eventId,receivedAt,event}` and test generated encrypted outbox payload using decryptValue; no actual LINE calls. Source event IDs for messages must be real inbox fixture IDs if a FK exists. Define fake IDs/content only; do not print opaque tokens.

Expected path: first text creates anonymous AI conversation/message and neutral menu; decrypt outbox to extract `yru:choice:` contact token; contact postback creates department choices; select validated IT department token; escalation creates WAITING_STAFF/HUMAN ticket + CREATED/ROUTED audit + Student acknowledgement. A department fixture with bound eligible Staff can prove one private notification, but root security suite separately covers recipients.

Test choice forging/session mismatch/expiry/replay/stale revision causes no ticket mutation and safe fresh-context response; alternatives for the same pending message are invalidated after one consumes it. Human new-topic path: create a HUMAN ticket, send text for library (no keyword auto-routing), prove pending context and unchanged old ticket; choose New issue and create separate AI conversation, then contact Library on that context. WAITING_USER pending text plus explicit Continue choice routes message to owned HUMAN ticket and moves to STAFF_HANDLING, with no automatic AI outbox reply. CLOSED context never reopens on text.

Check all owned active contexts are candidates, no dependence on only active_ticket_id or latest conversation, and content ownership is preserved. Report defects with failing regression. Do not edit root code. Wait for root authorization before running focused PG file to avoid overlapping global queue tests.
