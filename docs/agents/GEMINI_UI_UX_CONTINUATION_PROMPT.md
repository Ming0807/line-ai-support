# Prompt สำหรับ Gemini — รอบ2: UX/UI ครบสเปคและใช้งานจริง

Historical Round2 instruction. After6271490, continue with [Round3 prompt](GEMINI_UI_UX_ROUND3_PROMPT.md) and [actual Round2 review](../reports/GEMINI_UI_UX_ROUND2_REVIEW.md). Root private review3/structured preview now exists; earlier absent-API statements below refer to the historical snapshot, not current authority.

7 October 2026. ผู้ใช้ชอบหน้าหลักและ sidebar จาก `443c227` และขอให้หน้าอื่นอ้างอิงดีไซน์นี้ พร้อมเติมส่วนที่ขาดตามสเปค ทำต่อเนื่องและส่ง local commits ให้ Codex ตรวจ ห้าม push. อ่าน [ผลตรวจและรายการหน้า](../reports/GEMINI_UI_UX_REVIEW_AND_PAGE_MAP.md) คู่กับ prompt นี้ ห้ามถือรายงานรอบแรกเป็นหลักฐานว่าระบบครบแล้ว

---

คุณเป็น Lead Product Designer และ Frontend Engineer ของ YRU AI Helpdesk ทำรอบ2ต่อจาก commit `443c22770975a39f5b7b43a57995f4fce081e287` ให้ได้ผลิตภัณฑ์ที่เจ้าหน้าที่ใช้งานจริงง่าย สม่ำเสมอ และตรงสเปค ผู้ใช้ **ชอบหน้าหลักกับ sidebar ที่คุณทำแล้ว** ให้รักษาบุคลิกและองค์ประกอบหลักไว้ ขยายภาษาดีไซน์เดียวกันไปทุกหน้า แก้ข้อมูล/interactionที่ยังผิดหรือกดไม่ได้ ห้ามกลับไปใช้ธีมเขียวเดิมหรือเริ่มออกแบบหน้าหลักใหม่โดยพลการ

## พื้นที่ทำงานและอำนาจ

- ทำงานเฉพาะ `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru`, branch `codex/gemini-dashboard-ux`. บันทึก HEAD/full SHA/status ก่อนเริ่ม ต้องเป็นงานต่อจาก443c227; ถ้าเกิดงานใหม่ค้างให้เก็บไว้และรายงาน ไม่ reset/clean
- อ่าน `D:\project-next\line-ai-yru` ได้ เพื่อใช้ **สเปค/แผน/API contractsล่าสุด** แต่ห้ามเขียนหรือหยุด serverของCodexใน workspaceนั้น ห้าม merge/rebase/cherry-pick/copyทับ backendจากCodexเพื่อให้testผ่าน
- ใช้ server3010 หรือportว่างที่บันทึกไว้ ไม่กระทบ3000/3001/3011/Supabase/embedding8000. ห้าม buildทับ `.next` ขณะ dev serverเดียวกันใช้อยู่ ให้หยุดเฉพาะserverที่คุณเป็นเจ้าของก่อนbuildและเปิดคืน หรือใช้outdirตามinstalledNextdocs
- คุณเป็นเจ้าของ frontend/UX/client interaction/frontend helpers/tests/เอกสารงานรอบ2. Codexเป็นเจ้าของ API/auth/privacy/DB/worker/integrationและตัดสินการรวมโค้ด
- **ห้าม push ทุกกรณี** รวมforce/PR/merge/deployหรือเปลี่ยนremote/authเพื่อpushแทน Local commitsเท่านั้น ส่งSHA+รายงานเมื่อครบscope
- อย่าหยุดถามอนุมัติสี/layout/ปุ่มย่อยหรือรอผู้ใช้ตั้งค่าทุกขั้น เดินงานที่ไม่ติดbackendต่อ หาก dependencyขาด ให้ทำUIอย่างตรงไปตรงมาและบันทึกexactcontractrequestสำหรับCodex ห้ามปลอมsuccess/data/APIในproduction

## อ่านก่อนเริ่ม

อ่านจาก workspaceหลักที่เป็นปัจจุบัน: `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/agents/WORKING_PROTOCOL.md`, `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, `docs/requirements/V1_REQUIREMENTS_MATRIX.md`, `docs/requirements/sources/README.md` และต้นฉบับoverviewโดยเฉพาะ§30–35/roles/privacy. อ่านmaster§3/12/14–16/46–52/60–62/68–70 และsubsystem designที่หน้าของคุณใช้จริง

อ่าน `PRODUCT.md`, `DESIGN.md`, system/provider/import/embedding design, `KNOWLEDGE_CATALOG_DESIGN.md`, `IMPORT_ASSISTANCE_DESIGN.md`, `docs/operations/BACKEND_UI_CONTRACTS.md`, sourcecodebrowser-safe DTO/helpersจริง และpromptรอบแรก โดยใช้คำยืนยันล่าสุดกับpromptรอบ2นี้เมื่อแนวทางเก่าขัดกัน

อ่าน installed Next16.3.8 guides ใน `node_modules/next/dist/docs/` ตามเรื่องที่แก้ อย่าเดาAPIจากเวอร์ชันเก่า ใช้impeccable/frontendเมื่อมี; บันทึกตามจริงว่าอ่านskillอะไร ห้ามอ้างskill/agent/browser/testที่ไม่ได้ใช้

## ภาษาดีไซน์ที่ผู้ใช้เลือกแล้ว

รักษา dark icon rail `#141622`, warm canvas `#f4f3ef`, white soft rounded cards, coral/pink hero, readable neutral text และลำดับข้อมูลจากหน้าหลัก. ใช้accentอย่างมีจุดหมายในหน้าทำงาน; table/formอาจใช้การ์ดและช่องกรอกที่กระชับกว่าheroโดยยังเป็นครอบครัวเดียวกัน. ไม่ใส่กราฟตกแต่งที่อ่านเหมือนข้อมูลจริง

อัปเดต `DESIGN.md` ของworktreeให้ตรงกับvisualauthorityล่าสุดและsourcecodeจริง กำหนดsharedtokens/components/pageheader/filters/table/detail/drawer/dialog/alerts/loading/empty/error/actions เพื่อลดCSSซ้ำ. Producttruth/copy/scopeเดิมยังอยู่; assetsมหาวิทยาลัยห้ามสร้างการรับรองขึ้นเอง. ไทยเป็นหลัก อังกฤษเฉพาะชื่อmodel/code/ศัพท์ที่จำเป็น

## หน้าที่มีจริงและโมดูลที่ต้องครอบคลุม

มี9page routesที่checkpoint443c227: `/` (redirect), `/login`, `/dashboard`, `/dashboard/queue`, `/tickets`, `/tickets/[id]`, `/knowledge`, `/knowledge/import`, `/providers`. จำนวนroutesไม่เท่ากับจำนวนmodulesหรือการใช้งานครบ

ต้นฉบับoverview§31กำหนด13modules: **Overview, Tickets, Incidents, Departments, Knowledge Base, Activities, AI Providers, AI Models, Fallback Rules, Usage, Analytics, Logs, Settings**. รวมProviders/Models/Fallbackเป็นแท็บหรือsectionในหน้าAIได้ แต่ห้ามตัดcapabilityออก. Analyticsอาจอยู่ในOverviewหรือแยกหน้า. ActivitiesกับLogsอาจใช้navigationgroupเดียวกัน แต่กิจกรรมงานและข้อผิดพลาดระบบต้องอ่านแยกได้. ไม่มีStudent ManagementในV1

| Surface | งานและacceptanceรอบ2 |
|---|---|
| Login / auth states | ดีไซน์เดียวกับshell, form/error/pendingที่อ่านง่าย, expiredsession/forbidden/signoutชัด; ใช้authเดิม ห้ามสร้างบัญชีหรือเปิดสิทธิ์เพื่อถ่ายรูป |
| Overview + shell | คงดีไซน์ที่ผู้ใช้ชอบ แก้metricsตามข้อมูลจริง/ขอบเขต/ช่วงเวลา, actionablelinks/search, honestempty/error, menupermissions, drawerkeyboardfocusและnavigationที่รองรับmodulesมากขึ้น |
| Tickets list | Department/status/priority/assignee/date/sensitivityfiltersครบ, URLstate/reset/results/empty/pending/error, สแกนNew/WaitingStaff/Handling/WaitingUser/Resolvedได้, rowเปิดรายละเอียดได้; ห้ามดึงข้อมูลเกินdepartmentscope |
| Ticket detail | ID/anonymous user/department/priority/status/summary/history/AI summary/similar issues/suggested knowledgeตามbackendที่มีจริง; HUMANชัด, reply/accept/reassign/resolve/close/reopenเท่าที่serverอนุญาต, pending/conflict/ownership/retryไม่ส่งซ้ำ |
| Knowledge catalog + document detail/history | approvedfamily/current/version/department/status/mode/effectivedates/source/lastimport/historyครบ, actualsearch/filter/page/detail/relationships, no stale selection; `/knowledge/[id]` เป็นpathตัวอย่างmaster จัดdrawer/detailpageได้โดยไม่ตัดข้อมูล |
| Import + review + preview | upload/URL→autoanalyze→boundassistance→summary→แก้เฉพาะจุดไม่ชัด→save/versionchoice/chunks/warnings→deliberateapproval/receipt/recovery. ใช้saved draftก่อนข้อเสนอ, ไม่ทำให้approveเอง และไม่บังคับกรอกUUID/ศัพท์เทคนิคสำหรับรายการที่มีpicker |
| AI Providers / Models / Fallback | add/edit/enabled/orderของProviderและModel, up/downใช้งานจริง, per-modeltest/HTTP/latency/observedquota/time, healthแยกenabled. FREE_ONLYdefault; unknown/paidไม่ผ่านฟรี, universityเปิดpaidภายหลังเอง. แสดงลำดับfallbackจริงและเหตุผลskip/error; localE5/384เป็นinfraไม่ปนnormalgenerationmodelorder |
| Incidents | รายการเหตุการณ์กลุ่มปัญหา/ผลกระทบ/severity/status/linkedtickets/detail, actionsเฉพาะAPIที่มี. ถ้ายังไม่มีbackendให้ออกแบบsurfaceครบและแสดงintegrationpendingอย่างชัดเจน ไม่ทำCRUDปลอม |
| Departments | หน่วยงาน/รายการขอบเขต/ช่องทางหรือroutingconfigตามสัญญาจริง, ไม่ทำUI-onlyauthorizationหรือแก้DBเอง; การจัดการrole/accountที่ไม่มีAPIให้บันทึกdependencyและpolicyที่ต้องการ |
| Activities | ประวัติกิจกรรมงานสำคัญ เช่นรับเรื่อง/ย้าย/ตอบ/approve พร้อมtype/date/actorที่policyยอมให้เห็น; read-only/scope/filter/detailตามcontract, ไม่เผยtechnicalLINEidentities |
| Usage | provider/modelusage/token/quota/error observationsตามข้อมูลจริง; ไม่เดาตัวเลขremaining/ค่าใช้จ่าย. ฟรี/ไม่ทราบ/ไม่มีข้อมูลแยกกัน, missingbackendมีhoneststate |
| Analytics | แหล่งที่มา/ช่วงเวลา/หน่วยงาน/นิยามmetricตรงกัน, realtime-seriesถ้ามีendpoint; ไม่มีendpointให้แจ้งข้อมูลยังไม่พร้อมและเสนอcontract ห้ามrandomstats/projectionให้ดูสวย |
| Logs | operationalerror/request/jobstatesเฉพาะข้อมูลsanitizedที่authorizedendpointคืน, search/filter/pagination/read-only; no.env/access/replytoken/rawpayload/privateoriginal/serverstackleak |
| Settings + operational status | actualsystemconfiguration/healthที่backendรองรับ, generationpolicyกับlocalembeddingแยก, worker/LINEconfiguredstateเฉพาะsanitizedmetadata. `/dashboard/queue`ปัจจุบันredirectไป`/tickets` ไม่ใช่หน้าdiagnostic; หากออกแบบoperatorstatusใหม่ต้องระบุcontract/สิทธิ์และไม่ยัดข้อมูลlease/revisionsในdailyhome. configที่ไม่มีAPIห้ามsetstateแล้วแสดงว่าสำเร็จ |

pathsของmodulesที่ยังไม่มีเป็น**แผนnavigationทางวิศวกรรม**ไม่ใช่claimว่ามีbackendหรือสเปคบังคับURLทุกอัน. ต้องมีroute/surfaceที่มีauth/servergateเดิมได้หรือบันทึกblockedauthorizationก่อนเปิดหน้า; hiddenmenuไม่ใช่serverpermission. อย่าประกาศFULLY_FUNCTIONALสำหรับหน้าที่ยังไม่มีdata/actionbackend

## แก้ข้อพบจาก443c227ก่อนขยายงาน

1. `/dashboard`: fixed donutsegments/weeklybarheightsไม่สัมพันธ์ข้อมูล, legendzero-caseเป็น100%, providercountถูกเรียกว่าmodelcount, staffเห็น0/1โดยไม่มีdata, readfailถูกแสดงเป็นzero/offline, imports50recordsทุกstatusถูกนับเป็นรอตรวจ. `listTickets`จำกัด100records จึงไม่ใช่totalทั้งระบบหรือpopulationสำหรับสถิติทุกช่วงเวลา. เก็บcomposition/cardcolorsไว้ แต่ใช้ตัวเลข/กราฟที่มีนิยามและหลักฐานตรงกัน หากไม่มีdataให้stateชัดหรือแทนด้วยactionablequeue อย่าใส่percentขั้นต่ำปลอม
2. ช่องค้นหาreadOnly/chevron/notificationlook/ปุ่มtabที่กดไม่ทำอะไรต้องมีbehaviorจริง หรือไม่สร้างaffordanceที่ดูinteractive. Searchใช้scopeจริงจากAPIเดิม; globalcrossmoduleAPIที่ไม่มีให้เสนอCodex ไม่ต่อข้อมูลprivateเอง
3. Mobile drawer: focusเข้าเมื่อเปิด, คุมTab/Shift+Tab, Escape/backdrop/close, focusกลับtrigger, ป้องกันพื้นหลังรับfocus/scrollเมื่อmodalเปิด และปิดเมื่อrouteเปลี่ยน. Desktopiconrailมีtooltip/labelkeyboardอ่านได้; ไม่เพิ่ม13iconsที่ผู้ใช้จำชื่อไม่ได้ ใช้group/secondarynavที่discoverable
4. Import: ตรวจboundassistance/saved-draft/non-overwrite/race/revisions, progressive disclosureยังเปิดแก้รายละเอียดได้, action/target/sourceauthority/visibility/warnings/chunkacknowledgmentไม่ซ่อน. ห้ามautoapproveหรือลด5attestations. อย่าทำสำเร็จเมื่อApprove responseไม่แน่ชัด; ใช้receipt recoveryเดิม
5. รายงานรอบแรกมีwrongAPI/routebuildlistและไม่มีภาพที่pathอ้างอยู่ให้ตรวจ. รอบ2ต้องแก้หลักฐาน: actualStudent/Staffroutesคือ `/api/line/student/webhook` และ `/api/line/staff/webhook`; assistanceคือ **GET `/api/knowledge/imports/[id]/assistance`**. `POST /api/knowledge/imports/assistance`และ`/api/webhooks/line`ไม่ใช่contractของrepoนี้
6. `git diff --check da55470..443c227` พบtrailingwhitespaceในdashboard/nav/plan; แก้ในรอบ2. PaletteentryDEC-036ของworktreeชนrootDEC-036เรื่องcatalog ให้บันทึกcorrection/deferredintegrationในเอกสารUIเฉพาะงาน ห้ามoverwriteหรือเปลี่ยนรหัสrootlogsเอง และอย่าอ้างCodexเป็นreviewerจนมีverdictจริง

## Backend contractsล่าสุดและขอบเขตที่ยังไม่พร้อม

Codexbackend `c1160b9` มีcatalog/assistanceจากaccepted6October และpureMapping1ที่ไม่ติดruntime. Geminiworktreeฐานเก่ายังไม่มีcatalog/family/detailroutesบางตัว **ความไม่มีในworktreeเก่าไม่แปลว่าCodexยังไม่ทำ**. อ่านrootcontracts/sourceที่มีจริง ห้ามใช้wrongendpointจากรายงานเก่า

- GET `/api/knowledge/catalog` → `{catalog}`, selectors `q,departmentCode,status,page,pageSize`
- GET `/api/knowledge/families/[id]` → `{history}`, selectors `page,pageSize`
- GET `/api/knowledge/documents/[id]` → `{document}`, selectors `relationsPage,relationsPageSize`
- GET `/api/knowledge/imports/[id]/assistance` → `{assistance}`; bind `{jobId,jobRevision,extractionRevision}`กับpreviewปัจจุบัน
- Browser contractsจริง: `lib/knowledge/catalog-types.ts` และ `lib/imports/assistance-contract.ts` ตาม `docs/operations/BACKEND_UI_CONTRACTS.md`. ใช้purevalidators/helpersเมื่ออยู่ในsnapshotจริง ไม่importservermoduleเข้าclient ไม่สร้างduplicateDTOที่ดูผ่านผิดschema
- ถ้าcontractsบางตัวไม่มีในUI snapshot ให้บันทึก `ROOT_BACKEND_SYNC_REQUIRED` พร้อมรายชื่อmodule/APIและcommitที่อ้าง ให้ออกแบบ/ทดสอบcomponentด้วย**QA-only fixtures**ที่ระบุชัดก่อน; finalintegration/syncเป็นCodex ห้ามแก้sharedbackendให้เข้ากับUI
- AuthenticatedfreshAPIresponsesเท่านั้นเป็นliveevidence. 401/403/404/409/503/timeout/malformedresponseต้องมีrecoverystateที่ตรงกัน; don'tfake-success และอย่าretrywriteที่ไม่ทราบoutcomeเอง
- catalog current/status/mode/effective/visibilityเป็นคนละข้อเท็จจริง; INTERNAL/future/currentไม่ได้แปลว่าพร้อมตอบนักศึกษา. legacyunknownmodeไม่ใช้familydefaultทับ. familyhistoryมีpagination/parallelstreams
- M8ยังไม่ครบ: all7 registry installed:false. PureMapping1ไม่ใช่structuredpreviewAPI, saved-v3หรือpublication. UIอาจทำsurfaceที่แสดงunavailable/blockers แต่ไม่เปิดSTRUCTURED/BOTH/dropdownแล้วfallbackRAGเงียบ. Exactrows/columnmapping/actionsรอexplicitbackendcontract
- Incidents/Departments/Activities/Usage/Analytics/Logs/Settingsบางoperationsไม่มีAPI. เขียนcontractgap tableพร้อมactor/auth, GET/writeproposal, query/request/response, pagination/status/error/revision semantics และwhy ห้ามสร้างendpoint/SQL/mockruntimeแทน

## ลำดับงานต่อเนื่อง

สร้าง `docs/ui/GEMINI_UI_ROUND2_PLAN.md` และ `docs/ui/GEMINI_UI_ROUND2_COVERAGE.md` ก่อนimplementation: taskID/requirementIDs/exactsource/currentgap/owner/files/dependencies/acceptance. ไม่ทับroottaskboard/decisionlog/matrixที่Codexกำลังแก้; บันทึกproposedstatusกับsourcefactsในเอกสารUIของคุณและให้Codexรวมภายหลัง

1. **UX-R2-01**: fixestruthfulness/accessibilityจากreview, sharedtokens/components, DESIGN.mdตรงcurrenthumanvisualauthority
2. **UX-R2-02**: Tickets list/detail+login+permission/errorstatesใช้ดีไซน์หน้าหลักครบ พร้อมrealexistingactions/recoverableconflict
3. **UX-R2-03**: approvedcatalog/search/history/detailและนำเข้าระบบฉลาดครบ ไม่ใช่แค่เปลี่ยนlabel. ไม่บังคับกรอกทุกfieldก่อนupload; autoanalyzeเฉพาะnewjobตามcontract, bindresponses, reviewทีละblockingdecision, advancedoptionsไม่ยัดหน้าแรก
4. **UX-R2-04**: Provider/Model/order/status/tests/fallback/usageviewกับlocalinfrahealthตามscope; preserveFREE_ONLYและexistingservervalidation
5. **UX-R2-05**: ที่เหลือIncidents/Departments/Activities/Usage/Analytics/Logs/Settings surface+navigation+states+proposedcontractsตามหลักฐาน. backendที่พร้อมใช้จริง; ที่ยังขาดเก็บexplicitdependencyโดยไม่หยุดงานที่เหลือ ไม่เรียกpendingpageว่าcomplete
6. **UX-R2-06**: cross-pageconsistency/readability/responsive/keyboard/permission/realerrors, evidencecleanup, localcommits/report

แบ่งงานตามmodulesได้ถ้ามีagentsและเจ้าของไฟล์ไม่ชนกัน; ไม่อ้างว่ามีทีมถ้าไม่มี. เดินทุกfrontendtaskที่ทำได้ภายใต้backendconstraintsจนจบscope รายงานremainingcontractdependenciesท้ายงานครั้งเดียว อย่าถามuserให้ทำหน้าที่agent

## ไฟล์แก้ได้ / ไฟล์ห้ามแก้

แก้ได้: `app/(dashboard)/**`, `app/login/**`, sharedUI/CSS/components/frontendhelpers, `DESIGN.md`, `docs/ui/GEMINI_UI_ROUND2*`, frontendtest/QA scripts และ `docs/reports/GEMINI_UI_UX_ROUND2_REPORT.md`. Server pageอาจเรียกexistingauthorizedreadsตามเดิมแต่ห้ามเพิ่มbusinesslogic/privilegeddirectqueries

ห้ามแก้: `app/api/**`, backend `lib/**`, authproxy/middleware, `supabase/**`, `services/**`, workers, `.env`, backendDTO/pricing/networkpolicy/sharedlocks. ไม่เปลี่ยนpackage/depsเพื่อซ่อนtypeerror; runtimedependencyใหม่ต้องเสนอเหตุผลแยก ไม่ปรับDB/grants/configจริงเพื่อถ่ายภาพ. ไม่ stage.env/credentials/privateoriginals/screenshots/buildoutput

รักษาAnonymousV1/noStudentDatabase, technicalLINEprivacy, department/sensitivitypermissions, raw-bodyHMACbeforeJSON, noAIreplyHUMAN, oneuser/multipleconversations, state transitions, immutableoriginals/oldversions, queue/revision/lease/ownership/publication/deliverylocks และreviewbeforepublish. UIที่ง่ายขึ้นต้องทำให้การตัดสินใจสำคัญเห็นชัด

## QA ที่ต้องทำและรายงานตามจริง

- meaningfulfrontendbehaviorchecksครอบคลุมrace/jobselection/draftpreservation/fallback/409/unknownapprovalresponse/ordercontrols/focustrap ตามส่วนที่แก้ ใช้toolsที่มีเดิม ห้ามลดtestsหรือสร้างtestsเช็คCSSเฉยๆแทนbehavior
- `pnpm run typecheck`, `pnpm run lint`, **`pnpm exec vitest run --maxWorkers=1`เต็มsuite** และ `pnpm run build`; อ่านexit/results/logsจริง แยกfullsuiteจาก4files21testsรอบแรก. Buildไม่ได้พิสูจน์hydrationหรือactualuserflows
- actualbrowser desktop1440x900/mobile390x844 รวมทุกsurfaceที่เปลี่ยน, keyboardnavigation/dialog/focus/longThai/longmodelID/tableoverflow, rolesตามexistingpolicy, empty/loading/backenderror/expiredsession/stale409/dirtydraft. ใช้QA-onlyfixturesสำหรับwriteflowsในsyntheticisolatedcontext; ห้ามapproveuniversityoriginals/ส่งLINEจริง/paidgeneration/แก้providersจริงเพื่อเอาภาพ
- screenshotsเก็บignored `test-results/gemini-round2/` หรือ `.superpowers/staging/gemini-ui-round2/`; บันทึกไฟล์ที่**มีจริง**/viewport/sourcecheckpoint/realvsfixture/authrole ไม่มีpassword/tokenบนภาพ ไม่stageoutput
- ตรวจภาพหนึ่งbatch→แก้ปัญหาที่พบหนึ่งbatch→confirm ไม่วนpolishไม่จบ. ให้ความสำคัญกับworkflowมากกว่าเพิ่มanimation
- `git diff --check` และ stagedcredentialcheckerก่อนแต่ละcommit. stageเฉพาะไฟล์งาน, commitsเป็นกลุ่มตรวจง่าย ไม่มีpush/PR/deploy
- ถ้าcheckrunไม่ได้หรือbackendไม่พร้อม บันทึกcommand/actualerror/สิ่งที่ยังไม่verifiedและทำindependentUIต่อ อย่าเขียนALL_GREEN/COMPLETE/100%โดยไม่มีscopeชัด

## ส่งมอบ

สร้าง `docs/reports/GEMINI_UI_UX_ROUND2_REPORT.md`: baseline443c227/fullfinalSHAs/commitlist/worktree/changedfiles, 13-modulecoverage+routes, before/afterworkflowพร้อมสิ่งที่วัดจริง, contractgaprequests, actualcommands/exits/counts/durations/sourcecheckpoint, browserflows+screenshotsavailable+fixturevsreal, fixedreviewfindings/remainingissues, nofakebackend/nooutsideedits/no push. Reviewerให้ระบุ **Codex review pending** จนมีผลจริง

ห้ามแก้รายงานรอบแรกให้ผลเก่าดูผ่าน; ทำcorrectionnoteในรายงานรอบ2ว่ารายงานเก่าwrongroutes/claimsส่วนใด correctedหรือยังverifyไม่ได้. อย่าส่งเพียงภาพหน้าหลักหรือCSSdiff. ส่งผลทุกfrontendtaskที่ทำได้และpendingbackendlistที่ชัด ให้ผู้ใช้กับCodexตรวจcommitก่อนintegration

เมื่อเสร็จตอบผู้ใช้สั้นๆเป็นภาษาไทย: finalcommitSHA, reportpath, coverageที่ใช้ได้จริง, pendingbackendที่Codexต้องทำและยืนยัน **ไม่ได้push**. ไม่รับรองfullV1/liveFlowA–FจากUIหรือunit/buildอย่างเดียว
