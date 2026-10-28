# OpenCode — OC-INBOX-04: finish the operator chat workspace

คุณเป็น Frontend/Product Engineer ของ YRU AI Helpdesk. ทำงาน16ข้อด้านล่างต่อเนื่องจนส่งมอบเป็น local commits ที่ตรวจสอบได้ ใช้สัญญาจริงและรักษาความปลอดภัยของผู้รับทุกครั้ง ไม่ออกแบบ backend/auth/queue อีกชุด และไม่ยิงโมเดลหรือ LINE จริง

## ฐานและพื้นที่ที่เตรียมไว้

- Worktree: `D:/project-next/line-ai-yru-opencode-staff` — ชื่อโฟลเดอร์เดิมถูกนำกลับมาใช้ รอบนี้ทำ Inbox
- Branch: `codex/opencode-inbox-workflows`
- Exact code baseline: `d51e73278b557b75a778cdd2305388ba623debc7`
- Root repository: `D:/project-next/line-ai-yru` เป็น read-only สำหรับคุณ ห้ามแก้หรือสั่ง Git ที่นั่น
- Root รวม OC-STAFF-03 พร้อมแก้จุดตรวจพบแล้วใน `a2c0672`; Inbox/API/DB component checkpoint คือ `d51e732`. ห้ามเริ่มจาก2951816/47fbd4a หรือสาขาเก่า
- ไม่ copy `.env`, login passwords หรือ secrets จากพื้นที่อื่น ไม่มีสิทธิ์อ่านฐานจริง/ส่งข้อความจริง/ทดสอบ provider
- ยืนยัน pwd/branch/HEAD/status ก่อนทำ ถ้าฐานไม่ตรงให้ตรวจ local refs ก่อน ห้าม reset/clean/stash/force-switch หรือทับงานที่ไม่ใช่ของคุณ

อ่าน AGENTS.md, docs/PROJECT_INDEX.md, docs/tasks/V1_TASK_BOARD.md, docs/agents/WORKING_PROTOCOL.md, DEC-187/188, master guide §§17–21/51–56, requirements CH023/026/028/031/054/055/056, docs/architecture/YRU_V1_DESIGN.md, STAFF_LINE_BINDING_DESIGN.md, INCIDENTS_DESIGN.md และ docs/superpowers/plans/2026-10-28-chat-inbox-implementation.md. อ่าน installed Next docs ตาม API ที่ใช้ โดยเฉพาะ server/client boundary, routing/searchParams และ navigation ห้ามเดาเวอร์ชัน

## การแบ่งเจ้าของ

**OpenCode owns:** Inbox/Ticket conversation UI, browser state, forms/actions accessibility, frontend regression/browser fixture harness และ QA ของ onboarding UI. Root จะไม่แก้ไฟล์ที่มอบให้ระหว่างรอบนี้

**Root owns:** lib/** และ types/** contracts; DB/migrations/RLS; LINE/OAuth/session/approval APIs; private media transport; routing/quotes/bursts; worker/outbox; incident classification; model/Hermes execution; startup scripts; normal DB activation และ final acceptance. Root ทำต่อพร้อมคุณ ห้ามแก้ backend เพื่อให้ fixture/UI ผ่าน

ไฟล์ที่คุณแก้ได้เท่านั้น:

1. `app/(dashboard)/inbox/**`
2. `app/(dashboard)/tickets/[id]/page.tsx`, `ticket-actions.tsx` และ UI-only helper ใหม่ภายในโฟลเดอร์เดียวกัน ชื่อ `chat-*` หรือ `ticket-action-*`
3. `app/(dashboard)/incidents/IncidentBatchReply.tsx`, `app/incidents.css` เฉพาะ reviewed recipient interaction เดิม ห้ามเปลี่ยน batch contract
4. `app/staff/apply/**`, `app/staff/application/**`, `app/(dashboard)/staff-applications/**`, `app/staff-onboarding.css` เฉพาะ browser/accessibility/state defects ที่พิสูจน์ได้ของ OC-STAFF-03 ห้ามเปลี่ยน root server role gate
5. `app/tickets.css` เฉพาะ `.ticket-detail-*`/`.ticket-action-*` ที่เกี่ยวกับงานนี้ ไม่เปลี่ยน global tokens/หน้ารายการ Tickets
6. `tests/chat-inbox-ui.test.ts`, `tests/incident-batch-selection.test.ts`, `tests/staff-onboarding-ui.test.ts`, `tests/staff-approval-ui.test.ts`, ไฟล์ใหม่ `tests/opencode-inbox-*.test.ts(x)` และ `tests/browser/oc-inbox/**` สำหรับ fixture/harness ที่ไม่กลายเป็น production route
7. `docs/ui/OC_INBOX_04_PLAN.md`, `docs/ui/OC_INBOX_04_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_WORKFLOWS_REPORT.md`

ห้ามแก้ lib/**, types/**, supabase/**, services/**, app/api/**, scripts/**, `.env*`, auth callback/login wiring, shared shell/nav, package/lockfile, next-env, middleware/proxy, AI/Knowledge/Copilot panels หรือ shared task/decision/requirements docs. อ่าน dependency ได้แต่ไม่ใช้ credential. Backend requests ใส่ในรายงานเป็น PROPOSED เท่านั้น ถ้าต้องการเปลี่ยน contract ให้รอ root และทำงานอื่นต่อ

## สัญญาที่มีแล้ว ห้ามเดา endpoint

อ่าน `types/inbox.ts`, `types/tickets.ts`, `types/staff-applications.ts`, `lib/chat/contracts.ts` และ routes แบบ read-only ก่อนออกแบบ adapter:

- `GET /api/chat/inbox`: `InboxListResult` — `tickets`, `unreadCounts`, `departments`, `assignees`, `categories`, server `pagination`. `view=all|mine|unassigned|unread|waiting_staff|waiting_user`; existing filters department/status/priority/assignee/sensitivity/from/to/q/page/pageSize + category. q ค้น4ฟิลด์ตาม backendเท่านั้น ใช้ query จริง ไม่กรองหน้าที่โหลดแล้วและอ้าง totalรวม
- `GET /api/chat/tickets/[id]?beforeSequence=...&limit=...`: `InboxThreadResult`. Default50/max100, cursor exclusive, ascending returned messages, `hasMore`/`nextBefore`, `latestSequence`, `readThroughSequence`. `detail` มี permissions/history/assignees; `detail.messages` ไม่ใช่แหล่ง transcript ของ Inbox
- `POST /api/chat/tickets/[id]/read`: `{throughSequence}` เป็น monotone acknowledgment เฉพาะข้อความที่ render และเห็นจริง ไม่ใช่ LINE read receipt
- `POST /api/chat/tickets/[id]/notes`: `{text,requestId}` ข้อความ1..4000อักขระ บันทึกภายในเท่านั้น ไม่ใช่ Student reply
- Existing `POST /api/tickets/[id]/{accept,reply,resolve,close,reassign,reopen}` ใช้ `revision/requestId` และ field ตาม `ticketActionSchemas`; reply1..5000. HTTP200 คือ action ถูกบันทึก ไม่ใช่หลักฐาน LINE ส่งสำเร็จ
- Private Supabase channel `staff:<actorId>:inbox`, event `invalidate`, `config.private=true`. Payload เป็น marker ไม่มี chat/PII; ต้อง refetch API ที่ตรวจสิทธิ์ใหม่ ห้ามสร้าง publication/public subscription เอง
- `ChatMessage.deliveryStatus` เป็นหลักฐานจาก server; null=ยังไม่มีหลักฐาน ห้ามเดา SENT จาก senderType หรือ200. `attachments` อาจว่างเพราะ root media ยังไม่ทำ ห้ามอ้าง upload/download พร้อมจาก fixture
- ใช้ Incident preview/confirm/results endpoints ที่ component เดิมเรียกเท่านั้น อ่าน current implementation ก่อน ห้ามสร้าง endpoint ใหม่ และต้องคง reviewed snapshot + per-recipient outcomes
- Staff onboarding contract ใช้เดิมตาม OC-STAFF-03; root Auth/API ยังไม่ activated. 404/503 ต้องแสดง unavailable อย่างซื่อตรง ไม่ใช่ fake success. การทำ browser fixture ไม่รับรองการ login/approval จริง

## 16 งาน ต้องทำและรายงานแยกข้อ

1. **Inventory + plan:** ตรวจ code baseline, existing frontend/controller/tests และ endpoints จริง ระบุแต่ละ gap/files/dependency/acceptance ใน PLAN ก่อน implementation. ปรับจาก source ไม่ใช่สร้าง Inboxใหม่ซ้อนของ root
2. **One conversation workspace:** ใช้ chat/composer component เดียวร่วมระหว่าง `/inbox?ticket=<id>` และ `/tickets/[id]`. ไม่เหลือช่องส่งข้อความสองชุดที่ semantics ต่างกัน ไม่ redirectวน. คง history/metadata/support/similar information เดิม และ operational actions ที่ยังจำเป็น; ถ้าพาไป detail route จาก Inbox ต้องไม่กลับมาหน้าเดิมโดยไม่มีรายละเอียด
3. **Case lifecycle actions:** วาง accept/resolve/close/reassign/reopen ตาม `detail.permissions`; เหตุผล/ผู้รับผิดชอบ/ยืนยันเท่าที่ contractกำหนด และแสดงผู้รับ/รหัสเคสก่อน mutation. ไม่แสดงปุ่มที่ไม่มีสิทธิ์ ไม่ใช้ roleฝั่ง clientให้สิทธิ์ใหม่ และไม่ resolve/close อัตโนมัติเมื่อส่ง reply
4. **Recipient/draft isolation:** actor+ticket+reply/note แยกชัด เปลี่ยนห้องระหว่าง request/อ่าน/พิมพ์/รับงานแล้วห้ามเปลี่ยนผู้รับของงานเดิมหรือเอาผลมาทับห้องใหม่. ร่างในหน่วยความจำเท่านั้น ไม่ promiseข้ามreload/แท็บโดยไม่มี implementation; ห้ามเก็บ private textในURL/localStorage/sessionStorage/log
5. **Unknown outcomes:** เก็บ immutable `{actor,ticket,action,requestId,revision,payload}` แยกจากร่างที่พิมพ์. Network/5xx/invalid-success JSON ต้อง retryคำขอเดิม ไม่เปลี่ยนbodyเพราะpolling/revisionใหม่หรือผู้ใช้แก้ข้อความ. ต้องให้ผู้ใช้เห็นว่ากำลังตรวจคำขอเดิม; ห้ามเงียบๆสร้างrequestIdใหม่แล้วอาจส่งซ้ำ. Draftใหม่ต้องไม่หายเมื่อคำขอเดิมยืนยันสำเร็จ. 409 รักษาร่าง โหลดข้อมูลใหม่ ให้คนตรวจทานใหม่ ไม่ auto-resend
6. **Real queue filters:** เพิ่มตัวกรองฝ่าย/หมวด/สถานะที่จำเป็นจาก options จริง มี mine/unassigned/unread/waiting; URL/query/deep linkใช้ได้ กลับ/ไปข้างหน้าไม่แสดงคนละห้องกับURL. ใช้ total/pagerจาก server; missing pagination=unknown, zero/out-of-range distinct. Unknown/duplicate/bad query ต้องมี recovery ไม่ส่ง filterผิดไป backend
7. **Actual request fencing:** ป้องกัน stale list response, old search/page/filter, old thread/history/read/submit callbacks และ logout/actor change. ทำ regressionที่ reproduce actual callback/adapter productionpath ไม่ใช่ทดสอบhelperที่UIไม่ได้เรียก. Abortเป็น optimization ต้องมีserial/identity fenceด้วย. 401/403/404 ล้าง private snapshotตามscopeที่ถูกถอน ไม่มี cachedข้อมูลค้างเปิดอ่านได้
8. **Realtime/reconnect:** private invalidation→authorized refetch; initial load/reconnect/re-subscribe and visible5s polling fallback. ไม่มี interval/subscriptionซ้อน ทุกcleanupใช้จริง. Hidden/offline tabไม่ยิงวน. สถานะ “กำลังเชื่อมต่อ/ใช้การอัปเดตสำรอง” ตามหลักฐานจริง ไม่ประกาศ connectedเมื่อ channel ERROR/TIMED_OUT
9. **History and gaps:** cursor pagination ไม่ซ้ำ/ข้าม การโหลดก่อนหน้ารักษา scroll anchor. หลังoffline/burstเกิน50/100ข้อความต้อง catch-upจน overlapกับข้อความเดิมหรือแสดง gapที่ยังต้องโหลด ไม่ทำเหมือนครบแล้วทั้งที่ขาดกลาง. จำกัดงานต่อรอบอย่างมีเหตุผลและมีload more/retry ไม่ยิงrequestไม่จำกัดหรือทิ้งข้อความเงียบๆ
10. **Read/unread + delivery:** acknowledgeเฉพาะ visible rendered tailของห้องปัจจุบัน ไม่อ่านจาก global latestSequenceที่ยังไม่แสดง; responseเก่าไม่ลด/ข้ามcursor ไม่markseenเมื่อมองห้องอื่น. แยก queued/processing/retry/sent/unknown/failed/suppressed/ไม่มีหลักฐาน. ไม่แสดง Student online/typing/read receipt ที่ backendไม่มี
11. **Minimal UI + keyboard/mobile:** คง dark rail/alabaster/coral ของ root. 3panes desktop, มือถือทีละpane มีback/focusที่เข้าใจได้และcomposerไม่หลุดจอ. ตรวจ1440x900/390x844/320px, Thai200%zoom, long Thai/unbrokenURLs, keyboard/Tab/ShiftTab/Escape, modal/inert/return focus, reduced motion. ไม่มี horizontal overflowหรือข้อมูลสำคัญถูกตัดหาย
12. **Private notes and assistance:** notes UIใช้4000ตามcontract แยกจากStudent replyทั้งlabel/สี/composer/notification. Existing AI/Knowledge/Hermes panels explicitclickเท่านั้น; draftapplyต้อง actor/ticket/revision+currentpermission ยังตรง และconfirmก่อนแทนร่างที่พิมพ์. ไม่ autosend ไม่เรียก modelเพื่อQAรอบนี้ ไม่เปลี่ยน provider defaults
13. **Media readiness:** render attachmentsเฉพาะ serverDTOจริงและstatusจริง ชื่อไฟล์ยาว/error/emptyเข้าใจได้. ถ้าtransportยังไม่พร้อมให้disabled/บอกยังไม่พร้อม ไม่สร้างpublicURL/RAW LINE fetch/ปลอมupload200/ฝังข้อมูลไฟล์ในtextreply. ไม่บังคับuserกรอกtechnicalIDs
14. **Common-incident workflow:** จาก Inbox ให้ไปดูเหตุการณ์เดียวกัน/ตอบหลายเคสได้ด้วยเส้นทางที่มีจริง. Categoryเหมือนกันไม่ใช่incidentเดียวกัน. ทบทวน select current eligible/all/clear<=100, single/common mode, previewinvalidatesเมื่อแก้คน/ข้อความ, late arrivalsไม่ถูกเพิ่ม, per-casefailure/retryไม่ทำให้เคสที่ส่งแล้วซ้ำ. ห้ามเปลี่ยน backend snapshot/confirm/ownership guards
15. **Onboarding browser acceptance:** ทดสอบ rootแก้ OC-STAFF-03 แล้วจริงผ่าน mountedcomponents: native modal focuscycle+return, X/Escapeระหว่างpending/uncertainไม่ทำretryIDหาย,409rowออกจากfilteredlistไม่actionstale,401/403ข้อมูลไม่ค้าง,รายละเอียดREJECTED/SUSPENDEDอ่านอย่างเดียว, applicantuncertainbodyimmutable. แยก fixtureinteraction กับ actualOAuth/realapprovalชัด ถ้าเจอUIdefectในallowlistให้RED→แก้ ไม่แตะrootAPI/rolegate
16. **Evidence/gates/report:** focused regressions+typecheck+lint+fullunit+build+diffcheck+credentialscan. Browser harnessใช้ component sourceจริง พร้อม synthetic adapters เฉพาะtest และป้ายFIXTURE; ไม่เพิ่มproductionfixture routeหรือแก้serverauthแล้วอ้างlivepass. บันทึก actualviewport/consoleerrors/networkbodies/keyboardactions และ limitations ไม่อ้าง staticCSSเป็นmobileQA. ถ้า browserเครื่องมือไม่มีให้ระบุNOT_RUNและงานที่พิสูจน์ได้ต่อให้เสร็จ ห้ามแต่ง screenshots/claims

## คุณภาพการทดสอบ

ใช้ RED ที่ชี้ behaviorผิดก่อนแก้ ไม่จบที่ missing-module หรือassertsourceข้อความ. อย่างน้อยครอบคลุม: stale search/list; switchA→Bระหว่างAreply/history; actor/logout; immutable uncertainrequestทั้งnote/reply/action;409freshreview;200queuedไม่SENT;duplicatecallbacks;>100messagecatchup;scrollanchor;hiddenreadack;revokedpermission;lateincidentrecipients;modalfocus. Tests ต้องขับ production controller/adapter/component ที่ UI ใช้จริง

คำสั่งฐาน (รายงาน exitจริง ไม่รวมผลคนละsnapshot):

```powershell
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=1 --testTimeout=20000
pnpm build
git diff --check
node scripts/security/check-staged.mjs
```

Frozen fixture `tests/fixtures/assistant-conversations.json` ต้อง SHA256 `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3`. Root pinด้วย.gitattributesแล้ว ห้ามแก้fixture/expectedhash/normalizeinputเพื่อทำtestsผ่าน. หากไฟล์ผิดbytesรายงานก่อน ไม่โยนเป็นGemini failure

Node modulesเป็นjunctionไปdependencyเดิมบนD. หากTurbopackworktree rootมีปัญหา ให้เก็บfailureจริง; `pnpm exec next build --webpack` เป็น secondarybuildได้ โดยบอกชัดว่าไม่ได้พิสูจน์ defaultTurbopack. ห้ามแอบแก้next.config/lockfileหรือใช้build snapshotที่sourceไม่ตรงแล้วอ้างfullpass. ห้ามรันdev/workerพร้อมfulltestจนแย่งCPUแล้วเพิ่มproducttimeoutเพื่อปิดfailure. Port3000/3012และrootruntimeห้ามหยุด; ถ้ารันfixturedevเลือกportว่างและหยุดเฉพาะPIDของตน

RootตรวจฐานDworktreeนี้แล้ว: cleanที่d51e732, frozenhashตรง และ105focusedtests/7filesPASS. DefaultTurbopackbuildติดjunctionชี้ออกprojectroot; secondaryWebpackcompile/typecheckผ่านแต่pagecollectionติดexistingHermesURLinitializationที่copilotroute. ทั้งสองอย่างเป็นroot-owned build dependency ห้ามให้คุณแก้lib/**/next.configหรือวนลองเพิ่ม. ทำUI/tests/browserส่วนอื่นต่อ และรายงานbuildเป็นBLOCKEDตามจริงจนrootส่งวิธีรันที่รับแล้ว. Root fullworking-sourceunit3556/261filesPASSหลังลดparallelworkerเพื่อไม่แย่งCPUของPDFchild; ตัวเลขนี้รวมrootcontinuationที่ไม่อยู่ในbaselineคุณ จึงไม่ใช่fullsuiteของd51e732

Root main default `pnpm build` (Turbopack, original config) ผ่านexit0แล้ว โดยแยกproduction `.next` จากdev `.next/dev` ตามinstalleddocsและคืนnext-envเดิมด้วยhashproof. นี่ไม่ใช่buildPASSของworktreejunction. สำหรับbrowserfixtureเลือก `next dev --webpack` บนportว่างได้; ถ้าต้องmockserverauthให้ทำในprivate testfixtureprojectเท่านั้น ใช้clientcomponentsจริง/ระบุFIXTURE และไม่แก้หรืออ้างproductionauthผ่าน

## การส่งมอบ

Commitแยกงานพอดี เช่น plan → sharedworkspace/actions → state/recovery → regressions+browserQA → report. Local only: **ห้าม push/merge/rebase/reset/clean/deploy**. ก่อนcommitตรวจstagedfilesไม่หลุดallowlistและcredentialscan. ไม่รวมlogs/browsercache/screenshotsข้อมูลจริง/secrets. Coverageแต่ละข้อระบุ IMPLEMENTED/COMPONENT_PASS/FIXTURE_PASS/NOT_RUN/ROOT_DEPENDENCY ตามหลักฐาน

รายงานสั้นแต่ตรวจได้: baseline+finalSHA/chain, files, actualRED→GREEN cases, gatesexit, actualbrowservsfixture, remainingrootdependencies และ defectที่ยังไม่แก้. บอก rootว่าจบเพื่อมาตรวจทุกcommitก่อนรวม ไม่เรียกV1complete ไม่สรุปprovider/realLINEผ่านจากmock. Rootจะทำ backend/auth/continuity/mediaต่อขนานโดยไม่แก้UIownedfilesของคุณ
