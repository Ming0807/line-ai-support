# สิ่งที่ผู้ใช้ต้องตั้งค่า/ยืนยันก่อนใช้งานจริง

นี่เป็น checklistสะสมตามคำสั่งให้ทำimplementationต่อแล้วรวมmanualstepsตอนท้าย **ยังไม่ใช่ final handoff**. Agentต้องทำtasksที่เป็นcode/testให้เสร็จเองก่อน ไม่โยนช่องว่างimplementationให้ผู้ใช้ตั้งค่าแทน

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
