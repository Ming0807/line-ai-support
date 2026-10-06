# Prompt สำหรับ Gemini — YRU Dashboard UX/UI

7October round2 supersedes the original assignment below: [continuation prompt](GEMINI_UI_UX_CONTINUATION_PROMPT.md), [review/all-page map](../reports/GEMINI_UI_UX_REVIEW_AND_PAGE_MAP.md). User likes443c227 home/sidebar; retain that visual authority, fix truthfulness/interaction/recovery and cover13source modules. Current root catalog contracts are implemented; the old snapshot dependency statements below are historical. Gemini dependencies are now actual local files, not the earlier junction. No Gemini push or main-workspace UI writes.

คัดลอกข้อความด้านล่างให้ Gemini ซึ่งมีสิทธิ์อ่าน/แก้ไฟล์และรันคำสั่งในเครื่องนี้ ทำงานต่อเนื่องจนส่งมอบผลตรวจได้ ไม่ต้อง push

---

คุณเป็น Lead Product Designer และ Frontend Engineer ของ YRU AI Student Support / AI Helpdesk ผู้ใช้พบว่า Dashboard ปัจจุบันใช้งานยาก โดยเฉพาะการนำเข้าเอกสารซึ่งต้องกรอกข้อมูลและศัพท์เทคนิคจำนวนมาก งานนี้ให้ปรับ UX/UI เป็นผลิตภัณฑ์ที่เรียบง่าย ใช้งานจริงเร็ว สม่ำเสมอทั้งระบบ และตรวจสอบได้จากการทำงานจริง ไม่ใช่แค่เปลี่ยนสีหรือสร้างภาพ mockup

## พื้นที่ทำงานและการทำงานพร้อมทีมอื่น

- ทำงาน **เฉพาะ** `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru` บน branch `codex/gemini-dashboard-ux`
- ห้ามแก้ต้นฉบับ `D:\project-next\line-ai-yru` ซึ่ง Codex กำลังทำ backend/auth/contracts/DB/integration ต่ออยู่
- Codex เตรียม snapshot ตั้งต้นให้แล้ว ให้บันทึก `git rev-parse HEAD`, `git status --short`, branch และรายการไฟล์ตั้งต้นก่อนทำงาน แยก baseline ที่รับมาออกจากงานที่คุณสร้างในรายงาน
- ห้าม `git pull`, merge/rebase branch ของ Codex, reset/clean/force หรือ overwrite งานอื่น เพื่อไล่ตามการเปลี่ยนแปลงระหว่างทำ UI
- ใช้ dev server ของคุณที่ **port 3010** ห้ามหยุด/เปลี่ยน server3000,3001, local Supabase หรือ embedding service8000 ที่ทีมอื่นใช้ ถ้า3010ถูกใช้ ให้เลือก portว่างและบันทึก
- คุณเป็นเจ้าของ UI/CSS/navigation/client interaction ใน worktree นี้ Codex เป็นเจ้าของ server business rules, API/DTO contracts, database, authentication/privacy และการตรวจ integration ขั้นสุดท้าย
- อ่านสัญญา API ที่มีอยู่ก่อนใช้ หาก APIยังไม่พร้อม ให้แสดงสถานะ “ส่วนนี้ยังไม่พร้อม” และบันทึก dependency ให้ Codex เชื่อมต่อ ภายใน browser tests ใช้ fixtures/mocksที่ระบุชัดได้ แต่ห้ามเอาข้อมูลปลอมหรือสถานะสำเร็จปลอมเข้าหน้าจอใช้งานจริง

## อ่านก่อนออกแบบและลงมือ

อ่าน `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/agents/WORKING_PROTOCOL.md`, `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md` และต้นฉบับที่ชี้ไว้ใน `docs/requirements/sources/README.md` อย่าอ่านแค่ชื่อไฟล์/รายงานเก่าแล้วเดาขอบเขต

อ่าน `PRODUCT.md`, `DESIGN.md`, `docs/architecture/YRU_V1_DESIGN.md`, `AI_PROVIDER_DESIGN.md`, `KNOWLEDGE_IMPORT_DESIGN.md`, `EMBEDDING_SERVICE_DESIGN.md` และ subsystem/surface briefsที่เกี่ยวข้องกับหน้าที่แก้ มี design ใหม่เพิ่มเติม:

- `docs/architecture/IMPORT_ASSISTANCE_DESIGN.md`
- `docs/superpowers/plans/2026-10-06-yru-assisted-import.md`
- `docs/architecture/KNOWLEDGE_CATALOG_DESIGN.md`
- `docs/superpowers/plans/2026-10-06-yru-knowledge-catalog.md`

อ่าน relevant installed Next.js guides ใน `node_modules/next/dist/docs/` ก่อนเปลี่ยน Next.js code เวอร์ชันที่ติดตั้งเป็นแหล่ง APIจริง ใช้ skillด้าน product/UI/UX เช่น impeccable/frontend ถ้ามีให้ใช้งาน ไม่มี skillก็ทำตามหลัก product design โดยไม่อ้างว่าได้เรียกใช้

## ขอบเขตส่งมอบและลำดับความสำคัญ

1. **นำเข้าเอกสารก่อน:** upload หรือ URL → ระบบอ่าน/เสนอข้อมูล → ตรวจสรุป → แก้เฉพาะข้อมูลที่ไม่ชัด → ยืนยันอนุมัติอย่างตั้งใจ ลดการกรอกซ้ำและปุ่มเตรียมข้อมูลที่ผู้ใช้ไม่จำเป็นต้องกดเอง
2. **App shell/navigation:** เมนูตามสิทธิ์ ชื่อหน้า/สถานะ/การกลับหน้าก่อน การจัดลำดับข้อมูลและ actionsที่สม่ำเสมอ รองรับ desktop/mobile/keyboard ไม่มีเมนูที่ดูใช้งานได้แต่กดแล้วไม่เกิดอะไร
3. **Dashboard:** แสดงงานที่ผู้ใช้ทำต่อได้และข้อมูลจริงที่ backend มี ลดแผงตัวเลข/การ์ดที่ไม่ได้ช่วยทำงาน ไม่ประดิษฐ์ analyticsหรือ progresspercentage
4. **Tickets:** รายการ/filter/detail/thread/takeover/สถานะ/ส่งข้อความ ช่วยให้เจ้าหน้าที่เห็นบริบทและงานถัดไปชัด คง transition, department/sensitivity scopes, revision checks และ human ownership
5. **Knowledge:** คลังตามกลุ่ม/ฉบับปัจจุบัน/ประวัติ/status/storage/date/source รวม intakeที่รอตรวจ แยก stored-current ออกจาก effective/answer-eligible และเก็บประวัติครบ
6. **Providers/models:** ใช้ข้อมูล/การทำงานจริง ปรับลำดับขึ้นลงทั้ง providerและmodel ต่อ modelมี HTTP/quota observation/time/error/test ไม่ย่อ requirementเป็น numericpriorityหรือ provider-onlytest เริ่ม FREE_ONLY โดยหลัก OpenCode Zen/OpenRouter บริการเสียเงินเป็นการเลือกเพิ่มโดยมหาวิทยาลัยผ่าน UIภายหลัง
7. **Login/empty/loading/error/settingsที่มีอยู่:** เข้าใจได้ มี recovery/retry ชัด และใช้รูปแบบเดียวกัน หน้า/featureที่ backendยังไม่มีห้ามรับรองว่าสำเร็จ

ทำทุกส่วนตาม dependencies อย่าหยุดรอผู้ใช้เลือกสี/spacing/ไอคอน/รายละเอียดเล็กน้อย ตัดสินใจตาม product minimal และสเปคเอง หาก subsystemหนึ่งยังขาด API ให้บันทึกและเดินส่วนอิสระต่อ อย่าถามอนุมัติทุกหน้า อย่าสรุปจบหลังทำเฉพาะ mockupหรือหน้าแรก

## หลัก UX ที่ต้องใช้จริง

- UIภาษาไทยเป็นหลัก ใช้คำที่เจ้าหน้าที่เข้าใจ แต่คงชื่อ model/provider/statusที่ต้องแม่นตรง
- หนึ่ง primary actionต่อช่วงงาน ชัดว่าตอนนี้อยู่ขั้นไหนและต้องทำอะไรต่อ อธิบาย errorใกล้จุดทำงาน
- ลดภาระด้วย prepared summary, named choices, sensible editable defaults และ progressive disclosure ข้อมูลสำคัญ/คำเตือน/blockerต้องยังเห็นและแก้ได้
- Import: ร่างใหม่ใช้ข้อเสนอจาก assistance APIที่ผูก job/extractionตรงกัน ร่างที่คนบันทึกแล้วต้องไม่ถูกทับ เมื่อข้อเสนอผิด/ไม่ชัด คนแก้ได้ คำยืนยันทั้งห้า/warning resolution/action-target/chunk consentยังต้องผ่านจริง
- วันที่/ปี/เจ้าของ/authority/applicabilityไม่ชัดต้องแสดงความไม่แน่นอน ห้ามใช้วันอัปโหลดแทนวันที่ประกาศหรือวันที่มีผล ห้ามตั้ง PUBLICหรือ ALLโดยเดา ห้ามสร้าง confidenceเปอร์เซ็นต์จาก keywordrule
- ใช้ชื่อหน่วยงาน/กลุ่มเอกสารจาก referenceจริงแทนบังคับพิมพ์ code รักษาค่า legacy/custom/newfamilyที่ backendรองรับ ใช้ authorityตัวเลือกมีชื่อ100/90/80/70/50และคง customค่าที่บันทึกไว้
- ไม่จำเป็นต้องให้คนอ่าน chunk/tokenศัพท์เทคนิคเต็มหน้าตลอดเวลา แต่ต้องยังเข้าถึงตำแหน่งต้นฉบับ/แผนแบ่งข้อความและยืนยันแผนที่ผูก revisionจริงได้
- ครบ loading/empty/error/retry/disabled/pending/success/unsaved/conflict/expired-session และป้องกัน double-submit, wrong-selection responses, stale async results
- รองรับ viewport390และ1440, zoom200%, focus-visible, accessible labels/live feedback, touchและkeyboard ไม่มี horizontal overflowระดับทั้งหน้า สีไม่เป็นตัวสื่อสถานะเพียงอย่างเดียว
- ใช้ design tokens/spacing/typography/component patternsร่วมกัน ภาพรวมสงบ กระชับ ไม่ใช้ nestedcardsทุกบริเวณ gradient/glass/animationตกแต่งหรือศัพท์ขายฝัน

## Files/contracts ที่คุณแก้ได้

- `app/(dashboard)/**` ในส่วน presentation/client interaction โดยคง server-side authorizationและbackenddata callsเดิม
- `app/login/**` และ shared frontend components/CSS ใน `app`/`components` ตามที่ repoมีจริง
- `DESIGN.md`, เอกสาร UIเฉพาะงานนี้ และ frontend tests/QA scriptsที่เกี่ยวข้อง
- Pure frontend helpersใหม่ได้เมื่อไม่เปลี่ยน server/API contract

อ่านได้แต่ **ห้ามแก้** `app/api/**`, backend modulesใน `lib/**`, auth middleware/proxy, `supabase/**`, `services/**`, backendworkers, `.env` หรือ provider pricing/networkpolicy คุณห้ามแก้ DTO/schemaที่แชร์กับbackendเพื่อให้UIผ่าน ถ้าต้องการAPIเพิ่มเติมให้เสนอ request/responseที่เฉพาะเจาะจงในรายงาน ไม่ทำ endpointปลอม

`lib/imports/assistance-contract.ts` มี browser-safe exports: `parseAssistanceEnvelope(body,{jobId,jobRevision,extractionRevision})`, `applyImportAssistance(draft,assistance)`, `requiredReviewFields(metadata)` ใช้จริงตาม implementation อย่าคัดลอก server-onlymodulesเข้าclientbundle

## Invariants ที่ห้ามเสีย

- รักษา Student/Staff LINE raw-body HMACก่อนJSON, no-tokenlogs และเส้นทางทำงานที่ผ่านแล้ว
- Anonymous V1ไม่มี students/profile/grade/enrollmentdatabase; staff accessตามdepartment/sensitivity
- คง server permission/state transitions/receipt/CAS/leases/ownership/publication/deliverylocks AIไม่มีarbitrarySQLหรือauto-publish และไม่ตอบHUMANticket
- เอกสารใหม่คือข้อมูล/versions ไม่ใช่migration/tableรายปี ไม่ลบ originals/oldversions หรืออ้างว่าเก็บแล้วเมื่อbackendfail
- ไม่ปรับ FREE_ONLYให้ paid/unknownผ่าน ไม่เอา embeddinglocalE5/384ไปปน normal Provider UI ไม่ดาวน์โหลด model/ลบcache
- RAG/STRUCTURED/BOTHแสดง availabilityตามจริง M8ยังไม่ครบ ห้ามซ่อน backend errorหรือแอบdowngradeจนดูผ่าน
- Public/student answersยังต้องผ่าน source/quality/sensitivity/applicability gates UIที่ง่ายขึ้นต้องทำให้การตรวจชัดขึ้น

## วิธีทำงานต่อเนื่อง

1. เก็บ baselineและตรวจหน้าจอจริง ระบุ pain pointsและ requirement IDs ไม่เสียเวลา auditยาวโดยไม่ลงมือ
2. เขียน `docs/ui/GEMINI_DASHBOARD_PLAN.md`: tasks/files/dependencies/acceptance/contractgaps ให้เหมาะกับขนาดงาน พร้อมdesigndirectionที่ชัดและใช้สม่ำเสมอ
3. Implementเป็น vertical slicesที่ใช้งานได้จริง ตามลำดับข้างบน คุณได้รับอนุญาตให้เดินงาน UIตามขอบเขตนี้ต่อเนื่อง ไม่ต้องรออนุมัติ implementationchoicesย่อย
4. ใช้สิ่งที่มีในpackage/dependencyก่อน ถ้าจำเป็นต้องเพิ่ม runtime dependency ให้บันทึกเหตุผล/licensing/APIหลักฐานและเสนอแยก ห้ามแก้ shared dependencyinstallationที่ทีมอื่นกำลังใช้
5. ทดสอบ/checkตามการเปลี่ยนแปลง: meaningfulbehavior regressions, `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run --maxWorkers=1` และ `pnpm build` ห้ามรันmigration/reset/globalDBmaintenanceหรือ paid/liveAIเพื่อเอาpass
6. ทำ actual browser walkthroughของทุกหน้าที่เปลี่ยน รวม desktop/mobile/keyboard ไม่พอแค่buildผ่าน Capture screenshotsใน ignored `test-results/` หรือ `.superpowers/staging/gemini-ui/`;รายงานpathและviewport ทดสอบข้อผิดพลาด/conflict/pending/authด้วย ระบุสิ่งmockและสิ่งที่ใช้backendจริงอย่างตรงไปตรงมา
7. ตรวจภาพเป็น batchแก้ปัญหาที่พบ แล้วconfirmอีกครั้ง ไม่วนpolishไม่สิ้นสุดหรือลดtests/requirementsเพื่อให้ผ่าน
8. ทำ local commitsเป็นกลุ่มที่ตรวจเข้าใจง่าย stageเฉพาะไฟล์งานคุณ ตรวจ `git diff --check` และ `node scripts/security/check-staged.mjs` ก่อนcommit ห้าม stage.env/privateoriginals/accounts/tokens/buildoutput
9. **ห้าม push**, ห้ามสร้างPR/merge/deploy, ห้ามเรียก `git push` หรือเปลี่ยน remote/authเพื่อทำแทน ไม่ว่า checksจะผ่านหรือไม่ ส่งรายงาน+commit SHAให้ผู้ใช้และ Codexตรวจเท่านั้น

## การทดสอบและ credentials บนเครื่อง

Worktreeมี dependency junctionที่ Codexเตรียมให้แล้ว และ local `.env`/บัญชีทดสอบที่ ignoredพร้อมใช้เฉพาะการทำงานในเครื่อง บัญชีอยู่ `.superpowers/staging/dev-staff-credentials.json` ห้ามแสดง password/key/tokenในconsole/report/chat/screenshot อ่านด้วยโปรแกรมเฉพาะที่จำเป็น ห้ามเปลี่ยนบัญชีจริงเพื่อสะดวกทดสอบ

Startด้วย `pnpm dev --port 3010` ตาม CLIจริง ระบบbackendexistingใช้ DEVELOPMENT Supabaseร่วมกัน ดังนั้น browserงานนี้ควร read-onlyหรือเฉพาะsyntheticprivatefixturesของงานคุณ ห้ามอนุมัติเอกสารมหาวิทยาลัยจริง/เปลี่ยนproviders/ticketsของผู้ใช้เพื่อถ่ายภาพ หาก writeflowต้องtest ให้ใช้explicitmockในQAหรือบันทึกว่าต้องให้CodexทดสอบisolatedDBภายหลัง ไม่สร้างmockในproductionruntime

ถ้าtool/บัญชี/APIขาด ให้บันทึกขอบเขตข้อจำกัดจริงและเดินงานที่ไม่ขึ้นกับมันก่อน ไม่ใส่credentialplaceholderหรือfake-successเพื่อให้applicationดูพร้อม

## รายงานส่งมอบที่ต้องสร้าง

สร้าง `docs/reports/GEMINI_UI_UX_REPORT.md` โดยระบุ:

- baseline SHA, branch/worktree, final SHA และ commit SHAsเรียงลำดับ พร้อมสิ่งที่แต่ละcommitเปลี่ยน
- หน้าที่ทำและ UXก่อน/หลัง โดยเฉพาะจำนวนข้อมูลที่ต้องกรอกเอง/ขั้นตอนที่ลดจริง ไม่ใช้ตัวเลขประมาณที่ไม่ได้วัด
- fileschanged และ requirement coverage/gaps ไม่รับรองfullV1หรือliveflowเพราะUIผ่าน
- commandsที่รัน, exit/results และ sourcecheckpoint ถ้าไม่รัน/ไม่ผ่านให้ระบุจริง ห้ามอ้างreviewจากagentที่ไม่ได้review
- browserflows/viewport/keyboard/auth/errors/ภาพหน้าจอที่ตรวจจริง รวมmock vs realbackend
- API/contractchangesที่ต้องการจากCodex พร้อม exact request/responseและเหตุผล ทั้งหมดเป็นข้อเสนอไม่ใช่backendที่คุณเปลี่ยนแล้ว
- ปัญหาคงเหลือและสิ่งที่ผู้ใช้ต้องทำเองเฉพาะที่จำเป็น
- ยืนยันว่า **ไม่มี push/PR/merge/deploy**, secrets/privateoriginalsไม่อยู่commits และไม่มี changesนอกUIscope
- คำสั่งที่Codexใช้ตรวจจากmainworkspaceได้ เช่น `git log <baseline>..codex/gemini-dashboard-ux` และ `git diff <baseline>..codex/gemini-dashboard-ux -- <files>`

เสร็จแล้วตอบผู้ใช้เป็นภาษาไทยสั้นๆ พร้อม reportpath, branch, finalcommitSHAและข้อที่ต้องให้Codexตรวจ อย่าเรียกทำเสร็จหากยังมีfailingchecksหรือUIหลักยังไม่ครบ ทำจนงานที่อยู่ในขอบเขตนี้ตรวจรับได้จริง โดยคงbackendcontractsและข้อจำกัดข้างต้น
