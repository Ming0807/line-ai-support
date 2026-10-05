# YRU Helpdesk Phase 2 Contract Review

Status: controller review proposal; no application or schema changes are made by this report.

## Scope and recommendation

This review covers the Conversation Router, Quick Reply, Ticket State Machine, Human Takeover, Ticket Creation, Department Routing, ticket dashboard/detail/reply flows, the prescribed router tests, Flows C–E, and the Phase 2 roadmap contract. The master guide remains authoritative. The roadmap already fixes two important interpretations: `REOPENED` is a history action that returns a ticket to `WAITING_STAFF`, and router candidates must support multiple active tickets and conversations for one LINE session.

Use a pure router over server-resolved candidates, followed by a single authorized ticket service for all mutations. A decision should identify the exact conversation and, when applicable, ticket. Never route by “the session’s active ticket” or by a keyword alone. Bind ambiguity replies to a pending server context so they cannot select a ticket from another session or an outdated candidate set.

## Proposed state and action contract

`REOPENED` is an audit action, never a ticket status. The complete status vocabulary remains `NEW`, `AI_HANDLING`, `WAITING_STAFF`, `STAFF_HANDLING`, `WAITING_USER`, `RESOLVED`, `CLOSED`, and `CANCELLED`. The FSM must reject every transition not listed below.

| Action | Status change | Authorized initiator and guards | Mode, assignment, and audit effects |
|---|---|---|---|
| `START_AI` | `NEW → AI_HANDLING` | Backend system only, for a ticket explicitly opened for AI troubleshooting. `AI` output alone is not an authenticated actor. | Requires the selected ticket and its conversation to be AI-eligible. Record the transition and source. |
| `ESCALATE` | `AI_HANDLING → WAITING_STAFF` | Backend system after a validated AI/classifier result and backend department mapping. | Create/route the staff work item once; record `ROUTED`. Whether the ticket remains `AI` until Accept or enters `HUMAN` while queued is a policy choice to freeze. |
| `AI_RESOLVE` | `AI_HANDLING → RESOLVED` | Backend system only when configured AI-resolution criteria pass and no human takeover won the race. | Record the resolution source. A model response by itself cannot write status. |
| `CREATE_ESCALATION` | *(new ticket)* `→ WAITING_STAFF` | Backend system from a routed escalation, with ownership of `lineSessionId` and `conversationId` verified. | This follows §27. Pick one documented initial mode policy (`AI until Accept` or `HUMAN while queued`) and apply it to the linked conversation consistently. Record `CREATED` and `ROUTED` once. |
| `ACCEPT` | `WAITING_STAFF → STAFF_HANDLING` | Active staff with permission for the ticket’s department and sensitivity. A normal staff member may accept an unassigned ticket; any reassignment/steal policy must be explicit. | Atomically set `assigned_staff_id`, `ticket.mode=HUMAN`, and the linked ticket conversation’s `mode=HUMAN`; record `ACCEPTED`. A concurrent accept has one winner. |
| `STAFF_REPLY` | `STAFF_HANDLING → WAITING_USER` | Assigned staff, or supervisor/authorized delegate in scope; ticket must be `HUMAN`. | Persist message, durable outbound request, status, history, and activity idempotently. Mark `WAITING_USER` when the outbound request is durably accepted for retry. AI may draft, but the authenticated staff action sends. |
| `USER_REPLY` | `WAITING_USER → STAFF_HANDLING` | Inbound LINE event, resolved by backend to the same session, conversation, and ticket. The user supplies no trusted ticket ID. | Record `USER_REPLIED`; preserve HUMAN modes and assignment. If routing cannot uniquely bind the message, ask context instead of advancing a ticket. |
| `RESOLVE` | `STAFF_HANDLING → RESOLVED` | Assigned staff or authorized supervisor/delegate within department and sensitivity scope. | Record actor and resolution event. Do not infer resolve from message text. |
| `CLOSE` | `RESOLVED → CLOSED` | Scoped staff/supervisor under the selected close policy; optional system close only if explicitly configured. | Record `CLOSED` and timestamp. A later user message does not implicitly reopen. |
| `REOPEN` | `CLOSED → WAITING_STAFF` | Only a role/policy explicitly granted `ticket.reopen`; require a reason and sensitivity/department authorization. | Write history `action=REOPENED`, `from_status=CLOSED`, `to_status=WAITING_STAFF`. Do not persist a `REOPENED` status. The controller should choose whether the previous assignee is cleared; default recommendation is clear to re-enter the eligible queue. |
| `CANCEL` | `NEW`, `AI_HANDLING`, or `WAITING_STAFF → CANCELLED` | Restrictive proposal: system or scoped staff/supervisor with `ticket.cancel`, with a reason. Do not interpret ordinary user text as cancellation. | Terminal; record `CANCELLED`. No transition out of `CANCELLED`, and no implicit reopen. The guide names the status but gives no actor or lifecycle rule, so the controller should approve this narrow policy or explicitly leave cancellation unavailable in Phase 2. |
| `REASSIGN` | Status unchanged | Supervisor or explicitly authorized staff/admin with department and sensitivity permission; destination staff must be active and eligible for the ticket. | Update assignment only through the service; record `REASSIGNED`. This is a same-status action, not a generic update. |

For ticket creation, §27 says the postcondition is `WAITING_STAFF`, while §25 also describes `NEW → AI_HANDLING → WAITING_STAFF/RESOLVED`. The smallest faithful split is to reserve `CREATE_ESCALATION` for the explicit §27 escalation path and use `NEW → AI_HANDLING` only if the controller confirms that Phase 2 tracks an AI-troubleshooting ticket before escalation. Ordinary AI FAQ conversations need not create tickets. If that second path is not in scope, keep those FSM transitions validated but unreachable until a later contract adds a creation path. This avoids silently changing the explicit create-ticket postcondition.

`CANCELLED` is currently absent from §25’s transition list, dashboard columns, and action controls. The table proposes a small terminal path only before staff handling. If controller review does not want that policy, retain the enum but reject all `CANCEL` actions in Phase 2; do not allow arbitrary status writes to make the status reachable.

## Ticket and conversation modes

Both entities have `AI | HUMAN`, but each mode is scoped to its own entity. `ticket.mode` governs assistance on that ticket; `conversation.mode` governs student-facing AI replies in that conversation. A LINE session may have several conversations in different modes at once. Accept changes the ticket and its linked ticket conversation to `HUMAN` atomically. It must not change other conversations for the same LINE session.

For auto-reply, fail closed if either the selected conversation or its attached ticket is `HUMAN`, or the ticket is in a staff-owned/terminal state. Check the mode/revision again immediately before durable outbound enqueue. If Accept won after AI generation began, suppress that AI send. Drafting, summarizing, and RAG for staff remain allowed; only an authenticated staff send action reaches the student.

Flow E requires a distinct AI conversation for a new Library question while a Registration ticket remains HUMAN. Keep the Registration ticket and its conversation untouched, create/select another AI conversation in the same LINE session, and route only to that conversation. A resolved/closed ticket is not a candidate for ordinary follow-up unless the restricted reopen policy is invoked. The guide’s `active_ticket_id` is a conversation-local hint; it cannot represent the only active ticket for the whole LINE session.

## Router and service DTOs

Use validated, discriminated TypeScript types (and runtime parsing at HTTP/webhook boundaries). The shape below is a review contract, not a mandate to add or rename database columns.

```ts
type TicketStatus =
  | "NEW" | "AI_HANDLING" | "WAITING_STAFF" | "STAFF_HANDLING"
  | "WAITING_USER" | "RESOLVED" | "CLOSED" | "CANCELLED";
type Mode = "AI" | "HUMAN";

type RouteCandidate = {
  conversationId: string;
  conversationStatus: "ACTIVE" | "WAITING" | "RESOLVED" | "CLOSED";
  conversationMode: Mode;
  topicLabel: string | null; // safe, short display context for a choice
  revision: number;
  ticket?: {
    ticketId: string;
    status: TicketStatus;
    mode: Mode;
    departmentCode: string;
    assignedStaffId: string | null;
    summaryLabel: string;
    revision: number;
  };
};

type RouteMessageInput = {
  lineSessionId: string;
  message: { messageId: string; text: string; receivedAt: string };
  candidates: RouteCandidate[]; // loaded and ownership-checked by backend
  classification?: {
    intent: string;
    confidence: number;
    evidence: string[];
  };
  pendingChoice?: { contextId: string; revision: number };
};

type RouteDecision =
  | { route: "AI_NEW"; confidence: number; reason: string }
  | { route: "AI_EXISTING"; conversationId: string; confidence: number; reason: string }
  | { route: "HUMAN_TICKET"; conversationId: string; ticketId: string; confidence: number; reason: string }
  | { route: "ASK_CONTEXT"; contextId: string; options: Array<{ token: string; label: string }>; confidence: number; reason: string }
  | { route: "SPAM"; confidence: number; reason: string };
```

Recommended functions:

```ts
loadRouteContext({ lineSessionId }): Promise<RouteCandidate[]>;
routeMessage(input: RouteMessageInput): RouteDecision; // pure; no writes or sends
resolveQuickReply(input: {
  lineSessionId: string;
  contextId: string;
  token: string;
  currentRevision: number;
}): RouteDecision;
routeDepartment(input: {
  classification: { intent: string; confidence: number; evidence: string[] };
  allowedDepartments: Array<{ code: string; active: boolean }>;
}): { departmentCode: string; reason: string } | { needsContext: true; reason: string };
transitionTicket(input: {
  ticketId: string;
  action: TicketAction;
  actor: AuthenticatedActor; // constructed from verified LINE session or staff auth, never request JSON
  expectedRevision?: number;
}): Promise<TransitionResult>;
```

`TicketAction` should be a discriminated union for `START_AI`, `ESCALATE`, `AI_RESOLVE`, `ACCEPT`, `STAFF_REPLY`, `USER_REPLY`, `RESOLVE`, `CLOSE`, `REOPEN`, `CANCEL`, and `REASSIGN`, with required payloads such as destination staff, reply body/idempotency key, or reason. Return typed failures such as `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `STALE_CONTEXT`, and `VALIDATION_ERROR`; never return a success shape after partial mode/status/audit mutation.

`loadRouteContext` is the only way router candidates enter from storage. It must load every eligible conversation/ticket for the LINE session and enforce session ownership. Do not accept `activeConversations`, `activeTickets`, ticket IDs, or conversation IDs from a student request as authorization. A quick-reply token must be opaque and bound server-side to the LINE session, pending context, candidate IDs, revision, and expiry. Validate it once; stale, replayed, foreign-session, or mismatched choices cause a fresh context prompt or safe reroute with no ticket mutation.

When one ticket is the only plausible existing issue, the guide’s two options (“ปัญหาเดิม” / “คำถามใหม่”) are sufficient. When multiple tickets are plausible, show one safe short label per eligible ticket plus “คำถามใหม่”; a yes/no reply cannot identify which of two active tickets the student means. Keep raw IDs out of the LINE option label and validate the opaque option value on the backend.

## Authorization boundaries

Authorization is a service check for every action, regardless of dashboard visibility or RLS. The guide establishes department-scoped access, additional sensitive-ticket limits, and four staff roles; the precise per-action grants below are a conservative proposal for controller review.

| Actor | Suggested action scope |
|---|---|
| LINE user | Submit messages in the verified LINE session. Backend resolves whether a message belongs to a ticket. No client-selected ticket ID can mutate state. A student reply can advance `WAITING_USER → STAFF_HANDLING` only after unique context validation. |
| AI/classifier | Return intent, confidence, draft, and evidence. It cannot authenticate as staff, send during HUMAN mode, select an unapproved department, or directly update ticket status. Backend applies any permitted transition. |
| `STAFF` | Read/manage tickets in own department and sensitivity scope; accept an eligible unassigned ticket; reply/resolve only when assigned or explicitly delegated. |
| `SUPERVISOR` | Manage tickets across own department; may reassign and perform allowed close/cancel actions. Reopen only with explicit `ticket.reopen` policy. |
| `ADMIN` | Access only departments/actions explicitly granted by permission. The label does not imply blanket access. |
| `SUPER_ADMIN` | Cross-department scope; all sensitive access remains audited and subject to the restricted-ticket policy. |
| Backend system | Ingress, validated AI lifecycle transitions, durable delivery bookkeeping, and configured automation. Each action records a source and audit metadata. |

Restricted tickets require the additional sensitive permission even when a role’s department scope passes. Staff OA is notification only; its notification must not contain restricted details. Staff reply API checks active staff identity, department, assignment/delegation, sensitivity permission, HUMAN mode, valid transition, and idempotency before enqueuing a student push.

## Ambiguities for controller to freeze

1. **Creation point vs AI states:** §25 offers an AI-handled ticket path; §27 makes created tickets `WAITING_STAFF`. Adopt the escalation-only `createTicket` interpretation above unless tracked AI troubleshooting tickets are deliberately included in Phase 2.
2. **Queued ticket mode:** §27 permits HUMAN immediately or waiting until Accept. Freeze one policy. The simplest alignment with Flow D is `AI` while waiting, then atomically set both modes to `HUMAN` on Accept; if AI should stop at escalation, set both HUMAN at `ESCALATE` and let Accept change assignment/status only. Never leave the two mode fields inconsistent.
3. **Cancellation:** status exists without a transition, actor, UI action, or dashboard lane. Either adopt the narrow terminal pre-handling rule above or leave it unreachable for this phase.
4. **Reopen policy:** the roadmap fixes `CLOSED → WAITING_STAFF` and history action `REOPENED`, but policy grants, reason requirements, and assignee clearing are unspecified. Freeze these before exposing a button.
5. **Multiple active candidates:** §23 gives arrays, but §66 says “correct routing” without an ordering rule. Use all session-owned candidates and return a unique ticket only with enough evidence; otherwise ask context. Define candidate eligibility to exclude resolved/closed/cancelled tickets except the reopen action.
6. **Quick Reply cardinality and expiry:** guide text gives a two-choice prompt, not a pending-context protocol. Bind choices to session/candidates/revision/expiry and expand labels when multiple tickets match.
7. **Confidence and department mapping:** no threshold, unknown-intent fallback, or duplicate/ambiguous department rule is set. Backend maps validated classifier intents only to active allowed department codes; low confidence, unknown labels, or no unambiguous map must ask context or remain unrouted for review. Keywords may support classification but cannot be the sole final routing rule.
8. **Conversation status/cardinality:** ticket transitions are specified; conversation status transitions and ticket-to-conversation cardinality are not. Keep mode and status decisions scoped to the selected conversation. Do not let a session-wide pointer close or repoint unrelated conversations.
9. **Outbound status timing:** §53 says store, push, update status, history, activity, but gives no transaction/retry rule. Use the Phase 1 durable outbound idempotency contract: status/history change with durable enqueue, then retry delivery by key; do not send duplicate student messages on retry.

## Behavioral fixtures for Phase 2

Implement these as pure router/state-machine cases plus service-level authorization/race cases. The cases are specification fixtures only; this review did not run tests.

| # | Fixture | Expected behavior |
|---:|---|---|
| 1 | New LINE message; no eligible conversation or ticket | `AI_NEW`; no ticket ID is invented. Conversation creation is a later service action. |
| 2 | One active AI conversation and a likely follow-up | `AI_EXISTING` with that conversation ID. |
| 3 | One eligible HUMAN Registration ticket; message clearly follows its issue | `HUMAN_TICKET` with the exact ticket and linked conversation IDs. |
| 4 | Flow E: active HUMAN Registration ticket; user asks Library closing time | `AI_NEW` or a separate existing AI Library conversation; never select Registration ticket. Registration ticket and old conversation remain HUMAN and active. |
| 5 | Two active tickets; evidence uniquely matches the second ticket | `HUMAN_TICKET` for the second ticket, independent of recency or list order. |
| 6 | Two active tickets are both plausible targets | `ASK_CONTEXT` with distinct safe labels for each ticket and an AI-new-topic choice. No ticket receives the message yet. |
| 7 | One ticket is plausible but the message may be a new topic | `ASK_CONTEXT` with the guide’s old-issue/new-question choices. |
| 8 | Valid “old issue” token for a still-current pending context | Resolve to the bound `HUMAN_TICKET`; token’s ticket and conversation match the stored candidate snapshot. |
| 9 | Valid “new question” token | Resolve to `AI_NEW` or the selected separate AI conversation; leave all existing tickets unchanged. |
| 10 | Expired, replayed, forged, foreign-session, or stale-revision quick-reply token | Reject selection, do not mutate or send to a ticket, and issue a fresh context decision when needed. |
| 11 | Authorized staff accepts an unassigned `WAITING_STAFF` ticket | One atomic winner; status becomes `STAFF_HANDLING`, assignee is actor, and linked ticket/conversation modes become HUMAN; one `ACCEPTED` audit record. |
| 12 | Staff from another department or without restricted permission accepts/replies/reassigns | `FORBIDDEN`; no status, mode, assignee, message, outbound, or success audit mutation. |
| 13 | Assigned authorized staff replies to a HUMAN ticket | Persist staff message, durable outbound key, history/activity, and `WAITING_USER`; student send is attributable to staff. |
| 14 | Outbound delivery temporarily fails after durable enqueue; worker retries same key | Ticket remains in the documented queued/retry state; eventual delivery occurs once and does not duplicate message/history. |
| 15 | User replies to the same ticket in `WAITING_USER`, then asks an unrelated new topic | First message resolves to the same ticket and advances to `STAFF_HANDLING`; unrelated topic uses a separate AI conversation and does not advance that ticket. |
| 16 | AI response generation starts, staff Accept commits, then AI attempts outbound enqueue | Mode/revision fence suppresses AI send; no AI student message is queued after HUMAN takeover. Staff draft tools remain available. |
| 17 | Policy-authorized actor reopens a CLOSED ticket with reason | Status becomes `WAITING_STAFF`; history action is `REOPENED` with `CLOSED → WAITING_STAFF`; no `REOPENED` status is written. |
| 18 | Staff without reopen grant tries a CLOSED ticket; user merely sends another message to a CLOSED ticket | Staff action returns `FORBIDDEN`; inbound text does not bypass policy or reopen implicitly. |
| 19 | Exercise every allowed transition and representative invalid pairs, including any transition out of CANCELLED | Allowed pairs match the table exactly; invalid pair returns `INVALID_TRANSITION`; CANCELLED has no outgoing transition. |
| 20 | Keyword mentions “registration” but validated classification/context points elsewhere or confidence is low | No keyword-only department assignment. Backend maps only an allowed active classification; low/unknown/ambiguous result asks context or remains unrouted for review. |

## Source alignment

- `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` §§23–28: router inputs/output, quick reply, status/mode transitions, takeover, creation postcondition, department mapping.
- `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` §§51–54: dashboard/detail actions, HUMAN indicator, reply authorization/delivery/history, staff OA privacy.
- `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` §66: baseline router cases (no ticket, related/unrelated topic, ambiguity, multiple tickets).
- `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` Flows C–E: escalation, human lifecycle, new topic while a human ticket remains active.
- `docs/superpowers/plans/2026-10-04-yru-helpdesk-roadmap.md` Global Constraints, architecture decisions, and Phase 2: `REOPENED` audit action, multi-candidate routing, validated context, takeover race suppression, controller ownership of contract/schema/integration.

No application, migration, or environment file was changed. No tests were run.
