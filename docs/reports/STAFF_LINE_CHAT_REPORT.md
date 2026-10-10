# STAFF-LINE-CHAT-01 / CHAT-01E — controlled acceptance

10 October 2026. Root owns contracts, schema, authorization, privacy, integration and executed acceptance. CH013/026/054, USR-STAFF-LINE-CHAT and DEC-081–083. Status: component implemented and migration39 installed in LOCAL and the previously selected DEVELOPMENT; actual multi-person OA acceptance remains MANUAL_PENDING. INC-BATCH-01 remains implementation work, not a human configuration prerequisite or a completed broadcast feature.

## Result and operator workflow

Dashboard is the primary case workspace: separately authorized history and composer, visible ticket/anonymous reporter beside send, client state mounted by ticket identity, and retries bound to the same ticket/revision/request. Two-ticket browser navigation cannot carry a draft into the second recipient. The composer follows the history; AI assistance follows the ordinary reply/actions. Delivery labels distinguish queued, processing, sent and suppressed work.

Staff OA retains the approved explicit selected-case continuous text replies. ACCEPT has one winner and an idempotent receipt; it offers OPEN without switching an existing selection. “งานของฉัน” and “คิวฝ่าย” recover current paginated actions when older buttons expire. Incoming other-case alerts, another acceptance and Dashboard navigation do not change LINE focus. “หยุดคุย” expires selection. Delayed OPEN/STOP events cannot overwrite a newer deliberate selection/stop. There is a fixed30-minute selection lifetime without automatic renewal.

Only currently assigned, scoped GENERAL HUMAN cases allow LINE text relay through the existing ticket service. Private content stays in Dashboard. Explicit “รับทราบข้อความ” advances a source-message cursor only through complete displayed messages; API200, OPEN preview, a truncated message and a later arrival do not advance it. Resolution requires a fresh confirmation. A send is not a resolution or a LINE read receipt. Attachments receive text-only/Dashboard guidance.

Migration39 adds six browser-denied private tables and a ticket authority epoch. Guarded queued content is rechecked for current actor/binding/role/department/privacy/assignment/lifecycle before transport, while shared access and sorted conversation/delivery locks remain held outside SQL transactions. Reassignment, closure, unlink/rebind, revoke/restore and verified UNFOLLOW invalidate obsolete contexts/actions/pending content. FOLLOW alone does not restore a binding. Both raw-body HMAC webhook routes are unchanged. Initial generic ticket notifications retain their existing contract; the new content/queue/receipt guards apply to the added Staff chat path.

## Executed evidence

| Check | Evidence |
|---|---|
| Focused actual PostgreSQL Staff chat |20/20; two-connection claim race, replay, continuous replies, explicit Student continuation, absent/expired/stolen/private contexts, other-case isolation, ACK/new arrival, reassignment suppression, queue privacy, access mutation during mocked HTTP, binding ABA/UNFOLLOW and out-of-order OPEN/STOP |
| Registered actual PostgreSQL runner |422/422 in27 groups, including all8 controlled combined A–F cases; all39 migrations replayed, foundation RLS, normal schema preservation and exact owned cleanup PASS |
| Isolated advisors | Supabase CLI2.115.0:0 ERROR /0 WARN /116 INFO. INFO includes intentional private RLS tables without browser policies and fixture-unused indexes; no new ERROR/WARN |
| Full unit suite |2,138/2,138 in167 files; `pnpm exec vitest run --maxWorkers=1`, exit0 |
| Compiler and lint | Full `pnpm typecheck`, full `pnpm lint`, then compiler/changed-file lint after the final STOP ordering correction, exit0 |
| Production build | Fresh copied-source build with installed Next.js and one isolated build directory, exit0; running normal dev output/config were preserved |
| Compiled Dashboard browser |6 executed checks: real Staff login; client navigation/draft isolation; failed-network retry; actual scoped reply API commits only second ticket/one delivery;1440/390/320 without document overflow; no browser page errors |
| Activation | CLI dry-run then only39 applied to LOCAL/selected DEVELOPMENT;39 migrations/65 RLS tables. Full foundation/role/least-grant verification passed on both targets |
| Retention | LOCAL59 old tables unchanged; DEVELOPMENT58 unchanged. The sole control-state difference is the existing structured-selection epoch invalidated by the apply helper's reference-department INSERT statement, even with ON CONFLICT DO NOTHING; business/source rows and counts match. USER message ordering backfilled; no Staff selection auto-created |

Normal local eight-file regression passed53/53. Its initial52/53 run exposed an obsolete assertion from before UX-LIVE-01: selected HUMAN continuation now sends a SYSTEM routing acknowledgment. Root retained the exact one-ack check and separately required zero AI outbox rows/zero generation jobs and the correct case label, then reran all53 successfully. Fresh compiler/changed-file lint passed after that fixture-only change. The coordinator restarted READY with39/65RLS, actual offline CPU E5, all four post-start worker check-ins and local/public signed empty-event200 versus invalid401 for both routes. Current tunnel URLs are in the setup checklist. LINE/generation/search transports in database tests are injected controls; compiled browser tests do not send real LINE messages or call a real provider. No actual two-person OA pass is claimed.

## Failures and corrections retained

Original WAITING_USER state rejected consecutive Staff replies; actual RED2 became GREEN4 after adding the guarded self-loop and explicit RESOLVE. Two final event-order regressions reproduced delayed OPEN after STOP and delayed STOP after newer OPEN; both failed before the retained source fence and passed afterward. UNFOLLOW first left the binding active, then the initial fix referenced a nonexistent updated_at column; the corrected identity update passed the actual suite.

Full runner failures exposed a queue fixture sharing prior department work, an invalid synthetic department code contaminating later support selectors, and a Flow D assertion counting new Staff receipts as Student delivery. Root isolated the fixture department, used canonical letters/underscores and exact retirement, and asserted exactly the intended Student recipient/body/SENT row separately. No recipient, role, state or no-AI assertions were waived. Private copied build tests were initially collected twice by Vitest; retaining configDefaults while excluding `.superpowers/**` restores the real167-file suite. An owned grant-check attempt ran foundation after browser IT fixtures and failed its fixed fixture count; fresh registered foundation and actual LOCAL/DEVELOPMENT full security checks passed separately. Retention's initial all-table equality failed only on the expected DEVELOPMENT control epoch; the revised check explicitly accounts for that control state while preserving all business/source comparisons.

## Review provenance and remaining acceptance

Actual Luna high authored the pure presentation and19 tests and delivered a read-only LINE UX audit. Root accepted recognizable case action labels and stale receipt findings. Its interpretation that Dashboard-primary removes LINE relay was rejected against the latest explicit human choice. Actual Luna max authored the initial10 database cases and reached its limit before GREEN; root corrected/extended/executed the final20. Root owns final self-review and acceptance; no unavailable independent approval is claimed.

Real OA manual acceptance needs two bound authorized staff and multiple Student sessions: race one claim; winner explicitly opens/replies; intended Student receives once; other-case alerts and Dashboard navigation retain LINE focus; fresh queues recover old buttons; ACK leaves a concurrently arriving message new; reassignment/unlink prevents obsolete sends. Update both webhook URLs after the local coordinator restart. Existing real free-provider inference403 and zero approved PUBLIC documents remain separate AI/corpus gates.

INC-BATCH-01 still requires immutable exact recipient/message review, source/ownership/revision fences, per-recipient idempotent delivery/retry and truthful integrated Dashboard results. Category/similarity never grants group send or auto-resolution. V1 is not fully accepted until those required additions and deferred actual A–F/production evidence are accounted for.
