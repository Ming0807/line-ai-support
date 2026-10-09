# YRU V1 — System design

เอกสารรวม architecture วันที่ 4 ตุลาคม 2026 ใช้กับ [master guide](../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [ต้นฉบับ](../requirements/sources/README.md), [matrix](../requirements/V1_REQUIREMENTS_MATRIX.md) และ [task board](../tasks/V1_TASK_BOARD.md). แยก **มี implementation/evidence** ออกจาก **planned** ไม่ถือว่า diagram คือสิ่งที่ทำเสร็จทั้งหมด

9October current source contract: [source cascade](SOURCE_CASCADE_DESIGN.md) closes only the internal Structured EMPTY→reviewed RAG ordering and its higher-tier freshness proof. Official/general web remains root implementation. Current [board](../tasks/V1_TASK_BOARD.md) and linked dated reports supersede older planned-status examples below; deployment/live corpus/provider/OA/combined FlowA–F remain separate acceptance.

9October current incident contract: [authenticated context](INCIDENT_CONTEXT_DESIGN.md)/[runtime evidence](../reports/INCIDENT_CONTEXT_RUNTIME_REPORT.md) implements source-bound system/location proofs, worker/read freshness and retained-history compatibility. Local+DEVELOPMENT36versions/58RLS tables/exact grants/retention are verified. Live corpus/E5/operator and combined flows remain separate; [C2-Q](../reports/PUBLIC_SEARCH_QUERY_PREPARATION_REPORT.md) is unused public-query preparation only.

## System boundaries

5 October human update: default embeddings are local CPU `intfloat/multilingual-e5-small` / 384, through private FastAPI called only by Next.js backend. [Embedding design](EMBEDDING_SERVICE_DESIGN.md) owns cache/offline/prefix/configuration/typed-vector contracts. Normal Provider UI configures generation/reasoning; embedding health is read-only. Historical external adapters are compatibility code. Generation remains FREE_ONLY; foundation/import/publication/full-flow acceptance stays explicit.

Student OA เป็นช่องทางถาม/ตอบ anonymous; Staff OA เป็น alert/bind/action/เปิด Dashboard ไม่เป็น LINE ส่วนตัวที่คุยกับนักศึกษา. Staff Dashboard ใช้ Supabase Auth; backend ตรวจ department/sensitivity/active role ก่อนอ่านหรือเปลี่ยนงาน. Supabase PostgreSQL/Auth/pgvector เป็น data layer; Storage/import acquisition เพิ่มใน M7. Gateway คุม runtime generation ตาม FREE_ONLY และ priority; embeddingsใช้local E5 infrastructure. University เพิ่ม paid generation option ผ่าน UI ภายหลัง

```mermaid
flowchart TD
  S[Student LINE OA] --> V[Raw body HMAC verification]
  V --> I[Durable inbox commit then HTTP 200]
  I --> W[Inbox worker: spam / duplicate / context]
  W --> R[Conversation Router]
  R --> H[Existing HUMAN ticket]
  R --> Q[Opaque clarification / confirmation]
  R --> J[Durable AI job]
  J --> G[AI Gateway: free policy / priority / deadline]
  G --> K[Reviewed RAG / structured backend tools]
  G --> O[Final ownership / revision / evidence fence]
  H --> D[Authenticated Staff Dashboard]
  D --> T[Ticket state machine and history]
  T --> O
  O --> B[Outbox worker: Reply or Push]
  B --> S
  T --> N[Department and sensitivity scoped Staff alert]
  N --> F[Staff LINE OA]
  A[Knowledge admin] --> P[Upload or URL / extract / analyze / preview]
  P --> AP[Explicit approval and version publication]
  AP --> K
```

Diagram summarizes runtime boundaries with component evidence for ingestion/queues/tickets, free generation adapters/Provider UX, all-format import/structured publication, Staff binding/assistance and authenticated source-bound incident detection. Official/general web and final combined/live acceptance remain tracked in the current board. AI has no unrestricted SQL/search/publication authority.

## Anonymous identity และ persistence

LINE technical identity encrypted/private server boundary; browser/UI เห็น anonymous code. Studentไม่มี login/student profile; Staff identity เป็น Auth subject → active staff/permissions. Message/conversation/ticket มี ownership และ revision แยกกัน; new topic ไม่ถูกดูดเข้าตั๋วที่กำลัง HUMAN

Logical relationships ด้านล่างย่อจาก schema ปัจจุบัน ไม่ใช่ ER diagram ของทุก physical constraint:

```mermaid
erDiagram
  LINE_SESSION ||--o{ CONVERSATION : owns
  CONVERSATION ||--o{ MESSAGE : contains
  CONVERSATION ||--o{ TICKET : relates
  LINE_SESSION ||--o{ TICKET : owns
  DEPARTMENT ||--o{ STAFF : scopes
  DEPARTMENT ||--o{ TICKET : receives
  TICKET ||--o{ TICKET_HISTORY : records
  DOCUMENT_FAMILY ||--o{ DOCUMENT : versions
  DOCUMENT ||--o{ KNOWLEDGE_CHUNK : contains
  AI_PROVIDER ||--o{ AI_MODEL : configures
```

Actual SQL source อยู่ใน `supabase/migrations/`; ตัวอย่างชื่อตาราง/ไฟล์ในคู่มือไม่บังคับให้ duplicate schema เมื่อ behavior มี implementation เดิม เช่น ticket messages ผ่าน `messages.ticket_id`, versions ผ่าน documents/version_stream. Mapping ต้องมี acceptance ไม่ลบ requirement เพื่อให้ชื่อเข้ากัน

## Conversation และ ticket state

8October RAG-01A [semantic context design](AI_CONTEXT_ROUTING_DESIGN.md)/[component evidence](../reports/SEMANTIC_CONTEXT_ROUTING_REPORT.md) binds the configured free gateway in the production inbox worker. Ephemeral labels and actual USER snapshots commit before HTTP; bounded proposals map only after fresh lease/context checks. Unknown/low-confidence/stale results retain explicit owned choices. Business intent/troubleshooting and full sourced/live FlowE remain separate acceptance.

Router outcome: existing context, new AI conversation, context question หรือ blocked/spam. Context choice ใช้ opaque signed/owned/expiring tokens; ticket creation ต้อง confirmation backend-owned. AI classification เป็น structured proposal ที่ตรวจ against user text/applicability/active departments; ไม่ใช้ keyword เป็น final router

State machine มี implementation ใน `lib/conversation/state-machine.ts`:

```mermaid
stateDiagram-v2
  [*] --> WAITING_STAFF: confirmed ticket creation
  WAITING_STAFF --> STAFF_HANDLING: ACCEPT
  STAFF_HANDLING --> WAITING_USER: STAFF_REPLY
  WAITING_USER --> STAFF_HANDLING: USER_REPLY
  STAFF_HANDLING --> RESOLVED: RESOLVE
  RESOLVED --> CLOSED: CLOSE
  CLOSED --> WAITING_STAFF: authorized REOPEN
```

Schema ยังมี NEW/AI_HANDLING/CANCELLED แต่ service ไม่อนุญาต arbitrary transition. ACCEPT ตั้ง HUMAN; AI job/result/outbox ต้องตรวจ ownership/mode/revision อีกครั้งก่อนส่ง; เฉพาะ conversation ของ ticket นั้นถูกยับยั้ง new AI topic ยังคุยได้. เจ้าหน้าที่เป็นผู้ resolve/close; late reply ใช้ queued push ผ่าน Student OA และมี audit/idempotency

## Durable boundaries และ race handling

- Webhook อ่าน raw bytes ตรวจ HMAC ก่อน JSON; valid empty events ตอบ 200. Durable path commit inbox ก่อน ACK; ไม่มี model call ใน webhook transaction
- Inbox/outbox/AI jobs ใช้ leases/order/retry/idempotency; classify unsupported events โดยไม่สร้าง Student identity จาก Staff OA
- AI worker snapshot ใน short transaction → generation/embedding/search HTTP นอก transaction → stored result → reauthorize/revision/evidence checks → atomic message/outbox/job finalization. Retry ที่มี saved result ไม่ regenerate
- LINE dispatch revalidates HUMAN/revision และ eligible citations. Publication ใช้ sorted family locks ก่อน document locks ก่อน row locks; delivery ใช้ matching session/family/document fence ตาม M6 plan/report. ห้ามข้าม fence เมื่อ M7 เพิ่ม version/amendment
- Runtime tools have allowlisted parameters/owned confirmation/atomic receipts. Seven installed datasets use authenticated exact queries/provenance and repeated source fences. Scoped semantic similarity and authenticated system/location context are implemented; bounded external web and final combined/live acceptance remain pending.

## AI Provider

Contract รายละเอียดอยู่ใน [AI provider design](AI_PROVIDER_DESIGN.md). Default FREE_ONLY ครอบคลุม generation/test และ deterministic bounded fallback; embeddingsใช้local E5 infrastructure. Provider/Model ordering, HTTP observation, quota scope และ selected-model probe เป็น requirement ของ generation UI ไม่ลดเหลือ server priority field/one health badge

PRV-01…05 automated prerequisiteผ่าน [provider acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md): verified free Zen/OpenRouter/order/status/probes/cooldown/compatible configuration. Live free quality/account evidenceยังpending; M7เดินต่อหลัง gatesจริง ไม่เปลี่ยนลำดับmasterเพื่อเลี่ยงgap

## RAG และ versioned knowledge

Metadata scope: PUBLIC/reviewed/approved, official source, current/effective, family/year/audience/student type, authority, department แล้วจึง similarity/freshness. Historical question ระบุปี/date ที่มาจาก user; ambiguity ให้ถามกลับ ไม่ปล่อย LLM เดา current academic year/cohort

Chunks มี document/page/section/source provenance; citations สร้างจาก IDs ที่ retrieval ส่งจริงไม่รับ URL/title/page ที่ model แต่ง. Embedding cohort แยก fingerprint/dimension/provider/model configuration ไม่ผสมเวกเตอร์ข้ามรุ่น. Exact prefiltered distance ใช้กับ shortlist; ANN ยังต้องเลือก cohort/วัด recall

Document family/version streams preserve current uniqueness and history. Current replacement marks the old version SUPERSEDED without deletion; supplemental instruments never replace the base. Accepted relationship retrieval resolves complete base/amendment/cancellation groups before similarity, with reviewed publication/approval/catalog UI and delivery fences. See [relationship evidence](../reports/IMP_RELATIONSHIP_RETRIEVAL_REPORT.md); real university corpus approval remains separate.

## Import และ fixed structured data — component evidence

Target: PDF/DOCX/XLSX/CSV/URL → private original/checksum → bounded extraction → quality/sensitivity flags → family/department/date/authority/classification proposal → editable version-conflict preview → explicit approval → atomic version/chunks/dataset publication

The private all-five-format import/review/catalog and atomic RAG/STRUCTURED/BOTH components are accepted at their dated checkpoints. RAG persists prepared chunks/vectors, STRUCTURED persists authenticated typed rows without embeddings, BOTH persists both atomically with the same immutable receipt/version/relationship effects. Review3 preserves source mapping and deliberate approval. [Atomic evidence](../reports/STRUCTURED_ATOMIC_PUBLICATION_REPORT.md), [search/delivery](../reports/STRUCTURED_SEARCH_DELIVERY_REPORT.md), [combined UI](../reports/V1_COMBINED_UI_REPORT.md). Actual PDF400/409 recovery retains original bytes/located text/rows and unresolved warnings; [recovery](../reports/IMP_PDF_RECOVERY_REPORT.md). Local+DEVELOPMENT now36versions/58RLS application tables, seven runtime-ready datasets; no real university source was approved automatically. Final combined calendar/current/history/import flow and live corpus acceptance remain pending.

แผน M7 เดิมเริ่ม PDF/HTML slice; **ไม่ครบ V1 file types** จึงมี IMP-02 ต่อ DOCX/XLSX/CSV และ tests. Storage/encryption/access/retention ต้องมี plan ก่อน implementation ไม่อ้างว่ามี Supabase bucket พร้อมแล้ว. Low-quality/OCR/cohort/source warnings อยู่ PENDING_REVIEW จนคนตรวจ ไม่มี publish อัตโนมัติ

M8 registry จำกัด 7 datasets: `academic_calendar_events`, `tuition_fees`, `transfer_courses`, `university_services`, `university_systems`, `service_forms`, `announcements`. Exact dates/fees ใช้ validated structured query และ citation/version. Unknown dataset → RAG proposal/manual schema change ภายหลัง ไม่ AI DDL และไม่มีตารางรายปี

## Advanced และ operations — component evidence / remaining integration

Staff alerts target active/bound/authorized staff in the exact department/sensitivity scope. Self binding, HUMAN manual AI drafts/internal cited knowledge, scoped incidents/operational reads/metrics/UI, loading transport and private worker observation components have dated acceptance in the board. Observed timestamps never imply process health; unknown remains explicit. Verified system/location context, official/general web and final combined FlowA–F are remaining root implementation/acceptance. Real OA/account/corpus/deployment checks remain deferred human setup.

Staff-only AI assistanceระหว่างHUMANต้องแยกflow: authorizedstaffขอสรุป/แนะนำreply/knowledge/similartickets/route/severity → validatedgateway/tools → draftในDashboard. Studentไม่รับผลจนstaffกดส่งผ่านStaffReplyAPIตามstate machine. Master§52ต้องมีsummary/relatedtickets/knowledgecoverage ไม่ถือว่ามีmessagehistoryแล้วครบ

Dashboard modulesเป้าหมายมี **13**: Overview, Tickets, Incidents, Departments, Knowledge Base, Activities, AI Providers, AI Models, Fallback Rules, Usage, Analytics, Logs, Settings. ไม่จำเป็นต้องเป็น13routesแยก; Providers/Models/Fallbackอยู่surfaceเดียวได้แต่ต้องมีacceptanceของทุกfunction. Overview8metricsในต้นฉบับต้องมาจากจริง: Questions Today, AI Resolved, Human Escalations, Open Tickets, Urgent Tickets, Active Incidents, Common Problems, AI Provider Status. ไม่มีStudentManagement/ตัวเลขfixtureในruntimeUI

Rich Menuในต้นฉบับ§20เป็นข้อเสนอสำหรับprimaryentry (AskAI/MyTickets/Guides/ContactStaff) ไม่แทนcontextQuickReply. เก็บเป็นplannedoption ADV-05; ต้องระบุdecisionก่อนทำหรือdefer ไม่หายจากแผนเพราะไม่มีในchapterอื่น

Deployment ต้องมี web + inbox/outbox/AI/import workers ที่มี lifecycle ชัดเจน ไม่สมมติว่า route บน Vercel จะเป็น continuous worker. Production hosting/domain/backup/storage/observability เป็น final deployment contract ที่ยังไม่เลือก

## การตรวจรับ

Current M7 catalog/assistance contracts: [approved administrative inventory](KNOWLEDGE_CATALOG_DESIGN.md), [private prepared metadata](IMPORT_ASSISTANCE_DESIGN.md), [browser API boundaries](../operations/BACKEND_UI_CONTRACTS.md). Root supplies read-only backend/auth/SQL/revision/retention evidence; Gemini owns separate Dashboard presentation and submits commits for combined acceptance. No migration or normal-provider embedding change is introduced. See [current backend report](../reports/KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md) rather than treating an API component pass as full UI/usability/V1 evidence.

Unit/property behavior + actual PostgreSQL/RLS/concurrency + signed HTTP + authenticated browser ตรวจ component. Flow A–F ตรวจ business behavior ข้าม subsystem และแยก controlled mock transport จาก live free provider/OA. คำสั่ง/หลักฐานอยู่ใน reports; manual gates อยู่ใน [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md)

Document checkpoint นี้ไม่ได้รัน application build ใหม่ และไม่ทำให้ pending pricing RED test ผ่าน การปิด milestoneต้องตรวจ source ที่รวมแก้แล้วจริง ไม่เอาจำนวน tests ก่อนแก้มาอ้าง whole completion
