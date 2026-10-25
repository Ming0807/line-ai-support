# SOL-00 — current working-tree audit, 14 October 2026

Owner: root (contracts/DB/auth/privacy/integration); actual read-only Luna max AI audit and Luna high product/runtime audits. This records implementation inspection, read-only DEVELOPMENT observations and baseline checks. It is not current whole-V1, model-quality, capacity, browser or actual OA acceptance.

## 1. Current architecture

Branch `feat/yru-helpdesk-v1`, HEAD `aa90f0993298ec89ef7c0647205f6c92bae46b57`. Baseline inventory: 267 status entries, 824 source/config/test files, SHA256 fingerprint `2ebe528c67877ce91b034c876d715c98851638c5a8193ddd923a051acb5fefb1` at 2026-10-14T14:48:11Z / 21:48 Bangkok. Existing dirty/untracked work is the source; nothing was reset/cleaned/stashed or recreated from HEAD. Exact inventory and command logs are retained under `.superpowers/staging/sol-*` (ignored local evidence).

Required reading: AGENTS, continuation prompt and completion handoff, project index/board/decisions, master guide, original overview/versioning/source index, requirements matrix/system design/working protocol; subsystem documents below. Installed Next 16.3.8 Route Handlers/authentication documentation was checked. Latest instructions and current source supersede old report claims; no old PASS is carried into this acceptance.

| Subsystem | Current source and contract | Tests/evidence and current limits |
|---|---|---|
| Student/Staff LINE | `app/api/line/{student,staff}/webhook/route.ts`, `lib/line/receive-webhook.ts:23-50`, `lib/queue/inbox.ts:5-17`; CH005/021/054 | Exact raw HMAC before parse, channel-specific secrets, atomic batch persistence before ACK, valid empty envelope, safe unsupported events. Baseline unit PASS; actual OA pending. Echo compatibility retained. |
| Queue/recovery | `lib/queue/{process-inbox,run-inbox,outbox,run-outbox}.ts`, `lib/ai/{jobs,run-worker}.ts`; CH006/026/059 | Durable per-owner sequence, SKIP LOCKED leases, attempt bounds, saved-result reuse, stable push retry key, ambiguous reply UNKNOWN. Controlled current PG/load still pending. |
| Identity/auth/privacy | `lib/auth/staff.ts:22-59`, `lib/tickets/authorization.ts:8-27`, `lib/staff/line-binding.ts`; CH017/060/USR-STAFF-LINE-CHAT | Verified Auth subject + active staff row; explicit department/sensitivity checks; one-use self-binding to signed personal LINE source. No students/profile/grade/enrollment schema. |
| Staff case/session | `lib/staff/line-case-{chat,context,queue,snapshot}.ts`, `line-chat-delivery.ts`, migration `20261009184807`; CH026/053/054 | Explicit selection, assignment epoch/binding/UUID/event-sequence/absolute 30-minute TTL; queue/alert/accept/Dashboard do not select a newer recipient. LINE-only guarded content has dispatch authority checks. Dashboard STAFF outbox guard coverage requires reproduction. |
| Ticket/history | `lib/tickets/{ticket-service,human-takeover,history}.ts`, `lib/conversation/state-machine.ts`; CH007/008/025/026 | One assignee, revision/idempotent receipts, conversation/ticket locks, explicit transitions, HUMAN AI suppression. Missing race evidence is not a claim of broken existing mechanisms. |
| Assistant/evidence | `lib/ai/{assistant-decision,assistant-orchestrator,conversation-eval*}.ts`, `lib/knowledge/{configured,lookup-plan,structured-search,form-directory}.ts`; CH018/023/031-034, USR-AI-AGENT | Bounded model proposal, backend tools, PUBLIC/current/effective/applicability/authority filtering, final source/ownership fences. Frozen30 harness coverage and calendar/service/form usefulness remain open. Natural assistant activation is gated. |
| Provider/model | Providers UI/API; `account-free.ts`, `cost-policy.ts`, Gateway; CH014/029/030/USR-FREE/ORDER/STATUS/QUOTA/TEST | Provider+model up/down, selected model tests/status/quota unknown states exist. Environment-bound expiring Free-account attestation exists; dashboard issue/revoke/renew + durable actor audit missing. No qualified fallback. |
| Import/corpus | Knowledge Import UI/API; `lib/imports/*`, publication services; CH009-012/035-050/061/062 | Immutable originals, five-format parsing, explicit proposal consent, metadata/mapping/version review and publication receipts. Two approved PUBLIC HTML documents observed; ten pack candidates need full extraction/applicability review; one sensitivity-held reference. |
| Dashboard/integrations | Actual `/dashboard`, queue, tickets, incidents, departments, knowledge/import, activities, providers/models/fallback, usage, analytics, logs, settings | All 13 capabilities mapped to existing routes; layout auth is supplemented by API auth. Current role/browser/keyboard/1440/390/320 acceptance pending. Preserve approved UI. |
| Runtime/config/observability | `scripts/{worker,ai-worker,outbox-worker,incident-worker}.ts`, `scripts/local/{run,config,process-tree}.mjs`, `lib/database/pool.ts` | Bounded workers, dedicated session-mode dispatch pool, redacted fixed diagnostics, worker observations. No managed launcher state; other present processes have unknown ownership and were not stopped. |

Read-only selected DEVELOPMENT snapshot at 2026-10-14T14:50:12Z: 42 applied migrations, 73 public/private RLS table entries, 278 indexes, 692 constraints; schema/index/FK definitions and three EXPLAIN plans retained in `sol00-runtime-snapshot.json`. No migration or fixture ran there. `LINE_WEBHOOK_MODE=durable` in local configuration; an existing process's environment is not established by this observation. No new database/Redis is justified by this inventory.

## 2. Current problems

V1 remains incomplete. Sole enabled generation candidate is `gemini-3.5-flash-lite`; exact matching local Free-account grant expires 2026-10-20T19:54:19.237Z (21 October 02:54 Bangkok). Expiry is an operator attestation, not independent billing proof. Two approved PUBLIC documents were observed. No current whole-run frozen30 semantic observations exist. Previous A12/A18 missing-calendar-selector, A13 exact-name mismatch and A16 named-form-selection shortcomings must be reproduced after the harness can assert the actual cases. Historical sample scores are not current scores.

Potential safety gaps from root trace: `ticket-service.ts` queues Dashboard `kind=STAFF` without a `staff_chat_delivery_guard`, while `verifyStaffChatDelivery` permits missing guards for this kind; ordinary dispatch does not independently inspect its sender/assignment epoch. LINE selection TTL is checked at intake but not captured for a queued manual reply's dispatch. Treat both as hypotheses until owned RED tests, then repair using existing storage if proven.

## 3. LINE API feasibility

Official documentation rechecked during this audit (not merely inherited links): [webhooks](https://developers.line.biz/en/docs/messaging-api/receiving-messages/), [signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/), [retry](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), [Messaging reference](https://developers.line.biz/en/reference/messaging-api/index.html.md), [Quick Reply](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/), [Flex](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/), [group/room](https://developers.line.biz/en/docs/messaging-api/group-chats/), [mark as read](https://developers.line.biz/en/docs/messaging-api/mark-as-read/).

Raw-body HMAC is required; duplicate/reordered delivery is possible and redelivery is not guaranteed. User IDs are provider-scoped. Reply tokens are single use; use within one minute is advised, with extra redelivery restrictions. Push eligibility includes friendship or recent direct interaction; HTTP200 can still accompany nondelivery. Reply/push allow five messages; text limit is 5,000 UTF-16 units. Endpoint rate limits and monthly plan quota are different. Stable retry keys apply to supported push APIs, expire after 24 hours and cannot safely change payload/recipient. Quick Reply disappearance is local UI behavior, not global authorization revocation.

The documented webhook contract does not establish an individual OA Manager operator identity for attribution in this application. Bound personal Staff LINE and OA Manager sending are separate. No chat-open or user-read event is assumed. The documented mark-as-read API marks incoming messages from the OA side; it does not prove a Staff operator read the application's case or that a Student read an outgoing reply. Existing explicit ACK cursor is retained. Partner modules require separate provisioned eligibility.

## 4. Bottlenecks and measurement boundaries

Existing queues are serial per owner and bounded per process: inbox one/channel/cycle, AI one/cycle, outbox one/channel/cycle; pool defaults 1, dispatch dedicated pool 2. Dispatch retains sorted session advisory locks/client over a five-second-bounded LINE HTTP request outside SQL transactions. That is a necessary current delivery fence with an unmeasured occupancy/fairness cost, not evidence for replacing PostgreSQL. No current-source ACK/load/pool/lock/E5 cold-start measurements justify a capacity claim. Encrypted inbox retention is not currently automated; any deletion policy needs explicit retention scope and cannot be invented during this continuation.

## 5. Architecture options and recommendation

| Option | Benefits | Limits/cost/security |
|---|---|---|
| A bound personal LINE primary | Existing convenient explicit case selection | One physical chat; context/media/notification burden; rigorous server expiry and recipient guards required. |
| B Dashboard primary, LINE alert | Separate history/draft/recipient, less LINE quota | Browser auth/usability dependency; existing UI minimizes implementation effort. |
| C hybrid (recommended) | B plus explicit bound LINE quick actions/continuous reply | Both surfaces must share current actor/epoch/lifecycle fences; moderate tests, no new queue platform. |
| D OA Manager primary | Familiar OA operator UI | Individual operator attribution not established; rejected for current guarded routing contract. |
| E LIFF/Login extension | Rich UI in LINE | Extra channels/auth/deployment; later scope, unnecessary for V1. |

Retain C and existing durable PostgreSQL queues. Student conversations precede HUMAN tickets; a ticket owns only its particular HUMAN conversation. Extend [system design](../architecture/YRU_V1_DESIGN.md) diagrams and existing Staff design; do not create a competing architecture hierarchy.

## 6. Database changes

No schema migration is proposed merely by this audit. Existing outbox guard header permits nullable binding and per-case assignment epochs; root will first test reuse for Dashboard replies and server-owned encrypted TTL metadata for LINE-origin replies. Schema change only follows an identified gap and least-grant/RLS/forward-recovery gate. Imports never create yearly tables or delete old versions. `pnpm test:db` seeds normal local `postgres`; use only inspected uniquely owned disposable DB runners for current integration/load.

## 7. Concurrency strategy

Signed batch -> atomic durable persist -> ACK -> leased FIFO worker -> authorized effect -> frozen-recipient outbox -> current dispatch authority -> supported stable retry. Preserve channel-scoped event idempotency, distinct logical effects and finite attempts. One claim winner is enforced at ticket service; run at least 100 barrier races. Scope/binding/actor/assignment/privacy/lifecycle changes must be checked before enqueue and dispatch, with access/shared conversation/delivery locks in matching order. Never silently retarget queued T1 content to T2. Common incident sends remain explicitly reviewed per-case sets; no AI broadcast/automatic resolve.

## 8. Staff identity/session strategy

Keep authenticated one-use self-binding; signed direct-user source; active staff/department/sensitivity and one assignee. Unsupported group/room/media fail safely. UNFOLLOW/unlink/revoke invalidates authority; FOLLOW alone does not restore it. OPEN chooses exact ticket/epoch/binding/selection/event sequence for 30 minutes; no activity renewal or auto-close. Queue/accept/alert/Dashboard navigation does not choose LINE focus. Explicit displayed-message ACK is separate from delivery acceptance. Queued LINE content must retain its original selection deadline even if a newer case is opened; a newer selection cannot extend an old reply's authority.

## 9. Implementation slices and dependencies

| Task | Requirements / files | Acceptance and owner |
|---|---|---|
| SOL-01 | CH023/026/031/069, USR-AI-AGENT; eval-target, owned-eval/source/publication and focused tests | Full frozen30 case-specific structural safety/history/confirmation/HUMAN/takeover oracles and reviewed RAG_HTML source support; retain immutable fixture hash and human semantic review. Luna max bounded implementation, root integration. |
| SOL-02 | CH018/031-034/062; lookup-plan, answer/structured discovery/form rendering | Reproduce then bounded metadata discovery for calendar/service/name/form; no weakening exact query selectors, fuzzy cross-scope SQL or hardcoded answers. Depends SOL-01. Root contracts. |
| SOL-03A | CH026/053/054/060; ticket-service, manual delivery guards, outbox, Staff case chat, focused/owned PG tests | RED Dashboard queued revoke/reassign/lifecycle and LINE queued expiry; current actor/epoch/recipient/TTL checks at dispatch, sensitive Dashboard support and switch stays exact original recipient. Root. |
| SOL-03B | CH005/021/026/059 | Existing race/lease/postback/takeover/retry mechanisms accepted only after current owned tests; add missing exact fault cases, no blanket rewrite. Root. |
| SOL-04 | CH014/029/030/USR-FREE/ORDER/STATUS/QUOTA/TEST | Deliberate Free-account grant lifecycle/audit/expiry, fixed-input qualification of primary+fallback; held on SOL-02 for model ranking. |
| SOL-05 | CH009-012/035-050/061/062, USR-IMPORT-EASE/IMPORT5 | Review each real pack entry/full extraction/applicability/privacy, minimal input and explicit publication; unsupported/OCR/stale/400/409 recovery. Independent after SOL-00. |
| SOL-06 | CH019/021/026/059 | Owned synthetic controlled load A-J, repeat A-C >=3, ACK p95<=1s/p99<=2s, zero lost acknowledged/wrong-recipient/duplicate/multiwinner; declare finite drain budget before run. Depends SOL-03. |
| SOL-07 | USR-DASHBOARD/LOCAL-TEST, CH051/054 | Authenticated role/browser 1440/390/320, one fresh launcher command/current two webhook URLs/offline E5/four workers/Hermes pilot truth. Depends SOL-03-06. |
| SOL-08 | CH069/all required gates | Stable-source type/lint/unit/ownedPG/build/secret/whitespace, all30 reviewed/safety, controlled A-F, explicit actual-OA/manual separation. No V1 completion while required gates remain. |

## 10. Risks and quality constraints

No threshold/fixture weakening, paid/unknown inference, quota evasion, unconditional network-failure ticket, HUMAN AI reply, arbitrary SQL, latest-ticket shortcut or automatic publication. Preserve approved UI and complete Unicode/links; overflow/partial failures must be honest. Source/model/prompt/revision scope determines evidence validity; HTTP200/SENT and unit results do not prove useful answers or live OA delivery. Synthetic policy stays only in owned fixtures, never normal corpus.

## 11. Test plan and current evidence

Completed baseline commands: `pnpm typecheck` EXIT0; `pnpm exec vitest run --maxWorkers=1` EXIT0, 208 files/2623 tests, 111.59s. Source fingerprint above; no concurrent build was run. Runtime snapshot used an explicit READ ONLY transaction, no fixtures or normal mutations. Current-source full lint/build/owned PG/frozen30/load/browser/launcher/live FlowA-F are NOT_RUN at this audit checkpoint. Each subsequent slice must retain RED/GREEN output, exact source hashes, actual/control distinction, ownership/cleanup and review provenance.

Frozen fixture hash remains `e79ade32e0960df2e0399531d703e55955456caf7af432288ea919ae45e801f3`. All30 observations are required; rubric remains >=27/30 trajectory, >=18/20 useful answers and every authority/ownership safety rule. Expensive gates run sequentially; synthetic transport only for load. Real OA setup/two-Staff claims/switching and A-F are distinct manual gates.

## 12. Release decision and handoff

SOL-00 architecture/feasibility/options/design/sliced acceptance audit is recorded. Follow-on tasks remain implementation/acceptance work; V1 is NOT COMPLETE. Natural assistant activation remains gated. No new deployment, push or normal DB migration occurred. Deferred human steps belong in [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md), not in repeated permission requests. Exact URLs must come from a fresh verified managed launcher session, never historical tunnel prose.
