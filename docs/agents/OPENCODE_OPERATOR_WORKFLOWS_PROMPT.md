# OC-UI-02 — Activities + Logs continuous operator workflows

คุณเป็น Frontend Engineer ที่ผู้ใช้เลือกผ่าน OpenCode ทำงานต่อเนื่องจนครบ 12 งานย่อยด้านล่าง ไม่หยุดหลังวางแผน ไม่หยุดเพื่อขอ credentials และไม่ทำงาน backend เอง ใช้ skill frontend/impeccable หากเข้าถึงได้ แล้วบันทึก skill/tool ที่ใช้จริง งานนี้ให้ Codex ตรวจคุณภาพ implementation ตามหลักฐาน ไม่ใช้เป็นการจัดอันดับโมเดลทุกด้าน

## พื้นที่ทำงานและ baseline ที่ตรวจแล้ว

- Worktree เดิม: `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru`.
- Baseline **`9437654c5ce550a6dad864a6c0354da82bd11098`** บน `codex/opencode-ticket-pilot`: เป็น e5c022e + **root** repairs แล้ว ไม่ใช่ผลงานที่คุณเขียนรอบนี้
- ตรวจ `git status --short`, `git rev-parse HEAD`, `git log -4 --oneline` ก่อนเริ่ม ต้องไม่ทับงานค้าง ถ้า clean ให้สร้างและใช้ `codex/opencode-operator-workflows` จาก SHA นี้ ไม่แก้ branch Gemini/pilot เดิม
- Root reference read-only: `D:\project-next\line-ai-yru`, checkpoint `e78dd51228e171646d9ad3520ff4d7bb990fec6a` และเอกสาร OC-UI-02/DEC-050 ที่ root ส่งให้ ตรวจ HEAD ปัจจุบันและบันทึกจริง เพราะ root กำลังทำ backend ต่อ
- **Local commit only. ห้าม push, merge, rebase, reset/clean, deploy หรือแก้ root checkout**.
- Root เคลียร์ข้อเล็กของ Tickets แล้ว: unknown-empty/parser/UUID/custom size/metadata/count/range + fixture; focused44/full1499/98files/type/lint/build PASS ไม่มี browser/live acceptance อย่านับการแก้เหล่านั้นเป็นผลงานใหม่ของคุณ

## อ่านและรักษาสัญญา

อ่าน AGENTS.md, docs/PROJECT_INDEX.md, docs/tasks/V1_TASK_BOARD.md, docs/decisions/DECISION_LOG.md, CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md, docs/requirements/sources/README.md และ original-overview §§30–31, docs/requirements/V1_REQUIREMENTS_MATRIX.md (CH015/016/060, USR-UX/DASHBOARD), docs/architecture/YRU_V1_DESIGN.md, docs/operations/BACKEND_UI_CONTRACTS.md, docs/reports/GEMINI_UI_UX_ROUND5_REVIEW.md และ root [OC-UI-01 review](../reports/OPENCODE_TICKET_PILOT_ROOT_REVIEW.md). อ่าน installed Next guide ก่อนเขียน page/client/loading/error code

คุณต้องอ่าน `docs/reports/OPENCODE_TICKET_ROOT_REPAIR_REPORT.md` ใน worktree นี้ด้วย แยก root fixes ออกจากผลงานของคุณ

หากเอกสาร review/decision/contract ใหม่ไม่มีใน frozen worktree ให้อ่านจาก root checkout แบบ read-only ห้าม copy/merge backend เพื่อให้เอกสารหรือ API ดูเหมือนพร้อมแล้ว

รักษาหน้าหลักและ sidebar ที่ผู้ใช้ชอบ: rail #141622, canvas #f4f3ef, cards radius1.75rem, coral #f25c54, ไม่มีสีเขียวระบบเก่า เน้นอ่านเร็ว/keyboard/mobile/plain Thai ข้อความ product ห้ามมี ROOT_BACKEND_SYNC_REQUIRED หรือศัพท์ implementation/API fixture ติดอยู่บน production UI

## ขอบเขตที่คุณเป็นเจ้าของ

แก้เฉพาะ:

- `app/(dashboard)/activities/page.tsx` และไฟล์ browser-safe ใน folder นี้
- `app/(dashboard)/logs/page.tsx` และไฟล์ browser-safe ใน folder นี้
- shared operator components/types/controllers **ใต้** `app/(dashboard)/operator-workflows/` ใหม่
- `app/operator-workflows.css` ใหม่; ใส่ class เฉพาะ scope ห้ามเปลี่ยน global/home/sidebar tokens
- `tests/opencode-operator-*.test.ts` / `.test.tsx`, `tests/fixtures/opencode-operator-*`
- `scripts/ui/opencode-operator-*` หากจำเป็นสำหรับ fixture preview/browser QA ซึ่งไม่มี production route/auth bypass; generated output อยู่ ignored `output/`
- docs/ui/OPENCODE_OPERATOR_* และ docs/reports/OPENCODE_OPERATOR_WORKFLOWS_REPORT.md; task board/decision ใน worktree อัปเดตเฉพาะ OC-UI-02

ห้ามแก้ lib/**, types/**, app/api/**, supabase/**, services/**, existing auth/layout/nav, provider/LINE/embedding/ticket/import business behavior, testsเก่าเพื่อทำให้ contractอ่อนลง, package dependenciesโดยไม่มีเหตุผลชัดเจน ห้ามอ่าน/พิมพ์/คัดลอก .env/account passwords/private original/token ห้ามสร้าง audit write/API/schema/SQL หรือใช้ service-role ใน browser Root เป็นเจ้าของ backend contract และ final integration

## 12 งานย่อย ทำตามลำดับและทดสอบแต่ละชิ้น

1. **Plan and source inventory.** สร้าง docs/ui/OPENCODE_OPERATOR_PLAN.md: task IDs OC-UI-02.01–.12, req/source, owned files, dependencies และ acceptance ระบุหน้าเดิมเป็น shell และ adapter live ที่ยังไม่มีอย่างตรงไปตรงมา บันทึก model/provider/version/reasoning ที่ UI/CLI แสดงจริง หากไม่มีหลักฐานให้ UNKNOWN ห้ามเดาจากชื่อ harness

2. **Shared discriminated state contract.** เตรียม browser-safe states `unavailable | loading | ready | empty | error` พร้อม observedAt และ pagination เมื่อมีหลักฐานเท่านั้น สถานะ unavailable ห้ามแสดงศูนย์/ไม่มีรายการ/healthy/failed ปลอม; ready/empty ต้องมาจาก response ที่ตรวจรูปแบบแล้วเท่านั้น วันที่แสดง Asia/Bangkok; invalid timestamp แสดงไม่ทราบ ไม่โยน exception ทั้งหน้า

3. **Adapter and privacy projection.** default production adapter แสดง unavailable เพราะยังไม่มี root-accepted read endpoint ไม่เดา URL endpoint/model roles/status ใหม่ สร้าง injectable adapter seam ให้ tests/fixture harness ใช้ loader จำลองกับ **production controller/renderer เดียวกัน** ไม่มี fake responseใน production และไม่มี query/env เปิด demo ใน live app ความปลอดภัยจริงเป็น backend responsibility; browser projectionรับเฉพาะ allowlisted safe fields ตัด raw JSON/message bodies/stack/headers/request URLs/IP/LINE IDs/token/password/source notes ก่อน state/render/DOM ไม่ใช่แค่ hide CSS Fixturecontract ทุก field เป็น **PROPOSED, NOT ROOT-ACCEPTED** จน rootตรวจ

4. **Activities list.** จริงใน fixture mode: time/action label/staff display name or unavailable/anonymous ticket code/department label และ safe short summary ใช้ bounded fixturefields ไม่ใช้ private identity การคลิก activity เปิด detail ที่ทำงานจริง ไม่ใช้ decorative button Loadingมี status announcement, stale rowsไม่แสดงเป็น current response; productionที่ยัง unavailable มี recovery/navigation ที่ถูกต้องแทน fake timeline

5. **Activities filters and pager.** ค้นหาจาก safe displayed fields + action/date filters มี labels, Apply/Clear, clear resetspage retains chosen size และ pending query เก็บไว้เมื่อ failure กรอง/total/pagerมาจาก adapter responseเดียวกัน ห้าม count จาก array แล้วอ้าง servertotal URL/history supportเฉพาะ vocabulary ที่คุณประกาศใน browser seam; อย่าบอกว่า root API รับ queryนี้แล้ว Invalid range มีข้อความและไม่ dispatch request รุ่นใหม่ที่ไม่ถูกต้อง

6. **Activity detail accessibility.** ใช้ accessible native details หรือ dialogที่มี labelled title, Escape, focus return, keyboard cycle หากเป็น modal ใช้ safe text nodes (ไม่ dangerouslySetInnerHTML/raw JSON) ลิงก์ticketมีเฉพาะ validated internal routeจากallowlisted ID ไม่มี arbitrary external/raw payload URL ขอ actual assertionsการเปิด/ปิด/focus ไม่เพียงหา string ใน source

7. **Logs list and filters.** สร้าง ready fixture render สำหรับ safe event code/display label/component/time/observed HTTP status เมื่อมีจริง ไม่ทำ quota/healthy inferenceจาก200 หรือ429อย่างเดียว ไม่ใส่ token/replyToken/requestbody/LINEuser ออกใน table/detail ค้นหา severity/component/code/date ด้วย controller seamเดิม Empty/reset/retryทำงานและไม่ถูกปนกับ unavailable

8. **Log details and recovery.** แสดงเฉพาะ allowlisted diagnostic fields/observed time/request correlation ที่ synthetic และปลอดภัย ไม่มี copy raw JSON ปุ่ม Retry มี pending/disabled/announcementและเก็บ filters; unavailableproductionชี้ทาง Tickets/Providersที่มีจริงได้ ห้ามมี Retryปุ่มที่ทำงานเสร็จแล้วหลอกว่าเชื่อม APIสำเร็จ

9. **Races and cancellation.** latest-request wins: applyA→applyB→Bsuccess→Alatesuccess/errorต้องยังแสดงB; abortเมื่อ replace/unmount + epoch fenceหากadapterไม่honorabort Retry/clear/filter/detailไม่ใช้ old selectionคู่new rows ใช้ tests deferred promises ที่วิ่งผ่าน production controller/component ไม่เขียน controllerจำลองซ้ำใน test ไม่มี React lint disable เพื่อเลี่ยง lifecycle

10. **Rendered interaction tests.** REDก่อนfixและรายงานจริง ต่อด้วย loading→ready, honestunavailable, knownempty, malformed data→safeerror, rejection/retry preservesdraft, filters/pager args capture, detailopen/close, requestrace/abort/unmount, invaliddates/time, injected secret/private extra properties absent from output/DOM count actual casesไม่ inflate loopsเป็นtestจำนวน แยก helper/SSR/controller vs DOM/browser assertions อย่าแอบ skip testเดิม

11. **Actual browser and responsive QA.** ค้นหา tooling/browserที่ติดตั้งจริงก่อนกล่าวว่าไม่มี อาจใช้ skill Playwright/CLI, installed dependency runtime หรือ connectorที่คุณเข้าถึงจริง ห้ามใช้ credentials productionหรือแก้ requireStaffเพื่อ screenshot ทำ standalone fixture previewนอก app routesที่ใช้ rendererจริงได้ บันทึก syntheticfixtureชัดเจนใน QAartifact ถ่าย1440×900,390×844,320px พร้อม assertionsoverflow, keyboardTab/Enter/Escape/focus, zoom200%, filters/detail/retry/stale states ตรวจจริง หากขาดbrowserให้บันทึก NOT_RUN และรายการmanualpending; การอ่าน CSSไม่ใช่ viewportPASS ห้ามเอา screenshotplaceholderมาแทน

12. **Gates, local commits and report.** `pnpm typecheck`, `pnpm lint` ทั้งrepo, `pnpm exec vitest run --maxWorkers=1`, `pnpm build`, `git diff --check <baseline>..HEAD`, staged `node scripts/security/check-staged.mjs` ก่อนแต่ละcommit ตรวจ exitจริง แก้ failuresในowned scope ห้ามพอพบfullsuiteREDแล้วสรุป ALLPASS Update docs coverage + proposedbackendfields/states + worktreetaskboard/decisionโดยไม่แก้ requirementต้นฉบับ Commitเป็นชิ้นที่ reviewได้ localonly แล้วส่ง exactfinal SHA/branch/worktree/clean status/reportpath

## Guardrails เมื่อรัน QA

- ใช้ port3010 หรือportว่างที่ตรวจจริง ห้ามยึด3000/3011 Rootใช้ได้ บันทึกPIDจากprocessที่คุณสร้างเองและหยุดเฉพาะPIDนั้น ห้าม kill all node/next/browsers
- ไม่มี network/model/DB writes สำหรับ fixture tests ไม่มี authbypassใน production ไม่มี screenshots/trace/private HTMLจาก real login
- ถ้าจะเสนอdependency/toolinstallให้บันทึกเหตุผล/actual version/lockchangeและรายงาน root ไม่ใช้สิ่งนี้เป็นเหตุหยุดงานส่วนอื่น; toolingที่มีใช้ก่อน
- Preserve initial clean branchและbaseline อย่ารวม root UI/backendเอง ไม่ pushแม้credentialsพร้อม

## Acceptance และรายงาน

Deliverทั้งสองหน้าจริงใน fixture/controller/renderer contract พร้อม production unavailableที่ซื่อสัตย์ ไม่ใช่ shell/controls disabledทั่วหน้า การปิดbackend endpointเป็น **ROOT_BACKEND_SYNC_REQUIRED ในรายงานเท่านั้น** ไม่ใช่ปัญหาที่ให้คนใช้ตั้งค่าเอง

รายงานตาราง12งาน: implemented files, actual tests/commands, observed evidence, remaining dependency หลักฐานใหม่ของคุณต้องแยก root9437654fixesและGemini inheritedbaseline ให้ Codexตรวจได้ว่าตั้งใจโค้ด/testจริงจุดไหน สถานะ `FIXTURE_BEHAVIOR_PASS`, `BROWSER_FIXTURE_PASS` เฉพาะเมื่อมี actualbrowser, `LIVE_INTEGRATION_PENDING` จน rootทำbackend+combinedacceptance ห้าม V1COMPLETE/modelsuperiority/cost/speed claimsโดยไม่มี comparableevidence

หลังทุกcommitทำงานถัดไปต่อเองจนจบ12ข้อ ถ้าbackendยังไม่พร้อมให้จบ fixtureproductionstatecontract/tests/accessibility/reportใน scopeทั้งหมด แล้วรวบรวม dependencyให้ root ไม่ถามผู้ใช้ทีละข้อ
