ไม่ควรใช้แนวคิดว่า “มีเอกสารใหม่ = สร้าง migration ใหม่” ครับ เพราะมหาวิทยาลัยมีเอกสารเปลี่ยนตลอด ถ้าทำแบบนั้นฐานข้อมูลจะพังเป็นชิ้น ๆ ในไม่กี่เดือน

แนวที่เหมาะกับระบบเราคือ **แยก “โครงสร้างระบบ” ออกจาก “เวอร์ชันของข้อมูล”** ให้ชัดเจน

## 1. เอกสารใหม่ที่มาแทนฉบับเดิม

สมมุติมี

```text
ระเบียบเทียบโอน 2567
```

วันนี้มหาวิทยาลัยออก

```text
ระเบียบเทียบโอน 2569
```

เรา **ไม่ลบ 2567 ทิ้งทันที** และไม่เอา chunks ใหม่ไปปนเฉย ๆ

ให้ระบบทำแบบนี้:

```text
2567
status = superseded
is_current = false

2569
status = active
is_current = true

2569.supersedes = 2567
```

เอกสารเก่ายังอยู่เพื่อ

- Audit
- ดูประวัติ
- ตรวจสอบ Ticket เก่า
- ตอบคำถามเชิงอดีต เช่น “ปี 2567 ใช้เกณฑ์อะไร”

แต่ตอน User ถามปกติ:

> ตอนนี้เทียบโอนยังไง

RAG จะค้นเฉพาะ

```text
is_current = true
```

ดังนั้น AI จะไม่เอาระเบียบ 2567 กับ 2569 มาปนกัน

---

## 2. สิ่งสำคัญคือ Document Versioning

ผมแนะนำให้มีประมาณนี้

```text
documents
---------
id
document_family_id
department_id
title
document_type
version_name
published_at
effective_from
effective_to
status
is_current
supersedes_document_id
source_url
file_path
checksum
authority_level
created_at
```

และ

```text
document_families
-----------------
id
name
category

ตัวอย่าง:
TRANSFER_REGULATION
ACADEMIC_CALENDAR
TUITION_FEE
WIFI_GUIDE
STUDENT_ACTIVITY_RULE
```

ตรงนี้สำคัญมาก

เพราะชื่อไฟล์อาจเปลี่ยนทุกปี เช่น

```text
ประกาศการเทียบโอน 2567.pdf
ประกาศหลักเกณฑ์การเทียบโอน 2568.pdf
แนวปฏิบัติการเทียบโอน 2569.pdf
```

แต่ระบบรู้ว่าเอกสารทั้ง 3 อยู่ใน Family เดียวกัน:

```text
TRANSFER_REGULATION
```

---

# 3. ตอน Import เอกสารใหม่ ระบบควรตรวจของเดิมก่อน

Flow ที่ผมแนะนำ:

```text
Admin Upload / Import URL
          ↓
Extract
          ↓
AI วิเคราะห์
          ↓
Document Type
Department
Document Family
Version
Effective Date
          ↓
ค้นใน Database
          ↓
มี Family เดิมไหม?
```

ถ้ามี เช่น

```text
Academic Calendar
```

ระบบแสดง Admin ว่า

```text
พบเอกสารปัจจุบัน

ปฏิทินการศึกษา 2568
Current Version

เอกสารใหม่:
ปฏิทินการศึกษา 2569

ระบบแนะนำ:
☑ ตั้ง 2569 เป็น Current
☑ Archive 2568
☑ เก็บ 2568 สำหรับ History
```

Admin กด

**Approve**

จบ

ไม่ต้อง Migration อะไรใหม่

---

# 4. RAG ก็ไม่ต้องสร้าง Vector Database ใหม่

อันนี้สำคัญมาก

เราใช้ table เดิม:

```text
knowledge_chunks
```

เอกสารทุกฉบับเข้าตารางเดียวกันได้

เช่น

```text
knowledge_chunks
---------------------------------
id
document_id
content
embedding
page_number
section
department_id
document_family_id
is_current
effective_from
effective_to
```

เวลา 2569 เข้า:

```text
2567 chunks
is_current = false

2569 chunks
is_current = true
```

แล้ว Retrieval:

```text
WHERE is_current = true
```

ก่อน Vector Search

เพราะฉะนั้น **AI ไม่สับสน**

ถ้าออกแบบ Retrieval Metadata Filtering ดี

---

# 5. แล้วกรณี Both ล่ะ?

เหมือนกันครับ

สมมุติ:

```text
ค่าธรรมเนียม 2568
```

มีทั้ง

**RAG**

และ

```text
tuition_fees
```

พอค่าธรรมเนียม 2569 มา

ไม่สร้าง

```text
tuition_fees_2569
```

เด็ดขาด

ยังใช้ table เดิม:

```text
tuition_fees
```

แต่เพิ่ม version metadata

```text
id
program_id
fee
academic_year
effective_from
effective_to
document_id
is_current
```

ตัวอย่าง:

```text
Computer Science
2568
14,000
is_current = false

Computer Science
2569
15,000
is_current = true
```

ดังนั้น User ถาม

> ค่าเทอมวิทยาการคอมตอนนี้เท่าไหร่

Backend Query:

```text
WHERE is_current = true
```

ได้ 15,000

---

# 6. เพราะฉะนั้น Migration ไม่เกี่ยวกับการเพิ่มเอกสาร

ให้แยกสองเรื่องนี้เลยครับ

### Migration

ใช้เมื่อ **โครงสร้าง Software เปลี่ยน**

เช่นเราตัดสินใจเพิ่ม Column:

```text
authority_level
```

หรือสร้าง Table ใหม่:

```text
academic_calendar_events
```

นี่ค่อย Migration

### Import

ใช้เมื่อ **ข้อมูลเปลี่ยน**

เช่น:

```text
ปฏิทิน 2569
ระเบียบใหม่
ค่าเทอมใหม่
คู่มือ Wi-Fi ใหม่
```

นี่คือ Data Import

ไม่ใช่ Migration

---

# 7. แล้ว “เอกสารชนิดใหม่เลย” ทำยังไง?

อันนี้มี 3 กรณี

## กรณี A — เป็นเอกสาร Text ใหม่

เช่นวันหนึ่ง

> คู่มือใช้บริการรถรับส่งนักศึกษา

ไม่เคยมีมาก่อน

ระบบตรวจว่าเนื้อหาเป็นคู่มือ

→ RAG

ใช้ infrastructure เดิมทันที:

```text
documents
knowledge_chunks
```

ไม่ต้อง Migration

เพียงสร้าง

```text
document_family =
SHUTTLE_BUS_GUIDE
```

จบ

---

# 8. กรณี B — มีข้อมูล Structured แต่ตรงกับ Schema ที่มีอยู่แล้ว

เช่น

> ประกาศเวลาเปิดห้องสมุดฉบับใหม่

เรามี

```text
university_services
```

อยู่แล้ว

ก็ Import ลงนั้น

ไม่ต้อง Migration

---

# 9. กรณี C — ข้อมูล Structured ใหม่จริง ๆ

สมมุติมหาวิทยาลัยเริ่มระบบใหม่:

```text
ตารางรถ Shuttle Bus
```

มี

```text
route
stop
departure_time
arrival_time
```

ระบบเดิมไม่เคยมีข้อมูลแบบนี้

ตรงนี้ **ก็ยังไม่ควรรีบสร้าง Migration อัตโนมัติ**

ผมแนะนำให้ระบบ Import บอก:

```text
Structured Data Detected

No matching structured schema found.

Suggested:
RAG only for now

Optional:
Create Structured Dataset
```

Admin อาจเลือก:

```text
RAG
```

ก่อน

AI ก็ยังตอบได้

ต่อมาถ้าเราเห็นว่าข้อมูลนี้ใช้บ่อยและต้อง Query แม่น ๆ

ค่อยสร้าง

```text
shuttle_routes
shuttle_stops
shuttle_schedules
```

ด้วย Migration ครั้งเดียว

หลังจากนั้นเอกสาร Shuttle รุ่นต่อ ๆ ไป Import ลง Table เดิมได้ทั้งหมด

---

# 10. ผมจะไม่ให้ AI Agent สร้าง Table ใหม่เองทุกครั้ง

อันนี้ค่อนข้างอันตราย

เช่น AI เจอ PDF:

```text
กิจกรรมชมรม 2569
```

แล้วสร้าง

```text
club_activities_2569
```

ต่อมา

```text
club_activities_2570
club_activities_new
activity_announcement
```

สุดท้าย Database เละ

เราต้องมี **Schema Registry**

เช่น:

```text
Dataset Type

ACADEMIC_CALENDAR
→ academic_calendar_events

TUITION_FEE
→ tuition_fees

TRANSFER_COURSE
→ transfer_courses

DEPARTMENT_CONTACT
→ department_contacts

UNIVERSITY_SERVICE
→ university_services

ANNOUNCEMENT
→ announcements
```

AI ทำหน้าที่แค่:

> เอกสารนี้น่าจะเป็น `ACADEMIC_CALENDAR`

Backend เป็นคนรู้ว่า:

> `ACADEMIC_CALENDAR` ต้องลง table ไหน

---

# 11. แล้วหลายหน่วยงานจัดการอย่างไร

อันนี้เราควรใส่ตั้งแต่แรก

```text
departments
```

ตัวอย่าง:

```text
Registrar
IT
Student Affairs
Library
Dormitory
Finance
Academic Affairs
```

ทุก Document มี

```text
department_id
```

เช่น:

```text
คู่มือ Wi-Fi
department = IT

เทียบโอน
department = Registrar

กิจกรรมจิตอาสา
department = Student Affairs
```

---

# 12. ถ้าสองหน่วยงานมีข้อมูลคล้ายกันล่ะ?

นี่เป็นอีกเรื่องสำคัญ

เช่น

กองบริการการศึกษาบอก:

> วันสุดท้ายลงทะเบียน 10 มิ.ย.

แต่อีกเว็บไซต์หนึ่งบอก:

> 12 มิ.ย.

เราต้องมี **Source Authority**

เช่น:

```text
authority_level

100 = Official Regulation
90  = Official Announcement
80  = Official Department Website
70  = University FAQ
50  = General Web
```

Retrieval จะเลือก:

```text
Current
+
Effective
+
Highest Authority
```

ก่อน

ไม่ใช่เลือกจาก Vector similarity อย่างเดียว

---

# 13. AI จะไม่สับสนได้เพราะ Retrieval เราควบคุม

User ถาม:

> วันสุดท้ายลงทะเบียนคือเมื่อไหร่

เราไม่ได้โยน Vector DB ทั้งหมดให้ AI

ระบบจะ Filter ก่อน:

```text
University = YRU

Document Family = ACADEMIC_CALENDAR

Academic Year = current

Status = ACTIVE

is_current = true
```

แล้วค่อย

```text
Vector Search
```

AI จึงเห็นข้อมูลที่ถูกกรองมาแล้ว

นี่คือเหตุผลที่ Metadata สำคัญพอ ๆ กับ Embedding

---

# 14. Import Dashboard ควรแสดง Version Conflict

ตัวอย่าง Admin Upload:

```text
ปฏิทินการศึกษา 2569.pdf
```

ระบบวิเคราะห์:

```text
Document Family
Academic Calendar

Department
Academic Services

Version
2569

Current document detected
Academic Calendar 2568

Similarity
94%
```

แล้วถาม:

```text
เอกสารนี้:

● Replace current version
○ Add as additional document
○ Historical document
```

แต่คำว่า Replace ตรงนี้ไม่ได้หมายถึง Delete

หมายถึง

```text
2568 → SUPERSEDED
2569 → ACTIVE
```

---

# 15. ถ้าเป็นเอกสารเพิ่มเติม ไม่ใช่เอกสารแทนล่ะ?

เช่นมี

```text
ระเบียบเทียบโอน 2569
```

แล้ววันหลังมี

```text
FAQ การเทียบโอน 2569
```

สองอันนี้ไม่ควร Replace กัน

เพราะเป็นเอกสารคนละประเภท

```text
Transfer Regulation
+
Transfer FAQ
```

อยู่พร้อมกันได้

AI ใช้ทั้งสอง

แต่ Authority ต่างกัน:

```text
Regulation = 100
FAQ = 70
```

ถ้าข้อมูลขัดกัน

Regulation ชนะ

---

# 16. และมีอีกแบบคือ Amendment

มหาวิทยาลัยชอบมี:

```text
ประกาศหลัก
```

แล้วตามด้วย

```text
ประกาศแก้ไขเพิ่มเติม ฉบับที่ 2
```

ตรงนี้ไม่ควรแทนฉบับเดิมเต็ม ๆ

ให้เก็บ Relation:

```text
document_relationships

base_document_id
related_document_id
relation_type = AMENDS
```

เวลา AI ตอบ:

```text
Base regulation
+
All active amendments
```

ถูก Retrieve พร้อมกัน

---

# 17. Status ของเอกสารที่ผมแนะนำ

ใช้ประมาณนี้พอ:

```text
DRAFT
PENDING_REVIEW
ACTIVE
SUPERSEDED
EXPIRED
ARCHIVED
REJECTED
```

และ Import Flow:

```text
Upload
 ↓
PROCESSING
 ↓
PENDING_REVIEW
 ↓
Admin ตรวจ
 ↓
ACTIVE
```

อย่าให้ AI Import แล้ว Active ทันที

---

# 18. หน้าจอ Knowledge Base จะประมาณนี้

```text
Knowledge Base

[Import Document]

--------------------------------------------------
Academic Calendar
--------------------------------------------------
2569      ACTIVE               Current
2568      SUPERSEDED
2567      ARCHIVED

--------------------------------------------------
Transfer Regulation
--------------------------------------------------
2569      ACTIVE
2567      SUPERSEDED

     └ Amendment #1     ACTIVE

--------------------------------------------------
Wi-Fi Guide
--------------------------------------------------
2026-08   ACTIVE
2025      SUPERSEDED
```

แบบนี้ Admin เข้าใจง่ายมาก

---

# 19. ผมอยากเพิ่ม Auto-Update Detection ภายหลัง

เช่น Admin เพิ่ม Source:

```text
https://eduservice.yru.ac.th/...
```

ระบบอาจ Check เป็นระยะ

เจอไฟล์ใหม่:

```text
New document detected

ปฏิทิน 2570

[Review]
```

แต่ **ไม่ Import Publish เอง**

ต้อง Admin Approve

เพราะข้อมูลมหาวิทยาลัยบางครั้งโพสต์ไฟล์ผิดหรือมีไฟล์ draft ได้

---

# 20. Architecture ที่ผมแนะนำสุดท้าย

```text
                SOURCE
      PDF / DOCX / Web / Excel
                  ↓
             Import Job
                  ↓
        AI Classification
                  ↓
     ┌────────────┼────────────┐
     RAG        Structured     Both
      ↓              ↓           ↓
 Documents       Dataset      ทั้งสอง
 Chunks          Tables
      ↓              ↓
      └──── Metadata Layer ────┘
                  ↓
             Versioning
                  ↓
         Admin Review/Approve
                  ↓
               ACTIVE
```

และทุกอย่างมี

```text
Department
Document Family
Version
Effective Date
Status
Authority
Current Flag
```

---

## กฎสั้น ๆ ที่จำไว้

**เอกสารใหม่มาแทนของเดิม**

> เพิ่ม Version ใหม่ + ปิด Current ของเก่า  
> ไม่ลบของเก่า

**เอกสารเพิ่มเติม**

> เพิ่มเข้า Family เดิมหรือสร้าง Family ใหม่  
> ไม่ Replace

**เอกสารใหม่สำหรับ RAG**

> ใช้ `documents + knowledge_chunks` เดิม  
> ไม่ Migration

**ข้อมูล Structured รุ่นใหม่**

> ใช้ Table เดิม + Version  
> ไม่ Migration

**ข้อมูลชนิดใหม่จริง ๆ**

> เริ่ม RAG ได้ก่อน  
> ถ้าจำเป็นต้อง Query Structured ค่อยออกแบบ Table แล้ว Migration ครั้งเดียว

**Migration**

> เกิดเมื่อ Architecture/Schema เปลี่ยน  
> ไม่ใช่ทุกครั้งที่ข้อมูลเปลี่ยน

ถ้าเราวางแบบนี้ ต่อให้ในอนาคตมี **50 หน่วยงาน + เอกสารหลายหมื่นไฟล์ + อัปเดตทุกปี** Architecture ก็ยังรับได้ครับ และตรงนี้ผมว่าควรล็อกเป็นกฎของระบบก่อนให้ Codex เริ่มสร้าง Database จริง เพราะมันจะกำหนด `documents`, `document_versions`, `document_families`, `knowledge_chunks` และ Import Pipeline เกือบทั้งหมดเลยครับ.