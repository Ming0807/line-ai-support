# OpenCode — OC-OPERATOR-06: finish private Inbox, onboarding and reviewed bulk replies

ทำต่อเนื่องจนจบรอบในฐานะ Frontend/Product Engineer งานนี้ได้รับอนุญาตแล้ว ทำ local commits เท่านั้น ห้าม push, merge, rebase, reset, clean, deploy หรือแก้ Root repository ไม่ต้องถามผู้ใช้ว่าจะเริ่มข้อไหน

## ฐานงานและการแบ่งเจ้าของ

- Worktree: `D:/project-next/line-ai-yru-opencode-staff`
- Branch: `codex/opencode-inbox-workflows`
- Exact starting HEAD: `90db3d3b0f932a97ece0958b271a18ee47c75310` (OC-INBOX-05 final)
- เก็บประวัติ04/05ทั้งหมด ต่อ commit ใหม่ด้านบน ห้ามทำให้หลักฐาน RED เดิมหาย
- Root backend read-only reference: `D:/project-next/line-ai-yru`, checkpoint `0968451349ed020171e7aa397e9e7271b8295011` บน `feat/yru-v1-final-polish` ซึ่ง push แล้ว
- Root ยังไม่รวม04/05 เพราะ P1 ด้าน cache ยังเกิดจริง อย่าเขียนว่า05ผ่านการตรวจรับหรือ V1 complete

อ่าน AGENTS/PROJECT_INDEX/master guide/relevant requirements/DEC187–190/CHAT plan และ installed Next16 docs ก่อนแก้ อ่าน source ตามจริง ไม่สมมติว่าทุก endpoint ไม่มีหรือพร้อมใน worktree ของคุณ

**OpenCode:** UI/controllers/hooks/mounted regressions ของ Inbox/Ticket/Staff onboarding และ Incident recipient/batch reply ตาม allowlist ด้านล่าง

**Root:** `lib/**`, `types/**`, API/DB/Auth/RLS/migrations, routing/AI/Hermes, LINE/queue/outbox, private media transport, Incident grouping/authorization, shared shell/login entry, startup, integration/build/acceptance Root ทำส่วนนี้ขนาน ห้ามแก้ข้ามขอบเขต

แก้ได้:

1. `app/(dashboard)/inbox/**`
2. `app/(dashboard)/tickets/[id]/{chat-*,ticket-action-*,ticket-actions.tsx,page.tsx}` เฉพาะ UI ไม่แตะ AI/copilot/knowledge panel implementation
3. `app/staff/apply/**`, `app/staff/application/**`, `app/(dashboard)/staff-applications/**`, `app/staff-onboarding.css` คง server role gate
4. **รอบนี้อนุญาตเพิ่ม** `app/(dashboard)/incidents/{IncidentBatchReply.tsx,IncidentDetailView.tsx,presentation.ts}` และ styles เฉพาะโมดูล Incident ที่มีอยู่ ห้ามเปลี่ยน server page authorization หรือ API
5. `app/tickets.css` เฉพาะส่วน ticket/chat ที่เกี่ยวข้อง ไม่เปลี่ยน global palette
6. `tests/opencode-inbox-*`, `tests/incident-batch-selection.test.ts`, `tests/staff-onboarding-ui.test.ts`, `tests/staff-approval-ui.test.ts`, test ใหม่ `tests/opencode-operator-completion-*`, `tests/browser/oc-inbox/**`
7. `docs/ui/OC_OPERATOR_06_PLAN.md`, `docs/ui/OC_OPERATOR_06_COVERAGE.md`, `docs/reports/OPENCODE_OPERATOR_COMPLETION_REPORT.md`; เอกสาร05เพิ่ม dated erratum ได้ ห้ามลบคำอ้าง/ผลเก่าทิ้ง

ห้ามแก้ `.env*`, package/lockfile, next.config/next-env, auth/shared shell, root board/decisions, backend/types/schema หรือ frozen evaluator ห้ามอ่าน/copy credentials และห้ามเรียก Auth/OAuth/LINE/provider/Hermes จริง ใช้ fixture adapters ที่ชี้ชัดเท่านั้น

## ผล Root ตรวจ05 — ทำ causal RED ก่อนแก้

Root รันสาม focused suites29ข้อและ mounted15scenario ของคุณผ่านจริง แต่เพิ่ม mounted production-path checks แล้ว **สามกรณีต่อไปนี้ยังผิด** ทั้งยังมี independent Luna max Spec/Luna high Standards review สนับสนุนขอบเขตที่ระบุ อย่าใช้คำว่า green15/15หักล้าง counterexample ใหม่

### P1 — list denial ล้างแค่สิ่งที่เห็น แต่ private cache กลับมาได้

`Inbox.requestList` ล้าง list/selection เมื่อ401/403/404 แต่ไม่ล้าง records/seeded/read cursors/attempts/drafts ของ `useChatThreadOps` และ parent store

Reproจริง: เปิดA พิมพ์ร่าง → เปิดB → list403 → listกลับ200 แต่ GET threadAค้าง → เลือกA ได้ประวัติ `PRIVATE_FIXTURE_ROOM_A` และร่าง `PRIVATE_DRAFT_A` จาก cache ก่อน API ยืนยันสิทธิ์ใหม่ Rootวัด `privateHistoryVisible:true` ตรงนี้ต้อง false ห้ามแก้ด้วยซ่อนข้อความเฉย ๆ ต้องทำให้ state/requests ของ authority รุ่นเก่าไม่ฟื้นกลับมา

### P2 — read-ack เก่าปิดห้องใหม่

`chat-thread-ops.ts` ช่วง read-ack response ไม่มี selection/auth epoch guard; callbackในInboxไม่รับ ticketId แล้วปิดห้องปัจจุบันเสมอ

Reproจริง: เปิดA ให้ POST A/readค้าง → เลือกB → A/read403 → selectedเป็นnull ทั้งที่ควรยังเป็นB ล้างข้อมูลAที่ถูกปฏิเสธได้ แต่ห้าม callbackเก่าปิดB/เปลี่ยนURL/ทับ notice ของB ใช้ actor/ticket/authority generation อย่างถูกต้อง รวมกรณี A→B→A และ reauthorization

### P2 — result ของ write เก่ากระทบ notice/busy ของอีกห้อง

Reproจริง: POST noteAค้าง → เลือกB → noteA200 ที่ตรง DTO → Bแสดงข้อความ `บันทึกบันทึกส่วนตัวแล้ว · ผู้แจ้งจะไม่เห็นข้อความนี้` ทั้งที่เป็นผลของA `submitMessage` ยัง setNotice/setBusy ร่วมโดยไม่มี completion fence

Rootcounterexampleส่งvalidJSONและรอrenderแล้วพบnoticeผิดห้อง Independent maxตรวจพบสาเหตุS11เดิมผ่าน: `resolveDeferred`ส่งbodyเป็นobject แต่`respondWith`ใช้`String(body)` จึงได้`[object Object]`และJSONparseล้มเหลว Testกลับอนุญาตทุกnoticeยกเว้นsuccessphrase จึงไม่พิสูจน์ผล200ที่valid ต้องserializeให้ตรงHTTPจริงและassertnotice/busyBไม่เปลี่ยนทั้งsuccess/error paths รวมการรอresponse.json/React commit ไม่ใช่ตรวจทันทีหลังdeferred mapว่าง `note-a-1` เป็นvalid IDตามparserในbaseline ไม่ใช่เหตุให้แอบเปลี่ยนDTOให้parseไม่ผ่าน

Independent max Spec ยังพบขอบเขตที่ต้องเพิ่มregression: lifecycle401/403/404ล้างattemptแต่ไม่ขอcurrentrevalidationของthread; oldactioncompletionลบattemptด้วยkeyอย่างเดียวจึงอาจลบnewrequestIdหลังdenial/re-auth; read200เก่าใช้knowncursorที่captureไว้จึงทับcursorใหม่ให้ถอยหลังได้ ต้องmatchexpectedattemptidentityและmergeกับcurrentcursor ไม่ใช่cursorจากclosure Prompt05ข้อ11กำหนดvisible rendered contiguous tail: ถ้าโหลดแค่51–100แต่readcursor0 ห้ามACKข้าม1–50ที่ไม่ได้render ต้องเติมgap/holdcursorตามสัญญานี้ ไม่เปลี่ยนpolicyเงียบ ๆ

### Harness ที่ต้องแก้ด้วย

Request capture เก็บทุก body/ทุก requestไม่จำกัด; traceเดิม `artifacts/red/S02-invalid-success-200.json` ขนาด7,101,528bytes/258,191lines และทั้งรอบ521k+lines Rootไม่ยืนยันว่ามีข้อมูลจริงรั่ว แต่หลักฐานควร boundedและไม่ทำrepoบวมจากวงจรผิดพลาด ต้องเพิ่ม cap/fail-fast/output summary โดยเก็บที่มาหลักฐานเดิมอย่างตรวจกลับได้

## Backend ที่ Root ทำแล้ว — หยุดรายงานว่าไม่มี endpoint เหล่านี้

Checkpoint0968451มี private migration51 + transactional service + routes:

- `GET /api/staff/onboarding` → exact `StaffApplicationContext` (anonymous200พร้อม authenticated:false/departments:[])
- `POST /api/staff/applications` → exact `StaffApplicationItem`
- `GET /api/staff/applications?status=&page=&pageSize=` → exact `StaffApplicationList`, activeSUPER_ADMINเท่านั้น
- `POST /api/staff/applications/[id]/decision` และ `/suspend` → exact item, revision/requestId
- `/auth/line?mode=signin|link&next=...` และ `/auth/callback` → SupabasePKCE; UIไม่สร้าง/อ่านtokens

อ่าน `types/staff-applications.ts`, `lib/staff/{applications-contracts,applications-api}.ts`, `lib/auth/line-staff-config.ts` และ `docs/architecture/STAFF_ONBOARDING_DESIGN.md` ในRootแบบread-only APIไม่รับLINEsubject/role/grants/sameProviderConfirmedจากbrowser

Errorคงที่: INVALID_REQUEST400, UNAUTHENTICATED401, FORBIDDEN/STAFF_ACCOUNT_INACTIVE403, NOT_FOUND404, CONFLICT/IDENTITY_CHANGED/ALREADY_STAFF409, UNAVAILABLE503; APIไม่คืนrawprovider errors ปุ่มLoginเปิดเมื่อhostedconfigและsameProviderconfirmedพร้อมเท่านั้น การตั้งconsole/flagsยังรอผู้ใช้ท้ายงาน

Frozen worktreeคุณยังไม่มี backendล่าสุด เป็นข้อจำกัดฝั่ง worktree ไม่ใช่backendRootไม่ทำ ห้ามcopylib/API/migrationเข้ามาเอง ใช้ faithful fixtures และระบุ backend revision ที่อ้าง ห้ามอ้าง real integration จากfixture

## 16 งานของรอบนี้

| ID | งาน | เกณฑ์จบที่ต้องวัด |
|---|---|---|
| OP06-01 | Pin/plan/reproduceสามcounterexample | REDเป็นการกด production component ที่ mountจริง ครบ trace request/deferred/DOMหลังReact commit ไม่ใช่ค้นsource |
| OP06-02 | Actor authority reset | list denial และ actor/logout/unmount reset ล้าง private records/messages/notes/drafts/cursors/seeds/composer+lifecycle attempts ตามscope พร้อม invalidate/abortงานเก่า ไม่มีresponseเก่าสร้างcacheกลับ |
| OP06-03 | Denial scope + ABA | ล้างAอย่างเดียวเมื่อAถูกdeny; Bไม่ปิด/ไม่เสียร่าง; A→B→Aไม่รับผลepochเก่า; whole-actor denialต้องบังคับใหม่ทุกห้องก่อนคืนprivateข้อมูล |
| OP06-04 | Request lanes + complete fences | ผูก read/history/catch-up/refetch/write กับactor/ticket/authority generationและrequest orderingที่เหมาะสม ไม่ใช้serialร่วมจนpollฆ่าประวัติหรือผลเก่าลบnew attempt |
| OP06-05 | Per-room writes/busy | requestAค้างแล้วBยังใช้งานตามสิทธิ์ได้ ผลAปรับเฉพาะA ไม่ปลดbusyB/ลบร่างB/ทับnoticeB; เก็บผลของAอย่างซื่อสัตย์เมื่อกลับมา |
| OP06-06 | Lifecycle workspace lifetime | unknown attemptsยังอยู่เมื่อสลับA→B→A แต่ถูกล้างจริงเมื่อactor authorityหาย/ออกจากworkspaceตามpolicy ไม่มี globalMapค้างข้ามlogout/mount; oldcompletionต้องไม่restoreหรือลบnewattemptคนละrequestId; actiondenialtriggercurrentrevalidationตามสิทธิ์อ่านจริง |
| OP06-07 | SSR/RSC authority after denial | initialThread/lateRSC/oldcacheไม่ฟื้นsnapshotที่ถูกเพิกถอน มีepoch/currentauthorization boundary ไม่อ้างticketrevisionแทนสิทธิ์; permission revocationไม่จำเป็นต้องเพิ่มrevision |
| OP06-08 | Read/result DTO + receipt UX | invalid200ไม่ถือว่าread/sentสำเร็จ, servercursorต้องvalidate/mergeกับcurrentให้monotoneเมื่อresponsesกลับสลับลำดับ; ตรวจgap/unloadedhistoryกับreadcontract; refresh/batch attemptsคงrequestId/body/recipient snapshotตามสัญญา ไม่มีauto-resend unknown |
| OP06-09 | Realtime/reconnect unit behavior | mountจริงยิง SUBSCRIBED/CHANNEL_ERROR/TIMED_OUT/CLOSED, hidden/offline/visible/online, duplicate invalidation+unmount; ตรวจrefetch/cursor-gap recovery/cleanup ไม่ใช่snapshot string ต้องไม่เรียกสัญญาณliveถ้าfallback polling |
| OP06-10 | Bounded harness/evidence | กำหนดเพดานrequest/body/consoleต่อscenario, overflowต้องfailพร้อมsummary, ทุกbrowser/server/deferred cleanupในfinally; traceใหม่เป็นsmallrepresentative+counts ไม่commitlogsนับแสนบรรทัด เพิ่มindexSHA/ที่เก็บrawเดิมแทนลบประวัติเงียบ ๆ |
| OP06-11 | Staff onboarding real-contract UX | แยกunconfigured/anonymous/unlinked/pending/approved/rejected/suspended/inactivelegacy/identitychanged/conflict/permissionlostตามAPIล่าสุด แสดงThai recoveryที่ทำได้ ไม่สร้างfakeapplicationหรือautoactivate ไม่เปิดOAuthจริง |
| OP06-12 | Approval uncertain/access-loss paths | immutable requestId/body, stale409ไม่ย้ายdecisionไปอีกapplication, doubleclickหนึ่งrequest, revokedreviewerล้างprivate drawer/list, pendingdialogdismissไม่สูญคำขอ unknown; ฝ่ายสุดท้าย/การระงับชัดเจน |
| OP06-13 | Incident recipient selection | ใช้existingoptions/preview/confirm/status/retry contractsจากRoot แยกหมวดกับIncident ไม่autoรวมคน เลือกeligibleรายคน/ทั้งหมดที่มีสิทธิ์ (เพดาน100) พร้อมจำนวนเคส/ผู้รับจริง คนเข้าทีหลังไม่ถูกใส่batchเดิม รูปแบบvisualคงของระบบ |
| OP06-14 | Batch review/partial delivery UX | previewข้อความ/recipient snapshotก่อนconfirm, expiry/409บังคับreviewใหม่; QUEUEDไม่ใช่SENT; partial/UNKNOWN/DEADแสดงรายผู้รับและretryเฉพาะที่serverอนุญาต ห้ามmintbatch/requestใหม่จากtimeoutหรือส่งซ้ำคนสำเร็จ |
| OP06-15 | Mounted browser/a11y matrix | เพิ่มregressionsสามข้อ+actorreset+concurrentwrites+currentonboarding+incidentbulkผ่านproductioncomponents; 1440/390/320,keyboard/focus/dialog/200%Thai zoom/reducedmotion; FIXTUREป้ายชัด ห้ามใช้ภาพแทนbehavior |
| OP06-16 | Reviewable delivery | tests/type/lint/diff/credential+frozenSHA, exactsource/commands/counts, updated05errataและ06coverage จริง แยกIMPLEMENTED/COMPONENT_PASS/FIXTURE_PASS/NOT_RUN/ROOT_DEPENDENCY; ส่งlocalSHAsให้Rootตรวจ |

ความสำคัญ: ปิดprivate-data/recipient/concurrencyก่อนpolish หากงานที่เหลือจำเป็นต้องเปลี่ยนcontractให้เสนอPROPOSEDพร้อมrepro แล้วทำงานอิสระอื่นต่อ ห้ามสร้างendpoint/fieldsหรือแก้backendเพียงเพื่อให้fixtureผ่าน

## ข้อกำหนด UX/การทดสอบ

- Dashboardคือช่องStaffคุยหลัก OAเป็นแจ้งเตือน/รับ/เปิดDashboardเท่านั้น ลบcopyที่สื่อว่าเปิดห้องDashboardจะเปลี่ยนหรือไม่เปลี่ยนactiveLINEchatที่เลิกใช้ไปแล้ว
- รักษาdarkrail/alabaster/coral/roundedcardsของเดิม ไม่สร้างdesignระบบใหม่หรือสถานะonline/readโดยไม่มีหลักฐาน
- ข้อความยาวต้องอ่านครบ/wrap/scrollได้ ไม่sliceเนื้อหาเพื่อให้UIพอดี ขีดจำกัดcomposerต้องตรงserverและแจ้งก่อนส่ง ไม่เปลี่ยนlimitbackendเอง
- ไม่ใช้`as any`/disablelintวงกว้างเพื่อกลบข้อผิดพลาด ไม่skip testหรือแก้fixturehashเพื่อเขียว
- READ/WRITE completionต้องมีเงื่อนไขที่พิสูจน์ React/render settlement ไม่ตรวจabsenceทันทีหลังpromiseถูกresolve ใช้ bounded deterministic barriers/observableevents แล้ววัดDOMจริง
- ถ้าbrowserหรือbuildทำไม่ได้ บอกสาเหตุ/คำสั่ง/exitจริง รันสิ่งที่ทำได้ ไม่แก้node_modules/next.configเพราะjunctionและไม่อ้างRootbuildว่าเป็นbuildของsourceคุณ

แนะนำcommitแบ่งเป็น plan+RED → authority/cache → async/Realtime → onboarding/incident → boundedproofs+report ตรวจallowlistทุกcommit เก็บbaselinehistory ไม่push เมื่อครบส่งexactHEAD/cleanstatus/ผลจริงและremainingissues ไม่ประกาศV1complete
