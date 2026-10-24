# YRU AI Helpdesk — จุดเริ่มอ่าน

อัปเดต 24 ตุลาคม 2026 โดย root สถานะ V1: **ยังไม่ผ่านการตรวจรับทั้งหมด** งานระบบมีหลักฐานทดสอบแล้ว แต่คุณภาพคำตอบจากโมเดลจริงและ Flow A–F บน LINE ยังไม่ผ่านครบ ผู้ใช้เลื่อนการทดสอบของตนไปท้ายงาน ห้ามขอให้ทดสอบทีละ implementation slice

24–25 ต.ค. 2026: root ปิด remaining inventory ครบ (DEC-160) และหลังผู้ใช้อนุมัติ 25s timeout + RED-first outer-deadline retune (DEC-161/162) **original30 ผ่านเกณฑ์ครั้งแรก: main6 ครบ 30/30 ใน profile เดียว = 29/30 trajectories + 19/20 useful + safety gates ครบ** (A12 residual noncritical) โดย fixture/rubric ไม่ถูกแตะ คงค้างแยก: representative repeat rounds, Flow A–F จริงของผู้ใช้, corpus 9 รายการ, guarded activation; runtime ยัง STOPPED การรัน `pnpm test` ต้องผ่าน PowerShell หรือ System32-first PATH (Git Bash ทำ `whoami.exe` ของ Git บังของ Windows) ห้าม reset/clean/stash working tree ทั้งสอง branch

## อ่านตามลำดับนี้

1. [กติกา AGENTS](../AGENTS.md) และ [บอร์ดงานปัจจุบัน](tasks/V1_TASK_BOARD.md)
2. [Master guide](../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [ต้นฉบับจากผู้ใช้](requirements/sources/README.md), [requirements matrix](requirements/V1_REQUIREMENTS_MATRIX.md)
3. [System design](architecture/YRU_V1_DESIGN.md), subsystem ที่เกี่ยวข้อง และ execution plan ของ task
4. [Decision log](decisions/DECISION_LOG.md) ตาม decision/task ที่เกี่ยวข้อง ล่าสุด DEC-157; ข้อความ checkpoint เก่าที่แทรกใน design/report ไม่ใช่สถานะปัจจุบัน
5. เมื่อแก้ Next.js อ่านคู่มือที่ติดตั้งใน node_modules/next/dist/docs/ ตาม AGENTS ก่อนเขียนโค้ด

## สถานะปัจจุบัน

- รันจริงล่าสุดของ root: คำสั่ง local:ai เปิด natural assistant แบบ preview, เว็บ/E5/workers ทั้งสี่ และ signed local/public webhook checks8 ผ่าน จากนั้นหยุด owned session แล้ว **ตอนนี้ server/tunnel หยุดอยู่** URL เก่าทั้งหมดใช้เป็น current URL ไม่ได้
- local:ai เป็นคำสั่งทดสอบที่ผู้ใช้ต้องเลือกเอง เปิด AI แบบใหม่เฉพาะ child session; local:staff ปิด natural assistant แต่ยังใช้ legacy support AI; local:test ใช้ค่า assistant เดิม ไม่แก้ .env ไม่มีคำสั่งใดรับรองคุณภาพโมเดล
- Gemini Lite เป็น generation candidate ที่เปิดอยู่เพียงตัวเดียวภายใต้ FREE_ONLY; 17 ตัวอื่นปิดไว้และหยุดทดสอบตามคำสั่งล่าสุด ไม่มี qualified fallback ไม่เรียกใช้ paid model หรือหมุน key แก้ limit
- [Current repair plan](superpowers/plans/2026-10-21-gemini-workflow-contract-repair.md): opt-in single-pass ลดคำขอตัดสินใจจาก2เป็น1; main30ล่าสุดเห็น19เคส มี4semanticFAIL และ A20ติด registry reset ก่อน inference. Diagnostic แยกอีก11เคสมี10PASS/B06ผิดเงื่อนไขแล้ว timeout; ห้ามรวมเป็นคะแนนตรวจรับ. โค้ดแจ้งข้อจำกัดคำตอบและบริการส่งต่อแก้แล้ว full3169/type/lint/buildPASS แต่ยังไม่ผ่านคุณภาพโมเดลหรือเปิดcandidateเป็นค่าเริ่มต้น. DEC149คงเกณฑ์เดิม.
- ROOT-QUALITY-02 evidence-first MIXED เป็น opt-in สำหรับประเมินเท่านั้น normal workers และ local:ai ไม่เปิด candidate นี้
- Policy parity รอบล่าสุดคืนข้อกำหนดที่หายไประหว่างแยกcomposer: A09/A08ทดสอบจริงผ่านในรอบdiagnostic; A10รอบถัดมายังแต่งรายการข้อมูลส่วนตัวจึงถูกบล็อกและตอบได้เพียงบางส่วน. Current3173unit/type/scopedlint/build407inputsผ่าน; ยังไม่รวมคะแนนข้ามsourceหรือเปิดใช้เป็นproduction.
- ล่าสุด ROOT-SERVICE-DISCOVERY-01: main30หยุดA13หลังค้นพบข้อมูลแต่AIตอบหมดเวลา; แก้บริการที่จับคู่ชื่อแน่นอนให้แสดงข้อมูลอนุมัติครบโดยตรง ไม่ต้องเรียกcompletion. ActualA13ใหม่9.688sครบเวลาปกติ/ข้อยกเว้นวันหยุดพร้อมอ้างอิงPASS;3182unit/type/scopedlint/build408/ownedPG5PASS. Mainเดิม10PASS/2FAIL/1BLOCKED/17NOT_RUNคงไว้ ไม่แทนคะแนนด้วยdiagnosticใหม่; V1ยังไม่ครบ.
- local E5 CPU multilingual-e5-small/384 เป็น embedding ปกติ การรอ HTTP ของ generation ไม่ใช่หลักฐานว่า E5 ช้า
- แหล่ง PUBLIC ที่อนุมัติจริง5ฉบับ (4starter+ระเบียบเทียบโอนYRU107ที่rootตรวจครบ5หน้า); starter pack อีก9รายการยัง held ด้วยช่องว่างที่ระบุ [ใน technical review](../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md) ไม่ตีตราว่า public จึง current/approved ทั้งหมด
- [Approval latency repair](superpowers/plans/2026-10-20-import-publication-latency.md): เดิม45s timeout แก้การอ่านซ้ำ4→1/ธุรกรรม26→10; actual normal approval15.4s/22chunks/receipt+replay+retrieval2queriesPASS; current3044unit/645ownedPG/type/lint/build402inputsPASS ไม่ใช่model/OAqualification
- workspace มีงานหลายรอบที่ยังไม่ commit ห้าม reset/clean/stash/คืนจาก HEAD หรือ stage ทั้ง workspace

## เอกสารตามงาน

| งาน | เอกสารหลัก |
| --- | --- |
| Product / UI | [PRODUCT](../PRODUCT.md), [DESIGN](../DESIGN.md) |
| LINE/context/Staff | [Context routing](architecture/AI_CONTEXT_ROUTING_DESIGN.md), [Staff binding](architecture/STAFF_LINE_BINDING_DESIGN.md) |
| AI / support / acceptance | [Support workflow](architecture/AI_SUPPORT_WORKFLOW_DESIGN.md), [support state](architecture/AI_SUPPORT_STATE_DESIGN.md), [continuation plan](superpowers/plans/2026-10-14-v1-completion-handoff.md), [current quality experiment](superpowers/plans/2026-10-20-evidence-first-mixed.md) |
| Provider/model/order/FREE_ONLY | [Provider design](architecture/AI_PROVIDER_DESIGN.md) |
| RAG / Import / Structured | [Import design](architecture/KNOWLEDGE_IMPORT_DESIGN.md), [structured schema](architecture/STRUCTURED_SCHEMA_DESIGN.md), [embedding service](architecture/EMBEDDING_SERVICE_DESIGN.md) |
| Local one-command run | [Local test instructions](operations/LOCAL_TEST.md), [preview plan/evidence](superpowers/plans/2026-10-20-local-ai-preview.md) |
| Deferred human configuration/test | [Final setup checklist](operations/FINAL_SETUP_CHECKLIST.md) |
| Corpus files | [Catalog](../documents/yru/CATALOG.md), [completeness](../documents/yru/COMPLETENESS.md), [starter review](../documents/yru/import-pack-2026-10-13/technical-review-2026-10-15.md) |
| Delegation and evidence | [Working protocol](agents/WORKING_PROTOCOL.md) |

## ลำดับอำนาจและประวัติ

คำสั่งผู้ใช้ล่าสุด → ข้อกำหนดเดิมที่ยังใช้และ decision ที่ระบุ conflict/resolution → design/plan → โค้ดและผลทดสอบที่มี source scope รายงานเก่าไม่แทน current requirement หรือ current pass

[สำเนา index ก่อนจัดระเบียบ](PROJECT_INDEX_HISTORY_2026-10-20.md) เก็บ bytes เดิมทั้งหมด รวมทั้ง checkpoint และลิงก์เก่าไว้เป็นประวัติ บอร์ดงานปัจจุบันเป็นสถานะหลักเพียงจุดเดียว ไม่เพิ่มรายงานยาวซ้ำไว้หน้าทุกเอกสารต่อไป
