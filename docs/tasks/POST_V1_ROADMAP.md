# Post-V1 continuation roadmap — ตรวจโปรเจ็ค + แนวทางต่อยอด + task

จัดทำ25ตุลาคม ปรับสถานะ26ตุลาคม2026โดยroot. Original30มีหลักฐาน29/30+19/20+gatesตามDEC162; representative21executionsครบแต่A10ทั้ง3รอบเป็นsafe partialตามDEC167. ใช้คู่กับ[บอร์ดงานV1](V1_TASK_BOARD.md)และ[final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). งานHermes/QAส่งมอบเพิ่มเติมตามROOT-CLOSEOUT-01 ไม่ถือว่าปิดV1รับมอบจริง

## สถานะโปรเจ็ค ณ ตอนนี้ (สรุปตรวจ)

**ผลตรวจล่าสุด26ต.ค.: original30historicalคงเดิม; repeatedA10เป็นsafepartial3รอบไม่ใช่usefulnessPASSตามDEC167. StaffDashboardCopilotต่อแล้วตามDEC168;ROOT-CLOSEOUT-01ผ่าน657registeredPG/3272unit/type/lint/buildและกำลังเก็บlocalcommit. Actualnative/modeldraft/LINEยังรอผู้ใช้ ไม่ใช้คำกล่าวgitcleanของcheckpointเดิมเป็นสถานะปัจจุบัน.**

**งานฐานตามรายงานGLMและrootaudit:**13modulesตามmaster§3,43migrations/74RLStables,import5formats/atomicpublication,incidents/batchreply,Providerorder/test/quota/observationsและUIconsistency. ตัวเลขเดิม3184unit/645ownedPGเป็นหลักฐานตามsourceขณะนั้น; ผลล่าสุดอยู่บอร์ดงาน. Original30historicalPASS ส่วนrepeatA10ห้ามนับsafe partialเป็นคำตอบครบ. Branch`feat/yru-v1-final-polish`;ไม่ใช้คำว่าagentงานจบทั้งหมดหรือgitcleanจากcheckpointเก่าแทนสถานะปัจจุบัน

**งานข้อมูลและตรวจรับที่ยังไม่ปิด:** งานส่งมอบโค้ด/รวมหลักฐานที่rootทำต่อได้อยู่ROOT-CLOSEOUT-01ในบอร์ด ส่วนรายการต่อไปนี้ยังต้องมีข้อมูลจริงหรือการตรวจรับที่ผู้ใช้เลื่อนไว้
1. Flow A–F จริงบน LINE (ผู้ใช้ทดสอบเอง ตามตารางใน FINAL_SETUP_CHECKLIST)
2. Corpus จริง: อนุมัติแล้วเพียง 5 ฉบับ PUBLIC; 9 รายการ held รอเจ้าของข้อมูลตัดสิน; รวบรวมไว้ 187 รายการ
3. Guarded production activation + deployment จริง (host/domain/backup ยังไม่เลือก)
4. **คุณภาพบน corpus จริงยังไม่เคยวัด** — acceptance ที่ผ่านมาใช้ synthetic fixture ของ harness เท่านั้น
5. Gemini free-account attestation ปัจจุบันถึง **24 พ.ย. 2026 12:08 กรุงเทพฯ** (ตรวจregistryแบบอ่านอย่างเดียว25ต.ค.; ไม่ใช่การยืนยันvendorbilling) — ไม่ต่ออายุ = inference หยุด (ไม่มี fallback ที่ qualified)
6. เอกสาร matrix/report บางส่วนยังเขียนสถานะก่อน DEC-162/163

## แนวทางต่อยอดแบบละเอียด (4 เฟส)

### เฟส 0 — งานเก็บระเบียบเดิมปิด25ตุลาคม; รอบHermes/QAใหม่แยกROOT-CLOSEOUT-01

| Task | สิ่งที่ทำ / ผลลัพธ์ | ข้อกำหนดที่โยง |
| --- | --- | --- |
| HYG-01 ต่ออายุ Gemini attestation | **เสร็จ:** ต่อผ่าน saveFreeAccountGrant จริง (grant rev1, audit AI_FREE_ACCOUNT_CONFIRMED) — หมดอายุใหม่ **24 พ.ย. 2026**; สคริปต์รอบหน้า `scripts/ai/renew-gemini-free-grant.ts` | CH029, USR-FREE, DEC-146 |
| HYG-02 อัปเดต matrix/report ตาม DEC-162/163 | **เสร็จ (ส่วน matrix):** CH023/CH029/CH031/CH069 อัปเดตแล้วใน commit 51010b5; V1_AUTOMATED_ACCEPTANCE_REPORT ยังไม่ได้แตะ — โยนไปรวมกับ QUA-01 เมื่อมีผล corpus จริง | CH066/071, DEC-149 |
| HYG-03 ไล่ commit งานเก่าที่ค้าง | **เสร็จ:** commit 6 ก้อน (โค้ด 275/corpus 235/docs 107/เศษ) ผ่าน scan ทุกก้อน — **git status = 0 ไฟล์ค้าง ครั้งแรกของโปรเจ็ค** + tag `checkpoint/v1-agent-complete` | WORKING_PROTOCOL |
| HYG-04 เก็บกวาดสิ่งแปลกปลอม | **เสร็จ:** ลบไฟล์ขยะ `b.memoryMB-a.memoryMB)` แล้ว · `output/` (playwright) เพิ่มใน .gitignore · sdd report ที่เหลือ commit แล้ว | — |

### เฟส 1 — ปิด V1 จริง (นำโดยผู้ใช้ + agent สนับสนุน)

| Task | สิ่งที่ทำ / ผลลัพธ์ | ข้อกำหนดที่โยง |
| --- | --- | --- |
| V1L-01 ทดสอบ Flow A–F จริง | ผู้ใช้รัน `pnpm local:ai` (PowerShell) → ตั้ง webhook จาก READY → ไล่ตาราง Flow A–F + เคสเสริม (long message/multi-staff/concurrent/retry) → เก็บหลักฐานเวลา/รหัสเคส; defect ที่เจอกลับมาเป็น RED ใหม่ของ agent | CH069, FINAL_SETUP_CHECKLIST |
| V1L-02 ตัดสิน corpus 9 รายการ | เจ้าของข้อมูล (Registrar/StudentDev/Library) ตอบคำถามในตาราง checklist → approve ผ่านหน้า review ปกติ → เป้าหมาย: PUBLIC จริงเพิ่มจาก 5 เป็น 10+ ฉบับ | CH061/062/063, SOL-05 |
| V1L-03 guarded activation | หลัง Flow A–F ผ่าน: เปิด natural assistant ถาวรใน DEVELOPMENT → สังเกต usage/logs จริง → แล้วค่อยพิจารณา production | SOL-07, DEC-143 |
| V1L-04 deployment จริง | เลือก host/domain + ผู้ดูแล backup แล้วไล่ PRODUCTION_RUNBOOK: Node24+/parser child/E5 cache ย้าย+offline/Storage bucket private/worker lifecycle/TLS/roles/**restore drill จริง**/credential ผ่าน secret config | CH001/020/067, runbook |

### เฟส 2 — ยกระดับหลังมีของจริง (agent เป็นเจ้าของส่วนใหญ่)

| Task | สิ่งที่ทำ / ผลลัพธ์ | ข้อกำหนดที่โยง |
| --- | --- | --- |
| QUA-01 quality bracket บน corpus จริง | สร้าง frozen fixture ใหม่จากเอกสาร PUBLIC จริง (คำถามจริง+คำตอบที่เอกสารรองรับ) แล้ววัดด้วยเกณฑ์เดิม 27/30+18/20 — ปิดช่องว่าง "synthetic-only acceptance"; รวมถึงเช็ค A12-discovery กับปฏิทินจริง | CH063/069, DEC-149 |
| QUA-02 qualified fallback model | **BLOCKED_BY_AUTHORIZATION (DEC-164):** หลักฐาน registry — สองโมเดลที่เหลือในบัญชี Gemini (3.8/flash-latest) supports_json=false ใช้กับ pipeline strict-JSON ไม่ได้; fallback ที่ qualified ต้องมาจาก provider อื่น = **ผู้ใช้ยืนยัน (DEC-165): เลื่อนไปภายหลัง** — จะเพิ่ม provider แน่นอนเมื่อถึงเวลา ตอนนี้ห้าม agent เปิด/ถามซ้ำจนกว่าผู้ใช้เปิดหัวข้อ | CH029 §22, USR-FREE |
| QUA-03 ทนทาน latency spike | **คำตอบชั่วคราว = availability path ตามดีไซน์ (DEC-164):** ไม่มี failover target ในบัญชี (ดู QUA-02) spike >25s จึงตกเป็น fallback ตรงไปตรงมา; ทางเลือกอนุมัติ ceiling 45s/retry ยังคงรอผู้ใช้ (provider เพิ่ม = ตาม DEC-165 เลื่อนภายหลัง) | DEC-161/162 |
| QUA-04 A12-discovery หยุดกะพริบ | **เสร็จ (DEC-164):** กลไก = planner แปลงชื่อเหตุการณ์เป็น title selector + เลือก STRUCTURED ทั้งขาด required — แก้ด้วย backend reroute ไป deterministic discovery (calendar/services) RED2→GREEN11/11 + gates exit0 + live target12b 3/3 (A12=STRUCTURED_DISCOVERY พร้อม citations) | CH018/031, DEC-157 |
| PRF-01 ANN + ประสิทธิภาพ corpus จริง | CH019 เลื่อน ANN ไว้: เมื่อ chunks จริงเป็นหมื่น+ ให้ benchmark pgvector IVFFlat/HNSW เทียบ exact cosine ก่อนเปลี่ยน cohort; รวม E5 warm-cache strategy ตอน deploy | CH019, EMBEDDING_DESIGN |
| PRF-02 โหลดจริงซ้ำ | ทำ controlled load A–J บน corpus จริง + worker concurrency จริงของ host ที่เลือก | SOL-06 |
| UX-02 UX รอบถัดไปจากของจริง | เก็บ feedback จากการใช้จริง: loading UX บน LINE, Analytics/Usage กับข้อมูลจริง, ช่วย Staff เข้าใจ quick-reply/สถานะ, ม.สอบ ZOOM/contrast ตาม DEC-159 พื้นฐานเดิม | CH051/058, DESIGN.md |
| OPS-01 backup/restore drill ประจำ | ตารางเวลา backup + ซ้อม restore รายเดือน + credential rotation policy | runbook, CH060 |
| OPS-02 security audit รอบที่ 2 | **เสร็จ (ส่วน scan):** credential scan ต้นไม้เต็ม 1,576 ไฟล์ = สะอาด (เจอเฉพาะ fixture/ชื่อไฟล์), .env ไม่ถูก track; advisors/RLS ไม่มี migration ใหม่นับจากรอบตรวจล่าสุด (43 migrations เท่าเดิม) | CH017/070 |

### เฟส 3 — ส่วนขยายหลัง V1 (ต้องมหาวิทยาลัยเลือก/อนุมัติ ตาม CH073)

| Task | แนวทาง | เงื่อนไขเปิดงาน |
| --- | --- | --- |
| EXT-01 Paid generation opt-in | UI ให้มหาวิทยาลัยเปิด paid แบบ explicit (cost_mode ALLOW_PAID path มีรากไว้แล้ว) + budget caps + แจ้งต่อ usage | มหาวิทยาลัยอนุมัติงบ + ตั้ง billing; USR-FREE |
| EXT-02 Corpus program | ขยายจาก 187 รายการที่รวบรวม: ใช้ import-assistance ช่วย triage → review → publish เป็นรอบๆ ตาม family (มี 19 families แรก) | V1L-02 ปิดก่อน; CH063/064 |
| EXT-03 Bounded web search | ข้อเสนอพร้อมแล้ว (BOUNDED_WEB_SEARCH_PROPOSAL) — ค้นเว็บมหาวิทยาลัยเพื่อ "พบเอกสาร" ไม่ใช่ "ตอบจากเว็บ" | อนุมัติขอบเขต evidence + SSRF rules |
| EXT-04 Hermes orchestration | **อัปเดตDEC166 (25ต.ค.): เดินหน้าboundedStaffCopilotโดยใช้primaryเดิม ไม่ต้องรอproviderใหม่** → จังหวะ 1: Staff Copilot บน Dashboard (หลายก้าว: ค้น→รวบรวม→ร่าง ผ่าน allowlist backend-tools หลังสิทธิ์ฝ่าย) *StaffUI/API/native runner controlledPASSแล้วตามDEC168; actualnative/modeldraftreviewยังค้าง* → จังหวะ 2: ใช้ bridge pattern ซ้ำกับ EXT-03/ระบบอื่น *เปิดหลัง V1 live* — ทางเพิ่มเติมที่บันทึกไว้: Knowledge Gap Miner (ขุดคำถามที่ไม่มีเอกสาร→จัดลำดับขอเอกสารจริง, เปิดเมื่อมีบทสนทนาจริง), Incident Copilot (ร่างสรุป+batch reply จาก linked tickets), QA Pre-screener (คัดกรองให้ human review ไม่ใช่ผู้ตัดสิน), Nightly Ops Digest, Multilingual Draft Layer (ตามข้อจำกัด DEC-148), Local LLM client (CH073) — หลักการร่วม: agent ทำงานเบื้องหลังให้คน ไม่พูดแทนกับนักศึกษาโดยตรง | DEC-104/166, CH073; ขาดfallbackต้องรายงานunavailableอย่างซื่อสัตย์ |
| EXT-05 Student SSO/SIS/grades/payments | ออกแบบใหม่ทั้ง privacy model (V1 เป็น anonymous โดยตั้งใจ) — ต้องมี infrastructure มหาวิทยาลัย + DPA | นอก V1 ชัดเจน (CH073) |
| EXT-06 มุมมองหลายภาษา | DEC-148 จำกัด: เงื่อนไข guided เขียนด้วยภาษาไทย — ถ้ามีผู้ใช้ต่างชาติ ต้องทำ multilingual contract + ทดสอบใหม่ | ความต้องการจริง |
| EXT-07 Custom document families | เพิ่ม family นอก 19 แรกผ่าน UI (CH064 เปิดไว้) พร้อม proof/versioning เดิม | มีเอกสารจริงจำนวนมากพอ |
| EXT-08 Local AI (ผู้ใช้ยืนยันจะเพิ่มภายหลัง) | โมเดลท้องถิ่นบน **host ปรับใช้จริง** ไม่ใช่เครื่องพัฒนา (สเปคไม่พอ) — ผูกกับ EXT-01 paid/provider phase เดียวกัน | DEC-165; เมื่อมี host จริง + ผู้ใช้เปิดหัวข้อ |

## เอกสารเตรียมพร้อมสำหรับทุกประตูของผู้ใช้ (25 ต.ค.)

- **วันทดสอบ Flow A–F:** [TEST_DAY_RUNBOOK](../operations/TEST_DAY_RUNBOOK.md) (ขั้นตอน+แบบบันทึกผล) คู่กับ [LIVE_TEST_QA_PREP](../operations/LIVE_TEST_QA_PREP.md)
- **ตัดสิน corpus 9 รายการ:** [CORPUS_DECISION_PACKETS](../operations/CORPUS_DECISION_PACKETS.md) — คำถามสำเร็จรูปส่งเจ้าของข้อมูลได้ทันที
- **เลือก host/วัน deploy:** [DEPLOYMENT_WORKSHEET](../operations/DEPLOYMENT_WORKSHEET.md)
- **วันเพิ่ม provider/local AI (เฟสภายหลังตาม DEC-165):** [PROVIDER_ONBOARDING_PLAYBOOK](../operations/PROVIDER_ONBOARDING_PLAYBOOK.md)

## เพิ่มเติมจากรอบ 25 ต.ค. (หลังปิดเฟส 0)

- สร้าง **[เอกสารเตรียมทดสอบจริง](../operations/LIVE_TEST_QA_PREP.md)** แล้ว — ตรวจฐานจริงพบ: PUBLIC 5 เอกสาร/52 chunks พร้อมตอบ, **structured 7 ตาราง = 0 แถวจริง** (คำถามค่าเทอม/ปฏิทินต้องได้คำตอบ "ยังไม่พบเอกสาร")
- Historicalcheckpoint `checkpoint/v1-agent-complete` เคยสะอาดก่อนรอบHermes/QA; ปัจจุบันมีงานใหม่ยังไม่commit ใช้tagเทียบประวัติเท่านั้น ห้ามresetทับงานค้าง

## ลำดับแนะนำ (critical path)

```
เฟส 0 ปิดครบแล้ว (attestation ถึง 24 พ.ย. / เอกสาร / commits / tag)
→ ถัดไป: V1L-01 Flow A–F จริง (ใช้ LIVE_TEST_QA_PREP) ──┬→ V1L-02 corpus 9 รายการ → QUA-01 bracket ของจริง
                                                        └→ V1L-03 activation → V1L-04 deploy → PRF-02/OPS-01
QUA-02/03เลื่อนตามผู้ใช้(DEC165); QUA-04มีscopedfixแล้ว; HermesStaffUIต่อแล้วตามDEC168; actualnative/modeldraft/liveยังค้าง · PRF-01, UX-02, OPS-02 = หลังเฟส 1
EXT-* = เมื่อมหาวิทยาลัยเลือก (เฟส 3 ไม่มี deadline)
```

## ข้อควรระวังที่ยังผูกกันอยู่ทุกเฟส

- ห้าม pool คะแนนข้าม profile / ห้าม retry ใน profile ที่หยุดแล้ว / ทุกการรันวัดผูก freeze+review ตามแบบ DEC-160–163
- การเปลี่ยน timeout/model/key ทุกครั้งต้องได้รับอนุมัติก่อน (แบบ DEC-161)
- synthetic acceptance ≠ ของจริง: อย่าอ้าง QUA-01 ว่าผ่านจนกว่าจะรันจริง
- `.env`/keys/private originals ไม่เข้า repo เด็จขาด; backup เก็บนอก git

25October22:03Bangkok — remaining-work audit (root, read-only): actualapprovedPUBLIC5documents; all7structuredtables0rows. Useragaindefersmanualtests. Prioritybeforemanualacceptance: review9heldsources/prepareeligibledata, closecurrentHermes/QAcommitandcurrentintegrationcoverage. WholecurrentregisteredPGwasnotrerunbythe20casescopilotslice; do not callhistorical645casesfresh. No new model/provider test, publication, migration or activation.
