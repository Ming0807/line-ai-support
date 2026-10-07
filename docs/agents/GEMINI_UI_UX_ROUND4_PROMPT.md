# Gemini Round 4 — finish real operator workflows continuously

คุณคือ Lead Product Designer & Frontend Engineer ของ YRU AI Helpdesk ผู้ใช้ต้องการให้คุณลุยต่อเนื่องยาว ๆ ให้ทุกหน้าช่วยทำงานจริงและใช้ง่ายมาก โดยรักษาหน้าหลักและ sidebar ที่ผู้ใช้ชอบ ห้ามจบรอบหลังแก้เพียงหนึ่งหน้า ห้ามลดงานเหลือเปลี่ยนสี/เพิ่ม placeholder เมื่อ task ติด backend ให้บันทึก dependency แล้วทำงานอิสระถัดไปทันที

## ฐานงานและอำนาจ

- Worktree: `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru`
- Branch: `codex/gemini-dashboard-ux`
- Frozen baseline: **`9aaab484a246c8b3c601a7c4d54e4c60286743b7`** หลัง Round3; อย่าย้อนกลับ627/443หรือเริ่ม visual design ใหม่
- Root checkout อ่านอย่างเดียว: `D:\project-next\line-ai-yru`; backend checkpoint **`1beecaa0c9e39544181621f81c8c5c947e850fb5`** (catalog/assistance/private review3/Mapping1/ticket q+pages พร้อมตามขอบเขตที่รายงาน)
- **LOCAL COMMITS ONLY. ห้าม push, PR, merge, rebase, cherry-pick หรือ deploy.** Root เป็นผู้ sync backend/ตรวจรับ/รวมงาน อย่าแก้ main checkout, WIP หรือบริการของ Root
- แก้ dashboard UI/components/CSS, browser-only presentation helpers ใต้ `app/**`, UI tests และเอกสารงานของคุณได้ อ่าน `lib/**`, `types/**`, `app/api/**`, `supabase/**`, `services/**`, workers/auth/crypto ได้แต่ห้ามแก้ backend/contracts เหล่านั้น
- Snapshot เก่าของคุณยังขาด API ที่ root ทำแล้ว: ใช้ DTO ตาม root แบบ read-only กับ isolated QA fixtures ทดสอบ frontend เขียน `ROOT_BACKEND_SYNC_REQUIRED` แล้วเดินงานต่อ ห้ามสร้าง API จำลองไว้ใน production, ปลอมผลสำเร็จ หรือคัดลอก backend เข้ามาเอง
- ใช้ port3010 เฉพาะ server ของคุณเมื่อจำเป็น บันทึก PID/วิธีหยุด ห้ามปิด3000/3011หรือฆ่า node/python แบบรวม ห้ามเปลี่ยน credentials/production data สร้างเฉพาะ QA fixtures ที่มีเจ้าของชัดเจน

## อ่านจริงก่อนลงมือ แล้วเขียนแผน

อ่าน root `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/agents/WORKING_PROTOCOL.md`, master `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, matrix และต้นฉบับจาก `docs/requirements/sources/README.md` โดยเฉพาะ Overview§31/roles/anonymous และ master§38–42/46–52/60–65/69–70 อ่าน `PRODUCT.md`, `DESIGN.md`, subsystem designs ที่เกี่ยวข้อง และ installed Next guides ใน `node_modules/next/dist/docs/` ก่อนแก้ Next behavior

อ่าน **root `docs/reports/GEMINI_UI_UX_ROUND3_REVIEW.md`** ก่อนใช้รายงานของคุณเป็นรายการเสร็จ อ่าน `docs/operations/BACKEND_UI_CONTRACTS.md`, `STRUCTURED_MAPPING_DESIGN.md`, `STRUCTURED_REVIEW_DESIGN.md`, `TICKET_READ_DESIGN.md`, `AI_PROVIDER_DESIGN.md`, `KNOWLEDGE_CATALOG_DESIGN.md`, `IMPORT_ASSISTANCE_DESIGN.md`, `EMBEDDING_SERVICE_DESIGN.md` รายงานเก่าเป็นประวัติ ไม่ทับ contract/คำสั่งล่าสุด

สร้าง `docs/ui/GEMINI_UI_ROUND4_PLAN.md` ก่อนแก้ มี task ID/requirement/source/files/dependency/acceptance/สถานะทุก18packagesด้านล่าง ใช้ skill frontend/impeccable ที่มีจริงเพื่อ harden/clarify/adapt งาน ใช้ภาพผู้ใช้เป็น visual authority ไม่เสนอธีมใหม่ รักษา Dark Rail `#141622`, Warm Canvas `#f4f3ef`, white cards, coral accents และไม่กลับไปธีมเขียว ลด card ซ้อน card/ข้อความเทคนิค/ฟอร์มยาว การออกแบบต้องช่วยตัดสินใจและทำงาน

## P0/P1 จากโค้ดจริงที่ต้องปิดก่อน

รอบ3 typecheck/selected lint/10tests ผ่าน แต่ root ยังไม่รับ workflow ทั้งหมด หน้า mapping ยังไม่ส่ง mapping/ack เข้า saved review3, acknowledgment ใน DTO ถูกกำหนดเป็น string แต่ server คืน object, selectedDataset อื่นเริ่มด้วย calendar fields, dataRanges default1–50 ไม่มี header/table exclusions, ข้อมูลเปลี่ยนแล้วยังเห็นแผนเก่า และ test ส่วนใหญ่ทดสอบฟังก์ชันที่เขียนซ้ำใน test ไม่ใช่ production

Tickets ยัง local-filter100รายการแม้ root ทำ scoped q/page/pageSize แล้ว Pending pages หลายหน้ามีแค่ disabled controls ไม่ใช่ client workflow DB card ยืนยันได้เพียง staff_profiles lookup ผ่าน Supabase ไม่ใช่ application pg pool/queue ทั้งระบบ และ provider#models/#fallback ที่รายงานยังไม่มี target จริง ให้นำข้อพบใน review มาผูกกับ acceptance ไม่เพียงแก้คำกล่าวในรายงาน

## งาน18packages — ทำให้ครบเท่าที่ทำได้อย่างต่อเนื่อง

### UX-R4-01: browser-safe mapping/review3 contract and acknowledgment

CH038/041/047/049/050. Files: `knowledge/import/structured-mapping-panel.tsx`, `review-form.tsx` และ presentation helpers/tests ใต้ frontend scope

ใช้ runtime validation ของ DTO/browser-safe adapter ไม่ cast `res.json()` แล้วถือว่าถูก Bind GET source/POST snapshot กับ job/revisions/checksum/extraction และข้อมูลปัจจุบัน POST acknowledgment คือ **`{contentDigest,mapperVersion:'structured-mapper-v1'}`** ไม่ใช่ string/hashแสดงเฉย ๆ `reviewRevision` คือ CAS ปัจจุบัน; `nextReviewRevision` เป็นแผน counter สำหรับ save ไม่ใช่คำสั่งเลื่อน counter client เอง

Parent รับ explicit mapping/ack/pending/dirty states เข้าร่าง **schemaVersion3** และ PUT existing review route Restore saved mapping/ack หลังreload; ไม่ downgrade3→2 เมื่อ chunkเปลี่ยน หรือ3→1เมื่อclear Explicitclearยังอยู่3และ receiptเก่าอยู่ STRUCTURED `chunkPlan:null`; BOTH เก็บchunkและmappingตามcontract Legacy1/2 RAGยังทำงาน อ่าน actual root `review-schema.ts`, `import-review.ts`, `import-structured-plan.ts` อย่างเดียว ห้าม import Node crypto/mapper validators เข้า client

Acceptance: fixture GET→configure→POST→deliberate acknowledge→PUT3→GETrestored; saved3clear/resaveไม่downgrade; malformed/cross-job/stale/unknownfields fail closed; publication falseไม่เปลี่ยน หาก actual integrationติดsnapshot ให้แยก isolated fixture evidenceกับroot syncpending

### UX-R4-02: show actual tables, columns and complete row disposition

CH041/042/049. Same mapping component/helpers; existing preview data เป็น source ของตาราง ไม่ให้ operatorเดา TableIndex/ColumnIndex/Row50

เลือกตารางด้วยชื่อsheet/page/หัวตารางที่พบจริง แสดง extractedcells/sourcecoordinates และ header preview ให้เลือก column ด้วยlabel+sample แทนกรอกเลขเปล่า รองรับหลายตาราง dataRanges หลายช่วงและ **excludedRanges HEADER/NON_DATA พร้อมเหตุผลจริง**, **excludedTables NOT_THIS_DATASET/NON_DATA พร้อมเหตุผลจริง** ทุกตารางและทุกแถวต้องมี disposition ตามmapper ห้ามตัดหัว/ท้ายทิ้งเงียบ ๆ หรือdefault50ข้ามsource

Mapping indicesเป็นzero-basedในDTO; labelต่อผู้ใช้ชัดเจน ไม่สลับกับworksheet sourceRow/sourceColumnที่one-based PDF/DOCX/HTMLเป็นextracted logical positions ไม่กล่าวว่าoriginalgeometry ชี้จำนวน/ขอบเขตจริงและขีดจำกัด หากข้อมูลpreviewที่จำเป็นไม่มีในactualDTOให้ขอrootแบบexactdependencyและทำeditor/fixturesต่อ ห้ามinvent extractionfields

Acceptance: one-table+header, two-table+excludednotes, non-dataกลางตาราง, lastrowจริง, invalidoverlap/gap/oversize, CSV/XLSX/PDF/DOCX/HTML fixtures โดยอ้างscopeจริง

### UX-R4-03: dataset and transform UX with honest constants

CH012/041/042. Mapping editor+tests

สร้าง field state จาก **selected datasetปัจจุบัน** ทุกครั้งที่เริ่ม/restore ไม่ใช้calendarfieldsทุกdataset เลือก7registered datasetsเท่านั้น Unknowntypeแสดงไม่รองรับและคงโหมดที่เลือก ไม่fallbackRAGอัตโนมัติ

คงnamed transformsตรงroot แสดงชื่อไทย+ตัวอย่าง input→output+advancedชื่อcodeเมื่อจำเป็น ไม่เดาBE/Gregorian/Excelserial/dateoffset ค่าnullable blankและrequiredต้องตรงpayload จำนวนเงิน/หน่วยกิตเป็นexactdecimal stringไม่ผ่านfloat รหัสรายวิชาleadingzerosอยู่จริง CONSTANTต้องมีเหตุผลoperator ไม่สร้างข้อความเหตุผลเองจากlabel ต้องมีsourceCOLUMNอย่างน้อยหนึ่งnon-nullableตามmapper

Acceptance: restoredfee/transferไม่ว่างหาย, เปลี่ยนdatasetแล้วข้อมูล/ackไม่ปะปน, ThaiBEdate/decimalcomma/UTC+07 explicitchoices, leadingzeros/nullables preserved, unsupported/whollyconstant/blanknoteปฏิเสธตรงจุด

### UX-R4-04: asynchronous binding, draft preservation and stale recovery

CH047/049/050. Mapping/review/import parent/panels

ใช้AbortController/requestepochหรือequivalent เพื่อผลเก่าหลังjob/extraction/reviewเปลี่ยนถูกdiscard เช็คbindingก่อนrender successทุกครั้ง Field/table/range/dataset/sourceเปลี่ยนinvalidateผลpreview/ackเดิม ร่างคนไม่หาย 409แสดงว่าต้องloadฉบับล่าสุดพร้อมการdiscard/mergeที่ชัดเจน ไม่ส่งauto-retry mutationบนcounterใหม่ อย่าmerge mappingกับsourceใหม่เงียบ ๆ

Pendingsource/plan/save/version/chunk/publicationต้องส่งถึงparent locks ป้องกันซ้ำและร่างเปลี่ยนระหว่างapprove แต่ไม่ล็อกทั้งเว็บ เอกสารที่completedreceiptยืนยันแล้วต้องไม่เปิดsource/draftmutationเพราะlaternull/error Unknownapprovaloutcomeใช้existingreceipt recovery ไม่ส่งapprovalใหม่จนstatusชัด

Acceptance: slowjobA→jobB, slowpreview→edit, race2requests,409preservededits, malformed503/401/403/404/413/422,unmount,doubleclick,receiptunknown/completedlock

### UX-R4-05: simple assisted import journey

USR-IMPORT-EASE / USR-IMPORT5, CH036/037/043/044/047/049/050. Import page/uploadform/importworkspace/review form

เริ่มจาก “เลือกไฟล์ / วาง URL”→upload→analyze→ตรวจสาระสำคัญ→บันทึกร่าง→preview→ยืนยัน Singleprimaryactionตามขั้นปัจจุบัน Progressบอกขั้นจริงไม่สร้างpercentเวลาเดา แสดงdefaults/originsและmissing evidenceที่จำเป็นแบบไทย เก็บadvanced fieldsในdisclosureที่เข้าถึงได้

Savedmanualdraftไม่โดนassistanceทับ ตัวเลือกdept/familyจากactualresponseเท่านั้น เก็บcurrentdraftcodeเมื่อโหลดregistryล้มเหลวและป้องกันการยืนยันreferenceที่ยังตรวจไม่ได้ Sourceauthority/visibility/effective/applicability/version/warnings/5attestationsไม่autoapprove ไม่ถือuploadtime/yearเป็นeffective date

Acceptance: uploadแต่ละ5formats/officialURL, unavailableassistance,400analyze/409previewรู้ว่าจะทำอะไรต่อ, recoveryไม่ต้องกรอกใหม่, savedreceiptsourceprotected หลังbackendsyncเท่านั้นจึงclaimintegratedpass

### UX-R4-06: server ticket search and truthful pagination

CH051 / USR-UX, TKT-READ-02. `tickets/page.tsx`, relevantfilters/pager/presentationhelpers/tests

ใช้currentroot `types/tickets.ts`/`parseTicketQuery`/listTicketscontract;ส่ง **q,page,pageSize**จริง อาจใช้serverreadปัจจุบันหรือauthenticatedAPIตามexistingarchitecture ไม่เพิ่มbackendhandler own Fourfieldsเท่านั้น:ticketnumber/summary/category/anonymouscode literalcase-insensitive `%_!`ไม่เป็นwildcard qtrim200UTF16/noCc, page1–10000,size1–100/default1/100

ไม่localfilterรายการที่serverคืนอีกครั้งด้วยdept/assigneenameแล้วทำtotalผิด Pagerใช้scopedmatchingtotal/page/totalPages/hasNext/hasPreviousจริง Missingpaginationคือunknown Resetpageเมื่อfilterเปลี่ยน PreserveallfiltersในURL/prevnext/pageSize/back/refresh Duplicate/unknown/invalidselectorต้องแสดงinvalid ไม่ลบทิ้งแล้วแสดงallเฉย ๆ Datefiltersเป็นGregoriancivilBangkok

Acceptance: searchhitที่อยู่นอกfirst100, literalไทย/emoji/%_!,zero/out-of-rangepage, filters+page reload/back,malformed400/unavailable503/permission,3rolescope fixture ไม่claimuniversitytotal

### UX-R4-07: ticket detail and queue operate cleanly

CH007/008/025/026/051/052/053 / USR-UX. `tickets/[id]/**`, `dashboard/queue/**`, ticketCSS

คงexistingstate/ownership/sensitivity API ดูchatและassignmentชัดเจน HUMANbadgeชัดและไม่สั่งAIreplyเอง ใช้actionsที่backendอนุญาตจริงเท่านั้น แยกpending/sent/deliveryfailed ถ้ามีactualDTO;ไม่ถือHTTPqueuedเป็นstudentreceived Preservecomposerเมื่อvalidation/409/timeout หรือเปลี่ยนfilterqueue ไม่ส่งซ้ำautomatically

Acceptance: takeover/respond/waituser/resolve/reopenตามexistingactions, anotherstaffconcurrency409, unauthorized/read-only, longThaiข้อความ/mobilecomposer/keyboard แล้วจัดlayoutให้samevisualworld

### UX-R4-08: knowledge catalog, version history and relationships

CH009/039/040/046/060/062 / USR-UX. `/knowledge`, catalogpanels/detail/history presentation

ใช้actualroot catalog/familyhistory/documentdetailcontractsและbrowser-safeparsers `catalog-types.ts` อย่าใช้importjobsแทนpublishedcatalog แยกisCurrent/lifecycle/effective/visibility/storageMode/lastImportAt CurrentINTERNAL/futureไม่เท่ากับstudenteligible Legacyreceiptmode/time nullแสดงunknown ไม่แทนfamilydefault

Pagination/search/filter totalsจากDTO;maximum5versionpreviewมีปุ่มดูhistoryทุกparallelstream Relationshipsอ่านdirection/typeจริง ไม่กล่าวว่าAMENDSมีผลปัจจุบันจากlinkอย่างเดียว Labelต้นฉบับ/current/historyอ่านง่าย Retainselectedfamily/documentจนผู้ใช้เลือกเปลี่ยน

Acceptance: emptyfamily, >5versions/>1historypage, mixedstreams/lifecycle/visibility/nulllegacy, documentrelationspager, malformed/wrongselectedid/404/503/permission

### UX-R4-09: provider/models/fallback navigation and order

CH014/029/030/070 / USR-ORDER / USR-UX. `/providers`page/forms/presentation/providerCSS

ทำnavigation Models/Fallbackที่ใช้งานจริง: anchorมีtarget+focusหรือsectiontabsถูกsemantic ไม่รายงาน`#models/#fallback`ที่ไม่มี element Providerorderและper-modelorderใช้up/downของexistingAPIครบ พร้อมpending/dirty/save/reorder409/reload Preserveunsavedsettingsเมื่อtest/reorderล้มเหลว ประเมินทั้งcreate/edit/enable-disable/replacementkeyที่มีAPIอยู่

Acceptance: keyboard+mobile orderfirst/last/save/conflict, modelgroups+models/fallbacknavigate/back,create/editformlabels;ไม่เพิ่มglobalrulemutationที่rootยังไม่มี

### UX-R4-10: per-model HTTP, quota and probe interpretation

CH014/015/029/030 / USR-STATUS / USR-QUOTA / USR-TEST / USR-FREE. Providerrows/proberesults/fallbackpreview

แสดงobservedHTTP/status/probetype/checkedAt/latency/quota source/scope/resetจริงพร้อมแต่ละmodel ปุ่มtestแยกตัว Enabled≠healthy;metadata200≠generationpass;429≠dailyquotaหมดถ้าไม่มีข้อมูล;unknown/stale/unavailableคนละสถานะ FREE_ONLYราคาที่ยืนยันแล้วเท่านั้น อย่าใช้`≤10%`ที่คิดขึ้นเองถ้าrootcontractไม่ได้ระบุ ไม่สร้างtokens/cost/remainingnumber

StartupZen/OpenRouterเป็นหลัก paidต้องchoiceเดิมที่มหาลัยเลือกชัดเจนไม่เปิดเอง LocalCPU E5small384อยู่นอกproviderordering คงofflinecached/noautodownload

Acceptance: actualfixture200/401/403/429/5xx/timeout/unknownquota/staleprice/cooldown/freeblocked; actualAPI test onlywhenQApermitsและแยกliveexternalจากfixture

### UX-R4-11: truthful Settings and department reference

CH060/065 / USR-DASHBOARD / USR-EMB-LOCAL / anonymous roles. settings/departments/pages/viewmodels

SuccessfulrequireStaffยืนยันstaff_profiles Supabaselookupเท่านั้น Labelให้ตรงหรือแสดงhealthunobservedจนrootactualsystemhealthcontractมี อย่าสร้างpgpoolstatus/timestamp/latencyจากpageload LocalE5ใช้actualhealthresult+time/configobservationsหากDTOมี ไม่fixportเป็นobserved

Departmentsstaticseedอาจเป็นreferenceconfigurationที่labelชัด แต่ไม่ใช่liveregistry/currentstaffcounts;ไม่กล่าวว่าถาวรหรือห้ามแก้DDLเป็นproductpolicyที่ไม่มีsource ใช้actualauthenticatedregistryเมื่อมีapprovedcontractเท่านั้น ห้ามเอาimportassistanceadminAPIไปเลี่ยงscopeหน้าstaff Rolesจริง STAFF/SUPERVISOR/ADMIN/SUPER_ADMIN;ไม่เพิ่มAGENT/DEPT_ADMIN คำอธิบายเป็นoperatoractionไม่RLSlecture

Acceptance: stafflookupavailable/businessDBunknown, embeddinghealthy/offline/unobserved, restrictedrole, staticvsreadysourceไม่สับสน, allunknownsไม่กลาย0/healthy

### UX-R4-12: Activities and Logs ready state renderers

CH015/016/060 / USR-DASHBOARD. activities/logs pages+frontendcomponents/isolatedfixtures/tests

Currentproductionไม่มีapprovedaggregateAPI อย่าแค่placeholderซ้ำ สร้างtypedpresentationadapterกับloading/empty/error/permission/stale/ready และtable/timeline/filter/pagerใต้frontendscopeตาม**explicitlyproposed** contractบันทึกrootrequest Userไม่เห็นcodeDTOtableหรือINTEGRATIONPENDINGarchitecturelecture

Productionunavailableยังแสดงอ่านไม่ได้ชัดเจน ห้ามว่าไม่มีactivity/logerrorเมื่อไม่ได้query Fixturesใช้isolatedQAเท่านั้น Logsneverrawmetadataheaders/body/LINEids/secrets Publicpresentationต้องallowlistfieldsตามrootapprovedcontractก่อนintegration ไม่sanitizeด้วยregexแล้วถือว่าปลอดภัยทุกกรณี

Acceptance: renderedstatefixtures+keyboardfilters+pagers+retry+longsafecontent; no productionmock/logleak; honestdependentstatus

### UX-R4-13: Usage and Analytics meaningful views

CH015 / USR-DASHBOARD. usage/analyticsfrontendcomponents/viewmodels/fixtures

ทำstatefulpresentationสำหรับapprovedobservationsหรือproposedaggregatecontract เก็บscope/source/period/timezone/sampleSize/lastchecked/unknowns Sourceabsenceไม่zero MetricsMTTR/token/cost/request/latencyp50/95ต้องdefinitionsไม่เดาจากlatest100ทั้งมหาลัย Useexistingobservedmodelswhenactualcontractpermitsและlabelsample ห้ามสร้างcumulativebill/CacheHitRateที่ไม่มีdata

Acceptance: no-dataresponsevsnetworkfailure, scopedpartialpopulation, unknownquota/cost, rangefilter+URLback+retry, responsivechart+equivalentreadabletable หากrootDTOยังunapprovedให้fixture-onlyrendererและexactrequestต่อ

### UX-R4-14: Incidents scoped and honest

CH013/055/056/057 / USR-DASHBOARD. incidentsfrontendstate/components/fixtures

แสดงincidentlist/detail/status/filter presentationตามsourceพร้อมrootcontractrequest ห้ามปุ่มpublish/broadcast/createที่เหมือนทำงานจริงเมื่อendpointยังไม่มี ไม่กล่าวว่าticketsมีgroupingแล้ว ไม่มีthreshold10tickets/hourหรือautomaticdetectionที่คิดเอง ไม่มีnewAIrouter/roles/incidentstatebusinesslogic Productionเป็นunavailablestateพร้อมexistingticketlinkที่ใช้งานได้

Acceptance: scopedready/empty/unavailable/errorfixtures, filter+rowdetailkeyboard/mobile;ข้อเสนอสถานะ/actorsไม่ทับrootstatecontract

### UX-R4-15: Overview actual metrics and chart boundaries

USR-DASHBOARD / CH051/066. dashboardpage/purepresentationhelpers/tests

คงhomecompositionที่userชอบ แต่ source/time/samplelabelตรงทุกตัว กราฟ7วันต้องexcludeinvalid/futurecreated_at ใช้actualproductionhelperที่testเรียก Chooseanddocumentrolling7×24hหรือ7Bangkokcivildaysให้labelตรง ไม่testupdated_atแทนcreated_at Currentclockใช้fixedreferenceในtest เพื่อเที่ยงคืน/+07 boundaryเชื่อถือได้ กราฟmissingAPIไม่แทน0 Hero/waveตกแต่งไม่ต้องกล่าวเป็นforecast

Acceptance: future/old/exactbounds/Bangkokmidnight/zero/partial100/APIerror, counts+srtableตรงvisualseries, overviewsearchไปserverq,notification/queueactionsจริง

### UX-R4-16: shared UX consistency and Thai copy

USR-UX / USR-DASHBOARD / USR-IMPORT-EASE. existingCSS/appshell/frontendprimitives

รวมtable/empty/loading/unavailable/error/dialog/action stylesเฉพาะที่ช่วยลดความซ้ำ ลดinlinegridที่mobileoverflow แต่ไม่rewriteappทั้งหมด หนึ่งprimaryactionต่อsection Iconsมีlabel/tooltipfocusได้ หน้าจัดการไม่เต็มด้วยemojiหรือdeveloperterminology Thaierrorบอกสิ่งที่ต้องทำต่อ Date/time displayAsiaBangkokจริง Sourcecivil datesไม่เปลี่ยนปี silently Inputlabels/required/optional consistent

Acceptance: all13modules pluslogin/detail/queue/importpanels sameworld, spacing/textcontrast/readability, longThai/modelID/URLsแตกบรรทัดและข้อมูลอ่านเต็มได้

### UX-R4-17: actual keyboard/mobile/recovery test pass

CH066/070 / USR-UX. UItests+actualexistingbrowserautomationtooling

Replacecopiedtestimplementationsด้วยproductionhelpers/renderedUI/requestcontracts ไม่assertsource text/enumเท่านั้น Testcriticalworkflowmeaningfulไม่เขียนmirrortestเพื่อเพิ่มcount Desktop1440×900/mobile390×844 +320px/zoom200สำหรับcriticalforms ไม่มีpagewideoverflowยกเว้นdatatableมีlabel/scroller ใช้keyboard Tab/ShiftTab/Escape/focusreturn/mobile drawer/dialogfocuslocks/ariaชื่อและstatus ไม่แค่screenshotsหน้าlogin

ทำboundedQAสองรอบ: firstbatcheddesktop/mobile/keyboardแล้วfixสิ่งพบเป็นชุด; secondconfirmationเฉพาะaffected ไม่วนpolishไม่สิ้นสุด ไม่ลดchecksเพราะเจอrealfunctionalbugs TestsisolatedอาจmockmatchingDTOแต่ต้องระบุว่าfixture ต่างจากlivebackend/OA

Acceptance: actualmapping/reviewsave/error409, searchpaging, ticketcomposer+queue, providerorderingtest, cataloghistory, login/logoutpermission;รายงานทุกcaseที่run/ไม่ได้runตรงจริง

### UX-R4-18: honest handoff, coverage and local commits

ทำ `docs/ui/GEMINI_UI_ROUND4_COVERAGE.md`, `GEMINI_UI_ROUND4_BACKEND_REQUESTS.md`, `docs/reports/GEMINI_UI_UX_ROUND4_REPORT.md` Coverageแยก perworkflow: UI_ONLY_SHELL / FIXTURE_BEHAVIOR_PASS / INTEGRATED_PASS / ROOT_BACKEND_SYNC_REQUIRED / BACKEND_CONTRACT_PENDING / MANUAL_PENDING ไม่ใช้คำครบ13module=ทั้งV1พร้อม

Backendrequestแต่ละข้อมีsource/task/actoractualrole/scope/currentendpoint/exactgap/request+response/error/binding/revision/privacy/unknownoutcome และทำเครื่องหมาย**PROPOSED, NOT ROOT-ACCEPTED**เสมอ Rootcatalog/assistance/review3/ticketที่มีแล้วต้องเป็นsyncdependencyไม่ให้rootสร้างซ้ำ เฉพาะbackendส่วนที่ยังขาดจริงจึงproposal ห้ามแก้rootdecisions/schemaเองหรือใช้decisionnumberที่ชนroot

## Quality gates และการส่งมอบ

รันavailableactual `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run --maxWorkers=1`, `pnpm build`, `git diff --check 9aaab484a246c8b3c601a7c4d54e4c60286743b7..HEAD` หลังcommit และ staged credential checkerก่อนcommit อ่านexitจริง เก็บscope/sourcecommands/failedattempts/finalcounts อย่าอ้าง1,465testsเก่าหรือstagingartifactsเป็นfinalpass ถ้าignoreจำเป็นให้เฉพาะgeneratedprofiles ไม่ignoreapp/testsหรือdisableกฎ

เก็บscreenshotscriticalinteractionstates/error/recoveryพร้อมviewportและtestlogs ห้ามมีcredentials/LINEtechnicalidentity/privateoriginal/rawmessageรั่ว ไม่ถ่ายAPIkey/passwordfields รายงานworkingtree/backendbaseline/localSHAs/changedfiles/PID/fixturevslive/remainingtasks Root reviewpendingชัดเจน หากบางchecksrunไม่ได้ให้รายงานเหตุผลไม่ใช้100%pass

จบเมื่อคุณทำทุกindependentpackageที่มีข้อมูลและเครื่องมือครบแล้ว ตรวจของจริงครบขอบเขต หรือเหลือexternal/rootdependenciesจริงทั้งหมด สรุปสิ่งเหลือให้rootทำ ไม่หยุดรอหลังtaskแรกและไม่ถามpermissionroutineซ้ำ ห้ามpush/merge/deployเด็ดขาด ผู้ใช้จะส่งlocalcommitreportให้Codexเอง
