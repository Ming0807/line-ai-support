# สิ่งที่ผู้ใช้ต้องตั้งค่า/ยืนยันก่อนใช้งานจริง

7October GEM-REV-06/STR-01C-0: relay the [bounded OpenCode ticket pilot](../agents/OPENCODE_UI_PILOT_PROMPT.md) when choosing that coding model; the existing Gemini worktree/immutable045daa5/localbranch are specified. No new provider/LINE/key/login/schema setup is required for the unused encrypted row-evidence component. Agent work still includes actual atomic publication/query/combined UI; existing real-source approval/live free-provider/OA/production checks stay deferred. Helper/crypto test passes are not manual/live acceptance.

7October GEM-REV-05 adds no configuration requirement. User can relay the [20-package Round5 prompt](../agents/GEMINI_UI_UX_ROUND5_PROMPT.md) to Gemini in its existing worktree; [actual Round4 review](../reports/GEMINI_UI_UX_ROUND4_REVIEW.md) leaves frontend/backend synchronization and combined acceptance as agent work. No request for new LINE/provider/password/schema setup is made for this assignment. Existing real corpus/live OA/free-provider/production manual checks remain deferred; no live pass is implied by helper tests.

นี่เป็น checklistสะสมตามคำสั่งให้ทำimplementationต่อแล้วรวมmanualstepsตอนท้าย **ยังไม่ใช่ final handoff**. Agentต้องทำtasksที่เป็นcode/testให้เสร็จเองก่อน ไม่โยนช่องว่างimplementationให้ผู้ใช้ตั้งค่าแทน

7October STR-00Q-1 requires no new human setup: [pure query/reference preparation](../reports/STRUCTURED_QUERY_EVIDENCE_REPORT.md) has no runtime/SQL/mode-readiness change. [Gemini Round4 prompt](../agents/GEMINI_UI_UX_ROUND4_PROMPT.md) is prepared for the user's existing relay workflow; review fixes, backend snapshot synchronization, missing M9 contracts and final combined acceptance are agent implementation work. No new university key, upload, account or configuration is requested here; prior live/corpus/deployment rows remain deferred.

7October TKT-READ-02 scoped search/pagination requires no new user configuration, migration, key or account. Root owns backend acceptance; Gemini wiring and combined search/mobile/error flow are agent work. Matching scoped ticket totals do not replace analytics. [Evidence](../reports/TICKET_SEARCH_PAGINATION_REPORT.md).

| สิ่งที่ต้องทำเอง | เมื่อระบบส่วนใดพร้อม | หลักฐานที่ต้องได้ |
|---|---|---|
| เลือก/create Zen/OpenRouter freeaccountและAPIkeys | PRV-01…04 | แอดprovider/keyผ่านDashboard ไม่ส่งkeyในlog |
| เลือกfreemodel/capabilitiesและจัดfallbackpriority | PRV-03/04 | ปุ่มtestต่อmodelผ่านจริง, catalogfreeverified, saveorderตรงbackend; paidยังdisabled/FREE_ONLY |
| ดูแล embedding service เมื่อใช้ระบบ/ย้าย deployment | EMB-01…05 / deployment | E5 CPU/384ถูกเลือกและทดสอบlocalแล้ว; ไม่ต้องเพิ่มModelผ่านUI. Start `services/embedding/run.py`, configurecache/URL; remoteHTTPS+serverkey/private networking. Weightsย้ายแยกจากNext.js/Git; actualnew-hostThai/English/passage/healthchecks. C:เก็บไว้; ลบเฉพาะselectedmodelcacheเองได้หลังตรวจใช้งานD: |
| ตรวจและapproveเอกสารshortlist | IMP-04/STR-02 | officialprovenance/year/audience/dates/authority/sensitivity/OCR/AMENDSถูกต้อง; firstPDFRAG+current/historicalcitations |
| ตั้งcurrentHTTPSwebhookURLทั้งStudent/StaffOAและUseWebhook | durable/freeflowพร้อม | Verify200ทั้งสองchannel, invalidHMACrejected, freshmessagesผ่านจริง |
| ผูกStaffLINEกับactiveStaffaccount/department | ADV-01 | boundauthorizedrecipientเท่านั้น; unrelateddepartmentไม่รับalert; sensitivepayloadไม่มีdetailleak |
| ทดสอบจริงFlowA–Fผ่านLINEและDashboard | FINAL-01 | FAQ/troubleshoot/escalate/HUMAN/newtopic/importupdateครบ; ไม่ตอบซ้ำกับOAautoreply |
| เลือกproductionhosting/domain/Authstaff/storage/backupoperator | FINAL-01deploymentcontract | workerprocesses/lifecycle/verifiedTLS/queueobservability/backuprestore/rolesพร้อม |
| ตรวจ private Storage bucket `knowledge-originals` ใน production deployment | IMP-01C-STORAGE/final deployment | public=false, limit20971553bytes, MIMEapplication/octet-stream, ไม่มี browser object policies; backend service keyอยู่เฉพาะserver; actualrole-denial/restore test. Local+DEVELOPMENT setup/byte-recovery/role-denial passed6October; production/backuprestore evidenceยังแยกและpending |
| จัด runtime และไฟล์สำหรับ parser ใน hosting ที่เลือก | IMP-01B-CHILD/FINAL deployment | Node24+, production dependenciesรวมtsx, checked-in child/import sources; actualall-formatprocess testในdeployment, boundedconcurrency/15s/256MiBJSheap/32MiBstdout; standalone packagingและOSresourceconfigurationต้องตรวจจริง |

คำสั่งexact/หน้าจอขั้นตอนจะอัปเดตหลังแต่ละtaskสร้างroute/UIจริง. ตอนนี้ห้ามบอกว่าquotaAPI/paidtoggle/importapproveพร้อมเพียงเพราะมีdesign. Stablewebhookpathsคือ `/api/line/student/webhook` และ `/api/line/staff/webhook`; domainรอตามserver/tunnelจริงตอนทดสอบ

บัญชีDashboarddevelopmentเก็บlocalใน `.superpowers/staging/dev-staff-credentials.json`; ไม่อยู่Git/READMEและไม่แสดงpasswordในreport. ผู้ใช้เปลี่ยน/เลือกproductionstaffaccountsภายหลังโดยไม่ต้องลบdevelopmentevidence

ถ้าmanualข้อใดยังไม่ผ่าน ให้finalreportระบุ `MANUAL_PENDING` พร้อมผลที่ทำแล้ว ไม่เดาว่าผู้ใช้configuredครบ และไม่ใช้elapsedtimeแทนanswer/approval

6October IMP-03A private draft UI is implemented and tested. It can retain unfinished metadata and warning choices; it does not approve/index the shortlist. Version-target resolution/publication remains root implementation work before asking the university to perform the corpus approval row. No additional user configuration is needed for this slice; existing keys/originals/accounts stay local.


6October version-choice checkpoint: DEVELOPMENT has all19initial family reference rows; this is not19approved documents or complete real corpus coverage. Save reviewed metadata before version lookup, select the applicable action and exact target explicitly, and review scope/source/dates/sensitivity independently. Approval/published data effects remain agent implementation work; human document review follows after those required gates. No additional manual configuration was required for this resolver component. [Evidence](../reports/IMP_VERSION_RESOLVER_REPORT.md).

6October located preparation checkpoint requires no additional user configuration: all5format private plans and deliberate saved review-v2 acknowledgment passed actual browser checks. This acknowledgment does not approve or publish; the15source shortlist remains pending university review. Approval/relationship/M8 code remains root work under PUB-01…05, not a human configuration task. [Evidence](../reports/IMP_LOCATED_PREPARATION_REPORT.md).


6October PUB-01/02 private backend requires no additional human configuration. Local+DEVELOPMENT27migrations and runtime retention checks passed; actual synthetic publications/original recovery remain isolated private QA evidence. Approval API/UI and relationship behavior are still agent implementation work, not tasks for the user. Real university shortlist review, live free generation/OA flows and production checks remain pending. [Evidence](../reports/IMP_PUBLICATION_BACKEND_REPORT.md).


6October PUB-03 requires no additional human setup. Complete synthetic relationship/date/legacy drift and actual paused-LINE publication fences passed locally; guardedDEVELOPMENT28migrations remain development evidence. Approval UI/API is agent work; real corpus review and live final flows remain pending. [Evidence](../reports/IMP_RELATIONSHIP_RETRIEVAL_REPORT.md).

6October IMP-PDF-01 requires no new configuration or re-upload. Both user-reported originals were re-analyzed successfully through authenticated APIs; reload the import page to see READY extraction. Check located table/page warnings against the original before approval. This is review of source quality, not a permission needed for independent implementation. [Recovery evidence](../reports/IMP_PDF_RECOVERY_REPORT.md).

6October PUB-04/05 approval API/UI requires no additional setup: deliberate INTERNAL synthetic approval, unknown-response receipt recovery, exact replay/retained originals and three-role desktop/mobile checks passed in isolated QA. Current mode is reviewed RAG; STRUCTURED/BOTH stay unavailable until M8 implementation. Published catalog remains agent work, not a human task. Real university review/live free generation/OA/production items above remain deferred. [Evidence](../reports/IMP_PUBLICATION_APPROVAL_REPORT.md).

6October CAT-01/UX-01A adds private approved family/history/detail and bound metadata preparation without new configuration/migration/provider keys. Backend actual-PG and compiled three-role HTTP/private-original checks are in the [backend report](../reports/KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md). Gemini is implementing Dashboard presentation in its isolated worktree; submitting its local commit/report and root combined acceptance are development handoff steps, not a new university configuration task. Existing real corpus/live OA/free generation/production rows above remain pending. Latest backend success does not close UI usability or fullV1.

7October STR-01A-0 requires no new user setup: pure validators/immutable metadata cover seven fixed datasets, all installed:false. Do not select STRUCTURED/BOTH as working publication modes yet; fixed SQL/mappers/reviewed preview/atomic persistence/exact query proof remain agent work. Root completed scoped fixes/tests/review in the [component report](../reports/STRUCTURED_PAYLOAD_CONTRACT_REPORT.md). No new key, model download, migration, original re-upload or real source approval was performed. Existing final live/corpus/production items stay pending while independent implementation continues.

7October STR-01B-0 adds no human setup: [pure mapping preparation](../reports/STRUCTURED_MAPPING_PREPARATION_REPORT.md) passed scoped/full unit/type/lint, all installed:false. Saved review-v3, fixed SQL/authorized preview/publication/query integration remain agent work. No new key/upload/real source approval; existing live/corpus/production checks remain deferred. Gemini reported443c227 for root review; it is not yet combined acceptance.

7October GEM-REV-02: user already submittedGemini443c227. [Round2prompt](../agents/GEMINI_UI_UX_CONTINUATION_PROMPT.md) can be sent directly; review fixes, missingbackendcontracts and combinedUIacceptance are agent work, not new universityconfiguration. No livewrite/corpusapproval is requested for this planning task.

7October STR-01B-1 adds private encrypted review3/source-bound preview without new human configuration. [Evidence](../reports/STRUCTURED_REVIEW_PREVIEW_REPORT.md) records backend/CAS/auth/limits and isolated compiled HTTP; mapping UI/fixed7schema/atomicBOTH/exactquery remain agent work. No new key/upload/model/migration/real source approval. STRUCTURED/BOTH publication stays explicitly unavailable until those contracts and acceptance are complete. Existing deferred live/corpus/OA/production rows remain.

7October STR-01A-1 requires no new user setup. Root authored and tested the seven fixed tables/private provenance in a newly owned disposable database:29migration replay/foundationRLS/121actualPG+15existing RAG compatibility/1621unit/type/lint/advisors. [Evidence](../reports/STRUCTURED_SCHEMA_COMPONENT_REPORT.md). Normal local0/7 and remote schema are not migrated; all registry installed:false. Normal installation after integration, authenticated row-envelope/atomic STRUCTURED/BOTH/exact queries and combined Gemini UI remain agent work, not a request for human migration/configuration now. Existing real-source review/live OA/free generation/production checklist remains deferred.
