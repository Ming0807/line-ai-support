# Gemini Round 3 — ทำ workflow ให้ใช้งานจริงต่อเนื่อง

คำสั่งจากผู้ใช้: ทำงาน frontend/UX ต่อให้มากที่สุดอย่างต่อเนื่อง โดยรักษาหน้าหลักและ sidebar ที่ผู้ใช้ชอบ เมื่อมีงานที่ติด backend ให้บันทึก dependency และทำงานอื่นต่อ ห้ามหยุดหลังทำหนึ่งหน้า ห้าม push/merge/deploy ผู้ใช้จะส่งรายงานและ local commits ให้ Codex ตรวจรับ

## พื้นที่และฐานงาน

- ทำงานใน `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru` branch `codex/gemini-dashboard-ux`
- Baseline รอบนี้ `6271490fb024a00b61aa9746ed12991824d8e01b`; อย่าย้อนกลับ443c227หรือเริ่มดีไซน์ใหม่
- อ่านเอกสาร authoritative ปัจจุบันจาก `D:\project-next\line-ai-yru` แบบ read-only เพราะ backend ที่นี่เดินต่อจาก snapshot ของคุณแล้ว ล่าสุด structured review/preview อยู่ใน root commit `c99dbbc5764b0fdc6154657664bfb69b706929a7`
- ห้ามแก้ checkout หลักหรือ WIP ของ Codex ห้ามคัดลอก `.env`/บัญชีทดสอบ/ไฟล์ private original ไปเพิ่มในเอกสารหรือ git
- ใช้ dev port3010 เฉพาะของ worktree เมื่อจำเป็น บันทึก PID/คำสั่งหยุด server ที่คุณเริ่มเอง ห้ามหยุด3000/3011/บริการของคนอื่น

## อ่านก่อนทำและสร้างแผน .md

อ่าน root `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/agents/WORKING_PROTOCOL.md`, master `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, requirements matrix และต้นฉบับใน `docs/requirements/sources/README.md` จริง โดยเฉพาะ Overview§30–36/anonymous/roles, master§38–42/46–52/60–65/69–70 และคำยืนยันล่าสุด

อ่าน `PRODUCT.md`, `DESIGN.md`, system/provider/import/embedding/catalog/assistance/structured review designs, `docs/operations/BACKEND_UI_CONTRACTS.md`, [ผลตรวจรอบ2](../reports/GEMINI_UI_UX_ROUND2_REVIEW.md) และ prompt รอบก่อนเพื่อทราบสิ่งที่ค้าง อ่าน installed Next.js guides ใน `node_modules/next/dist/docs/` ก่อนแก้ Next behavior ห้ามเดา API จากความจำ

ใช้ frontend/impeccable skills ที่มี บันทึกจริงว่าใช้อะไร รักษา human visual authority หาก skill เสนอทิศทางอื่น ผู้ใช้เลือก dark rail `#141622`, warm canvas `#f4f3ef`, white rounded cards, Sunset Coral แล้ว และไม่ต้องการสีเขียว อย่าเปิด design interview หรือเปลี่ยนกลับธีมเดิม

ก่อน code สร้าง `docs/ui/GEMINI_UI_ROUND3_PLAN.md`, `docs/ui/GEMINI_UI_ROUND3_COVERAGE.md`, `docs/ui/GEMINI_UI_ROUND3_BACKEND_REQUESTS.md`: taskID/requirement/source/files/owner/dependencies/acceptance ชัดเจน ห้ามแก้ root task board/matrix/decision log จาก snapshot เก่า ส่ง proposed updates ใน UI docs ของคุณให้ Codex รวมภายหลัง

## ต้องแก้ผลตรวจรอบ2ก่อน

1. `review-form.tsx` fallback ใช้รหัสหน่วยงาน/หมวดเอกสารที่เดาและไม่ตรง registry เช่น ACADEMIC/ADMISSIONS/FACULTY_* และ TUITION_FEES ที่ backend ใช้ TUITION_FEE ลบการแทน actual choices ด้วยค่าที่เดา เมื่อ assistance โหลดไม่ได้ ให้รักษาร่าง/ข้อมูลที่มีแล้ว มี retry และคำอธิบาย ไม่แสดงว่าตัวเลือกจากฐานข้อมูลถูกโหลดสำเร็จ ห้าม hardcode19familiesเพื่อแทน live/custom families
2. Dashboard ส่ง `/tickets?q=...` แต่ Tickets ไม่อ่านq ทำให้ค้นหาไม่มีผล ทำให้พฤติกรรมค้นหาจริงและมี scope ชัดเจน ใช้ backend selectors ที่มีจริง หากเป็นการค้นหาในรายการที่โหลดแล้วต้องบอกขอบเขตนั้น ห้ามเพิ่มคำว่าglobal searchหรือส่ง API query ที่ server ไม่รองรับ
3. Dashboard errors ของ providers/imports ยังกลายเป็น0; Settings Database badge ยัง hardcodeเชื่อมต่อสำเร็จ แยก loading/empty/error/unavailable/unknown ออกจาก0สำเร็จและ healthyจริง ใช้ timestamp/source ที่มีจริง
4. กราฟเรียก weekly แต่รวมทุก loaded ticket ตาม `getDay()` โดยไม่จำกัดสัปดาห์และไม่กำหนด Asia/Bangkok แก้ช่วงเวลา/timezone/ขอบเขต100รายการ และ zero-data label/bar ตามหลักฐาน งาน statusREADY เป็น extraction/intake stage ไม่ใช่จำนวนรออนุมัติเสมอ เพราะเผยแพร่แล้วก็ยังREADY ห้ามเดาสถานะเผยแพร่จากREADY
5. ย้ายตาราง API/JSON/implementation requests ออกจากหน้าที่เจ้าหน้าที่ใช้ ไปอยู่ docs ของคุณ Product UI ใช้ภาษาไทยบอกงานที่ทำได้/สถานะ/ขั้นตอนถัดไป API path/SQL/schema/จำนวนmigrations ไม่ใช่เนื้อหาหน้าใช้งานทั่วไป
6. Route links ห้ามติด `role=tab`/tablist ถ้าไม่มีtabpanel/keyboard tab interaction ใช้ navigation links + aria-current หรือ implement tabs จริง กลุ่ม Providers/Models/Fallback ต้องมี section/tab ที่เปิดถึงจริง
7. รายงานรอบ2ใส่ Codex เป็น reviewer ก่อนรับผลจริง รอบ3ระบุ `Codex review pending` Screenshot26ภาพมี12route groups+login ไม่เท่ากับทุก module capabilityผ่าน และไม่มีหลักฐาน ticket detail/queue keyboard flows อย่ารายงานcomplete13functionalmodulesจากจำนวนหน้า
8. Codex rerun typecheck ผ่าน แต่ full `pnpm lint` ปัจจุบันล้มเหลว976problems (37errors/939warnings) เพราะ ESLint เข้าไปอ่าน third-partybrowserextensions ใน ignored `.superpowers/staging/edge-profile/` แยกgeneratedQAartifactsออกจากlintด้วยignoreที่แคบและถูกต้องหรือจัดQAprofileนอกsource อย่าลดlint rules/ignoreapp/tests/ลบprofileคนอื่นเพื่ออ้างpass แสดงfullgateหลังแก้จริง
9. Codexตรวจ actual443c227..6271490 commitdiff แล้ว `git diff --check` exit2 พบ17trailingwhitespace locations (10TSX/7report) แก้และตรวจตั้งแต่baselineจริง ไม่ใช้workingtreecleanที่ไม่มีdiffเป็นPASS รายงานhistoricalcorrectionแยกจากผลรอบ3

## ขอบเขตไฟล์และ backend

แก้ได้ใน worktree ของคุณ: `app/(dashboard)/**`, `app/login/**`, UI CSS/shared components/helpers ภายในfrontend, frontend behavior tests/QA scripts, `DESIGN.md`, `docs/ui/GEMINI_UI_ROUND3*`, `docs/reports/GEMINI_UI_UX_ROUND3_REPORT.md` และ precise generated-QA-artifact ignore ใน ESLint config โดยห้ามลด project rules/source scope

ห้ามแก้ `app/api/**`, backend `lib/**`, auth actions/proxy/middleware contracts, `supabase/**`, `services/**`, workers/configจริง/LINE/provider keys แก้ business DTO/schema/permissions เพื่อให้ UI ผ่าน หรือเพิ่ม dependencies เพื่อซ่อนปัญหา ห้ามสร้าง API/SQLแทน root ห้ามลด tests/quality gates

เรียก existing authorized backend reads/actions ได้ตาม contract ไม่ query privilegedDB จาก frontendเอง Permission hiding ไม่แทน server authorization ไม่มี student/profile/grade/enrollment management ห้ามแสดง technicalLINEuserID/replyToken/token/rawpayload

Root backend ใหม่อาจไม่มีใน worktree snapshot: อ่าน exact contracts จาก rootและใช้ type-only references เมื่อมีใน snapshot อย่า import server crypto/Buffer/encryption เข้า client bundle อย่า merge/cherry-pick/copybackendเอง ถ้ายังขาด browser-safe module ให้ทำ frontend-owned transport view model/parsers ตาม frozenHTTPshapeและ meaningful fixture testsภายในfrontend ห้ามประกาศ validatorนั้นเป็น server authority บันทึก `ROOT_BACKEND_SYNC_REQUIRED` พร้อม module/commit/contract และทำ independent tasks ต่อ

ห้าม production mock data, fabricated success, quotaเปอร์เซ็นต์ที่ไม่มีหลักฐาน, auto approval, silent mode downgrade หรือ retry write ที่ไม่ทราบ outcomeเอง QA-only fixtures อยู่ tests/isolatedbrowserharness และแยกจาก productionruntimeชัดเจน

## งานต่อเนื่อง 16 ชุด

| ID | งาน | สิ่งที่ต้องใช้ได้และตรวจรับ |
|---|---|---|
| UX-R3-01 | แก้ข้อผิดพลาดรอบ2/registry/truth | ผิดรหัส/unknown-as-zero/false-health/no-op-searchหมด มีbehavior regression tests พร้อม source evidence |
| UX-R3-02 | Shared product UI | tokens/pageheader/button/form/filter/table/pagination/drawer/dialog/notice/skeleton/empty/error/retry ใช้ร่วมกัน ลด inlineCSSซ้ำ รักษาความหนาแน่นข้อมูลของหน้าทำงาน ไม่ขยายทุกการ์ดเท่าhero |
| UX-R3-03 | Shell/login/role navigation | routeactiveที่ตรง, accessible icon labels/tooltips, keyboarddrawer/Escape/returnfocus/visiblefocus/scrollrestore, sidebar groupsครบ, signout/expired/forbidden statesชัด ไม่เปิดrights/สร้างaccountเพื่อถ่ายภาพ |
| UX-R3-04 | Overview ที่นำไปทำงานต่อได้ | searchจริง, queue linksตามfilterที่serverรับ, สถิติ/กราฟมีloadedscope/timezone/ช่วงเวลา, unknown/zeroแยก, no fake decorative trend, empty/retryมีทางต่อ ไม่เรียกหน้าOverviewว่าAnalyticsโดยไม่ตั้งใจ |
| UX-R3-05 | Tickets list/detail/queue | filters URLstate/reset/resultcount/paginationตามAPIจริง; mobile scan/longThai; detailมีthread/history/department/sensitivity/HUMAN/ownership; accept/takeover/reassign/reply/resolve/close/reopenเท่าที่backendอนุญาต pending/409/unknownoutcomeไม่ส่งซ้ำ ป้องกันร่างreplyหายก่อนaction |
| UX-R3-06 | Approved knowledge catalog | literal search/department/status/page, family current/history/parallelstreams, documentdetail/relationships/source/scope/effectivedates/modeจริง, legacyunknownไม่ใช้defaultmodeทับ, abortdifferentselection, stale/error/retry, clearfilter/outofrangepage; currentไม่ได้แปลว่าใช้ตอบได้ทุกคน |
| UX-R3-07 | นำเข้าแบบง่ายและฉลาด | หน้าแรกเลือกไฟล์/URL→รับต้นฉบับ→วิเคราะห์→อ่านสรุป→แก้เฉพาะสิ่งที่ยังไม่ชัด ไม่บังคับกรอกทุกmetadataก่อนupload; progressive steps/advanced disclosure; newjob analyzeครั้งเดียวตามcontract; requestserial/cancel/retry/status400/409/413/422/503; เลือกjobใหม่ไม่เห็นdraftเก่า |
| UX-R3-08 | Review/version/chunks/approval | saved draftเป็นฐานก่อนassistance; missingdecision summaryไทย; actualfamily/departmentpickers; newfamily/exactversiontarget/all5actions/CANCELS; warning reasonและ5attestations deliberate; source/saved-draft revisionsถูก; dirtydraft/conflict/unknownapprovalresponse/receiptrecovery; ไม่ต้องให้คนพิมพ์UUID |
| UX-R3-09 | Structured Mapping1/private review3 | ทำ columnmapping/constant/range/exclusion/transform/sourceevidence/typedpreview/private saveตามรายละเอียดด้านล่างทุก7dataset; publicationUnavailableแยกจากdraftpreparation; no autoapprove/no fallbackRAG |
| UX-R3-10 | Providers/Models management | actualadd/edit/enabled/providerupdown/modelupdown, separateper-modeltest/httpstatus/latency/observedquota/time/cooldown/errors; modelenabledไม่เท่ากับhealthyหรือeligible; freeverified/unknown/paidชัด เริ่มFREE_ONLY มหาวิทยาลัยเพิ่มpaidผ่านUIภายหลังเอง |
| UX-R3-11 | Fallback/usage observation | เปิดถึงModels/Fallbackได้จริง มีorderedcandidate/skipreason/defaultpolicyตามserver ไม่ใช้numericpriorityแทนupdown; remainingquotaunknownแสดงunknown ไม่เดาจาก200,429/5xx/authbadแยก, candidatepreviewไม่เรียกpaidinference |
| UX-R3-12 | Incidents/Departments | reusable list/detail/filter/linkedtickets/severity/status/date/empty/errorในclientviewตามapprovedDTOที่มี; actualdepartmentregistry/scopedrows ห้าม invented9departments/keywordfinalrouting/broadcastallstudents/newroleDEPT_ADMIN ถ้าrootยังไม่ให้DTOใช้isolatedQAfixturesและฝากexactcontractrequest ไม่เรียกproductioncomplete |
| UX-R3-13 | Activities/Logs | readabletimeline/filter/date/actorrole/eventcategory/correlationตามsanitizedcontract, separatebusinessactivitiesจากsystemerrors, privatecontent/token/rawLINEpayloadไม่แสดง, unknown/errorไม่แสดงNoeventsสำเร็จ, pagination/longerror/mobile |
| UX-R3-14 | Usage/Analytics | time-range/AsiaBangkok/scopeddenominator/samplewindow/count/success/latency/tokenusage/costobservedตามactualsource; unresolved/MTTR definitionsต้องมีcontract ห้ามpretendloaded100คือมหาวิทยาลัยทั้งหมด CSVexportเฉพาะdataที่ผู้ใช้มีสิทธิ์และAPIรองรับ |
| UX-R3-15 | Settings/operational states | actualrole/freepolicy/localE5read-onlyhealth/checkedtime/unknown/broken, generationกับembeddingแยก; UIconfigurationเฉพาะexistingserveractions; staffOA binding/notifications/AIstaffassist surfacesเฉพาะfrozencontracts หากไม่มีฝากrequest ไม่สร้างtoken/LINEcall/backendเอง |
| UX-R3-16 | Cross-page acceptance/ส่งมอบ | desktop/mobile/keyboard/userflows/error/stale/dirtydraft/longThai/permissionครบ, fix findingsหนึ่งbatch+confirm, meaningfulnewtests, independentactualreviewเมื่อมี, localcommits/reportครบ no push |

ทำ01ก่อน แล้วเดิน02–11ที่ backendพร้อมให้ครบ เตรียม12–15ด้วย frontend state/components/testsที่มีประโยชน์ตามcontract พร้อมฝากbackendrequests สุดท้าย16 ห้ามนับหน้า placeholderหรือdisabledfilterเป็นfeaturecomplete

### Mapping1/private review3 ที่ backendเพิ่มแล้ว

Root `docs/operations/BACKEND_UI_CONTRACTS.md`, `STRUCTURED_REVIEW_DESIGN.md`, `STRUCTURED_MAPPING_DESIGN.md` และ `STRUCTURED_DATA_DESIGN.md` เป็น authority อ่าน source/typesจริงใน root:

- GET `/api/knowledge/imports/[id]/structured` → `{source:{jobId,jobRevision,extractionRevision,reviewRevision,sourceChecksum,extractionDigest}}` ไม่มีqueryselectors activeSUPER_ADMINเท่านั้น
- POST same path → `{expectedJobRevision,expectedExtractionRevision,expectedReviewRevision,mapping}`; review0 validก่อนsave; response `{snapshot:{jobId,jobRevision,extractionRevision,reviewRevision,nextReviewRevision,plan,acknowledgment,publicationAvailable:false}}`
- Mapping1.sourceใช้sourceจากGETโดยไม่ใส่reviewRevision ระบุ dataset/version1/registryVersionจริง, selectedtables/ranges/excludedrangesและเหตุผล/fieldbindings/explicitconstants/excludedtables ครบ ห้ามเดาจากหัวตารางแล้วsaveอัตโนมัติ
- COLUMN field bindingเลือกcolumnIndex/transform/blankREJECTหรือNULL ตามrequirednessจริง CONSTANTต้องมีnoteและไม่แอบอ้างว่าเป็นค่าจากsource อย่างน้อยหนึ่งnonnullabletargetต้องมาจากCOLUMN
- แสดงdataset pickerทั้ง7ตามregistry, targetfieldsrequired/nullable, sheet/tablelabel/coordinatesตามsourceชนิดจริง, rawlexeme/transform/typedvalueแยกกัน วันที่พ.ศ./ค.ศ./decimalcomma/+07/midnightเป็นexplicitreviewedchoice ห้ามExcelserialdateguess
- XLSXใช้worksheetcells, CSV logicalrecords, PDF/DOCX/HTML extractedlogicalrows ห้ามอ้างoriginalDOM/XMLgeometryที่ไม่มี เปลี่ยนmapping/source/selectionแล้วinvalidatepreview/ack
- Planมีalltypedrows/cellevidence/warnings/flags/requiresReview:true; paginatedviewในclientอาจช่วยอ่าน ไม่ส่งnormalizedbrowserrowsกลับเป็นauthority ไม่ทำแค่sampleแล้วบอกallrowsvalid
- PUT reviewroute ใช้schemaVersion3 + commonreview2fields + `structuredMapping:null|{mapping,acknowledgment:null|{contentDigest,mapperVersion:'structured-mapper-v1'}}` nonnullmappingต้องmetadataSTRUCTURED/BOTHและdatasetตรง STRUCTUREDไม่ส่งchunkPlan
- ร่างmappingยังไม่ครบใช้nullmapping/ackตามcontract ไม่convert3กลับ1/2 แม้clearแล้ว backendreject409 Preserveunknownreviewversionอย่างปลอดภัยอย่าoverwrite
- private draft/previewทำได้ แต่ fixedpublicSQL/mode publicationยังไม่พร้อม registryinstalled:false และ `publicationAvailable:false` ดังนั้นแสดงยังเผยแพร่ข้อมูลตารางไม่ได้ให้คนเข้าใจ ปุ่มapprovalของ3ต้องblockedพร้อมเหตุผล Existing1/2 RAGapprovalคงทำงาน ไม่มีsilentfallbackหรือปลอมreceipt
-400invalid/409stalebinding/413limits/422rowunsafe/503unavailableต้องrecoverable coordinateerrorเลือกrow/fieldที่เกี่ยวข้องได้โดยไม่แสดงrawbackendexception 2MiBrequest/256KiBmapping/16MiBplan/2000rowsตามserver
- ไม่ทำNodehash/crypto/Bufferในbrowser ไม่สร้างpublicationHTTPcontractใหม่เอง Sourcebootstrap/preview/private saveต้องผูกexactjob/extraction/reviewcounter กันlate-responseจากjobอื่น รวมabort/unmountและconflictหลังreload

## Backend requests ที่ต้องฝาก root

ทุก gapเขียนใน `GEMINI_UI_ROUND3_BACKEND_REQUESTS.md`: module/task/linkedrequirement/สิ่งที่ operatorต้องทำ/currentactualAPI/ช่องว่าง/actor+department+sensitivity scope/GETหรือmutation/proposedselectors+DTO/status/revision/idempotency/pagination/unknownoutcome/reason

Proposalsไม่ใช่frozencontracts Rootตัดสินก่อนimplementation ห้ามสร้างrequirementsเพิ่มจากตารางAPIที่คุณเคยเขียน หากcontractขาด ทำcomponent/isolatedtests/documentrequestและงานอื่นต่อ ไม่รอผู้ใช้ทำbackend ไม่บอกpageพร้อมใช้จริงจนมีactualintegration

## การทำงานเป็นทีมและ checkpoints

ใช้agentตามเครื่องมือที่มีและบันทึกactualowner ใช้Luna highสำหรับcomponent/testsธรรมดา และmaxสำหรับrace/draft/mapping/accessibilityreviewที่ซับซ้อนถ้ามีตามผู้ใช้ขอ ห้ามอ้างagent/reviewerที่ไม่เกิดจริง Root/Geminiต้องดูแลsharedcontractและintegrateเอง แต่ละagentownfilesไม่ชนกัน

ทำlocalcommitsเป็นชุดตรวจง่าย:01–04;05–06;07–09;10–11;12–15;16 หรือกลุ่มที่source dependenciesเหมาะสม ทุกชุดtype/lint/relatedbehaviorchecksและstagedcredentialscanก่อนcommit รักษาgit history ไม่reset/clean/stashไฟล์คนอื่น ไม่push/PR/deployหรือmergecheckoutหลัก

## QA และหลักฐานที่ต้องส่ง

- regressiontestsจริงสำหรับwrongregistryfallback/no-opsearch/timezone/unknownstatus; dirtydraft/jobselection/abort/stale409/unknownapprovalreceipt; Mapping1edit/invalidack/review3nodowngrade; order/testobservationsและrole/keyboardตามที่แก้ ห้ามtestแค่class/colorแทนbehavior
- `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run --maxWorkers=1` เต็มsuite และ `pnpm build`; อ่านexit/counts/sourcecheckpointจริง ถ้าOOM/toollimitต้องรายงานfailureและทำindependenttasksต่อ ไม่อ้างALLGREEN
- Actualbrowser desktop1440x900/mobile390x844: Overview/list/detail/queue/catalog/importselectedjob+review/providerModelsFallback/login และทุกหน้าที่แก้ keyboarddrawer/dialog/focus/200%zoom/longThai/malformed/empty/error/sessionexpired Permissionใช้existingfixturesตามscope ไม่เปิดสิทธิ์หรือใช้studentdataเพิ่ม
- No liveOA messages/providerpaidcalls/changeproviderจริง/approveuniversitydocumentsเพื่อถ่ายภาพ ใช้syntheticisolatedQAสำหรับwriteflows Missingbackendtestsใช้QA-onlyfixturesและประกาศsourceชัด Captureartifactต้องตรงstateไม่ใช่loginถูกเรียกว่าdashboard
- screenshotหนึ่งbatch→แก้หนึ่งbatch→confirm เก็บignored `.superpowers/staging/gemini-ui-round3/` พร้อม manifest route/viewport/actor/source/realvsfixture/actualfilename ไม่stagecredentials/privateoriginals/screenshots/buildoutput
- `git diff --check <baseline> HEAD`, `git diff --cached --check`, `node scripts/security/check-staged.mjs` Gateผ่านต้องสัมพันธ์กับactualchangedcommitdiff ไม่ใช้emptyworkingdiffเป็นหลักฐานcommitwhitespace

## รายงานสุดท้าย

`docs/reports/GEMINI_UI_UX_ROUND3_REPORT.md` ต้องมีbaseline627/fullfinalSHA/commitlist/cleanstatus/changedfiles/actualowners; task01–16และ13modulecapabilitycoverage; ผลแก้findingsรอบ2พร้อมtests; before/afterงานimportกับstaffreplyที่ทำได้จริง; actualcommands/exits/counts/build/sourcecheckpoint; browserflows/screenshotsactualและfixture/liveแยก; exactbackendrequests/remainingintegration/manualdependencies

Reviewer=`Codex review pending` จนรับคำตัดสินจริง ไม่เขียนว่าครบV1/100%จากroutes/tests/screenshots การอ้าง13modulesคือcapabilitiesไม่ใช่บังคับ13routes ภาพProvidersหนึ่งภาพไม่พิสูจน์Modeltest/Fallbackworkflow

เดินงานfrontendที่authorizedทั้งหมดจนจบ แล้วตอบผู้ใช้ไทยสั้นๆพร้อมfullSHA/reportpath/usableworkflows/pendingbackendและยืนยันไม่ได้push ผู้ใช้จะส่งรายงานให้Codexตรวจและรวมงาน คุณไม่ต้องรอให้ผู้ใช้สั่งcontinueทีละหน้า
