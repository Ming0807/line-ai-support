# M3/M4 integration implementation brief

Status: bounded implementation brief for work after M2 dev deployment. The master guide remains authoritative. This covers M3 durable LINE processing and M4 ticket/router/HUMAN operations. It does not widen scope into AI Gateway, RAG, imports, provider settings, remote database writes, or the final dashboard/configuration report.

## Baseline and hard boundaries

M1 provides a channel-scoped webhook inbox, encrypted payloads, unique (channel, event_id), event sequence, per-(channel,user_hash) transactional enqueue locks, stale-lease fencing, and event_kind. The shared receiver in lib/line/receive-webhook.ts verifies raw-body HMAC, but live Student and Staff routes still log or reply directly through echo helpers. scripts/worker.ts claims only STUDENT jobs. lib/queue/process-inbox.ts treats every valid user event as Student and can create public.line_sessions. private.message_outbox and private.delivery_attempts exist, but there is no outbox claimer/sender. Current staff_profiles has no LINE binding; Staff identity is established by requireStaff() in lib/auth/staff.ts.

Retain these invariants:

- V1 remains anonymous. Never add a students or student_profiles table.
- Verify exact raw request bytes using the secret belonging to the route’s fixed channel before parsing or acting on an event. Ignore any channel value in the body.
- Return HTTP 200 only after durable inbox commit. Persistence failure returns retryable non-2xx; (channel,event_id) dedup makes redelivery harmless.
- Preserve per-channel/per-user receive order and independent progress for other users. Keep the M1 enqueue-order and stale-lease regressions.
- Event payloads, reply tokens, raw LINE IDs, and command tokens stay encrypted or hashed and server-only. Logs contain bounded channel/result/count/error-code metadata only.
- Staff-channel events never create or modify public.line_sessions, private.line_identities, Student conversations, or Student messages. Staff OA is a notification/command surface for authenticated staff, not chat with Students.
- Every ticket write goes through one transaction-backed service. Check active staff, explicit department grants, assignment/delegation, and sensitive/restricted scope in the service as well as relying on RLS.
- No broadcast. Notify eligible active Staff recipients individually and omit restricted details.

## Decisions to freeze

1. Both webhook routes call the shared durable receiver with fixed STUDENT or STAFF dependencies. Remove direct echo sends from request handlers. Never both echo and enqueue a reply. Keep echo helper tests isolated; replace live route assertions with durable ingress/outbox assertions.
2. One worker deployment services two isolated inbox lanes, each claimed with a fixed channel. processInboxEvent dispatches by the claimed channel. Staff never falls through to the Student processor. Unbound/inactive/unsupported Staff events complete as safe ignored events; they do not bootstrap an identity.
3. Use existing encrypted private.message_outbox for every Student reply/push and Staff notification. Insert the outbox row in the same database transaction as the message/ticket/history change that authorizes it. Never call LINE while holding a DB transaction.
4. An escalated ticket starts WAITING_STAFF with both ticket.mode and its linked conversation.mode set to HUMAN atomically. Accept assigns the winner and moves it to STAFF_HANDLING; it never restores AI. Other conversations in the same LINE session remain unchanged.
5. M4 implements human ticket lifecycle and deterministic routing/context selection only. Until M5 supplies AI Gateway, expose an explicit Student contact-staff action for the tested escalation path. Do not present a keyword or deterministic stub as AI classification.
6. CLOSED → WAITING_STAFF is the only reopen path. Store history action REOPENED, never a REOPENED status. Require scoped supervisor/admin permission and a reason; clear assignment. Keep CANCELLED unreachable in M4 because the guide does not define its actor/policy. Do not add generic status PATCH.
7. Staff OA accepts typed postback actions with opaque, single-use, expiring server-side tokens. Free-text Staff messages cannot accept, reassign, or reply to a Student ticket. The dashboard is the only Staff-to-Student reply UI.
8. Enqueue staff reply as durable Student Push and move ticket to WAITING_USER in the same transaction. Delivery state is tracked separately. Do not roll back a valid ticket transition because LINE is temporarily unavailable.

## M3 — durable Student and Staff LINE integration

### Ordered implementation

1. Refactor app/api/line/student/webhook/route.ts and app/api/line/staff/webhook/route.ts to call lib/line/receive-webhook.ts and lib/queue/inbox.ts. Keep route channel, secret, encryption key, and access-token selection server-configured and separate. The shared receiver bounds body bytes/event count; verifies HMAC against exact bytes; parses strict UTF-8 JSON only after verification; persists the encrypted event; then acknowledges. Empty verification events remain 200. Invalid signature/JSON/envelope return 401/400; oversize returns 413; missing channel configuration or failed commit returns 503. Remove full-payload Student logging even though the current recursive redactor masks known identifiers.
2. Split runtime validation in lib/line/events.ts into Student and Staff event schemas. Student supports direct user message/follow/unfollow with validated nonempty text/media shapes. Staff accepts only direct user postbacks needed for commands/binding. Unsupported, group, and room events are never reinterpreted as Student input. Persist unknown events safely; the worker applies none of them.
3. Extend lib/queue/process-inbox.ts so InboxJob includes channel and dispatches to processStudentInboxEvent or processStaffInboxEvent. Student processing retains HMAC-derived identity lookup, encrypted raw ID, unique session creation, source_event_id idempotency, message rate window, and sequence order. Staff processing uses a new server-only private.staff_line_identities table keyed by a purpose-separated HMAC and linked to active staff_profiles; encrypt the Staff LINE ID separately. Do not add the ID to a public profile column. Binding starts from an authenticated Staff account and is one-time/expiring; inbound text cannot self-enroll.
4. Update scripts/worker.ts to service both fixed-channel inbox lanes fairly and independently. Preserve processInboxEvent’s transaction and stale-lease fence. Messages/tickets/history/outbox effects commit with DONE; failures roll back before the fenced retry/dead-letter update. Keep bounded error codes and current five-attempt behavior.
5. Add lib/queue/outbox.ts plus channel-specific senders in lib/line/reply.ts and lib/line/push.ts, run by scripts/outbox-worker.ts or an equivalent long-running worker. Claim with SKIP LOCKED, token-fenced lease, per-recipient ordering, retry/backoff, and no duplicate side effects. Student target lookup decrypts only inside the server worker from private.line_identities; Staff notification target lookup uses private.staff_line_identities. Validate channel/kind/recipient combinations before sending.
6. If the demo echo is retained, generate it only from a fresh valid event and enqueue it in the same processing transaction with a stable event-scoped idempotency key and channel-correct replyToken. Redelivery must not enqueue a second echo. Otherwise remove echo behavior rather than leaving a direct send path. Retire Staff message echo; Staff channel handles bound commands and safely ignores unsupported input.

### Outbound delivery contract

Add one timestamped migration through the project’s migration tooling. Extend private.message_outbox with exactly one target: Student line_session_id or Staff recipient_staff_id, consistent with channel; delivery mode REPLY or PUSH; reply_deadline_at; and terminal UNKNOWN for ambiguous reply attempts. Keep encrypted payload, unique idempotency_key, stable unique line_retry_key, attempts, lease fields, private.delivery_attempts, and sanitized error code. Add private.claim_outbox, service-only grants, indexes, and recipient-lane ordering so concurrent writers cannot send later messages ahead of earlier ones. Earlier PENDING/PROCESSING rows block a lane; DEAD/SUPPRESSED release it. Browser roles have no access to private outbox, identity, or token tables.

A reply token is single-use. The current LINE reference says use it within one minute, while warning that the limit may change and success after it is not guaranteed. Centralize one conservative safe window (20 seconds default; server-configurable, never above 60 seconds) and attempt Reply immediately inside it. If a reply row has not been attempted and is already outside the window, switch it to Push before its first request. Do not retry Reply or fall back to Push after timeout/5xx/any result that could have been accepted; mark UNKNOWN (or permanent 4xx DEAD) and surface a safe operational failure. Reply API does not support retry keys.

For Push, use the row’s same line_retry_key on the first request and every retry, with identical recipient and body. Mark 2xx SENT; mark 409 SENT because LINE already accepted that retry key; retry timeout/5xx with exponential backoff only while within 24 hours; stop on 4xx and mark DEAD. Never change recipient/body or rotate the key on retry. Store only sanitized status/request ID/error code in delivery_attempts; never store response bodies or auth headers. Current official references: [LINE reply-token reference](https://developers.line.biz/en/reference/messaging-api/nojs/) and [LINE retry-key guidance](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/).

### M3 schema and real-PostgreSQL gate

Required additive schema work:

- private.staff_line_identities with unique keyed hash, encrypted Staff LINE ID, staff_profile_id FK, timestamps/active state; service-role only.
- private.staff_binding_tokens or equivalent with token hash only, staff ID, expiry, consumed time, and attempt limit; service-role only.
- private.message_outbox target/delivery fields, UNKNOWN state, private.claim_outbox with SKIP LOCKED lease, indexes, and recipient order.
- Constraint that channel matches exactly one valid recipient target.

Real PostgreSQL tests must prove:

- Signed raw bytes pass; altered bytes fail before parsing/persisting; empty events succeed; DB outage returns non-2xx. Same channel/event ID dedups; identical ID on the other channel is independent.
- Redelivery cannot duplicate Student message/outbox response. Student and Staff secrets/tokens do not cross. Payload/replyToken never appear in logs or plaintext columns.
- Same-user order, independent-user progress, channel isolation, lease expiry, stale-token rollback, retry-to-DEAD, and no premature 200 hold with both worker lanes active.
- Unbound/inactive Staff message or postback creates no line_sessions, line_identities, conversations, tickets, or Student messages, and does not consume Student quota. A bound Staff fixture maps only to its profile.
- Concurrent outbox claims are exclusive and ordered per recipient. Duplicate idempotency keys create one row. Transaction failure leaves no partial message/history/outbox.
- Fake LINE transport proves: in-window Reply; unattempted expired Reply switches to Push; Reply timeout becomes UNKNOWN without Push; Push retries keep one retry key and exact body/target; 409 is SENT; 4xx is DEAD; retries after 24 hours are refused.

Keep echo helper tests where possible, but replace any route-level claim that an HTTP request directly sends a reply. Add localhost smoke proving valid signed ingress commits before 200, duplicate delivery is idempotent, and the worker sends exactly one message through fake transport.

## M4 — router, ticket lifecycle, Staff commands, and dashboard/API

### Exact application surface

Create the roadmap paths:

- lib/conversation/router.ts — pure route decision over server-loaded candidates.
- lib/conversation/context-resolver.ts — map Student event to owned session/conversation/ticket; never trust IDs from LINE payload or request body.
- lib/conversation/quick-reply.ts — opaque, one-time choices bound to session, candidate IDs/revisions, and expiry.
- lib/conversation/state-machine.ts — pure valid action/status table; no generic updates.
- lib/tickets/ticket-service.ts — sole mutation boundary and transaction coordinator.
- lib/tickets/create-ticket.ts, lib/tickets/route-department.ts, lib/tickets/human-takeover.ts — narrow service functions called only by ticket-service or Student worker.
- types/tickets.ts — runtime-validated request/response/action unions.
- app/api/tickets/route.ts, app/api/tickets/[id]/route.ts, app/api/tickets/[id]/accept/route.ts, app/api/tickets/[id]/reply/route.ts, app/api/tickets/[id]/resolve/route.ts, app/api/tickets/[id]/close/route.ts, app/api/tickets/[id]/reassign/route.ts — authenticated Staff endpoints; no status PATCH.
- app/(dashboard)/tickets/page.tsx and app/(dashboard)/tickets/[id]/page.tsx — scoped queue/detail with obvious HUMAN mode. Follow guide filters: department/status/priority/assignee/date/sensitive. Never show raw LINE ID.
- Extend lib/queue/process-inbox.ts for Student routing and bound Staff postbacks after message persistence and dedup.

### Router and lifecycle contract

Router is deterministic and side-effect-free. It receives message plus all eligible candidates loaded for that session, each with safe display label and current revisions. Return discriminated AI_NEW, AI_EXISTING, HUMAN_TICKET, ASK_CONTEXT, or SPAM with exact conversation/ticket references where selected, confidence, and reason. Department selection maps validated intent to active department codes. Low confidence, unknown/ambiguous department, or multiple plausible tickets asks context; keyword alone never picks a department/ticket. Before M5, AI route results stop at neutral no-AI response or explicit contact-staff choice.

Use private.pending_route_choices (or equivalent server-only durable store) for one-time opaque values. Bind each choice to Student session, exact candidate set, ticket/conversation revisions, choice, and expiry; consume atomically. Expired/replayed/forged/foreign/stale choices do nothing and request fresh context. Labels are safe and non-sensitive; token contains no raw IDs. Never use conversations.active_ticket_id as sole route source; query all session-owned conversations and tickets so multiple issues remain distinct.

Ticket actions, all through ticket-service:

| Action | Transition and atomic effects |
|---|---|
| CREATE_ESCALATION | New ticket WAITING_STAFF; set ticket and linked conversation HUMAN; persist validated summary/category/department/sensitivity/context; add CREATED and ROUTED history/activity; enqueue Student acknowledgement and department-scoped Staff notification. |
| ACCEPT | Unassigned WAITING_STAFF → STAFF_HANDLING. Lock ticket/conversation in stable order. One active authorized Staff wins; set assignee/accepted_at and bump revisions atomically; write one ACCEPTED history/activity. Concurrent loser returns conflict/already handled with no mutation. |
| STAFF_REPLY | Only active authorized assigned Staff/delegate; require HUMAN and nonempty validated text. Persist STAFF message, set WAITING_USER, add STAFF_REPLIED history/activity, enqueue one Student Push with server-generated ticket/message-scoped idempotency key. |
| USER_REPLY | Resolve by signed source event and server context. Only uniquely owning ticket in WAITING_USER advances to STAFF_HANDLING; preserve HUMAN/assignment and record USER_REPLIED. Ambiguity asks context with no ticket mutation/send. |
| RESOLVE | Authorized assigned Staff/delegate in STAFF_HANDLING → RESOLVED; record actor, reason if any, timestamp and history/activity. |
| CLOSE | Scoped Staff RESOLVED → CLOSED; record history/activity. A user message does not reopen. |
| REOPEN | Scoped supervisor/admin permission and reason; CLOSED → WAITING_STAFF, record action REOPENED with CLOSED→WAITING_STAFF, clear assignee, notify eligible department Staff. Never persist status REOPENED. |
| REASSIGN | After ACCEPT, scoped supervisor/admin selects active eligible Staff in the same authorized department/sensitivity scope; STAFF_HANDLING or WAITING_USER stays unchanged; record REASSIGNED. WAITING_STAFF remains unassigned until ACCEPT. This clarification avoids the reviewed pending-assignment dead end. |

CANCELLED remains unreachable in M4. START_AI, AI_HANDLING, AI escalation, and AI_RESOLVE remain unavailable until M5; test the state vocabulary without inventing an AI actor or API.

Add integer revisions to tickets and conversations, or equivalent compare-and-set tokens, and bump in every routing/mode/status mutation. Accept sets ticket and linked conversation HUMAN atomically. Any future AI/outbox enqueue rechecks both modes/revisions immediately before durable insert. Test a controlled race where Accept commits first and the generated AI row is suppressed; test the opposite ordering and verify serial outcomes, never a stale AI send after takeover.

Ticket message, state, ticket_history, private.activities audit row, and outbox enqueue share one transaction. History actor IDs follow current DB rule: STAFF has staff ID; SYSTEM/USER/AI do not. Audit metadata is allowlisted and omits raw IDs, tokens, secrets, and inbound bodies. Make private.activities server-write-only; ticket detail reads scoped ticket_history. Idempotent replay yields one message, history action, activity, and outbox row.

### Staff command boundary

No automatic Staff identity from display name or incoming message. Binding UX can wait for the final configuration pass, but command processing is disabled unless an active private.staff_line_identities binding exists. Notify each eligible active Staff profile individually with ticket number/category/priority and safe dashboard link; Restricted tickets get generic notice. No all-department broadcast.

Accept and Open Dashboard are typed postbacks, not free text. Store only hash of a random single-use command token, bound to active staff ID, ticket ID, action, expected revision, and expiry. Validate Staff channel/signature, mapped active profile, token/expiry/use, then invoke the same ticket-service guard. Recheck department grant, sensitivity, status/revision, and assignment inside that transaction. Payload contains opaque token/action only, never raw ticket UUID/student ID. Duplicate webhook events are deduped; repeated/stale token is harmless. Dashboard link still requires login and normal server authorization.

### M4 schema additions

Use CLI-generated additive timestamped migrations and preserve M1 explicit-privilege/RLS patterns:

- tickets.revision and conversations.revision for routing/takeover fences; collected_context JSONB only if case-specific context is needed, validated/minimized, and protected by ticket RLS.
- private.pending_route_choices: hashed opaque token, line_session_id, candidate snapshot/revisions, choice, expiry, consumed_at; service-role only.
- private.staff_action_tokens: token hash, staff_profile_id, ticket_id, action, expected revision, expiry, consumed_at; service-role only.
- private.staff_line_identities and private.activities as above.
- private.message_outbox recipient/delivery fields, UNKNOWN state, claim/lease function, per-recipient order.
- Any new public table requires RLS, explicit browser read/write grants, and rollback-only real-role fixture; prefer private for tokens/activity/queue state.

### M4 tests and acceptance gate

Unit tests in tests/conversation-router.test.ts and tests/ticket-state-machine.test.ts cover every route and allowed/invalid transition: no candidates; one AI conversation; one HUMAN ticket; two uniquely resolved tickets independent of ordering; two plausible tickets ask context; explicit new topic leaves HUMAN issue unchanged; stale/expired/foreign/replayed choice; low confidence/keyword collision; CLOSED does not reopen; CANCELLED has no outgoing transition.

Real PostgreSQL tests (extend/create tests/database/tickets.integration.ts and tests/database/queue.integration.ts) prove:

- Ticket create plus WAITING_STAFF/HUMAN mode, linked conversation, CREATED/ROUTED history, activity, Student acknowledgement, and department Staff notification are atomic; injected failure leaves no partial rows.
- Two concurrent authorized accepts produce one assignee/revision/ACCEPTED audit. Wrong department, ungranted Admin, inactive staff, sensitive/restricted denial, wrong assignee, or stale revision has no mutation or success audit.
- Staff reply requires HUMAN and assignment/delegation. One idempotency key yields one STAFF message/history/activity/outbox; status is WAITING_USER. Delivery retry adds no message or transition.
- AI-in-flight race uses real transactions and a barrier. Test both accept-wins and enqueue-wins orderings.
- Student reply uses source event/session ownership and unique server context; no client-selected IDs. New topic uses a separate AI conversation while old ticket stays HUMAN; CLOSED message does not reopen.
- Staff postback requires bound active identity, current one-time token, and exact revision. Forged/expired/replayed/foreign-channel/wrong-department/restricted commands do nothing and never create Student session.
- Browser roles cannot access private token/outbox/identity/activity surfaces or write exposed tables. Fixtures and logs contain no raw LINE IDs or credentials.

M4 gate: real local Student event → durable inbox/message → explicit contact-staff → WAITING_STAFF/HUMAN ticket → scoped Staff accept → dashboard reply durably queued → fake LINE Push accepted/retried without duplicate → Student reply maps to the same ticket → resolve/close. Pass Flow E isolation, typecheck, lint, unit tests, real PostgreSQL integration, and production build before M5.

## Authoritative references

- CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md: sections 5–8 (anonymous identity/conversation/ticket/history), 16–17 (audit/RLS), 21–28 (webhook, spam, router, quick reply, FSM, takeover, creation/routing), 51–54 (ticket UI/reply/Staff OA), 59–60 (reply/push/privacy), 66 (router fixtures), 69–70 (Flows C–E and prohibited behavior).
- docs/superpowers/plans/2026-10-04-yru-helpdesk-roadmap.md: Global Constraints and Phase 2; Phase 7 binding/setup UI remains a later integration item.
- .superpowers/sdd/reports/m1-queue-report.md, .superpowers/sdd/reports/m1-rls-report.md, and .superpowers/sdd/reports/phase2-contract-review.md.
- Re-check official LINE rules at implementation time. Current official docs are linked above. Root-reported dev verification is evidence for M1/M2 only; it does not replace M3/M4 Postgres, concurrency, delivery, and privacy gates.
