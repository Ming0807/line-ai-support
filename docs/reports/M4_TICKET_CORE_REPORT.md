# M4 — Ticket core, scoped dashboard and LINE delivery

Automated acceptance passed on 4 October 2026. Student context selection, validated department escalation, HUMAN ticket lifecycle, scoped dashboard actions and durable channel-correct delivery are implemented. Real human OA delivery through the new complete ticket flow remains a manual check; controlled transport evidence below does not claim a real LINE send.

## Verification

- Clean replay of all seven migrations on the dedicated local project. Full effective-role RLS/grant/privacy fixture and **52/52 PostgreSQL integration tests** pass. Local security/performance advisors report no issues.
- **155/155 unit tests**, TypeScript, ESLint and production build pass. Original Student/Staff echo regressions remain passing.
- Actual signed HTTP → Next production route → encrypted PG inbox → worker → department choice → WAITING_STAFF/HUMAN ticket → individually scoped Staff notification → signed bound-Staff ACCEPT postback → STAFF_HANDLING passes. Staff service reply/replay produces exactly one message/history/outbox effect. Controlled Push503→409 keeps its key/body; Student CONTINUE reaches the same HUMAN ticket; an explicit NEW choice for “ห้องสมุดปิดกี่โมง” creates a separate AI context and preserves the registration ticket; resolve/close passes. Exact fixture cleanup runs in finally. This runner uses the ticket service directly for Staff reply; authenticated dashboard evidence is separate.
- Actual Chromium with three real development Auth accounts and controlled local ticket fixtures passes14 cases: scoped/restricted reads and denial, accept/reply, stable action replay, stale revision409, foreign origin403, Library accept/resolve/close, mobile layout. Screenshots inspected at desktop and390px without overflow. Fixture mirrors use trusted account subjects only and are removed.
- PostgreSQL coverage proves competing accepts have one winner, transactional rollback, action/choice expiry by database clock, finite retries, ordered claims, first-attempt commitment before HTTP, accepted-Push finalization recovery, purpose-separated Staff targets/tokens, current scope revocation, frozen-recipient retry suppression and unused expired Reply mode persisted as PUSH before HTTP. Controlled takeover/dispatch barriers prove no open SQL transaction during HTTP and no AI send after HUMAN takes the shared conversation lock.
- Independent backend and delivery reviews have no open implementation blocker. Review-found WAITING_STAFF reassignment dead end, clock expiry, bounded-body/origin and channel/kind boundary defects were fixed with behavioral evidence. The channel/kind guard has witnessed RED→GREEN and enqueue/dispatch/database enforcement.

## Development deployment and the reported dashboard error

The reported `column t.revision does not exist` was reproduced as `TICKET_SCHEMA_REVISION_MISSING` on the development database, which still had six migrations while the working dashboard required M4. After reviewed local gates, the guarded additive deployment applied only the selected development project's seventh migration. Postflight confirms18 application tables with RLS and nine departments, without deleting or overwriting existing data.

Remote full privacy/effective browser/server grant checks and real Super Admin/IT/Library subject fixtures pass and roll back. The same schema/read smoke now passes for all three accounts. Actual browser login, `/tickets`, its API and reload on `http://localhost:3000` pass for all three roles; there are currently zero real tickets. This resolves the user's reported error.

Current development inbox and outbox workers were started with M4 source after both `--once` checks exited0. Outbox uses the strict-TLS session-mode DIRECT_URL. Fresh localhost and the current public tunnel return200 for signed empty verification,401 for an invalid signature and405 for GET on both channels.

## Remaining evidence and next milestone

- Real Student escalation → dashboard Staff reply → real Student receipt should be tested by the human after final configuration. Earlier echo confirmations are separate evidence. Staff binding UI and supported binding mutation are M9; controlled local bindings alone were used here.
- M9 binding/revocation must take the same `delivery:STAFF:staffId` advisory lock as dispatch; its barrier race is a required later integration gate.
- AI/RAG are not present in this checkpoint. Menus/context choices are backend behavior, and the separate AI context above has no claimed generated answer. All real corpus resources remain pending review and unpublished.
- Continue M5 under `docs/superpowers/plans/2026-10-04-yru-ai-gateway.md`; full V1 remains active and incomplete. Missing provider credentials and other human configuration will be consolidated in the final V1 report.
