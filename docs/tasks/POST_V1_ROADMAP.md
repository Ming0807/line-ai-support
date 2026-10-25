# Post-V1 continuation roadmap — ตรวจโปรเจ็ค + แนวทางต่อยอด + task

จัดทำ 25 ตุลาคม 2026 โดย root หลังปิดงาน agent ทั้งหมดของ V1 (original30 **ACCEPTED** 29/30+19/20+gates ตาม DEC-162 และ representative repeats 3×7 ครบตาม DEC-163) ใช้คู่กับ [บอร์ดงาน V1](V1_TASK_BOARD.md) และ [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md) — ไฟล์นี้เป็นแผนงานต่อจากนี้ ไม่ใช่การประกาศ V1 ผ่านรับมอบ

## สถานะโปรเจ็ค ณ ตอนนี้ (สรุปตรวจ)

**ปิดแล้ว:** 13 modules ครบตาม master§3 · 43 migrations/74 RLS tables · unit 3,184 · owned PG 645+ · import 5 ฟอร์มแมต + atomic publication · incidents/batch reply · Provider UI ครบ order/test/quota/observations · UI consistency (DEC-159) · **คุณภาพโมเดลผ่าน original30 + repeats บน synthetic frozen fixture** (DEC-162/163) · branch `feat/yru-v1-final-polish` commits 734e795→d87d2ae

**ยังไม่ปิด (ทั้งหมด user-gated หรือต้องมีของจริง):**
1. Flow A–F จริงบน LINE (ผู้ใช้ทดสอบเอง ตามตารางใน FINAL_SETUP_CHECKLIST)
2. Corpus จริง: อนุมัติแล้วเพียง 5 ฉบับ PUBLIC; 9 รายการ held รอเจ้าของข้อมูลตัดสิน; รวบรวมไว้ 187 รายการ
3. Guarded production activation + deployment จริง (host/domain/backup ยังไม่เลือก)
4. **คุณภาพบน corpus จริงยังไม่เคยวัด** — acceptance ที่ผ่านมาใช้ synthetic fixture ของ harness เท่านั้น
5. Gemini free-account attestation หมดอายุ **28 ต.ค. 2026 13:15 กรุงเทพฯ** — ไม่ต่ออายุ = inference หยุด (ไม่มี fallback ที่ qualified)
6. เอกสาร matrix/report บางส่วนยังเขียนสถานะก่อน DEC-162/163

## แนวทางต่อยอดแบบละเอียด (4 เฟส)

### เฟส 0 — เก็บระเบียบทันที — **ปิดครบแล้ว 25 ต.ค. 2026**

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
| QUA-02 qualified fallback model | ปัจจุบัน Gemini Lite เดี่ยว (17 ตัวปิด) — เมื่อมี quota/เหตุผลใหม่ ให้ประเมิน 1 โมเดลสำรองผ่าน harness เดิม (ไม่ pool คะแนน) เพื่อให้เครื่องไม่ตายตัวเดียว | CH029 §22, USR-FREE |
| QUA-03 ทนทาน latency spike | เหตุการณ์ call เกิน 25 วิ (เจอ 2 ครั้งใน 55 executions) — ทางเลือก: อนุมัติ ceiling สูงขึ้น (DEC-108 รองรับถึง 45s) / ออกแบบ bounded retry ระดับ turn / ยอมรับ fallback UI ตาม DEC-160 availability path | DEC-161/162 |
| QUA-04 A12-discovery หยุดกะพริบ | A12 สลับระหว่าง discovery-render (main5/main6 รอบอื่น) กับ clarify — วิเคราะห์ transcript จับเงื่อนไขที่ทำให้ planner เลือก STRUCTURED-clarify แทน DISCOVER_CALENDAR แล้วแก้ 1 จุดแบบ RED-first | CH018/031, DEC-157 |
| PRF-01 ANN + ประสิทธิภาพ corpus จริง | CH019 เลื่อน ANN ไว้: เมื่อ chunks จริงเป็นหมื่น+ ให้ benchmark pgvector IVFFlat/HNSW เทียบ exact cosine ก่อนเปลี่ยน cohort; รวม E5 warm-cache strategy ตอน deploy | CH019, EMBEDDING_DESIGN |
| PRF-02 โหลดจริงซ้ำ | ทำ controlled load A–J บน corpus จริง + worker concurrency จริงของ host ที่เลือก | SOL-06 |
| UX-02 UX รอบถัดไปจากของจริง | เก็บ feedback จากการใช้จริง: loading UX บน LINE, Analytics/Usage กับข้อมูลจริง, ช่วย Staff เข้าใจ quick-reply/สถานะ, ม.สอบ ZOOM/contrast ตาม DEC-159 พื้นฐานเดิม | CH051/058, DESIGN.md |
| OPS-01 backup/restore drill ประจำ | ตารางเวลา backup + ซ้อม restore รายเดือน + credential rotation policy | runbook, CH060 |
| OPS-02 security audit รอบที่ 2 | รีรัน credential scan ทั้ง repo หลัง commit งานเก่าครบ + advisors + RLS review กับ migration ใหม่ถ้ามี | CH017/070 |

### เฟส 3 — ส่วนขยายหลัง V1 (ต้องมหาวิทยาลัยเลือก/อนุมัติ ตาม CH073)

| Task | แนวทาง | เงื่อนไขเปิดงาน |
| --- | --- | --- |
| EXT-01 Paid generation opt-in | UI ให้มหาวิทยาลัยเปิด paid แบบ explicit (cost_mode ALLOW_PAID path มีรากไว้แล้ว) + budget caps + แจ้งต่อ usage | มหาวิทยาลัยอนุมัติงบ + ตั้ง billing; USR-FREE |
| EXT-02 Corpus program | ขยายจาก 187 รายการที่รวบรวม: ใช้ import-assistance ช่วย triage → review → publish เป็นรอบๆ ตาม family (มี 19 families แรก) | V1L-02 ปิดก่อน; CH063/064 |
| EXT-03 Bounded web search | ข้อเสนอพร้อมแล้ว (BOUNDED_WEB_SEARCH_PROPOSAL) — ค้นเว็บมหาวิทยาลัยเพื่อ "พบเอกสาร" ไม่ใช่ "ตอบจากเว็บ" | อนุมัติขอบเขต evidence + SSRF rules |
| EXT-04 Hermes orchestration | ยกระดับจาก isolated 2-turn pilot เป็น orchestration layer (ถ้าคุ้ม) โดยยังอยู่หลัง backend tools + FREE_ONLY | หลัง QUA-02 มี fallback; CH073 |
| EXT-05 Student SSO/SIS/grades/payments | ออกแบบใหม่ทั้ง privacy model (V1 เป็น anonymous โดยตั้งใจ) — ต้องมี infrastructure มหาวิทยาลัย + DPA | นอก V1 ชัดเจน (CH073) |
| EXT-06 มุมมองหลายภาษา | DEC-148 จำกัด: เงื่อนไข guided เขียนด้วยภาษาไทย — ถ้ามีผู้ใช้ต่างชาติ ต้องทำ multilingual contract + ทดสอบใหม่ | ความต้องการจริง |
| EXT-07 Custom document families | เพิ่ม family นอก 19 แรกผ่าน UI (CH064 เปิดไว้) พร้อม proof/versioning เดิม | มีเอกสารจริงจำนวนมากพอ |

## เพิ่มเติมจากรอบ 25 ต.ค. (หลังปิดเฟส 0)

- สร้าง **[เอกสารเตรียมทดสอบจริง](../operations/LIVE_TEST_QA_PREP.md)** แล้ว — ตรวจฐานจริงพบ: PUBLIC 5 เอกสาร/52 chunks พร้อมตอบ, **structured 7 ตาราง = 0 แถวจริง** (คำถามค่าเทอม/ปฏิทินต้องได้คำตอบ "ยังไม่พบเอกสาร")
- ต้นไม้สะอาด + tag `checkpoint/v1-agent-complete` — ย้อนกลับด้วย `git reset --hard checkpoint/v1-agent-complete`

## ลำดับแนะนำ (critical path)

```
เฟส 0 ปิดครบแล้ว (attestation ถึง 24 พ.ย. / เอกสาร / commits / tag)
→ ถัดไป: V1L-01 Flow A–F จริง (ใช้ LIVE_TEST_QA_PREP) ──┬→ V1L-02 corpus 9 รายการ → QUA-01 bracket ของจริง
                                                        └→ V1L-03 activation → V1L-04 deploy → PRF-02/OPS-01
QUA-02/03/04 เริ่มได้เลยตอนนี้ (agent) · PRF-01, UX-02, OPS-02 = หลังเฟส 1
EXT-* = เมื่อมหาวิทยาลัยเลือก (เฟส 3 ไม่มี deadline)
```

## ข้อควรระวังที่ยังผูกกันอยู่ทุกเฟส

- ห้าม pool คะแนนข้าม profile / ห้าม retry ใน profile ที่หยุดแล้ว / ทุกการรันวัดผูก freeze+review ตามแบบ DEC-160–163
- การเปลี่ยน timeout/model/key ทุกครั้งต้องได้รับอนุมัติก่อน (แบบ DEC-161)
- synthetic acceptance ≠ ของจริง: อย่าอ้าง QUA-01 ว่าผ่านจนกว่าจะรันจริง
- `.env`/keys/private originals ไม่เข้า repo เด็จขาด; backup เก็บนอก git
