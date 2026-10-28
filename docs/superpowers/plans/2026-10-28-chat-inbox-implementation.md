# CHAT — approved implementation contract, 28 October 2026

Human approved the in-chat plan and then selected Dashboard-only Staff conversation. This execution contract records implementation dependencies, not a new summary report. Preserve all pre-existing RAG/Hermes edits and generated next-env.d.ts; preflight private snapshot contains their hashes. Root owns contracts, DB/auth/privacy/migrations/integration. Luna high implements the bounded Inbox UI; Luna max reviews source/concurrency.

Requirements: CH023/028/031 conversation routing, CH026 ticket actions, CH054 Staff identity, CH013/055/056 incidents; latest human adds realtime chat, LINE Login + SuperAdmin approval, private images/PDF and multi-message/topic changes. Read original overview §§17–21 and master §§51–56 with latest decisions. DEC187 supersedes personal Staff OA chat in DEC081–083, not its retained history/ownership safeguards.

## Ordered tasks and owners

1. CHAT01–02 root: anonymized actual regression; delivered USER/AI/STAFF projection, same-session quoted-message provenance. Files: lib/conversation/{semantic-routing,semantic-routing-contracts,semantic-routing-provider}.ts, lib/line/{events,delivery}.ts and source-bound delivery storage. No AI response in HUMAN; never route by latest ticket.
2. CHAT03 root: persist every event; bounded1200ms quiet/3000ms collection, original IDs/whole messages, topic-specific generation source fences and safe cancellation. A new topic does not cancel another topic; changed/ambiguous input never disappears.
3. CHAT04–05 root: types/inbox.ts and lib/chat/**; cursor/read/notes service + app/api/chat/**; private Supabase invalidation and authorized refetch; five-second visible-tab recovery. Reuse ticket action/idempotency/assignment guards. Realtime cannot grant access or carry message/PII payloads.
4. CHAT06 Luna high: app/(dashboard)/inbox/** plus shell navigation. API contract below. Preserve existing darkrail/alabaster/coral identity; actor+ticket draft/retry isolation, mobile/accessibility, no invented online/read state.
5. CHAT07 root: signed durable Staff webhook stays; notifications, atomic ACCEPT and Dashboard links stay. Disable typed/manual Student relay at handler and dispatch; legacy OPEN/REPLY gives authorized Dashboard navigation. Suppress only unsent LINE-origin manual packets under retained delivery guards; do not alter SENT/UNKNOWN or Dashboard-origin content.
6. STAFF-LOGIN01–02 root: existing Supabase authentication + custom OAuth2 custom:line-staff, PKCE, email_optional, LINE userinfo sub. Existing users link explicitly; new users apply then SuperAdmin approves final department/services/base STAFF role. Claimed name/department never grants access. Pending/rejected/suspended self-status only; preserve password recovery and unique technical bindings.
7. CHAT-MEDIA01 root: private attachment storage, type/size guards, exact LINE content fetch outside SQL; authorized file viewer for Student without profile/enrolment database. Private PDF/image outbound uses controlled links, not a public storage bucket. No promise text-only AI understands an image.
8. INCIDENT01–02 root: reuse detector/context/batch preview/confirm/fanout; distinguish category from incident, prevent personal-record grouping. Explicit eligible selection <=100cases and exact human review; no automatic new recipients or resolution.
9. QA-CHAT01 root: focused RED/GREEN, owned PG migration/concurrency/authorization, UI desktop/mobile, type/lint/fullunit/build,10/100/500controlled bursts, runner update, no real LINE sends or500paid/free inference calls. Current component acceptance and actual OA UX remain separate.

## Inbox browser contract

- GET /api/chat/inbox accepts existing ticket filters plus view=all|mine|unassigned|unread|waiting_staff|waiting_user and category. Returns InboxListResult; successful pagination always known.
- GET /api/chat/tickets/[id] returns InboxThreadResult; optional beforeSequence (exclusive positive integer), limit default50/max100. Latest page newest50 presented ascending; history has nextBefore. Every request reloads active actor/scope; private/no-store responses.
- POST /api/chat/tickets/[id]/read accepts {throughSequence}; acknowledge only visible rendered messages and monotone max. No LINE read claim.
- POST /api/chat/tickets/[id]/notes accepts {text,requestId}; private notes never use Student outbox or routing context.
- Existing /api/tickets/[id]/{accept,reply,resolve,close,reassign,reopen} remain authority. Preserve requestId across uncertain retry and draft after409; no blind authority refresh.
- Subscribe private staff:<actorId>:inbox event invalidate; payload contains only version/change marker. Fresh authorized refetch is mandatory; initial load and reconnect work without broadcast. No localStorage plaintext drafts or notes.

## Acceptance and boundaries

Replay Staff question→Student answer, multiple short answers, clearly new library topic, duplicate/redelivered/reordered events, two simultaneous assignees, two tabs, closure/reassignment/revocation, source failure, unread cursor, failed/unknown delivery, file access across cases and reviewed batch partial failure. Zero lost/duplicate/cross-recipient effects under controlled10/100/500load, record latency and queue metrics honestly. Actual LINE/Login configuration remains human setup after independent implementation. Do not claim V1 complete from component tests. No push.
