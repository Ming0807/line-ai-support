# สิ่งที่ผู้ใช้ต้องทำตอนส่งมอบทดสอบจริง

อัปเดต25ตุลาคม2026 หลังผู้ใช้สั่งลุยต่อ: rootเปิดlocal:aiไว้ให้พร้อมแล้ว ผู้ใช้ยังเป็นผู้ทดสอบคำตอบ/LINEจริงภายหลังตามDEC166. ไม่ยิงmodeltestsเพิ่ม และchecklistนี้ไม่ใช่การประกาศV1ผ่านการตรวจรับจริง

## Runtime ตอนนี้และคำสั่งที่ใช้

ROOT-LOCAL-READY-01เริ่ม25October2026ประมาณ21:24Bangkokและคงsessionไว้: **server, E5,4workers,tunnelกำลังรัน**. Local/publicsignedempty-event200และinvalid401ทั้ง2OAผ่านครบ8checks. Workerobservationsสด4ตัว; metadataread-onlyถึง21:27พบgenerationattempts0หลังเปิด ไม่รันHermescheck. URLด้านล่างใช้เฉพาะรอบนี้; เปิดtunnelใหม่ต้องคัดลอกจากREADYใหม่

- Dashboard: http://127.0.0.1:3000/login
- Student webhook: https://bookmarks-quick-efficiently-submissions.trycloudflare.com/api/line/student/webhook
- Staff webhook: https://bookmarks-quick-efficiently-submissions.trycloudflare.com/api/line/staff/webhook
- Local log: `.superpowers/staging/local-test/run-2026-10-25T14-24-50-032Z.log` ผ่านการปกปิดcredentials. หยุดด้วย`pnpm local:stop`;ไม่รันอีกsessionซ้อน

เมื่อถึงรอบทดสอบธรรมชาติของAI ให้ใช้คำสั่ง **pnpm local:ai** จากโฟลเดอร์โปรเจกต์ คำสั่งนี้เปิดเว็บ, offlineE5,Inbox/AI/Outbox/Incidentsและtunnel พร้อมเปิดnaturalassistantเฉพาะsession เป็นpreviewของโมเดลที่ยังNOT_QUALIFIED ไม่ใช่ release promotion และจะตอบ LINE จริง/ประมวลผลฐานDEVELOPMENTจริง ไม่ใช่ sandboxสังเคราะห์

21ตุลาคม root คัด Gemini 3.5 Flash Lite เป็นตัวหลักเพียงตัวเดียวและตรวจ registry ปัจจุบันแล้ว; อีก17ตัวปิดไว้ ไม่ได้ลบ. Candidate `scopeFirst`/`ragCoverage` ยังไม่เปิดในคำสั่งนี้ เพราะ actual target ยังมีข้อผิดพลาดและ timeout. ห้ามถือผล model-test HTTP200 หรือ technical tests ว่าคุณภาพการคุยผ่านแล้ว; งานแก้/ตรวจรับยังเป็นของ root ไม่ย้ายให้ผู้ใช้ทดสอบแทน.

- pnpm local:staff: natural assistantOFF, legacy supportAIยังON สำหรับงานStaffเดิม
- pnpm local:test: ใช้ค่าassistantที่ตั้งไว้เดิม; pnpm local:test --hermes-check เพิ่มเฉพาะHermes synthetic2turncheck ไม่เปลี่ยนตัวตอบLINE
- pnpm local:check: ตรวจconfiguration/cache/database ไม่เปิดservicesหรือเรียกprovider
- pnpm local:stop หรือCtrl+C: หยุดเฉพาะownedsession

รายละเอียดใน [local instructions](LOCAL_TEST.md) บัญชีdevelopmentเดิมอยู่ไฟล์ignored .superpowers/staging/dev-staff-credentials.json บนเครื่องนี้ เปิดเอง ไม่ส่งpasswordในchat/docs

## ขั้นตอนรวมสำหรับทดสอบระบบจริง

1. รอการส่งมอบจากroot แล้วเปิดlocal:ai รอREADY เก็บterminalไว้เพื่อดูlog ปัจจุบันมีapprovedPUBLIC5ฉบับ (เพิ่มระเบียบเทียบโอนที่ตรวจครบ5หน้า/22chunks) ไม่ใช่ทุกไฟล์ในdocuments/yruพร้อมตอบ
2. LoginDashboard→Providers ตรวจmodel/order/statusและFree-account permissionตามบัญชีจริง Freshread-onlyregistry25October21:27ยืนยันGemini3.5FlashLite/FREE_ONLY/25s/modelrev3 และmanagedaccountattestationACTIVEถึง24November2026 12:08Bangkok; ไม่มีการต่ออายุหรือแก้configurationในรอบstartupนี้. นี่คือoperatorattestationไม่ใช่การตรวจvendorbillingจริง. ต่อผ่านSuperAdminUIเมื่อจำเป็น ไม่หมุนบัญชี/keyเพื่อหลบquota ไม่เปิดpaidหรือ17ตัวที่ยังไม่qualified
3. ตั้งWebhookURLจากREADYทั้งStudent/StaffในLINE Developers กดVerify/UseWebhook ปิดOAauto-replyที่ตอบซ้ำ Quicktunnelเปลี่ยนURLเมื่อเปิดใหม่
4. StaffLoginของแต่ละคน→Settings→สร้างbindingcode→ส่งให้StaffOAภายใน10นาที ตรวจdepartment/roleและสถานะbindingก่อนทดสอบแจ้งเตือน
5. ทดสอบStudentกับStaffของตน ไม่ใช้ข้อมูลส่วนตัวจริง สองStaffลองclaimเคสเดียวกันต้องมีผู้ชนะคนเดียว Dashboardแยกประวัติ/ร่างตามเคส StaffLINEต้องกดเปิดเคสก่อนพิมพ์ ข้อความแจ้งเตือนไม่เปลี่ยนเคสที่เลือกเอง
6. ตรวจทั้งStudentOA/StaffOA/Dashboard→Logs/Usage/Tickets HTTP200หรือmodeltestผ่านอย่างเดียวไม่ยืนยันsemantic/source/deliveryจริง หากผิดให้เก็บเวลา/รหัสเคส/ข้อความที่ไม่ลับ ไม่ส่งcredentials

## ข้อความและผลที่ต้องตรวจใน LINE จริง

| Flow | สิ่งที่ทำ | ผลที่ต้องเห็น |
| --- | --- | --- |
| A | ถามFAQที่มีคู่มือทางการอนุมัติ เช่นคู่มือWi-Fi/Passportใน4แหล่งปัจจุบัน | ตอบตรงคำถามพร้อมอ้างแหล่งจริง ไม่สร้างticketเมื่อข้อมูลพอ ไม่ใช้เอกสารheldเป็นauthority |
| B | แจ้งWi-Fiมีปัญหา ตอบรายละเอียด/ลองขั้นตอนตามหลักฐานที่ใช้ได้ | ถามเฉพาะที่ขาด จำขั้นตอนเดิม ไม่แนะนำล้างการตั้งค่าโดยขาดprerequisites; แก้ได้ต้องได้การยืนยันของผู้ใช้ ไม่ถือว่าส่งคำแนะนำ=solved |
| C | แจ้งยังแก้ไม่ได้ในบริการมหาวิทยาลัยแล้วกดยืนยันส่งต่อจากข้อเสนอที่ส่งถึงจริง | สร้างticketITครั้งเดียวพร้อมบริบท แจ้งเฉพาะStaffที่ผูกOAและมีสิทธิ์ ไม่ส่งต่อจากAI/networkerrorอย่างเดียว |
| D | Staffรับ/เปิดเคส/ตอบ Studentตอบเรื่องเดิม แล้วStaffresolve/close | HUMANเดิมAIไม่ตอบแทรก ถูกผู้รับเดียว ข้อความครบ; สลับเคสปลอดภัย ปุ่มเก่า/expired/ต่างฝ่ายไม่ส่งผิดเคส |
| E | ขณะHUMANยังเปิด ถามเรื่องใหม่ เช่นเวลาเปิดห้องสมุด | แยกAIconversation ไม่แก้HUMANเดิม ถ้าแหล่งเวลาเปิดยังheldต้องไม่เดาชั่วโมงจากความจำ |
| F | Importรุ่นใหม่ที่มีหลักฐานครบ review/previewแล้วapprove replacement | ก่อนapproveไม่เผยแพร่; รุ่นปัจจุบันตอบใหม่ รุ่นเก่าถามย้อนหลังได้ ประวัติไม่หาย ไม่มีDDLจากเอกสารใหม่ |

เพิ่มเติม: คุยทั่วไป/คำนวณ/เขียนข้อความ/ติดตามบริบทจริง, คำถามยาวและคำตอบหลายLINEmessagesต้องครบ,staff2คนแย่งรับ,studentหลายคนพร้อมกัน,staffเปลี่ยนเคสขณะstudentตอบ,LINE/AIล่มแล้วretryไม่ซ้ำหรือข้ามคน ต้องตรวจหลังtechnical/model acceptanceตามแผน ไม่ยกcomponentpassมาทดแทน

## ข้อมูลเอกสาร — root รับผิดชอบตรวจและนำเข้าต่อ

DEC172: ผู้ใช้ยืนยันการใช้ข้อมูลสาธารณะและอาจารย์อนุญาตแล้ว ไม่ต้องขอownerapprovalซ้ำ ตารางเดิมด้านล่างเป็นรายการค้นข้อเท็จจริงของroot ไม่ใช่งานที่ผู้ใช้ต้องตอบก่อนเดินต่อ. ตรวจปฏิทิน/แบบฟอร์ม/ห้องสมุดและบันทึกnormaldrafts5รายการแล้ว26ตุลาคม ดู[ผลตรวจปัจจุบัน](CORPUS_DECISION_PACKETS.md). Publicationยังไม่มีเพิ่ม: ต้องแก้การรองรับunknown dates/public blank templatesและcorrectionของlocated extractionอย่างตรงไปตรงมา ไม่เดาวันที่หรือเปลี่ยนชนิดเอกสารเพื่อหลบguard. [Technical reviewเดิม](../../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md)เป็นประวัติตามวันที่

| กลุ่ม | คำตัดสินที่ยังไม่มีหลักฐาน |
| --- | --- |
| Registrar: YRU010/011 | governingcalendar/amendments/ขอบเขตregular-weekend; วันในPDFบางรายการมีข้อสงสัย ห้ามแก้ปีเอง |
| Registrar: YRU007/034/047/027 | อัตราค่าธรรมเนียมแยกprogram/cohortและrowผิดรูป, แบบเกินหน่วยกิต/ช่วงยื่น, currentnessของformaltransferguideและfeeinstrument2565ที่อ้าง50บาท, title/sensitivityของblankform;43วันกับ30/15วันเป็นคนละpath ไม่ใช่ข้อขัดกันที่พิสูจน์แล้ว |
| StudentDevelopment: YRU149/166 | currentamendments/annualcriteria/transferdiscrepancyและประกาศรายcohort; indexเป็นdiscoveryไม่ใช่กฎเดียวครอบทุกคน |
| Library: YRU182 | ยืนยันชั่วโมง/ข้อยกเว้น/เบอร์ติดต่อหน่วยงานแล้วจากเว็บทางการ; วันประกาศไม่ทราบ ต้องรองรับข้อมูลundated ไม่ใช้วันcaptureแทนหรือขอผู้ใช้อนุมัติเบอร์ซ้ำ |

บทความMAC/Passport/Wi-Fi/ห้องstudyroomที่อนุมัติแล้วรับรองเฉพาะข้อความอ้างแหล่ง ไม่รับรองบริการเปิดทำงานจริงหรือเนื้อหาattachmentที่ยังเข้าไม่ได้ ถ้าเพิ่มเอกสารให้ใช้normalreview/publicationservice ห้ามautoapproveทั้งโฟลเดอร์

## เมื่อต้อง deploy ภายหลัง

ยังไม่ต้องdeployVercelตอนทดสอบlocal เจ้าของระบบเลือกhost/domainและผู้ดูแลbackup จากนั้นตรวจworkerlifecycle/scheduling/verifiedTLS/roles/restoreจริง:

- Node24+, parserchildและtsxครบในpackage; all5formatprocessจริงและOSresource/concurrencylimits
- E5offlinecacheเดิม/384/URL/auth/private networkingบนhostใหม่ ไม่มีautomaticweightdownloadหรือเปลี่ยนembeddingcohort
- PrivateStorage bucketknowledge-originals:public=false,limit20971553bytes,MIMEapplication/octet-stream,ไม่มีbrowserobjectpolicies; servicekeyserver-onlyและbackup/restore/role-denialจริง
- StaffAuth/department/sensitivity, production provider-account status/FREE_ONLY/quota, retry/queueobservability, backuplifecycleและrestore
- เปลี่ยนcredentialsสำหรับproductionผ่านsecretconfiguration ไม่commit.env/accountpassword/privateoriginals

Deployment/actualOA/sourceaccuracy/publication evidenceยังไม่ถูกนับว่าผ่าน; sourceownerpermissionได้ตามDEC172แล้ว [บอร์ดงานปัจจุบัน](../tasks/V1_TASK_BOARD.md) เป็นสถานะหลัก [สำเนาchecklistเดิม](FINAL_SETUP_CHECKLIST_HISTORY_2026-10-20.md) เก็บbytesเดิมและURLเก่าทั้งหมดเป็นประวัติ

22ตุลาคม: ทดลอง typed guided advice เฉพาะฐานทดสอบแล้ว ไม่มีการเปิดใช้ใน local:ai/normal workers. Actual A09/A04 ตอบสำเร็จแต่ยังไม่ผ่านคุณภาพ (คำอธิบาย cache และรักษาความหมายเรื่องด่วน). Current3,125unit/type/changed-file lint/buildผ่าน ไม่ใช่การส่งมอบให้ผู้ใช้เทส; runtimeยังหยุดและไม่มี current webhook URL.

23October update: routing outages now preserve the pending original message and explain temporary AI unavailability with owned context-choice buttons. This does not qualify the model. Actual network-phase diagnostic completed TLS/request finish at~192ms but received no HTTP headers before15s; no key/timeout/provider setting change or inference retry. User manual checks remain deferred; no new webhook URL while app/tunnel stopped.

## 25October Hermes/QA continuation — controlled core only

Latest human will test Gemini conversations later; no new generation tests were run during ROOT-GLM-HERMES-01 or ROOT-HERMES-STAFF-UI-01. Staff Copilot is now wired into the HUMAN-case Dashboard. It requires reply permission (assigned staff or scoped supervisor), current revision, active staff scope, YRU_AI_ENABLED=true and the existing approved FREE_ONLY model. The cached native runtime starts only on an explicit draft request. It cannot publish, change tickets or send to Student. Complete evidence and a draft are shown for human editing; apply only copies into the existing composer. A controlled child/bridge PASS does not qualify an actual Hermes/model draft.

Commands added for later explicit operator use (none are auto-run by local:ai):
- `pnpm hermes:copilot --staff-id=<UUID> --ticket-id=<HUMAN_TICKET_UUID> --revision=<CURRENT_REVISION>` — explicit model-backed prototype; user-deferred live run.
- `pnpm qa:prescreen <ARTIFACT_DIRECTORY>` — offline only, queues artifact-bound flags for human review.
- `pnpm qa:knowledge-gaps --staff-id=<SUPER_ADMIN_UUID>` — bounded read-only aggregate; no inference, raw student questions or LINE identities in output. Category hints are private analytics heuristics, not proof that knowledge is absent.

Normal FlowA–F/corpus approvals/deployment remain deferred. Use webhook URLs printed by a freshly started local:ai session when testing; no server/tunnel was started during this audit.

For later Staff Copilot manual acceptance: run existing `pnpm local:ai` (no separate Hermes daemon command), open an accepted HUMAN case as its assigned staff or scoped supervisor, choose “Hermes · ช่วยร่างคำตอบ” → “สร้างร่าง”. Compare the complete draft with displayed evidence/references, edit it and apply to the reply composer; confirm nothing sends until the normal Send button is pressed. Also test cancellation, switching cases during generation, retaining a previously typed reply, and a source/case being changed by another authorized operator. A draft over5,000 stays visible in full but must be edited before applying. No verified source means no draft. Missing native cache/unavailable primary/busy capacity fails safely. Actual native/model execution and real LINE delivery remain unverified here; the native Windows cache is not a serverless deployment claim.
