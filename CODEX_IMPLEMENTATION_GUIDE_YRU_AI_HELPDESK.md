# YRU AI Student Support / Intelligent Helpdesk
## Codex Agent Implementation Guide

> เอกสารนี้ใช้เป็น Master Implementation Specification สำหรับ Codex Agent  
> เป้าหมายคือสร้างระบบ **AI-Powered University Student Support and Intelligent Helpdesk via LINE**  
> สำหรับมหาวิทยาลัยราชภัฏยะลา โดยเน้น V1 ที่ Anonymous, ใช้ LINE เป็นช่องทางหลัก, มี RAG, Ticket, Human Takeover, Staff Dashboard, Knowledge Import และ Document Versioning

---

# 0. เป้าหมายของ V1

ระบบต้องทำได้อย่างน้อยดังนี้

1. นักศึกษาคุยผ่าน LINE OA #1
2. ระบบรับข้อความผ่าน Webhook
3. Spam Guard ทำงานก่อนเรียก AI
4. Conversation Router แยกคำถามใหม่ / Ticket เดิม / Human Mode
5. AI ตอบคำถามทั่วไปจาก University Knowledge
6. AI ใช้ RAG จากเอกสารมหาวิทยาลัย
7. AI ใช้ Structured Data เมื่อต้องการข้อมูลที่ต้องตอบแบบแม่นยำ
8. ถ้า AI แก้ไม่ได้ ให้สร้าง Ticket
9. Ticket ถูก Route ไป Department ที่เกี่ยวข้อง
10. Staff Login เข้า Dashboard
11. Staff รับ Ticket และเข้าสู่ Human Takeover
12. Staff ตอบนักศึกษาผ่านระบบกลาง
13. Staff ไม่เห็น LINE userId จริงโดยไม่จำเป็น
14. Staff กด Resolve/Close Ticket เอง
15. หลัง Ticket ปิด AI กลับมารับคำถามใหม่
16. User สามารถมีหลาย Conversation/Ticket พร้อมกันได้
17. รองรับ Import PDF/DOCX/XLSX/CSV/URL
18. Import Pipeline วิเคราะห์ว่าเอกสารควรเป็น RAG / Structured / Both
19. เอกสารใหม่สามารถแทนเอกสารเก่าโดยไม่ลบ History
20. AI ต้องไม่สับสนเอกสารเก่า/ใหม่
21. รองรับหลาย Department
22. รองรับ AI Provider หลายเจ้าและ Fallback
23. มี Usage Log / Error Log / Health Check

---

# 1. Technology Stack

ใช้ Stack นี้เป็นค่าเริ่มต้น

- Frontend / Dashboard: Next.js App Router + TypeScript
- Backend API: Next.js Route Handlers
- Database: Supabase PostgreSQL
- Auth: Supabase Auth สำหรับ Staff
- Vector Search: Supabase pgvector
- Storage: Supabase Storage
- LINE: Messaging API
- Validation: Zod
- ORM: ไม่บังคับ แนะนำ Supabase Client + SQL Migration โดยตรง
- AI Gateway: Custom Service
- RAG: Custom Retrieval Layer
- Deployment Dev: Local + Cloudflare Tunnel
- Deployment Production: Vercel หรือ University Server
- Testing: Vitest/Jest + API integration tests

---

# 2. หลักการสำคัญที่ห้ามทำผิด

## 2.1 AI = สมอง, Backend = มือ

AI ห้ามยิง SQL เองแบบอิสระ

AI เรียก Tool ที่ Backend เตรียมไว้เท่านั้น เช่น

- searchKnowledge()
- searchStructuredData()
- searchWeb()
- findSimilarIssues()
- createTicket()
- getTicketStatus()
- assignTicket()
- escalateToHuman()

Backend เป็นผู้ตรวจสิทธิ์, validate input และ execute จริง

---

## 2.2 Anonymous V1

V1 ไม่มี students table

ห้ามสร้าง:

- students
- student_profiles
- student_grades
- registered_courses

เก็บเพียง technical identifier จาก LINE เท่าที่จำเป็น

---

## 2.3 Migration != Import

Migration ใช้เมื่อโครงสร้างระบบเปลี่ยน

ตัวอย่าง:

- เพิ่ม column
- เพิ่ม table
- เพิ่ม index
- เพิ่ม enum
- เพิ่ม function

Import ใช้เมื่อข้อมูลเปลี่ยน

ตัวอย่าง:

- ปฏิทินปีใหม่
- ระเบียบใหม่
- คู่มือ Wi-Fi ใหม่
- ค่าเทอมใหม่
- ตารางเทียบโอนใหม่

เอกสารใหม่ไม่ควรสร้าง migration ใหม่ทุกครั้ง

---

## 2.4 Versioning

เอกสารใหม่ที่มาแทนฉบับเดิม:

- เอกสารใหม่ = ACTIVE / is_current=true
- เอกสารเก่า = SUPERSEDED / is_current=false
- ห้ามลบเอกสารเก่าอัตโนมัติ

---

# 3. Project Structure

สร้างโครงสร้างประมาณนี้

```text
/
├─ app/
│  ├─ (auth)/
│  │  └─ login/
│  │     └─ page.tsx
│  │
│  ├─ (dashboard)/
│  │  ├─ layout.tsx
│  │  ├─ dashboard/
│  │  │  └─ page.tsx
│  │  ├─ tickets/
│  │  │  ├─ page.tsx
│  │  │  └─ [id]/
│  │  │     └─ page.tsx
│  │  ├─ incidents/
│  │  │  └─ page.tsx
│  │  ├─ departments/
│  │  │  └─ page.tsx
│  │  ├─ knowledge/
│  │  │  ├─ page.tsx
│  │  │  ├─ import/
│  │  │  │  └─ page.tsx
│  │  │  └─ [id]/
│  │  │     └─ page.tsx
│  │  ├─ providers/
│  │  │  └─ page.tsx
│  │  ├─ usage/
│  │  │  └─ page.tsx
│  │  ├─ logs/
│  │  │  └─ page.tsx
│  │  └─ settings/
│  │     └─ page.tsx
│  │
│  └─ api/
│     ├─ line/
│     │  ├─ student/
│     │  │  └─ webhook/
│     │  │     └─ route.ts
│     │  └─ staff/
│     │     └─ webhook/
│     │        └─ route.ts
│     │
│     ├─ tickets/
│     │  ├─ route.ts
│     │  └─ [id]/
│     │     ├─ route.ts
│     │     ├─ accept/
│     │     │  └─ route.ts
│     │     ├─ reply/
│     │     │  └─ route.ts
│     │     ├─ resolve/
│     │     │  └─ route.ts
│     │     └─ close/
│     │        └─ route.ts
│     │
│     ├─ knowledge/
│     │  ├─ import/
│     │  │  └─ route.ts
│     │  ├─ analyze/
│     │  │  └─ route.ts
│     │  ├─ approve/
│     │  │  └─ route.ts
│     │  ├─ documents/
│     │  │  └─ route.ts
│     │  └─ search/
│     │     └─ route.ts
│     │
│     ├─ providers/
│     │  ├─ route.ts
│     │  └─ health/
│     │     └─ route.ts
│     │
│     └─ incidents/
│        └─ route.ts
│
├─ components/
│  ├─ dashboard/
│  ├─ tickets/
│  ├─ knowledge/
│  ├─ providers/
│  └─ ui/
│
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts
│  │  ├─ server.ts
│  │  └─ admin.ts
│  │
│  ├─ line/
│  │  ├─ student-client.ts
│  │  ├─ staff-client.ts
│  │  ├─ signature.ts
│  │  ├─ reply.ts
│  │  ├─ push.ts
│  │  └─ loading.ts
│  │
│  ├─ ai/
│  │  ├─ gateway.ts
│  │  ├─ provider-registry.ts
│  │  ├─ fallback.ts
│  │  ├─ health.ts
│  │  ├─ prompts.ts
│  │  ├─ schemas.ts
│  │  └─ usage.ts
│  │
│  ├─ conversation/
│  │  ├─ router.ts
│  │  ├─ state-machine.ts
│  │  ├─ context-resolver.ts
│  │  └─ quick-reply.ts
│  │
│  ├─ tickets/
│  │  ├─ create-ticket.ts
│  │  ├─ route-department.ts
│  │  ├─ priority.ts
│  │  ├─ human-takeover.ts
│  │  └─ ticket-service.ts
│  │
│  ├─ knowledge/
│  │  ├─ rag.ts
│  │  ├─ retrieval.ts
│  │  ├─ chunking.ts
│  │  ├─ embeddings.ts
│  │  ├─ metadata-filter.ts
│  │  └─ citation-builder.ts
│  │
│  ├─ imports/
│  │  ├─ import-service.ts
│  │  ├─ analyzer.ts
│  │  ├─ classifier.ts
│  │  ├─ version-resolver.ts
│  │  ├─ structured-mapper.ts
│  │  ├─ pdf-parser.ts
│  │  ├─ docx-parser.ts
│  │  ├─ xlsx-parser.ts
│  │  ├─ csv-parser.ts
│  │  ├─ url-importer.ts
│  │  └─ checksum.ts
│  │
│  ├─ incidents/
│  │  ├─ similarity.ts
│  │  ├─ detector.ts
│  │  └─ incident-service.ts
│  │
│  ├─ spam/
│  │  ├─ rate-limit.ts
│  │  ├─ duplicate.ts
│  │  └─ spam-guard.ts
│  │
│  ├─ auth/
│  │  ├─ permissions.ts
│  │  └─ roles.ts
│  │
│  ├─ config/
│  │  └─ env.ts
│  │
│  └─ utils/
│     ├─ logger.ts
│     ├─ ids.ts
│     └─ dates.ts
│
├─ types/
│  ├─ database.ts
│  ├─ tickets.ts
│  ├─ knowledge.ts
│  ├─ ai.ts
│  ├─ imports.ts
│  └─ line.ts
│
├─ supabase/
│  ├─ migrations/
│  │  ├─ 001_extensions.sql
│  │  ├─ 002_departments_staff.sql
│  │  ├─ 003_line_sessions.sql
│  │  ├─ 004_conversations_messages.sql
│  │  ├─ 005_tickets.sql
│  │  ├─ 006_ticket_history.sql
│  │  ├─ 007_documents.sql
│  │  ├─ 008_knowledge_chunks.sql
│  │  ├─ 009_import_jobs.sql
│  │  ├─ 010_structured_data.sql
│  │  ├─ 011_incidents.sql
│  │  ├─ 012_ai_providers.sql
│  │  ├─ 013_ai_usage_logs.sql
│  │  ├─ 014_activities_logs.sql
│  │  ├─ 015_rls_policies.sql
│  │  ├─ 016_search_functions.sql
│  │  └─ 017_indexes.sql
│  │
│  └─ seed.sql
│
├─ tests/
│  ├─ conversation-router.test.ts
│  ├─ ticket-state-machine.test.ts
│  ├─ import-versioning.test.ts
│  ├─ metadata-filter.test.ts
│  ├─ provider-fallback.test.ts
│  └─ spam-guard.test.ts
│
├─ .env.example
├─ README.md
└─ CODEX_IMPLEMENTATION_GUIDE.md
```

---

# 4. Migration Files

## 4.1 `supabase/migrations/001_extensions.sql`

หน้าที่:

- เปิด pgcrypto
- เปิด vector extension
- extension อื่นเท่าที่จำเป็น

ตัวอย่าง:

```sql
create extension if not exists pgcrypto;
create extension if not exists vector;
```

---

## 4.2 `002_departments_staff.sql`

สร้าง:

### departments

```text
id
code
name_th
name_en
description
active
created_at
updated_at
```

ตัวอย่าง code:

- IT
- REGISTRAR
- STUDENT_AFFAIRS
- LIBRARY
- DORMITORY
- FINANCE
- ACADEMIC_AFFAIRS
- ADMIN

### staff_profiles

```text
id
auth_user_id
department_id
display_name
role
active
line_staff_user_id
created_at
updated_at
```

Role:

```text
STAFF
SUPERVISOR
ADMIN
SUPER_ADMIN
```

---

# 5. LINE Session

## `003_line_sessions.sql`

สร้าง `line_sessions`

```text
id
line_user_id_hash
line_user_id_encrypted หรือ protected value
anonymous_code
active
last_message_at
created_at
updated_at
```

หมายเหตุ:

- UI แสดง Anonymous User เช่น `Anonymous #A82F`
- Staff ไม่ควรเห็น raw LINE userId
- Backend ยังต้องมีค่าที่ใช้ส่ง Push กลับได้

---

# 6. Conversation / Message Tables

## `004_conversations_messages.sql`

### conversations

```text
id
line_session_id
conversation_type
mode
status
topic
active_ticket_id
started_at
ended_at
created_at
updated_at
```

conversation_type:

```text
GENERAL
SUPPORT
TICKET
```

mode:

```text
AI
HUMAN
```

status:

```text
ACTIVE
WAITING
RESOLVED
CLOSED
```

### messages

```text
id
conversation_id
ticket_id nullable
sender_type
sender_staff_id nullable
message_type
content
line_message_id nullable
metadata jsonb
created_at
```

sender_type:

```text
USER
AI
STAFF
SYSTEM
```

---

# 7. Ticket Tables

## `005_tickets.sql`

### tickets

```text
id
ticket_no
line_session_id
conversation_id
department_id
assigned_staff_id nullable
category
subcategory
problem_summary
priority
severity
status
mode
sensitive_level
created_at
accepted_at
resolved_at
closed_at
updated_at
```

priority:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

status:

```text
NEW
AI_HANDLING
WAITING_STAFF
STAFF_HANDLING
WAITING_USER
RESOLVED
CLOSED
CANCELLED
```

mode:

```text
AI
HUMAN
```

sensitive_level:

```text
GENERAL
SENSITIVE
RESTRICTED
```

### ticket_messages

ถ้าต้องการแยกจาก messages:

```text
id
ticket_id
sender_type
sender_staff_id
content
metadata
created_at
```

หรือสามารถใช้ messages table เดียวแล้วมี ticket_id ได้  
เลือกแนวทางเดียว อย่าสร้างข้อมูลซ้ำโดยไม่จำเป็น

---

# 8. Ticket History

## `006_ticket_history.sql`

สร้าง `ticket_history`

```text
id
ticket_id
action
from_status
to_status
actor_type
actor_id
metadata jsonb
created_at
```

action ตัวอย่าง:

- CREATED
- ROUTED
- ACCEPTED
- STAFF_REPLIED
- USER_REPLIED
- REASSIGNED
- RESOLVED
- CLOSED
- REOPENED

---

# 9. Document Versioning

## `007_documents.sql`

ต้องมี 4 table หลัก

### document_families

```text
id
code
name
category
default_storage_mode
created_at
updated_at
```

ตัวอย่าง:

```text
ACADEMIC_CALENDAR
TRANSFER_REGULATION
TUITION_FEE
WIFI_GUIDE
STUDENT_ACTIVITY_RULE
DORMITORY_RULE
LIBRARY_GUIDE
```

default_storage_mode:

```text
RAG
STRUCTURED
BOTH
```

### documents

```text
id
document_family_id
department_id
title
document_type
version_name
academic_year
published_at
effective_from
effective_to
status
is_current
authority_level
source_url
storage_path
mime_type
checksum
supersedes_document_id
created_at
updated_at
```

status:

```text
DRAFT
PENDING_REVIEW
ACTIVE
SUPERSEDED
EXPIRED
ARCHIVED
REJECTED
```

authority_level แนะนำ:

```text
100 = Official Regulation
90 = Official Announcement
80 = Official Department Website
70 = Official FAQ/Guide
50 = General Web
```

### document_relationships

```text
id
source_document_id
target_document_id
relation_type
created_at
```

relation_type:

```text
SUPERSEDES
AMENDS
ATTACHMENT_OF
RELATED_TO
CANCELS
```

### document_versions

optional ถ้าต้องการแยก version history ออกจาก documents

แต่ V1 สามารถใช้ documents แต่ละ row เป็นแต่ละ version ได้

---

# 10. Knowledge Chunks

## `008_knowledge_chunks.sql`

สร้าง `knowledge_chunks`

```text
id
document_id
document_family_id
department_id
chunk_index
page_number
section_title
content
embedding vector(...)
is_current
effective_from
effective_to
authority_level
metadata jsonb
created_at
```

สร้าง index สำหรับ vector

ต้อง filter metadata ก่อน vector search

Default retrieval:

```text
status = ACTIVE
is_current = true
effective_from <= now()
effective_to is null OR effective_to >= now()
```

แล้วค่อย similarity search

---

# 11. Import Jobs

## `009_import_jobs.sql`

สร้าง:

### import_jobs

```text
id
source_type
source_url
uploaded_file_path
status
detected_document_type
detected_family_id
detected_department_id
recommended_storage_mode
detected_version
detected_effective_from
detected_effective_to
detected_authority_level
existing_current_document_id
analysis jsonb
error_message
created_by
created_at
updated_at
```

source_type:

```text
UPLOAD
URL
```

status:

```text
UPLOADED
PROCESSING
ANALYZED
PENDING_REVIEW
APPROVED
IMPORTING
COMPLETED
FAILED
REJECTED
```

### import_staging_rows

ใช้ตอน Structured Import

```text
id
import_job_id
row_number
raw_data jsonb
normalized_data jsonb
validation_errors jsonb
created_at
```

---

# 12. Structured Data Tables

## `010_structured_data.sql`

เริ่มจาก table ที่มีโอกาสใช้จริงก่อน

### academic_calendar_events

```text
id
document_id
academic_year
semester
student_type
event_type
title
start_date
end_date
description
is_current
created_at
```

### tuition_fees

```text
id
document_id
academic_year
program_name
major_name
student_group
study_type
fee_amount
currency
effective_from
effective_to
is_current
created_at
```

### transfer_courses

```text
id
document_id
source_program
source_course_code
source_course_name
source_credits
target_program
target_course_code
target_course_name
target_credits
conditions
is_current
created_at
```

### university_services

```text
id
document_id nullable
department_id
service_code
name
description
location
opening_hours jsonb
phone
email
url
active
updated_at
```

### university_systems

```text
id
department_id
code
name
description
url
support_url
active
```

ตัวอย่าง:

- REG
- YRU_PASSPORT
- WIFI
- MICROSOFT_365
- LIBRARY

### service_forms

```text
id
department_id
name
description
form_url
requirements
active
document_id nullable
```

### announcements

```text
id
document_id
department_id
title
summary
publish_at
effective_from
effective_to
priority
active
```

---

# 13. Incidents

## `011_incidents.sql`

### incidents

```text
id
department_id
title
summary
category
severity
status
first_detected_at
last_detected_at
report_count
created_at
updated_at
```

status:

```text
DETECTED
INVESTIGATING
MONITORING
RESOLVED
CLOSED
```

### incident_tickets

```text
id
incident_id
ticket_id
similarity_score
created_at
```

---

# 14. AI Provider Tables

## `012_ai_providers.sql`

### ai_providers

```text
id
name
base_url
api_key_encrypted
enabled
priority
health_status
last_health_check
created_at
updated_at
```

### ai_models

```text
id
provider_id
model_id
display_name
supports_tools
supports_json
supports_vision
enabled
priority
timeout_ms
created_at
updated_at
```

Health:

```text
HEALTHY
DEGRADED
RATE_LIMITED
OFFLINE
UNKNOWN
```

---

# 15. Usage / Error Logs

## `013_ai_usage_logs.sql`

### ai_usage_logs

```text
id
provider_id
model_id
request_type
conversation_id
ticket_id
latency_ms
input_tokens
output_tokens
estimated_cost
status
fallback_used
created_at
```

### ai_errors

```text
id
provider_id
model_id
error_type
http_status
message
metadata
created_at
```

---

# 16. Activities / Audit

## `014_activities_logs.sql`

### activities

```text
id
actor_type
actor_id
action
entity_type
entity_id
metadata
created_at
```

ใช้ audit:

- Staff login
- Ticket accepted
- Document imported
- Document published
- Provider changed
- Settings changed

---

# 17. RLS

## `015_rls_policies.sql`

ต้องมี RLS สำหรับ Staff

หลักการ:

- Staff เห็น Ticket เฉพาะ Department ตัวเอง
- Supervisor เห็น Department ตัวเองทั้งหมด
- Admin เห็นหลายส่วนตาม permission
- Super Admin เห็นทั้งหมด
- Sensitive Ticket จำกัดเพิ่ม
- Anonymous User ไม่ query DB โดยตรง
- LINE Webhook ใช้ server-side service role เท่านั้น

---

# 18. Search Functions

## `016_search_functions.sql`

สร้าง PostgreSQL function เช่น

```text
match_knowledge_chunks(...)
```

รับ:

- query_embedding
- department_id optional
- document_family_id optional
- current_only
- max_results
- min_similarity

ต้อง filter current/effective/authority ก่อน

---

# 19. Indexes

## `017_indexes.sql`

Index อย่างน้อย:

- tickets(status)
- tickets(department_id)
- tickets(line_session_id)
- conversations(line_session_id)
- messages(conversation_id)
- documents(document_family_id, is_current)
- documents(department_id, status)
- knowledge_chunks(document_id)
- knowledge_chunks(document_family_id)
- academic_calendar_events(academic_year, semester)
- import_jobs(status)
- ai_usage_logs(created_at)
- incidents(status)

---

# 20. `lib/config/env.ts`

Validate ENV ด้วย Zod

Environment ที่ต้องมี:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

LINE_STUDENT_CHANNEL_SECRET=
LINE_STUDENT_CHANNEL_ACCESS_TOKEN=

LINE_STAFF_CHANNEL_SECRET=
LINE_STAFF_CHANNEL_ACCESS_TOKEN=

APP_BASE_URL=

DEFAULT_AI_TIMEOUT_MS=20000
HARD_AI_TIMEOUT_MS=45000

EMBEDDING_PROVIDER=
EMBEDDING_MODEL=

ENCRYPTION_KEY=
```

Provider API Keys ไม่ควรบังคับเป็น env ทุกตัว  
หลัง V1 ควรเก็บใน ai_providers แบบ encrypted

---

# 21. LINE Student Webhook

## `app/api/line/student/webhook/route.ts`

Flow:

```text
Receive Webhook
↓
Verify LINE Signature
↓
Return/prepare HTTP 200 safely
↓
Find/Create line_session
↓
Spam Guard
↓
Duplicate Check
↓
Conversation Router
↓
Handle AI / Human / Clarification
↓
Reply or Push
```

ห้าม:

- เรียก AI ก่อน verify signature
- ส่ง raw userId ไป frontend
- Broadcast staff ทุกคน

---

# 22. Spam Guard

## `lib/spam/spam-guard.ts`

ทำ:

1. Rate limit per LINE userId
2. Duplicate message detection
3. Burst detection
4. Cooldown

ค่าเริ่มต้นปรับได้:

```text
5 messages / 10 seconds
20 messages / minute
100 messages / hour
```

อย่า hardcode กระจายหลายไฟล์  
เก็บใน system_settings หรือ config กลาง

---

# 23. Conversation Router

## `lib/conversation/router.ts`

นี่คือไฟล์สำคัญที่สุดไฟล์หนึ่ง

Input:

```ts
{
  lineSessionId,
  message,
  activeConversations,
  activeTickets
}
```

Output:

```ts
{
  route:
    | "AI_NEW"
    | "AI_EXISTING"
    | "HUMAN_TICKET"
    | "ASK_CONTEXT"
    | "SPAM",
  conversationId?: string,
  ticketId?: string,
  confidence: number,
  reason: string
}
```

Rules:

1. ถ้าไม่มี Active Ticket → AI
2. ถ้ามี Active Ticket แต่ข้อความชัดว่าเกี่ยวกับ Ticket → Human Ticket
3. ถ้าข้อความชัดว่าเป็นเรื่องใหม่ → New AI Conversation
4. ถ้าไม่แน่ใจ → Quick Reply ให้ User เลือก
5. ห้ามเดา 100% ถ้า confidence ต่ำ

---

# 24. Quick Reply

## `lib/conversation/quick-reply.ts`

กรณีไม่แน่ใจ:

```text
ข้อความนี้เกี่ยวข้องกับปัญหาที่กำลังดำเนินการอยู่หรือไม่?

[🎫 ปัญหาเดิม]
[✨ คำถามใหม่]
```

ใช้เฉพาะเมื่อจำเป็น  
ไม่แสดงทุกข้อความ

---

# 25. Ticket State Machine

## `lib/conversation/state-machine.ts`

Valid transitions:

```text
NEW
→ AI_HANDLING

AI_HANDLING
→ WAITING_STAFF
→ RESOLVED

WAITING_STAFF
→ STAFF_HANDLING

STAFF_HANDLING
→ WAITING_USER
→ RESOLVED

WAITING_USER
→ STAFF_HANDLING

RESOLVED
→ CLOSED

CLOSED
→ REOPENED only if policy allows
```

ห้ามเปลี่ยน status แบบ arbitrary update

สร้าง function:

```ts
transitionTicket(ticketId, action, actor)
```

และ validate transition ทุกครั้ง

---

# 26. Human Takeover

## `lib/tickets/human-takeover.ts`

เมื่อ Staff กด Accept:

```text
ticket.status = STAFF_HANDLING
ticket.mode = HUMAN
conversation.mode = HUMAN
assigned_staff_id = staff
```

ระหว่าง HUMAN mode:

- AI ห้ามส่งคำตอบเอง
- AI ช่วย draft response ได้
- AI สรุป Ticket ได้
- AI ค้น RAG ให้ Staff ได้

Staff ต้องเป็นผู้กด Send

---

# 27. Ticket Creation

## `lib/tickets/create-ticket.ts`

ต้องรับ:

```ts
{
  lineSessionId,
  conversationId,
  category,
  subcategory,
  summary,
  department,
  priority,
  severity,
  sensitiveLevel,
  collectedContext
}
```

หลังสร้าง:

1. status = WAITING_STAFF
2. mode = HUMAN หรือรอ Accept ตาม policy
3. create ticket_history
4. send notification to Staff OA
5. reply Student ว่ารับเรื่องแล้ว

---

# 28. Department Routing

## `lib/tickets/route-department.ts`

AI วิเคราะห์ intent ได้  
แต่ Backend ต้อง map ไป Department ที่อนุญาต

ตัวอย่าง:

```text
wifi/network → IT
registration → REGISTRAR
student_activity → STUDENT_AFFAIRS
building/facility → FACILITY
library → LIBRARY
dormitory → DORMITORY
```

ไม่ใช้ keyword อย่างเดียว

ใช้ AI classification + backend mapping/rules

---

# 29. AI Gateway

## `lib/ai/gateway.ts`

Interface:

```ts
generate({
  taskType,
  messages,
  tools,
  responseSchema,
  timeoutMs
})
```

Gateway ทำ:

1. load enabled models
2. sort priority
3. call primary
4. fallback เมื่อ:
   - 429
   - timeout
   - 5xx
   - provider down
   - model unavailable
5. log usage
6. return normalized response

---

# 30. Provider Registry

## `lib/ai/provider-registry.ts`

ห้ามกระจาย provider logic ทุกไฟล์

ทุก provider ต้องใช้ interface เดียว

```ts
interface AIProviderAdapter {
  generate(...)
  healthCheck(...)
}
```

---

# 31. AI Output Schema

## `lib/ai/schemas.ts`

ใช้ Zod

Router output:

```ts
{
  intent: string,
  category: string,
  subcategory?: string,
  needsTicket: boolean,
  department?: string,
  urgency: "low" | "medium" | "high" | "critical",
  needsKnowledgeSearch: boolean,
  needsStructuredSearch: boolean,
  needsWebSearch: boolean,
  confidence: number
}
```

ห้าม parse free text แบบเปราะบางถ้า provider รองรับ JSON

---

# 32. RAG Retrieval

## `lib/knowledge/retrieval.ts`

ลำดับ Retrieval:

```text
University Structured DB
↓
University RAG
↓
Official University Website
↓
Internet Search
```

University question ต้อง prioritize internal official source

---

# 33. Metadata Filter

## `lib/knowledge/metadata-filter.ts`

ก่อน vector search ให้ filter:

```text
status = ACTIVE
is_current = true
effective date valid
authority highest
department relevant
document family relevant
```

AI ต้องไม่เห็นเอกสารเก่าถ้า User ไม่ถามเชิงอดีต

---

# 34. Historical Questions

ถ้า User ถาม:

```text
ปี 2567 เทียบโอนใช้หลักเกณฑ์อะไร?
```

Router ต้อง detect historical intent

จากนั้น retrieval อนุญาต:

```text
academic_year = 2567
```

แทน current_only

---

# 35. RAG Chunking

## `lib/knowledge/chunking.ts`

Chunk ตาม section ไม่ใช่ตัดจำนวน token อย่างเดียว

Priority:

1. heading
2. section
3. paragraph
4. table boundary

Chunk metadata ต้องมี:

- document_id
- page
- section
- family
- department
- version
- effective dates
- authority

---

# 36. Import Service

## `lib/imports/import-service.ts`

Main flow:

```text
Upload/URL
↓
Checksum
↓
Extract
↓
Analyze
↓
Classify
↓
Find existing family/current version
↓
Recommend RAG / STRUCTURED / BOTH
↓
Stage
↓
Admin Preview
↓
Approve
↓
Publish
```

ห้าม auto publish โดยไม่มี review ใน V1

---

# 37. Import Analyzer

## `lib/imports/analyzer.ts`

Extract:

- title
- department
- document type
- academic year
- published date
- effective date
- version
- authority
- likely family
- table presence
- sensitive data risk

Return:

```ts
{
  title,
  departmentCode,
  documentType,
  familyCode,
  versionName,
  academicYear,
  effectiveFrom,
  effectiveTo,
  authorityLevel,
  containsTables,
  sensitiveRisk,
  recommendedStorageMode
}
```

---

# 38. Classifier

## `lib/imports/classifier.ts`

กฎ:

### RAG

ใช้เมื่อเป็น:

- ระเบียบ
- คู่มือ
- FAQ
- ขั้นตอน
- นโยบาย
- คำอธิบาย
- troubleshooting

### STRUCTURED

ใช้เมื่อเป็น:

- รายการวันที่
- ค่าใช้จ่าย
- ตารางเวลา
- รายวิชา
- contact
- URL/service directory
- data rows ที่ต้อง exact query

### BOTH

ใช้เมื่อมีทั้ง:

- narrative rules
- structured table
- วันที่/ค่าธรรมเนียม + คำอธิบาย
- transfer rules + transfer course table

---

# 39. Version Resolver

## `lib/imports/version-resolver.ts`

ค้น:

```text
same family
same department
same document type
current version
```

ผลลัพธ์:

```ts
{
  action:
    | "NEW_FAMILY"
    | "ADD_ADDITIONAL"
    | "REPLACE_CURRENT"
    | "ADD_HISTORICAL"
    | "AMEND_EXISTING",
  currentDocumentId?: string
}
```

Important:

`REPLACE_CURRENT` ไม่ใช่ delete

ทำ:

```text
old.status = SUPERSEDED
old.is_current = false

new.status = ACTIVE
new.is_current = true

new.supersedes_document_id = old.id
```

---

# 40. Amendment

ถ้าเอกสารเป็น:

```text
ประกาศแก้ไขเพิ่มเติม ฉบับที่ 2
```

ห้าม mark เอกสารหลักเป็น superseded อัตโนมัติ

สร้าง relation:

```text
AMENDS
```

Retrieval ต้องดึง base + active amendments

---

# 41. Structured Mapper

## `lib/imports/structured-mapper.ts`

มี Schema Registry

```ts
ACADEMIC_CALENDAR -> academic_calendar_events
TUITION_FEE -> tuition_fees
TRANSFER_COURSE -> transfer_courses
UNIVERSITY_SERVICE -> university_services
SERVICE_FORM -> service_forms
ANNOUNCEMENT -> announcements
```

AI ระบุ dataset type  
Backend เป็นคนเลือก table

ห้ามให้ AI สร้าง table name เอง

---

# 42. Unknown Structured Data

ถ้าเจอเอกสารชนิดใหม่ เช่น:

```text
Shuttle Bus Schedule
```

แต่ยังไม่มี schema

V1 behavior:

```text
Recommended: RAG
Structured schema not available
Admin can request schema extension later
```

ห้ามสร้าง migration อัตโนมัติ

---

# 43. PDF Parser

## `lib/imports/pdf-parser.ts`

ต้อง:

- extract text
- preserve page numbers
- detect headings
- extract tables ถ้า library รองรับ
- fallback ถ้า scanned document
- mark low-confidence pages

ถ้า parse quality ต่ำ ให้ status `PENDING_REVIEW`

---

# 44. URL Import

## `lib/imports/url-importer.ts`

รองรับ official YRU page

เก็บ:

- original URL
- fetched_at
- title
- source domain
- content hash

ถ้า content hash ไม่เปลี่ยน → ไม่ import ซ้ำ

---

# 45. Checksum

## `lib/imports/checksum.ts`

คำนวณ SHA-256 ของ file/content

ใช้ detect duplicate

กรณี checksum ตรง:

```text
Duplicate document detected
Do not re-import
```

---

# 46. Knowledge Dashboard

## `app/(dashboard)/knowledge/page.tsx`

แสดง:

- document family
- current version
- department
- status
- storage mode
- effective date
- source
- last import
- version history

ตัวอย่าง:

```text
Academic Calendar
2569 ACTIVE Current
2568 SUPERSEDED
2567 ARCHIVED
```

---

# 47. Import Page

## `app/(dashboard)/knowledge/import/page.tsx`

ต้องมี:

```text
[ Upload File ]
[ Import URL ]

Auto Detect Type
Auto Detect Department
Auto Detect RAG/Table/Both
Extract Tables
Detect Sensitive Data
```

หลัง Analyze แสดง Preview

```text
Detected family
Detected department
Version
Effective dates
Current document found
Recommended action
Recommended storage mode
Extracted chunks
Extracted structured rows
Validation errors
```

Admin ต้องกด Approve

---

# 48. Import API

## `app/api/knowledge/import/route.ts`

รับ:

- file หรือ URL

สร้าง import_job  
ยังไม่ publish

---

# 49. Analyze API

## `app/api/knowledge/analyze/route.ts`

Run:

- parser
- analyzer
- classifier
- version resolver
- structured mapper

return preview

---

# 50. Approve API

## `app/api/knowledge/approve/route.ts`

transaction:

1. create/update document
2. supersede old version if needed
3. insert chunks
4. create embeddings
5. insert structured rows if needed
6. set import job COMPLETED
7. activity log

ถ้าขั้นใด fail → rollback

---

# 51. Ticket Dashboard

## `app/(dashboard)/tickets/page.tsx`

Filters:

- Department
- Status
- Priority
- Assigned Staff
- Date
- Sensitive Level

Cards/columns:

- New
- Waiting Staff
- Handling
- Waiting User
- Resolved

---

# 52. Ticket Detail

## `app/(dashboard)/tickets/[id]/page.tsx`

แสดง:

- Ticket ID
- Anonymous User
- Department
- Priority
- Status
- Summary
- Conversation History
- AI Summary
- Similar Tickets
- Suggested Knowledge
- Reply box
- Accept
- Reassign
- Resolve
- Close

Human mode ต้องแสดงชัด

```text
HUMAN TAKEOVER ACTIVE
AI will not auto-reply
```

---

# 53. Staff Reply API

## `app/api/tickets/[id]/reply/route.ts`

Flow:

1. validate staff permission
2. validate ticket HUMAN mode
3. store message
4. send LINE Push to Student
5. update status if needed
6. ticket_history
7. activity log

---

# 54. Staff OA

Staff OA ใช้แจ้งเตือน ไม่ใช่ chat กับ Student โดยตรง

Notification:

```text
🔴 Ticket ใหม่
T-2026-0152

ประเภท: ระบบลงทะเบียน
ระดับ: High

[รับเรื่อง]
[เปิด Dashboard]
```

Restricted ticket ห้ามส่งรายละเอียด sensitive ใน LINE

---

# 55. Similar Issue Detection

## `lib/incidents/similarity.ts`

ทำ embedding ของ problem summary

ค้น ticket/incident ใกล้เคียง

อย่าใช้ similarity อย่างเดียว

พิจารณา:

- category
- department
- location
- system
- time window
- similarity score

---

# 56. Incident Detector

## `lib/incidents/detector.ts`

ตัวอย่าง rule:

```text
same system + high similarity + 5 reports / 15 min
→ candidate incident
```

Threshold ต้อง config ได้

AI เสนอได้  
Backend rule เป็น final guard

---

# 57. Severity

## `lib/tickets/priority.ts`

AI ประเมิน severity แต่ Backend rule ช่วย

ตัวอย่าง:

```text
1 device issue → Medium
many users / registration outage → High
university-wide critical service down → Critical
```

---

# 58. Loading Indicator

## `lib/line/loading.ts`

ถ้า LINE API รองรับ loading indicator ให้ใช้ก่อน AI processing

หลีกเลี่ยงส่ง:

```text
กรุณารอสักครู่
```

ถ้าไม่จำเป็น

---

# 59. Reply vs Push

AI response ที่ทันใน Reply window → Reply API

Staff response ภายหลัง → Push API

Gateway timeout target:

```text
target < 20s
hard timeout ~45s
reply before safe LINE deadline
```

อย่า hardcode deadline แบบกระจัดกระจาย

---

# 60. Privacy Rules

V1:

ห้ามเก็บข้อมูลส่วนตัวเกินจำเป็น

ไม่ต้องมี:

- ชื่อจริง
- Student ID
- faculty
- major
- grades

ถ้า Staff ขอ Student ID ใน Ticket:

- เก็บใน Ticket context เฉพาะ case
- จำกัด permission
- ไม่เอาไปสร้าง student profile อัตโนมัติ

---

# 61. Sensitive Data Import

Import Analyzer ต้อง flag:

- รายชื่อนักศึกษา
- Student ID
- phone
- email ส่วนตัว
- grades
- medical data
- financial personal data

ถ้า detect:

```text
Sensitive data detected
Manual review required
Do not publish to public RAG
```

---

# 62. Source Authority

Retrieval rank ใช้:

```text
1. current/effective
2. authority
3. department relevance
4. semantic similarity
5. freshness
```

ไม่ใช้ semantic similarity เพียงอย่างเดียว

---

# 63. Official YRU Sources

เริ่มต้นจาก domain ทางการ เช่น

```text
yru.ac.th
eduservice.yru.ac.th
acdservice.yru.ac.th
stddev.yru.ac.th
nse.yru.ac.th
library.yru.ac.th
dormet.yru.ac.th
```

Source URL ต้องเก็บทุกครั้ง

---

# 64. Initial Document Families

Seed อย่างน้อย:

```text
ACADEMIC_CALENDAR
REGISTRATION_GUIDE
TRANSFER_REGULATION
TRANSFER_GUIDE
TRANSFER_COURSE_TABLE
TUITION_FEE
EXAM_REGULATION
GRADING_REGULATION
TRANSCRIPT_GUIDE
CERTIFICATE_GUIDE
COURSE_WITHDRAWAL_GUIDE
SPECIAL_COURSE_GUIDE
WIFI_GUIDE
YRU_PASSPORT_GUIDE
MICROSOFT_365_GUIDE
LIBRARY_GUIDE
STUDENT_ACTIVITY_RULE
VOLUNTEER_ACTIVITY_RULE
DORMITORY_RULE
```

---

# 65. Seed Departments

## `supabase/seed.sql`

เพิ่ม:

```text
IT
REGISTRAR
STUDENT_AFFAIRS
LIBRARY
DORMITORY
FINANCE
ACADEMIC_AFFAIRS
FACILITY
ADMIN
```

---

# 66. Tests

## `tests/conversation-router.test.ts`

ทดสอบ:

1. ไม่มี ticket → AI
2. มี Registration Ticket + user ถามเรื่อง Registration → Human ticket
3. มี Registration Ticket + user ถาม Library hours → New AI
4. ambiguity → ASK_CONTEXT
5. multiple active tickets → correct routing

---

## `tests/ticket-state-machine.test.ts`

ทดสอบ invalid transition

เช่น:

```text
CLOSED → STAFF_HANDLING
```

ต้อง reject

---

## `tests/import-versioning.test.ts`

Case:

```text
Academic Calendar 2568 ACTIVE
import 2569
approve replace
```

Expected:

```text
2568 SUPERSEDED
2569 ACTIVE
```

---

## `tests/metadata-filter.test.ts`

ต้องยืนยันว่า current question ไม่ดึง expired/superseded document

---

## `tests/provider-fallback.test.ts`

Primary 429 → fallback model works

---

## `tests/spam-guard.test.ts`

duplicate burst ไม่เรียก AI

---

# 67. README

## `README.md`

ต้องมี:

1. Project overview
2. Architecture
3. Prerequisites
4. ENV
5. Supabase setup
6. LINE OA setup
7. Run locally
8. Cloudflare Tunnel
9. Migration
10. Seed
11. Import first knowledge
12. Test
13. Production notes

---

# 68. Codex Implementation Order

ห้ามทำทุกอย่างพร้อมกัน

## Phase 1 — Foundation

สร้าง:

1. Next.js project structure
2. Supabase clients
3. env validation
4. migrations 001-006
5. Staff Auth
6. LINE Student webhook
7. basic conversation/messages

Acceptance:

- LINE webhook รับข้อความได้
- message ถูกเก็บ DB
- Staff login ได้

---

## Phase 2 — Ticket Core

สร้าง:

1. Conversation Router
2. Ticket State Machine
3. createTicket
4. Department Routing
5. Ticket Dashboard
6. Ticket Detail
7. Human Takeover
8. Staff Reply to Student

Acceptance:

```text
Student message
→ Ticket
→ Staff accepts
→ Staff reply
→ Student receives
→ Resolve
```

ครบ

---

## Phase 3 — AI Gateway

สร้าง:

1. ai_providers
2. ai_models
3. gateway
4. fallback
5. health
6. usage logs

Acceptance:

- primary model call
- timeout fallback
- 429 fallback
- usage log

---

## Phase 4 — RAG

สร้าง:

1. documents
2. document_families
3. knowledge_chunks
4. embedding
5. retrieval
6. metadata filter
7. current-version filtering

Acceptance:

- upload one PDF
- search chunks
- AI answer from document
- citation/source attached

---

## Phase 5 — Import Pipeline

สร้าง:

1. import_jobs
2. parser
3. analyzer
4. classifier
5. version resolver
6. preview
7. approve
8. version replacement
9. structured mapper

Acceptance:

- import old doc
- import new version
- old becomes superseded
- new becomes current
- no duplicate chunks used in current answer

---

## Phase 6 — Structured Data

สร้าง:

- academic_calendar_events
- tuition_fees
- transfer_courses
- university_services
- service_forms

Acceptance:

AI เลือก structured query เมื่อ User ถาม exact value/date

---

## Phase 7 — Advanced

สร้าง:

1. Similar Issue
2. Incidents
3. Severity rules
4. Staff OA
5. Provider dashboard
6. Analytics
7. logs

---

# 69. Definition of Done ของ V1

V1 ถือว่าเสร็จเมื่อ Demo Flow นี้ผ่านทั้งหมด

## Flow A — FAQ

```text
User: เทียบโอนต้องทำอย่างไร
→ RAG
→ answer
→ no ticket
```

## Flow B — AI Troubleshooting

```text
User: Wi-Fi ต่อไม่ได้
→ AI asks context
→ RAG guide
→ solve
→ no ticket
```

## Flow C — Escalation

```text
User: ทำตามแล้ว Wi-Fi ยังไม่ได้
→ create ticket IT
→ notify staff
```

## Flow D — Human

```text
staff accepts
→ HUMAN mode
→ staff asks user
→ user replies to same ticket
→ staff resolves
→ close
```

## Flow E — New Topic During Human Ticket

```text
Registration ticket active
User: ห้องสมุดปิดกี่โมง
→ new AI conversation
→ AI answers
→ Registration ticket remains active
```

## Flow F — Document Update

```text
Academic Calendar 2568 ACTIVE
Import 2569
→ detect same family
→ preview
→ admin approve
→ 2568 SUPERSEDED
→ 2569 ACTIVE
→ AI uses 2569 by default
```

---

# 70. สิ่งที่ห้าม Codex ทำ

1. ห้ามสร้าง students table ใน V1
2. ห้ามสร้าง table ใหม่ทุกครั้งที่ Import เอกสาร
3. ห้ามสร้าง `tuition_fees_2569`
4. ห้ามสร้าง `academic_calendar_2569`
5. ห้ามลบ old document version อัตโนมัติ
6. ห้ามให้ AI publish document โดยไม่ review
7. ห้ามให้ AI ยิง SQL แบบ arbitrary
8. ห้ามให้ AI ตอบใน HUMAN mode
9. ห้าม broadcast Ticket ให้ Staff ทุก Department
10. ห้าม expose raw LINE userId ใน Dashboard
11. ห้ามใช้ Keyword Routing เป็นตัวตัดสินหลัก
12. ห้ามใช้ Vector Similarity เพียงอย่างเดียว
13. ห้ามใช้เอกสาร superseded ใน current answer
14. ห้ามเก็บ sensitive student list เข้า public RAG
15. ห้ามสร้าง Migration จากเอกสารใหม่โดยอัตโนมัติ
16. ห้าม hardcode Provider เดียวทั่วระบบ
17. ห้าม hardcode Department Mapping กระจัดกระจาย
18. ห้ามเปลี่ยน Ticket Status โดยไม่ผ่าน State Machine

---

# 71. Prompt สำหรับ Codex Agent

สามารถให้ Codex อ่านไฟล์นี้แล้วใช้ Prompt:

```text
Read CODEX_IMPLEMENTATION_GUIDE.md completely before making changes.

Implement the project incrementally in the exact phase order described in the guide.

Important constraints:
- V1 is anonymous and must not create a students table.
- Database migrations are only for schema changes, never for normal document updates.
- Knowledge documents must support versioning, current/superseded states, effective dates and authority levels.
- AI must never execute arbitrary SQL.
- Human takeover must disable automatic AI replies for that ticket.
- A user may have multiple active conversations/tickets.
- Importing a new document must use the existing import pipeline and schema registry.
- Do not auto-create database tables for unknown structured documents.
- Do not auto-publish imported knowledge without admin approval.
- Every important backend operation must be validated and logged.

Before coding each phase:
1. inspect the current repository,
2. list the exact files you will create or modify,
3. implement the smallest complete vertical slice,
4. run tests/typecheck,
5. report what is completed and what remains.

Start with Phase 1 only.
```

---

# 72. Recommendation สำหรับการทำงานกับ Codex

อย่าให้ Codex ทำคำสั่งเดียวว่า:

```text
สร้างระบบทั้งหมดให้เสร็จ
```

ให้ทำทีละ Phase

ตัวอย่าง:

```text
Phase 1 only.
Implement project foundation, Supabase connection,
initial migrations, Staff Auth and Student LINE webhook.
Do not start AI/RAG/Ticket advanced features yet.
```

แล้วตรวจให้ผ่านก่อน

ต่อด้วย:

```text
Phase 2 only.
Implement Conversation Router, Ticket State Machine,
Ticket CRUD, Human Takeover and Staff-to-Student reply flow.
```

วิธีนี้ลดโอกาส Architecture เพี้ยนมากกว่าการให้ Agent ทำระบบใหญ่ทั้งหมดในครั้งเดียว

---

# 73. Future Extensions (ยังไม่ทำ V1)

ยังไม่ต้องทำตอนนี้:

- Student SSO
- Student Database
- SIS integration
- Grade lookup
- Registered course lookup
- Payment system integration
- University internal identity verification
- Automatic unrestricted web crawling
- Fully automatic document publishing
- Local LLM
- Multi-agent architecture เต็มรูปแบบ
- Hermes mandatory orchestration

ออกแบบให้เพิ่มภายหลังได้ แต่ไม่เพิ่ม scope V1

---

# 74. สรุป Architecture

```text
Student
  ↓
LINE OA #1
  ↓
Webhook
  ↓
Spam Guard
  ↓
Conversation Router
  ↓
┌──────────────────┬────────────────────┐
│ AI Conversation  │ Human Ticket       │
│                  │                    │
│ AI Gateway       │ Staff Dashboard    │
│ ↓                │ ↓                  │
│ Structured DB    │ Staff Reply        │
│ ↓                │ ↓                  │
│ RAG              │ Student LINE       │
│ ↓                │                    │
│ Official Web     │                    │
└──────────────────┴────────────────────┘

Knowledge Import
  ↓
Analyze
  ↓
RAG / Structured / Both
  ↓
Version Resolver
  ↓
Admin Review
  ↓
ACTIVE Knowledge
```

หัวใจของระบบไม่ใช่แค่ Chatbot

หัวใจคือ:

```text
Conversation Routing
+
Knowledge Management
+
Document Versioning
+
Ticket State Machine
+
Human Takeover
+
Department Routing
+
AI Gateway
```

ถ้า 7 ส่วนนี้ออกแบบถูก ระบบจะสามารถขยายจากโครงงานไปเป็นระบบมหาวิทยาลัยจริงได้ในอนาคต
