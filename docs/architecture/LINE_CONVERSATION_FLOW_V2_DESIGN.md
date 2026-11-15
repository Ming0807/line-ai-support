# CONV-V2 — LINE conversation flow ที่เร็วขึ้นและตอบครบขึ้น

สถานะ: **IN PROGRESS — 01–05 implemented behind a default-off flag; 00, 06 and 07 pending** — 15 พฤศจิกายน 2026 โดย root ตามคำขอของผู้ใช้ "Write the design" หลังการวิเคราะห์ว่า flow ปัจจุบันดีพอไหมสำหรับการสนทนาใน LINE. เอกสารนี้ยังไม่มีโค้ด ไม่มีผลทดสอบ และยังไม่เปลี่ยนพฤติกรรมของระบบ. Decision: [DEC-195](../decisions/DECISION_LOG.md).

เกี่ยวข้องกับ: CH006, CH021–CH024, CH029, CH031–CH034, CH058–CH059, CH069, USR-AI-AUTONOMY, USR-WEB ใน [requirements matrix](../requirements/V1_REQUIREMENTS_MATRIX.md). ต่อยอดจาก [support workflow](AI_SUPPORT_WORKFLOW_DESIGN.md) (AI-AGENT-01) และ [context routing](AI_CONTEXT_ROUTING_DESIGN.md).

## สถานะการทำ (15 พฤศจิกายน 2026)

ทำแล้ว CONV-V2-01 ถึง 04 อยู่หลัง flag `YRU_CONVERSATION_FLOW_V2` (ค่าเริ่มต้นปิด) และ `pnpm local:ai --flow-v2`:

- **ปรับจาก design เดิมในรอบนี้:** call 1 ใช้ decision contract เดิม (`assistant-decision.ts`) ที่ผ่าน 29/30 โดยไม่เปลี่ยน prompt หรือ schema และไม่ให้ model กรอก scope. ลดจำนวนครั้งเรียกตรงขั้นหลัง LOOKUP แทน: คำถามทางการที่ไม่ระบุปี วันที่ รุ่น หลักสูตร หรือประเภทนักศึกษา (`requiresScopePlanning` ใช้ตัวตรวจ scope เดิม) จะค้นด้วย default scope แบบ current และ backend-only แล้วตามด้วย compose หนึ่งครั้ง. คำถามที่ต้องการ scope, ผลค้นว่าง/กำกวม/ผิดพลาด หรือ compose ตอบว่าไม่มีหลักฐาน จะไปทางเดิมทั้งหมด (`createKnowledgeProducer`). การให้ call 1 กรอก scope ยังเป็นทางเลือกต่อไป ถ้าการวัดชี้ว่าคุ้ม
- ไฟล์: `lib/knowledge/scope-validation.ts`, `lib/knowledge/section-expansion.ts`, `lib/knowledge/section-answer.ts`, `lib/ai/turn-flow-v2.ts`, tool `search_knowledge_sections`, การเชื่อมใน `lib/knowledge/configured.ts`
- ผลลัพธ์ ANSWER ที่ขยาย section มี `sectionExpanded: true` ทั้ง finalizer (`run-worker.ts`) และ delivery fence ใช้ `freshAnswerEvidence` เพื่อขยายซ้ำแบบเดียวกันก่อนตรวจ. ถ้าไม่มี flag พฤติกรรมเดิมไม่เปลี่ยน
- หลักฐาน: typecheck, full lint, unit 3748 tests / 286 files และ build ผ่าน. owned-PG `tests/database/section-expansion.integration.ts` เขียนแล้วแต่ **NOT_RUN** เพราะ Docker ไม่ได้เปิด. ยังไม่มีการเรียก model จริง
- CONV-V2-05 ทำแล้ว (15 พ.ย.): คำตอบ V2 ที่ยาวเกิน 900 ตัวอักษรส่ง bubble แรกเป็นบรรทัดต้นของคำตอบที่ผ่านการตรวจแล้ว (ไม่เกิน 600 ตัวอักษร) พร้อมบอกว่ามีขั้นตอนหรือเงื่อนไขเพิ่มเติม ชื่อแหล่ง และปุ่ม "ดูขั้นตอนทั้งหมด" (`lib/line/answer-presentation.ts`). ปุ่มเป็น owned one-use choice ที่เก็บเฉพาะ job ID เมื่อกด `lib/conversation/show-full-answer.ts` อ่านผลที่บันทึกไว้ ตรวจ evidence ใหม่ภายใต้ lock เดิม แล้วส่งผ่าน AI outbox fence โดยไม่เรียก model. ข้อความล้มเหลวแบบ V2 มีปุ่ม "คุยกับเจ้าหน้าที่" ซึ่งใช้ CONTACT เดิม (เลือกหน่วยงานก่อนสร้าง ticket)
- **ปรับจาก design รอบนี้:** ไม่ต่อ loading แบบวนซ้ำ เพราะ DEC-057 กำหนดให้เรียก loading ครั้งเดียวแบบ best-effort จึงให้ V2 ขอ animation 40 วินาทีครั้งเดียวแทน 20 (LINE ซ่อนเองเมื่อคำตอบมาถึง). ยังไม่มีปุ่ม "ลองใหม่" เพราะ quick reply ของระบบรองรับเฉพาะ postback และการส่งคำถามเดิมซ้ำต้องมี contract แยก. Flex Message ยังเลื่อนไว้ตามเดิม
- หลักฐาน 05: unit 3760 tests / 288 files, typecheck, full lint และ build ผ่าน. owned-PG บนฐานข้อมูลชั่วคราว 53 migrations ผ่านทั้งหมดผ่าน `scripts/database/run-owned-test.ts`: section expansion 3/3 และ short-first/show-all 4/4 (ส่งแบบสั้น, กดดูทั้งหมดครั้งเดียว, กดซ้ำถูกปฏิเสธ, source เปลี่ยนถูกปฏิเสธ, staff takeover ไม่ส่ง, ปุ่มคุยกับเจ้าหน้าที่) และ cleanup ผ่าน. runner นี้ต้อง grant `references` บน `auth.identities` ให้ `postgres` เหมือน hosted Supabase. ฐาน local `postgres` เดิมยังค้างที่ 41 migrations จึงไม่ได้ใช้
- ยังไม่ทำ: 00 baseline และ 06 การเปรียบเทียบ ซึ่งต้องได้งบ model จากผู้ใช้ และ 07 การทดสอบบน OA จริง

## 1. ปัญหาที่ต้องแก้

แนวคิดด้านความปลอดภัยของระบบปัจจุบันดีและต้องเก็บไว้ทั้งหมด แต่เส้นทางสร้างคำตอบมีขั้นตอน model เรียงต่อกันมากเกินไป. จากการอ่านโค้ด (ยังไม่ได้วัดจริงในรอบนี้) คำถามที่ต้องใช้ข้อมูลมหาวิทยาลัยหนึ่งข้อผ่าน:

| ลำดับ | การเรียก model | ที่อยู่ในโค้ด | deadline ต่อครั้ง |
| --- | --- | --- | --- |
| 1 | semantic routing (เฉพาะเมื่อมีหลายเรื่องค้าง) | `lib/conversation/semantic-routing.ts` | 25 วินาที |
| 2 | assistant decision | `lib/ai/assistant-orchestrator.ts` → `assistant-decision.ts` | 25 วินาที |
| 3 | (อาจมี) repair decision | `assistant-orchestrator.ts` | 25 วินาที |
| 4 | knowledge plan (scope + method) | `lib/knowledge/answer-producer.ts:369` | 25 วินาที |
| 5 | (อาจมี) program/plan repair | `answer-producer.ts:483` | 8 วินาที |
| 6 | knowledge answer | `answer-producer.ts:514` / `:585` | 25 วินาที |

ทั้งงานมีเพดาน 90 วินาที (`lib/ai/run-worker.ts:64`). Gemini Flash Lite ที่ใช้อยู่เคยตอบ 2.7–14.7 วินาทีต่อครั้ง ดังนั้นคำตอบหนึ่งข้ออาจใช้ราว 15–40 วินาที ซึ่งตัวเลขนี้เป็นการประมาณที่ต้องยืนยันใน CONV-V2-00. ทุกขั้นที่เพิ่มขึ้นคือโอกาส timeout, invalid output หรือข้อความจำกัดสำเร็จรูปเพิ่มขึ้น.

ปัญหาอื่นที่พบ:

- **decision layer ถูกวางทับ pipeline เดิม** — เมื่อ decision เลือก LOOKUP ตัว knowledge producer ยังเรียก model วางแผนและตอบเองอีกสองครั้ง
- **คำตอบถูกแต่ไม่ครบ** — กรณี Wi-Fi จริง (ROOT-NATURAL-07) ขาดการตั้งค่า MAC และ URL Passport และลำดับขั้นผิด เพราะ retrieval คืน chunk ไม่ใช่ทั้งขั้นตอน
- **คำตอบยาวแบบเอกสาร** — ส่งได้ถึง 5 ข้อความ × 5,000 ตัวอักษร ซึ่งอ่านบนมือถือยาก
- **ข้อความจำกัดสำเร็จรูปยาวและแข็ง** — เช่น `partialGeneralText` ใน `assistant-orchestrator.ts`
- **loading animation เปิดครั้งเดียว 20 วินาที** (`run-worker.ts:86`) ถ้าตอบนานกว่านั้น ผู้ใช้จะเห็นแชทเงียบ

## 2. สิ่งที่ห้ามเปลี่ยน

ทุกข้อด้านล่างคงเดิม และ test เดิมต้องผ่านต่อ:

- backend เป็นผู้ตรวจและทำ tool ทุกตัว ส่วน AI แค่เสนอ. AI ห้ามรัน SQL เอง, เผยแพร่ความรู้เอง, ข้าม state transition หรือตอบใน ticket ที่เป็น HUMAN
- ข้อมูลทางการต้องผูกกับ evidence ที่ reviewed/current/effective/applicable และต้องกรองก่อน similarity. citation และค่าที่ตรงตัวต้องให้ backend ตรวจ (`buildCitedAnswer`, structured citations, claim screen ใน `conversation-reply.ts`)
- routing ใช้ความหมาย ไม่ default ไปที่ ticket ล่าสุด ไม่ใช้ keyword ตัดสินเป็นที่สุด และยังรวม burst/quote/topic fence ไว้
- การส่งต่อเจ้าหน้าที่ยังต้องผ่าน owned confirmation และสร้าง ticket จริงด้วย backend receipt
- งาน provider/LINE/network อยู่นอก SQL transaction. queue idempotency, lease, revision และ delivery lock คงเดิม
- FREE_ONLY และ turn budget แบบ durable (`lib/ai/durable-turn-budget.ts`) คงเดิม
- flow เดิมยังเป็นค่า default จนกว่า flow ใหม่จะชนะในการวัด (ดูหัวข้อ 7)

## 3. บทเรียนจากรอบก่อน

ROOT-SINGLE-PASS-01 เคยรวม scope และ decision เป็น JSON ใหญ่ก้อนเดียว (`lib/ai/scoped-assistant-decision.ts`, flag `singlePass`). ผลคือจำนวนครั้งเรียกลดจาก 2 เหลือ 1 แต่ main19 พลาดด้านความหมาย 4 กรณี จึงไม่ได้เปิดใช้. ข้อสรุปคือ **อย่าลดจำนวนครั้งเรียกด้วยการยัดงานหลายอย่างลง schema เดียว** สำหรับ model ขนาดเล็ก.

CONV-V2 จึงลดจำนวนครั้งด้วยวิธีอื่น: **เอา model ออกจากข้างใน retrieval**. การเลือกวิธีค้น (RAG / structured / discover) กลายเป็นการเลือก tool ซึ่งเป็นงานที่ model ทำได้ดีกว่าการกรอก schema ซ้อนหลายชั้น. ส่วน backend ทำ retrieval แบบ deterministic แล้วคืน evidence.

## 4. Flow ใหม่ต่อหนึ่ง turn

```
LINE message
  → ingress + burst collection (เดิม)
  → routing (เดิม, แยก worker; ข้ามเมื่อมี candidate เดียว)
  → [call 1] turn decision พร้อม tools
       ├─ answer_general / ask_user  → claim screen → ส่ง        (รวม 1 call)
       ├─ propose_handoff            → owned confirmation (เดิม)  (รวม 1 call)
       └─ search_* (args มี query + scope)
            → backend ตรวจ scope → retrieval + section expansion
            ├─ structured exact → backend render → ส่ง          (รวม 1 call)
            └─ RAG evidence → [call 2] compose → citation check → ส่ง (รวม 2 calls)
```

### 4.1 Call 1 — turn decision

- input ได้แก่ คำถามเต็ม, history ของเรื่องนี้ (เฉพาะ USER และ assistant ที่ SENT จริง), family catalog ที่ approved และสรุป support state เดิม
- output เป็น tool เพียงหนึ่งตัวจากชุดนี้:
  - `answer_general(text)` สำหรับความรู้ทั่วไป การเขียน การคำนวณ และ troubleshooting ระดับแรก
  - `ask_user(text)` เมื่อขาดข้อมูลที่จำเป็นจริง
  - `search_knowledge(query, scope, familyCodes)`
  - `search_structured(dataset, query, scope)` และ `discover_public_structured` / `discover_public_forms`
  - `propose_handoff(reason, departmentHint)`
  - สำหรับคำถามแบบผสม (MIXED) ให้ส่ง `generalText` ไปพร้อม search
- ใช้ tool registry เดิมใน `lib/ai/backend-tools.ts` (ToolRegistry, gateway รับได้ไม่เกิน 8 tools). ถ้า registry ของ Gemini ยังไม่ระบุว่ารองรับ native tools ให้ใช้ tagged JSON decision ที่ dispatch ไป handler ชุดเดียวกัน (AI-AGENT-01 อนุญาตไว้แล้ว). ทั้งสองทางต้องผ่าน adapter test ก่อนเชื่อมเข้าระบบ
- backend ตรวจ scope ใน args ด้วย `scopeIsGrounded`, `temporalScopeMatches` และ `familySelectionIsKnown`. ตัวตรวจเหล่านี้ต้องแยกออกจาก `answer-producer.ts` มาเป็น module ร่วม โดยไม่เปลี่ยนตรรกะ. scope ที่ไม่ผ่านให้ถามผู้ใช้กลับ ห้ามเดา

### 4.2 Retrieval และ section expansion

- ใช้ `searchKnowledge`, `searchStructured` และ discover ตามเดิม ลำดับการกรอง current/authority/applicability ก่อน similarity ห้ามเปลี่ยน
- **section expansion (ใหม่)**: ถ้า chunk ที่ค้นเจอมาจาก procedure หรือ guide ให้ดึง chunk ทั้งหมดที่อยู่ใน `headingPath` / `section_title` เดียวกันของ document revision เดียวกัน เรียงตามตำแหน่ง ภายในงบ token ของ evidence. ถ้าเกินงบให้ส่งเฉพาะ chunk ที่เจอพร้อมธง `sectionIncomplete` และให้คำตอบบอกผู้ใช้ตรงๆ ว่าขั้นตอนยังไม่ครบ
- expansion ใช้ได้เฉพาะ chunk ที่ผ่านตัวกรองเดียวกัน ห้ามข้ามไป document อื่นหรือ revision อื่น

### 4.3 Call 2 — compose

- input ได้แก่ คำถาม, evidence packet และ `generalText` (ถ้ามี)
- output schema: `{ short: string, full: string | null, citationChunkIds: uuid[], generalPart: string | null }`
- backend ตรวจด้วย `buildCitedAnswer` และ claim screen เดิม. ส่วน structured exact ให้ backend render เองโดยไม่เรียก call 2 (calendar/service rendering มีอยู่แล้ว)
- **ไม่มี repair call โดยอัตโนมัติ**. ถ้าคำตอบถูก reject ให้ backend สร้าง fallback แบบ deterministic จาก evidence (ชื่อเอกสาร, หัวข้อ และลิงก์ที่ reviewed) พร้อมข้อความจำกัดสั้นๆ. repair ยังเปิดเป็น option ได้ภายในงบรวม

### 4.4 งบต่อ turn

- ทั่วไป: 1 call. ข้อมูลทางการ: 2 calls. เพดาน 3 inference attempts ต่อ turn ซึ่งรวม fallback ของ provider แล้ว
- deadline เบื้องต้น (ต้องยืนยันจาก baseline): call 1 ไม่เกิน 12 วินาที, call 2 ไม่เกิน 20 วินาที, เป้า p95 ทั้ง turn ไม่เกิน 30 วินาที. job deadline 90 วินาทีเดิมยังคงไว้ในระยะแรก
- งบผูกกับ inbound turn ผ่าน durable turn budget เดิม. ข้อความใหม่ การ takeover หรือการยกเลิกจะตัดงานที่ค้างทั้งหมด

## 5. การแสดงผลใน LINE

- **สั้นก่อน**: bubble แรกเป็น `short` ไม่เกินประมาณ 8 บรรทัด / 600 ตัวอักษร ตามด้วยบรรทัดที่มาแบบย่อ เช่น "ที่มา: คู่มือ Wi-Fi มหาวิทยาลัย (2568)"
- **ดูทั้งหมด**: ถ้ามี `full` ให้แนบ quick reply "ดูขั้นตอนทั้งหมด" ซึ่งเป็น owned one-use choice ผูกกับ answer revision และ source digest. เมื่อกด ระบบส่ง `full` ที่เก็บแบบเข้ารหัสไว้ **โดยไม่เรียก model ใหม่**. ถ้า source เปลี่ยนหรือ choice หมดอายุ ให้แจ้งและเสนอถามใหม่. ใช้กลไก choice เดิมใน `lib/conversation/quick-reply.ts`
- **ขั้นตอน**: ใช้เลขข้อ 1., 2., 3. ภายในข้อความเดียว และไม่ซ้ำ citation ยาวในทุกข้อ
- **quick reply ต่อยอด**: ไม่เกิน 3 ปุ่ม เช่น "ยังไม่ได้ผล" (ต่อ troubleshooting เดิม) และ "คุยกับเจ้าหน้าที่" (เข้า owned confirmation เดิม). ปุ่มต้องไม่สร้าง ticket โดยไม่ยืนยัน
- **Flex Message**: เลื่อนไปเฟสหลัง เพราะต้องขยาย `lib/line/message-schemas.ts` และ delivery test. รอบนี้ใช้ข้อความธรรมดากับ quick reply ก่อน
- **loading**: ต่อ loading animation ทุกประมาณ 15 วินาทีขณะที่ turn ยังทำงาน รวมไม่เกิน 60 วินาที และหยุดทันทีเมื่อส่งคำตอบหรือถูก takeover
- **ข้อความจำกัด**: แทนข้อความสำเร็จรูปด้วยชุดข้อความไม่เกิน 2 บรรทัดที่บอกว่าเกิดอะไรขึ้นและทำอะไรต่อได้ พร้อม quick reply "ลองใหม่" / "คุยกับเจ้าหน้าที่". ความหมายด้านความปลอดภัยเดิมต้องคงไว้ (ไม่อ้างว่าส่งเรื่องแล้ว ไม่ยืนยันข้อมูลทางการ)

## 6. Model สำรอง (ต้องให้ผู้ใช้ตัดสิน)

ตอนนี้มี Gemini Flash Lite เพียงตัวเดียว (CH029) และ attestation หมดอายุ 24 พ.ย. 2026. design นี้รองรับ model สำรองผ่าน provider order และ FREE_ONLY เดิม แต่**การเปิดใช้ขัดกับ DEC-165 ที่พัก provider อื่นไว้** จึงต้องให้ผู้ใช้อนุมัติแยก. model สำรองต้องผ่านชุดประเมิน 30 กรณีเดียวกันก่อนเปิดใช้.

## 7. การวัดและเกณฑ์รับ

**Baseline ก่อน (CONV-V2-00)**: วัด flow ปัจจุบันบนชุด frozen 30 กรณีเดิม (`lib/ai/conversation-eval*.ts`) และบันทึกค่าต่อ turn:

- จำนวน inference call และ attempt
- latency p50/p95 ต่อ turn และต่อ call
- อัตราที่ตอบด้วยข้อความจำกัดสำเร็จรูป และอัตราที่ต้องถามซ้ำ
- trajectory score และ useful score
- ความครบของขั้นตอนเทียบกับต้นฉบับ (กรณี procedure)

**เกณฑ์ที่ flow ใหม่ต้องผ่านก่อนเปลี่ยน default**:

- คุณภาพไม่ต่ำกว่าเกณฑ์เดิม: ≥27/30 trajectory, ≥18/20 useful และกรณี authority-sensitive ผ่านครบ 10/10
- invariant เป็นศูนย์: wrong recipient, unauthorized tool effect, AI ตอบใน HUMAN และข้อมูลทางการที่แต่งขึ้น ต้องเป็น 0 ทั้งหมด
- p95 latency ต่ำกว่า baseline อย่างมีนัย (กำหนดตัวเลขหลัง baseline) และจำนวน call เฉลี่ยไม่เกิน 2
- อัตราข้อความจำกัดและอัตราถามซ้ำไม่สูงกว่า baseline
- เปรียบเทียบบน fixture เดียวกัน ไม่ pool ผลข้ามรอบ และไม่ปรับ rubric

**งบเรียก model จริง**: การประเมินด้วย Gemini จริงใช้ quota free และงบ ROOT-AI-SELF-ACCEPT รอบก่อนใช้หมดแล้ว จึง**ต้องให้ผู้ใช้อนุมัติงบใหม่**ก่อน CONV-V2-00 และ CONV-V2-06 (ประมาณการ: 30 กรณี × 2 flow × ไม่เกิน 3 calls = ไม่เกิน 180 calls ต่อรอบเทียบ). งาน component ทำได้ด้วย fake provider โดยไม่ใช้งบนี้.

**Rollout**: flag server-only `CONVERSATION_FLOW_V2` ค่าเริ่มต้น OFF. เปิดได้ผ่าน `local:ai` แบบ opt-in. ไม่ทำ shadow mode เพราะจะใช้ quota เป็นสองเท่า. เปลี่ยน default ได้หลังผ่านเกณฑ์ข้างต้น และหลังผู้ใช้ทดสอบบน OA จริงแล้วเท่านั้น.

## 8. งานย่อย

| Task | งาน | ไฟล์หลัก | ขึ้นกับ | Acceptance |
| --- | --- | --- | --- | --- |
| CONV-V2-00 | วัด baseline ของ flow ปัจจุบัน | `scripts/qa/*`, `lib/ai/conversation-eval*.ts` (เพิ่มการบันทึก call/latency) | งบ model จากผู้ใช้ | รายงาน baseline ครบตามหัวข้อ 7 พร้อม denominator |
| CONV-V2-01 | แยกตัวตรวจ scope ออกมาเป็น module ร่วม | `lib/knowledge/scope-validation.ts` (ใหม่), `answer-producer.ts` | — | test เดิมทั้งหมดผ่านโดยพฤติกรรมไม่เปลี่ยน |
| CONV-V2-02 | section expansion | `lib/knowledge/section-expansion.ts` (ใหม่), `retrieval.ts` | — | RED จากกรณี Wi-Fi; owned-PG ยืนยันว่าไม่ข้าม document/revision/filter |
| CONV-V2-03 | turn decision (call 1) และ dispatch | `lib/ai/turn-agent.ts` (ใหม่), `backend-tools.ts`, `configured.ts` | 01 | fake-provider test ทุก tool, scope ที่ไม่ grounded ถูกปฏิเสธ, งบ ≤3 attempts |
| CONV-V2-04 | compose (call 2) และ deterministic fallback | `lib/ai/turn-compose.ts` (ใหม่), `citations.ts` | 02, 03 | citation/claim screen เดิมผ่าน และ reject แล้วไม่มี repair loop |
| CONV-V2-05 | การแสดงผล LINE: short/full choice, loading renewal, ข้อความจำกัดใหม่ | `lib/line/answer-presentation.ts` (ใหม่), `quick-reply.ts`, `run-worker.ts` | 04 | owned choice ส่ง full โดยไม่เรียก model, choice ที่ stale ถูกปฏิเสธ, HUMAN takeover หยุด loading |
| CONV-V2-06 | ประเมินเทียบ old กับ new | eval harness | 00–05, งบ model | ผ่านเกณฑ์หัวข้อ 7 |
| CONV-V2-07 | ผู้ใช้ทดสอบบน OA จริง และตัดสินเรื่อง default | checklist | 06 | หลักฐานจากผู้ใช้ ห้ามอ้างแทน |

ทุก task ต้องเขียน RED test ก่อน และรัน typecheck/lint/unit/build ทุกครั้ง. task ที่แตะ DB หรือ delivery ต้องมี owned-PG test พร้อม exact cleanup. Root เป็นเจ้าของ contract และ integration ส่วน delegation ทำตาม [working protocol](../agents/WORKING_PROTOCOL.md).

## 9. ความเสี่ยงและคำถามที่ยังเปิด

- Gemini ผ่าน chat-completions อาจรองรับ tools + strict JSON ร่วมกันไม่ดี ทางสำรองคือ tagged JSON decision ซึ่งต้องพิสูจน์ใน CONV-V2-03
- call 1 ต้องทำทั้งเลือก tool และกรอก scope ซึ่งเสี่ยงซ้ำรอย SINGLE-PASS-01. ตัวกันคือ schema ของแต่ละ tool เล็กและแยกกัน และ backend ตรวจ scope เอง. ถ้า baseline เทียบแล้วแย่ลง ให้แยก scope กลับไปเป็น call ของตัวเองเฉพาะ path ทางการ (รวม 3 calls)
- section expansion อาจทำให้ evidence ยาวเกินงบ prompt 19,000 ตัวอักษร ต้องมีลำดับตัดที่ชัดและธง `sectionIncomplete`
- ข้อความ `short` อาจตัดเงื่อนไขสำคัญทิ้ง ต้องมี rubric ข้อ "short ไม่ทำให้เข้าใจผิดเมื่ออ่านลำพัง"
- routing ยังเป็น call แยก การรวมเข้ากับ call 1 ข้าม worker boundary (INBOX/AI lease) ซึ่งไม่อยู่ในขอบเขตรอบนี้
- Corpus ยังบาง (PUBLIC 16 รายการ) flow ที่ดีขึ้นไม่ได้แทนการเพิ่มแหล่งข้อมูล
