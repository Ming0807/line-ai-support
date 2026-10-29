# OpenCode — OC-INBOX-05: prove and harden the operator workspace

ทำงานต่อเนื่องในฐานะ Frontend/Product Engineer จนส่งมอบ local commits ที่ตรวจรับได้ ห้าม push รอบก่อนมีโครงสร้าง UI ที่นำไปต่อได้ แต่ Root ตรวจพบข้อผิดพลาดในเส้นทางใช้งานจริง จึงยังไม่รับ OC-INBOX-04 ว่าใช้งานครบ รอบนี้แก้พฤติกรรมและพิสูจน์ผ่าน component ที่ mount จริง ห้ามจบที่เทส helper หรือค้นข้อความใน source แล้วเรียกว่า workflow ผ่าน

## ฐานและเจ้าของงาน

- Worktree เดิม: `D:/project-next/line-ai-yru-opencode-staff`
- Branch เดิม: `codex/opencode-inbox-workflows`
- Exact starting HEAD: `87257b53548b04ebcc902346199d5a476f1df0bc`
- OC-INBOX-04 original baseline: `d51e73278b557b75a778cdd2305388ba623debc7`
- Root: `D:/project-next/line-ai-yru` อ่าน source/contract/prompt ได้ แต่ห้ามแก้หรือสั่ง Git ที่นั่น
- Root ยังไม่ได้ merge OC-INBOX-04; เก็บ commit chain เดิม ต่อ commit ใหม่ด้านบน ห้าม reset/clean/stash/rebase/force-switch หรือลบหลักฐาน RED เดิม
- ไม่อ่าน/copy `.env` หรือ credential ไม่ต่อฐานจริง ไม่ยิง provider/Hermes/LINE/OAuth จริง ไม่เปลี่ยนสิทธิ์เพื่อทำ browser QA

อ่าน AGENTS.md และ required project sources ตามนั้น รวม root prompt OC-INBOX-04, DEC-187/188, CHAT execution plan, installed Next16 docs ของ API ที่ใช้ และ server contracts `types/{inbox,tickets,staff-applications}.ts`, `lib/chat/contracts.ts`, ticket action route/response schema แบบ read-only

**OpenCode:** UI/controller/hooks/test harness ของ Inbox/Ticket/Staff onboarding เดิม

**Root:** `lib/**`, `types/**`, APIs/auth/privacy/DB/RLS/migrations, source routing/quotes/bursts, media transport, incident detection, LINE/outbox/worker, AI/Hermes, startup และ integration acceptance Root ทำงานส่วนนี้ขนาน ห้ามแก้ข้ามขอบเขตเพื่อให้ UI ผ่าน

แก้ได้:

1. `app/(dashboard)/inbox/**`
2. `app/(dashboard)/tickets/[id]/{page.tsx,ticket-actions.tsx,chat-*,ticket-action-*}` เฉพาะ UI/helper
3. `app/tickets.css` เฉพาะ ticket-detail/ticket-action ที่เกี่ยวข้อง และ styles ที่อยู่ใน Inbox
4. `app/staff/apply/**`, `app/staff/application/**`, `app/(dashboard)/staff-applications/**`, `app/staff-onboarding.css` เฉพาะข้อผิดพลาด UI ที่พิสูจน์ได้ ห้ามเปลี่ยน server role gate
5. `tests/opencode-inbox-*`, `tests/browser/oc-inbox/**`, `tests/staff-onboarding-ui.test.ts`, `tests/staff-approval-ui.test.ts` และ new tests `tests/opencode-inbox-hardening-*`
6. `docs/ui/OC_INBOX_05_PLAN.md`, `docs/ui/OC_INBOX_05_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_HARDENING_REPORT.md`; เอกสาร OC_INBOX_04_COVERAGE/OPENCODE_INBOX_WORKFLOWS_REPORT เดิมเพิ่ม dated erratum ได้เพื่อแก้คำอ้างที่ผิด ห้ามลบผล/ข้อจำกัดเดิม

ห้ามแก้ backend/shared shell/AI panels/provider/Knowledge/incident batch implementation/package+lockfile/next.config/next-env/global auth `.env*`/shared board+decisions ห้ามรวม source ของ Root ที่ยัง uncommitted ให้เสนอ contract change เป็น PROPOSED และทำข้ออื่นต่อ

## ข้อบกพร่องที่ Root ตรวจพบ — ต้อง reproduce ก่อนแก้

ข้อด้านล่างมาจาก actual independent Luna high Standards review และ Root source inspection ไม่ใช่ผล browser live ให้คุณพิสูจน์ causal path ด้วย mounted production components อีกครั้ง

- **P1 lifecycle retry ข้ามเคส:** Inbox render `TicketActions` โดย instance เดิมเมื่อเปลี่ยน A→B; `PendingAction` เก็บ action/fields/body แต่ไม่เก็บ actor/ticket/endpoint แล้ว execute ใช้ id prop ปัจจุบัน Repro: ACCEPT หรือ CLOSE ของ A ได้ network error/5xx → เลือก B → กด action แบบเดียวกัน → body/requestId/revision ของ A ถูก POST ไป endpoint B อย่าแก้เพียงใส่ key แล้วทำให้ uncertain attempt ของ A หายเมื่อกลับมา
- **P1 private snapshot ค้าง:** list non-OK เพียง setError โดยไม่ล้าง list; thread denial เพียงเรียก optional callback และ detail route ไม่มี callback จึงยัง render cached messages/metadata หลัง 401/403/404 ต้องล้างในเจ้าของ state ไม่พึ่ง parent callback อย่างเดียว
- **P2 uncertain lifecycle สูญหาย:** `response.ok` ถือว่าสำเร็จโดยไม่ validate success DTO; invalid JSON/ผิด shape 200 ทำ requestId หาย อีกทั้งเปลี่ยน action/fields ทับคำขอที่ยังไม่ทราบผล
- **P2 authority หลายชุด:** detail lifecycle ได้ permissions จาก SSR แต่ ChatThreadLive refresh state อีกชุด กดโหลดข้อมูลล่าสุดแล้วปุ่มเดิมอาจยังมีสิทธิ์เก่า; initialThread effect ข้าม RSC refresh ทุกครั้งหลัง seeded และ assistance callback ผูก initial revision
- **P2 missing callback fences:** ตรวจ loadEarlier/loadCatchUp/read/submit completion ตามจริง ทุก response ต้องผูก actor/ticket/request epoch ไม่ใช้แค่ state helper ที่ hook ไม่เรียก
- **P2 URL ambiguity:** repeated params ถูกเลือกค่าแรกเงียบ ๆ ต้องเห็นข้อผิดพลาด/recovery ตามสัญญา
- **P2 mobile focus:** เลือกแถวแล้ว hide pane ที่มี focused element; back ก็ hide focused back button ไม่มี transfer/return focus

Actual Luna max Spec review เสร็จแล้ว ยืนยันสอง P1 ตรงกับ Standards และเพิ่มหลักฐาน: stale A submit แสดง notice ใน B; stale history ทับ detail/permissions ใหม่; fresh AI draft หลัง reply ถูกปฏิเสธเพราะ callback ใช้ initial revision; `page=10000` กับ `total>0,tickets=[]` ไม่ได้ recovery เพราะ helper ตรวจแค่ total===0 และ coverage04 row7 อ้าง read/history/submit ใช้ ThreadRequestFence ทั้งที่มีเพียง fetchThread ต้องแก้พฤติกรรมและเพิ่ม dated erratum ให้รายงานตรง source

## 16 งานของรอบนี้

1. **Inventory/plan:** pin exact HEAD/status/hash อ่านจริง ทำตาราง defect→reproduction→files→acceptance ก่อน code ห้ามบิดรายงานเก่าว่ามี browser proof ที่ไม่เคยรัน
2. **Immutable lifecycle authority:** attempt เก็บ actor/ticket/action/endpoint/revision/requestId/body แบบ write-once เก็บแยกตามเคสใน workspace memory; A→B→A ไม่ส่งข้าม/ไม่ทำ A retry หาย pending/unknown ต้องไม่เกิด action ใหม่ทับคำขอเดิมในเคสนั้น
3. **Uncertain-action UX:** network/5xx/invalid-success ยังใช้คำขอเดิม ปุ่ม retry ชัดทุกชนิดไม่พึ่ง startsWith ข้อความภาษาไทย ให้เห็นเคส/action ที่กำลังตรวจคำขอเดิม การแก้ช่องฟอร์มไม่แก้ body ที่ส่งไปแล้ว definitive 4xx/409 จึงปล่อย attempt ตามสัญญาและให้ review ข้อมูลใหม่ ห้าม auto-resend
4. **Synchronous submit guard:** กันสอง click/submit ใน tick เดียวด้วย guard ที่ทำงานก่อน await ไม่ใช้ React pending state อย่างเดียว Test กดพร้อมกันต้องมีหนึ่ง requestId/HTTP
5. **Actual response validation:** อ่าน success contract ของแต่ละ endpoint แล้วตรวจ field/identity ที่จำเป็น Reply/note/lifecycle ต้องไม่ถือว่า `{}`, `null`, wrong-ticket DTO หรือ malformed200 เป็น committed แยก action recorded จาก LINE SENT ไม่ให้ private draft ใหม่หายเพราะ response เก่า
6. **Access-loss erasure:** 401/403/404 ที่ยัง current ต้องล้างข้อมูลตามขอบเขตทั้ง list/thread/history/notes/assistance/selection/permissions/queued callbacks ทั้ง Inbox และ detail การตอบกลับเก่าห้ามคืนข้อมูลหลัง revoke ส่วน 409/network ต้องรักษาร่างตามนโยบาย ไม่ลบทุกอย่างเพราะ network หลุด
7. **All callback epochs:** ทำ mounted tests A history/read/submit ค้าง → B → A และ actor/logout/revoke อย่าอาศัย activeRef.id อย่างเดียวซึ่งยอมรับ ABA response เก่าได้ ห้าม stale history เขียน record หรือ stale response ลบ unknown attempt ใหม่/เปลี่ยน notice/clear busy ของอีกห้อง read error ก็ต้องจัดการ authority ตามจริง
8. **One current detail authority:** shared workspace เป็นแหล่ง detail/permissions/revision ปัจจุบันให้ทั้ง chat/actions/assistance RSC update ที่มี authority ใหม่ต้องเข้าจริงแต่ไม่ทับข้อความ/ประวัติใหม่ด้วย snapshot เก่า assistance draft ใช้ revision ที่ผูกกับคำขอจริง ไม่ใช้ initial revision ตลอดชีวิต component
9. **Realtime/reconnect ทั้งสอง route:** detail และ Inbox ได้ authorized refetch จาก private invalidation และ visible polling/reconnect เหมือนกัน ติด event listener/cleanup อย่างละหนึ่งชุด มี test `CHAT_THREAD_REFRESH_EVENT` จริง ไม่ยิง polling ขณะ hidden/offline ไม่ส่ง PII ผ่าน broadcast ป้องกัน actor change/channel error/unmount
10. **Query/deep link:** unknown/duplicate/malformed keys รวม ticket/date/UUID/enum/pagination ต้องมี recovery ไม่ส่ง arbitrary first duplicate ไป backend ใช้ server total/cursor ไม่กรอง loaded page แล้วอ้าง total รวม ทดสอบ popstate และ deep-link mismatch
11. **Transcript coverage/read:** burst >100 + cursor gaps ต้องตามถึง overlap หรือแสดงช่วงที่ยังขาดอย่างซื่อตรง history response เก่าห้ามทับ latest detail/permissions หรือทำให้ live message delivery status ย้อนกลับ ack เฉพาะ visible rendered contiguous tailตามนโยบายของ API ไม่อ้างอ่านช่วงที่ยังขาดด้วย global latestSequence ทดสอบ read/network/reconnect/late response ไม่ลด cursor
12. **Actor/session cleanup:** memory stores ต้อง actor-scoped และล้าง private cache เมื่อ logout/revoke/unmount ตามขอบเขต ไม่เผยข้อมูลคนเดิมตอน actor ใหม่ rerender Draft/unknown attempts ไม่ไป URL/localStorage/sessionStorage/log Request ที่ปิดงานก่อนเปลี่ยน actor ต้องไม่กลับมาส่ง mutation ในนาม actor ใหม่
13. **Mobile/keyboard:** transfer focus เข้า pane และกลับแถวเดิม (กรณีแถวหายกลับ queue heading) ไม่มี focus อยู่ใน display:none ขนาด1440×900/390×844/320×844, Thai200%zoom, longURL/Thai, Escape/Tab/ShiftTab, reduced motion และ composerไม่หลุดจอ ตรวจด้วย browser จริง
14. **Mounted regression harness:** fixture ต้อง import production component/hook จริง + synthetic same-contract adapters มี deferred responses ควบคุม A/B/ABA และ error bodies ทดสอบตามข้อ2–12 REDก่อนแก้ ห้าม SSR/source-string/pure helper อย่างเดียวแล้วอ้าง integration ทุก screenshotมี FIXTURE label ไม่สร้าง fixture/auth bypass ใน production routes
15. **Onboarding/browser backlog:** ใช้ harnessเดียวกันพิสูจน์ native dialog focus/inert/return, uncertain X/Escape/immutable applicant payload,409 rowออกfilter,401/403ล้างsnapshot,finished applicationอ่านอย่างเดียว สถานะเงินจริง/OAuth/backendยังเป็น NOT_RUN ตามจริง ไม่แตะ root API
16. **Gates/report:** focused mounted suites + fullunit/typecheck/lint/diffcheck/staged scan จริง จัดผลแต่ละข้อ FIXED/PRODUCTION_PATH_PASS/FIXTURE_BROWSER_PASS/NOT_RUN/ROOT_DEPENDENCY สองคำหลังไม่ใช่ผ่าน รายงาน baseline→finalSHAs, changedfiles, exact RED/GREEN, actual viewports/network requests/console และ issues ที่ยังเปิด

## Browser tooling ที่ Root ตรวจให้แล้ว

Root29October ยืนยัน bundled Playwright มีอยู่จริง ใช้ installed Edge แบบ headless และ private synthetic profile บนD ตั้ง viewport ได้ตรง1440×900/390×844/320×844 การ probe เป็นเพียง tooling capability ไม่ใช่ Inbox acceptance ไม่ต้องติดตั้ง browser ใหม่หรือเขียน cache ลงC

```js
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/NOTEBOOK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
// Create a unique, owned synthetic profile under D:/codex-cache/yru-ui-qa/.
const context=await chromium.launchPersistentContext(ownedProfile,{headless:true,channel:'msedge'});
try {
  const page=await context.newPage();
  await page.setViewportSize({width:390,height:844});
  // Load YOUR isolated test fixture, importing real production UI with synthetic adapters.
} finally {await context.close();}
```

ใช้ context/profile ของตัวเองเท่านั้น ห้าม attach browser/session/cookies ของผู้ใช้ เก็บ artifact ที่ไม่มีข้อมูลจริงและมี scope ชัด ถ้าใช้ CLI มีคำสั่ง resize ตาม [official Playwright](https://playwright.dev/agent-cli/commands/interaction) แต่ bundled library ข้างบน Rootพิสูจน์ใช้ได้แล้ว ไม่ต้องวนหาเครื่องมือใหม่

สร้าง isolated fixture project ภายใต้ allowlisted `tests/browser/oc-inbox/**` หรือ ignored staging ของตัวเองได้ ต้องไม่แก้ production Auth/page gate เพื่อเปิดดู UI; mock navigation/Supabase network เฉพาะ fixture adapter เท่านั้น หากจำเป็นต้องติดตั้ง test dependency เพิ่ม อย่าเปลี่ยน main package/lockfile ให้ใช้ package/cache แยกบนDแล้วบันทึก version+เหตุผล/command ไม่เพิ่ม paid service และไม่อ่าน `.env`

Worktree `node_modules` junction ยังทำ default Turbopack build fail เป็น ROOT_DEPENDENCY ที่ทราบแล้ว ไม่แก้ next.config หรือวน buildซ้ำ Rootจะตรวจ finalbranch buildแยกหลังreview การใช้ config เฉพาะ isolated fixture ต้องระบุชัด ไม่ใช่ production buildPASS Port3000/3012/rootworkersห้ามแตะ ใช้ portว่างและปิดเฉพาะ process ของตัวเอง Start-Process ต้อง Hidden เก็บ peak memory/error จริง ไม่สรุป OOM ว่าไม่เกี่ยวกับแอปโดยไม่มีหลักฐาน

## คุณภาพและส่งมอบ

ทดสอบคลิก/submit ผ่าน component ที่ UI ใช้จริง จับ endpoint/body/requestId ทั้งก่อนและหลัง switch ไม่เปลี่ยน acceptance ให้ตรง bug ที่เพิ่งเขียน ถ้าเปลี่ยน architecture ภายใน frontend ต้องมี causal regression และไม่เปลี่ยน server contract

Frozen evaluator SHA256 ต้องเดิม `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` ไม่แก้ input/hash หรือ normalize ขณะรัน ไม่เพิ่ม producttimeout/providerbenchmark ไม่เอาตัวเลข Root backend suite มารวมเป็นของตัวเอง

ทำ local commits ขนาด reviewได้: plan/testsRED → lifecycle/cacheguard → callback/currentauthority → browser/regressions → report ทุกcommit scan stagedallowlist+credentials+diffcheck ห้าม push/merge/rebase/deploy รายงานสุดท้ายต้องบอกข้อที่ยังไม่ผ่าน แม้ fullunitเขียว อย่าเรียก V1complete

ระหว่างทำ Rootเก็บ backend/auth/media/continuity/Hermesต่อ การแก้ข้างบนได้รับอนุญาตแล้ว ทำจนจบรอบ ไม่ต้องถามผู้ใช้ว่าจะเริ่มข้อไหน
