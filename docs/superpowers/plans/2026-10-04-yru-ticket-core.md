# M4 Ticket core implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with bounded ownership and review gates. The user already authorized continuous execution.

**Goal:** Deliver Student context selection, scoped human ticket lifecycle, dashboard operations and durable channel-correct LINE delivery.

**Architecture:** The inbox worker coordinates Student routing and ticket effects in one transaction. All staff mutation requests go through the ticket service; opaque choices are session/revision bound. An independent outbox worker delivers after commit, using a dedicated session-mode connection and a conversation advisory lock shared by takeover transactions to serialize delivery against HUMAN changes.

**Tech Stack:** Next.js16.3.8, TypeScript, Zod, PostgreSQL17/Supabase, LINE Messaging API, Vitest/node:test.

## Global constraints

- Master guide and `.superpowers/sdd/briefs/m3-m4-integration.md` govern scope. Anonymous V1 has no Student profile tables.
- No AI provider calls or simulated AI classification. Before M5, neutral menu/context responses and explicit contact-staff department choices drive the human path.
- Staff free text never sends to Students. A private active identity and single-use typed postback are required for Staff OA actions. Binding UI is M9; test bindings are controlled local fixtures.
- Every backend read/mutation rechecks active profile, explicit Admin grants, department and sensitivity. Supervisors/Admins with applicable scope may delegate replies; ordinary Staff must be assignee. Reassign/reopen require scoped supervisory role; reopen requires reason.
- Enqueue acknowledgements, replies and individually eligible Staff notifications atomically with ticket/history/activity; delivery failure is separate from business state. No HTTP call inside a database transaction.
- Remote additive migrations follow local replay, PostgreSQL privacy/concurrency tests and independent review. No remote fixtures persist; no secrets or raw LINE IDs in logs.

## Frozen interfaces and ownership

Root owns `types/tickets.ts`, schema, ticket service/reads/API, quick-choice persistence, context resolver, Student worker integration, outbox persistence/lease/dispatch, integration tests and deployment. Luna MAX owns pure `lib/conversation/{router,state-machine}.ts` and associated unit tests. Luna MAX transport task owns `lib/line/delivery.ts` and its unit test only. Luna HIGH UI task owns ticket pages/components and `app/tickets.css` only after DTO freeze. All subagent briefs are Markdown; root reviews and commits.

### Pure logic contract

`TicketStatus` is NEW|AI_HANDLING|WAITING_STAFF|STAFF_HANDLING|WAITING_USER|RESOLVED|CLOSED|CANCELLED. `TicketAction` is ACCEPT|STAFF_REPLY|USER_REPLY|RESOLVE|CLOSE|REOPEN|REASSIGN. `nextTicketStatus(status,action):TicketStatus|null` implements the transition table in the integration brief. REASSIGN is allowed only after acceptance in STAFF_HANDLING or WAITING_USER; WAITING_STAFF stays unassigned until ACCEPT, avoiding an assignment that has no valid accept/reply path. This policy resolves the review's pending-assignment ambiguity while keeping REASSIGN status unchanged. CANCELLED is unreachable. No AI action in M4.

`RouteCandidate` has conversationId, conversationRevision, mode, topicLabel, ticketId|null, ticketRevision|null, ticketStatus|null. `routeConversation({candidates,selectedConversationId?,newTopic?,spam?,confidence?})` returns `{route,conversationId?,ticketId?,confidence,reason}` with the five specified route kinds. Selection IDs are server-resolved opaque choices, never raw client IDs. Low confidence <0.8 asks context when candidates exist. Multiple candidates without explicit valid selection ask context; closed/resolved/cancelled candidates are not reopened. HUMAN candidate with active ticket routes HUMAN_TICKET, AI candidate routes AI_EXISTING. Explicit new topic returns AI_NEW and leaves old HUMAN candidate untouched.

### Transport contract

`deliverLine({channel,mode,recipientId,replyToken?,messages,retryKey,firstAttemptAt,replyDeadlineAt?,attempts}, {accessToken,fetchImpl?,now?,timeoutMs?}):Promise<{status:'SENT'|'RETRY'|'DEAD'|'UNKNOWN',httpStatus?:number,requestId?:string,errorCode?:string,mode:'REPLY'|'PUSH'}>`.

Messages are validated LINE text messages/quickReply postbacks; never mutate them. In-window unused reply uses Reply API once; expired unused reply switches to Push. Reply attempted previously or timeout/5xx is UNKNOWN without fallback. Push stable retry-key/body/recipient on timeout/5xx/429 within24h;409 counts SENT;permanent4xx DEAD;24h expiry DEAD. Transport never logs credentials/body/token and bounds request IDs. Root persists effective mode before first request and prevents reusing ambiguous replies.

### Dashboard/API contract

`listTickets(staffId,filters)` returns `{tickets:TicketListItem[],departments:{id,code,name_th}[],assignees:{id,display_name}[]}`. Filters: department,status,priority,assignee,from,to,sensitivity. `getTicketDetail(staffId,id)` returns `TicketDetail|null` with ticket, ordered messages/history, scoped assignees and safe delivery states. DTO fields are defined in `types/tickets.ts`; no raw LINE IDs/tokens/private payloads.

POST `/api/tickets/[id]/{accept,reply,resolve,close,reassign,reopen}` requires same-origin browser request, verified Staff session and strict schema: revision, UUID requestId; reply adds text; reassign adds assigneeId; reopen adds reason; resolve optional reason. Reply idempotency uses requestId plus actor/ticket/action server scope. Stale revision409; unauthorized/foreign ticket404; bad request400; auth401. No generic PATCH. GET list/detail uses same server guard.

## Task 1 — schema and transaction fences (root)

- [ ] Write real-PG red tests proving no outbox claim, revision choice persistence or atomic ticket actions exists.
- [ ] CLI-generate additive migration: revisions; private route choices/action receipts/activities/staff identities/action tokens; outbox target/mode/UNKNOWN/order/claim; RLS/revocations/service grants.
- [ ] Implement enqueue/claim; use session-mode DIRECT_URL only for advisory locks spanning bounded HTTP. Ticket mutation takes matching transaction advisory lock before row locks.
- [ ] Test exclusive/ordered claim, expired reply UNKNOWN recovery, stable retry keys, browser denial and source/target constraints.

## Task 2 — pure transitions/router and transport (Luna MAX)

- [ ] Add failing fixtures for every allowed/invalid lifecycle transition, multiple contexts, HUMAN new topic and low confidence.
- [ ] Implement frozen signatures and run focused Vitest.
- [ ] Add fake transport failures: Reply timeout never Push; expired unused reply Push; Push same retry key/body;409 SENT;429/5xx RETRY;4xx DEAD;24h expiry.
- [ ] Write RED/GREEN result reports; root checks contracts and integration.

## Task 3 — ticket service/context/Student processing (root)

- [ ] Implement validated department selection; explicit escalation WAITING_STAFF/HUMAN, history and activity, acknowledgement and scoped notification.
- [ ] Implement service guards and action idempotency under advisory+row locks. Two simultaneous accepts produce one winner, one ACCEPTED row.
- [ ] Persist one-time HMAC opaque choices with exact candidate snapshots/revisions, session, expiry and optional pending message. Forged/foreign/stale/replayed choices cause no ticket mutation.
- [ ] Extend Student schema to signed direct-user postbacks/reply-token capture. Process after rate guard; messages route to all owned active candidates. Ambiguous content waits for a choice; no keyword topic selection.
- [ ] Test new topic preserves old HUMAN, WAITING_USER reply maps to owned ticket and CLOSED stays closed.

## Task 4 — API/dashboard/Staff commands (root + Luna HIGH)

- [ ] Read installed Next route-handler/async params docs; create guarded list/detail/action endpoints with origin/strict payload checks.
- [ ] UI list/detail with filters, empty/error/loading states, clear HUMAN/AI state, accept/reply/resolve/close/reassign/reopen controls and revision/conflict handling.
- [ ] Typed bound Staff postback uses same service guard; token tied to Staff, revision/action/expiry and consumes atomically only with authorized action.
- [ ] Browser test login→scoped queue/detail→actions; unauthorized API and cross-department checks.

## Task 5 — integrated acceptance/deployment (root + independent reviewer)

- [ ] Real local PG flow: signed Student event→explicit department/contact→ticket→accept→dashboard reply→fake Push retry→user reply→resolve→close; prove atomic rollback and one audit/outbox effect on replay.
- [ ] Controlled barrier races for takeover vs AI enqueue/send, exclusive accepts and outbox delivery. Transport stays outside transactions; dispatch and takeover serialize on the same dedicated-session conversation lock.
- [ ] Clean migration replay, full RLS/privacy suite, focused/full tests, typecheck/lint/build, actual Next/API/browser evidence and independent review.
- [ ] Apply reviewed additive migration only to selected dev project; fresh runtime smoke, report and commit/push noninteractively. Live human configuration/test evidence stays explicitly deferred. Continue M5.
