# YRU AI Helpdesk — จุดเริ่มอ่านของโปรเจกต์

อัปเดต 4 ตุลาคม 2026 หลังผู้ใช้ให้ทบทวนสเปคและจัดแผนก่อนกลับไปแก้โค้ด เอกสารชุดนี้เป็นทางเข้าเดียวสำหรับคนและ agent; สถานะงานปัจจุบันอยู่ใน task board ไม่ต้องไล่อ่านประวัติแชต

## อ่านตามลำดับนี้

| เอกสาร | ใช้ตอบคำถาม |
|---|---|
| [README](../README.md) | โปรเจกต์คืออะไร เริ่มใช้งานและทดสอบอย่างไร |
| [PRODUCT](../PRODUCT.md) / [DESIGN](../DESIGN.md) | Product truth และ visual baseline พร้อมข้อกำหนด minimal |
| [AGENTS](../AGENTS.md) | agent ต้องอ่านอะไรและรักษากติกาใด |
| [ต้นฉบับและที่มา](requirements/sources/README.md) | ผู้ใช้กำหนดอะไรไว้ตั้งแต่ต้น |
| [Master guide](../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md) | ขอบเขต V1 และ Flow A–F |
| [Requirements matrix](requirements/V1_REQUIREMENTS_MATRIX.md) | แต่ละข้ออยู่ในงานไหน มีหลักฐานแล้วหรือยัง |
| [System design](architecture/YRU_V1_DESIGN.md) | subsystem เชื่อมกันอย่างไรและมีขอบเขตใด |
| [Provider design](architecture/AI_PROVIDER_DESIGN.md) | AI ฟรี การจัดลำดับ UX, HTTP/โควต้าและปุ่มทดสอบ |
| [Import design](architecture/KNOWLEDGE_IMPORT_DESIGN.md) | all5formats/private originals/extraction/review/version/publication contracts |
| [Task board](tasks/V1_TASK_BOARD.md) | เสร็จอะไร งานถัดไปคืออะไร ใครรับผิดชอบ |
| [Decision log](decisions/DECISION_LOG.md) | ข้อสรุปใดมาจากผู้ใช้ ข้อใดเป็นวิธีที่ผู้พัฒนาเลือก |
| [Working protocol](agents/WORKING_PROTOCOL.md) | วิธีมอบงาน ตรวจงาน และอัปเดตเอกสาร |
| [Local setup](operations/LOCAL_SETUP.md) | ENV, Supabase, LINE, workers, tests |
| [Final setup checklist](operations/FINAL_SETUP_CHECKLIST.md) | สิ่งที่ผู้ใช้ต้องตั้งค่า/ยืนยันภายหลัง |

## ลำดับอำนาจของเอกสาร

1. คำสั่ง/คำยืนยันล่าสุดของผู้ใช้ มีผลเหนือข้อเสนอหรือตัวอย่างเก่า บันทึกไว้ใน decision log และ matrix โดยระบุว่าเป็นคำยืนยันภายหลัง
2. Master guide ใช้ร่วมกับต้นฉบับภาพรวมและ versioning; ห้ามอ่านคู่มือแล้วละเลยเป้าหมาย Zen/OpenRouter/free startup ในต้นฉบับ
3. Design แปลงข้อกำหนดเป็นวิธีทำงาน; ต้องระบุสิ่งที่มีอยู่จริงและสิ่งที่ยังวางแผน
4. Task board บอกสถานะล่าสุด; execution plan บอกรายละเอียดของ task; report บอกผลทดสอบ ณ source checkpoint นั้น
5. Roadmap และ progress ledger เก่าเก็บเป็นประวัติ ไม่ใช้สถานะเก่ามาทับ task board

หากสองแหล่งขัดกัน ให้เพิ่มรายการ conflict/decision ก่อนเปลี่ยน behavior ห้ามตีความ “ตัวอย่าง OpenAI” หรือ “Paid Emergency” เป็นการอนุมัติเปิดบริการเสียเงินเอง

## สถานะที่ต้องรู้ก่อนเริ่มงาน

- Latest human update 5 October: local CPU `intfloat/multilingual-e5-small` / 384 is default embedding infrastructure, outside normal Provider UI. Read [source](requirements/sources/2026-10-05-local-e5-embedding.md), [design](architecture/EMBEDDING_SERVICE_DESIGN.md), [EMB plan](superpowers/plans/2026-10-05-yru-local-e5-embedding.md). EMB-01…05 component acceptance passed; continue M7 review/publication before approved-corpus/live RAG acceptance. Generation stays FREE_ONLY; old registry-embedding plans/reports are dated history for that choice.

- M1–M4 มีหลักฐาน automated/DB/auth/HTTP ตามรายงาน; Student/Staff echo เคยผ่าน LINE จริงตามผู้ใช้ยืนยัน การทดสอบ ticket flow จริงยังต้องทำภายหลัง
- M5 provider automated prerequisites ผ่าน [acceptance](reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md); free/order/status/quota/probe/cooldown/compatible UI มีหลักฐานแล้ว. Live free account/Thai quality และ M6 business/full flows ยัง pending
- DOC-01 และ PRV-01…05 automated prerequisite ผ่านตามรายงาน; root กำลังเดิน Import ต่อภายใต้ contracts ปัจจุบัน
- M7 ยัง `PARTIAL / IN_PROGRESS`: acquisition/private Storage/staging/URL-query and bounded Office/PDF parser components มีหลักฐานล่าสุดใน [parser checkpoint](reports/IMP_PARSER_COMPONENT_REPORT.md). Combined1197unit/112integration/type/lint/build ผ่าน; all5-format supervised runtime/real corpus, extraction/edit/review/publication/UI และ citations ยังไม่ครบ. PDF builder final independent verdict unavailable; ดู current task board และ [E5 combined checkpoint](reports/LOCAL_E5_EMBEDDING_REPORT.md)
- ชุดเอกสารมหาวิทยาลัยเก็บ 187 resources; คัด 15 แหล่งเป็น pending review แล้ว ยังไม่ใช่ approved/indexed knowledge
- ผล426 unit/81PG/build เดิมเป็นประวัติ; PRV รอบแรกมี542unit/type/lint ผ่าน และ focused/actualPG เพิ่มตาม component report. Source ยังแก้ร่วมกับทีม จึงต้องรัน full checks ใหม่ก่อนรับ milestone
- ยังไม่เรียก live/paid AI และยังไม่ถือว่า V1 พร้อมใช้งานจริง

## ที่เก็บแผนและหลักฐาน

- [Roadmap เดิม](superpowers/plans/2026-10-04-yru-helpdesk-roadmap.md): ประวัติ Phase 0–7; ตาราง milestone ปัจจุบันอยู่ใน task board
- [Free provider execution plan](superpowers/plans/2026-10-04-yru-free-ai-providers.md): แผนแก้ M5/M6 ต้องใช้ร่วมกับ provider design ล่าสุด
- [Provider UX/status/test execution plan](superpowers/plans/2026-10-04-yru-provider-management-ux.md) และ [surface brief](ui/PROVIDER_SURFACE_BRIEF.md): tasks PRV-03/04 แบบ product minimal
- [RAG execution plan](superpowers/plans/2026-10-04-yru-rag.md), [Import execution plan](superpowers/plans/2026-10-04-yru-knowledge-import.md)
- [Provider spec audit](reports/AI_PROVIDER_SPEC_AUDIT.md), [M5 report](reports/M5_AI_GATEWAY_REPORT.md), [M6 component evidence](reports/M6_RAG_REPORT.md)
- [Documentation control report](reports/DOCUMENTATION_CONTROL_REPORT.md): source hash/link/75chapters/Flow coverage และผลreviewของทีมใน DOC-01
- [M2 Auth](reports/M2_DEVELOPMENT_AUTH_REPORT.md), [M3 LINE](reports/M3_DURABLE_LINE_REPORT.md), [M4 Tickets](reports/M4_TICKET_CORE_REPORT.md)
- [Corpus completeness](../documents/yru/COMPLETENESS.md) และ [catalog](../documents/yru/CATALOG.md)

ชื่อไฟล์ไม่จำเป็นต้องเป็น `design.md` หรือ `agent.md`; โครงการนี้ใช้ `AGENTS.md` ตาม convention และแยก design/task/requirements ตามหน้าที่ เอกสารทุกชุดต้องโยงจากหน้านี้ ไม่สร้างแผนซ้ำที่มีสถานะขัดกัน
## Latest component checkpoint

Latest human-update checkpoint: [local E5 foundation](reports/LOCAL_E5_EMBEDDING_REPORT.md), [architecture](architecture/EMBEDDING_SERVICE_DESIGN.md). E5 CPU/384 is now default infrastructure; D-only offline/realHTTP/backend/typedPG/generation-onlyUI gates PASS. Combined1197unit/112integration/22replay/RLS/advisors0/type/lint/build and6actualbrowser checks PASS. Local+DEVELOPMENT22migrations,DEV33RLS tables/9departments/rolefixtures/generatedvector384 verified. Livegeneration/corpusapproval/fullV1/production remain pending. Continue M7 extraction preview/review/publication; older statements below are dated checkpoints.

Current continuation: [parser component evidence](reports/IMP_PARSER_COMPONENT_REPORT.md). XML/Office package/XLSX and real bounded-child/dispatch focused checks are passing; DOCX/PDF team work and integration review are active. Whole-workspace gates after new parser source remain pending. Upload routes still stage only; extraction/edit/review/publication/UI and full V1 remain incomplete. The acquisition checkpoint below is dated accepted source `6d79c15`, not a full-suite pass for subsequent parser changes.

[Import acquisition/staging checkpoint](reports/IMP_ACQUISITION_STAGING_COMPONENT_REPORT.md):1065unit/63files,110integration including actual localAuth/StorageHTTP, foundationRLS,21isolatedreplay/advisors0/type/lint/build PASS. Source/CSV/HTML/URL/query/privateencryptedStorage/staging/API are component evidence. URL and Storage scoped independent reviews passed; ZIP23tests + rootselfreview passed, independent reviewer usage limited. DEV remains19migrations; PDF/Office semantics/child/extraction/edit/review/publication/UI/citations, M8/M9/fullFlowA–F and livefree/corpus/OA/production remain pending. Prior provider checkpoint is [dated acceptance](reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md). FullV1 remains active/incomplete.
