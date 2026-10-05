ภาพรวมโปรเจกต์

โปรเจกต์นี้คือระบบ AI Student Support / AI Helpdesk สำหรับมหาวิทยาลัยผ่าน LINE

แนวคิดหลักคือให้คนใช้งานได้ง่ายที่สุด เพราะนักศึกษาและบุคลากรคุ้นเคยกับ LINE อยู่แล้ว ไม่ต้องติดตั้งแอปใหม่ ไม่ต้องเข้าหน้าเว็บเพื่อถามคำถาม และในช่วงเริ่มต้น ไม่ต้อง Login ไม่ต้องกรอกรหัสนักศึกษา และไม่ต้องรู้ด้วยซ้ำว่าคนที่กำลังคุยคือใคร

ระบบจะช่วยตอบคำถามทั่วไป แก้ปัญหาเบื้องต้น ค้นข้อมูลมหาวิทยาลัยจากเอกสาร และถ้าเป็นปัญหาที่ AI จัดการไม่ได้ ระบบจะรวบรวมข้อมูลจากบทสนทนาแล้วสร้าง Ticket ส่งต่อเจ้าหน้าที่ที่เกี่ยวข้อง

ภาพรวมคือ:

นักศึกษา / ผู้ใช้
        ↓
LINE
        ↓
AI ช่วยตอบและแก้ปัญหา
        ↓
ถ้า AI แก้ได้
→ ตอบจบตรงนั้น

ถ้า AI แก้ไม่ได้
→ สร้าง Ticket
→ ส่งฝ่ายที่เกี่ยวข้อง
→ เจ้าหน้าที่รับช่วง
→ พูดคุยกับผู้ใช้ผ่านระบบกลาง
→ ปิด Ticket
→ AI กลับมารับคำถามใหม่


---

1. เราจะมี LINE Official Account 2 บัญชี

โครงล่าสุดคือแยก LINE ออกเป็น 2 OA

LINE OA #1
สำหรับนักศึกษา / ผู้ใช้ทั่วไป

LINE OA #2
สำหรับเจ้าหน้าที่

OA #1 — Student AI Support

เป็นช่องทางหลักของนักศึกษา

นักศึกษาสามารถถามได้เช่น:

ลงทะเบียนเรียนยังไง

เทียบโอนได้ไหม

กิจกรรมมหาวิทยาลัยมีอะไรบ้าง

ต่อ Wi-Fi ไม่ได้

เข้าเว็บลงทะเบียนไม่ได้

คอมในห้องเรียนเสีย

Microsoft 365 ใช้งานไม่ได้

แจ้งปัญหาอาคาร

AI จะเป็นด่านแรกในการตอบและวิเคราะห์ปัญหา


---

OA #2 — Staff Alert

ไม่ได้เอาไว้ให้เจ้าหน้าที่นั่งคุยกับนักศึกษาโดยตรงแบบ LINE ส่วนตัว

เอาไว้สำหรับ:

แจ้ง Ticket ใหม่

แจ้ง Ticket เร่งด่วน

แจ้ง Ticket ที่ถูกส่งมาหาฝ่ายของตน

รับเรื่อง

เปิด Dashboard

ติดตามสถานะ

ตัวอย่าง:

🔴 Ticket ใหม่

T-2026-0152

ประเภท:
ระบบลงทะเบียน

ระดับ:
High

[รับเรื่อง]
[เปิด Dashboard]

จุดสำคัญคือ ไม่แจ้งทุก Ticket ให้เจ้าหน้าที่ทุกคน

ระบบจะ Route ตามฝ่าย

เช่น:

Wi-Fi
→ IT

ลงทะเบียน
→ งานทะเบียน

กิจกรรมนักศึกษา
→ กิจการนักศึกษา

อาคารเสีย
→ อาคารสถานที่


---

2. เจ้าหน้าที่กับนักศึกษาไม่ต้อง Add LINE ส่วนตัวกัน

นี่คือแนวทางที่เราตัดสินใจแล้ว

เจ้าหน้าที่ไม่ต้องรู้ LINE ส่วนตัวของนักศึกษา และนักศึกษาก็ไม่ต้องรู้ LINE ส่วนตัวเจ้าหน้าที่

การคุยกันจะผ่านระบบกลางทั้งหมด

Student LINE OA
       ↓
    Backend
       ↓
    Ticket
       ↓
Dashboard / Staff
       ↓
    Backend
       ↓
Student LINE OA

Backend จะรู้ว่า Ticket นั้นเป็นของ LINE userId ไหน

แต่เราไม่จำเป็นต้องแสดง userId ให้เจ้าหน้าที่เห็น

เจ้าหน้าที่อาจเห็นเพียง:

Anonymous User #A82F


---

3. V1 จะเป็น Anonymous

ตอนเริ่มต้นเรา ไม่สร้าง Student Database

ดังนั้นไม่ต้องมี:

students
student_name
student_id
faculty
major
year
registered_courses
grades

และไม่ต้อง Migration ข้อมูลนักศึกษาทั้งมหาวิทยาลัยเข้ามา

นี่เป็นการตัด scope ใหญ่ส่วนหนึ่งออกไปเลย

ระบบจะใช้เพียง LINE userId เป็น identifier ทางเทคนิค

ประมาณ:

U5a92xxxxxxxxxx

เพื่อให้รู้ว่า:

ข้อความนี้มาจากใคร

Ticket นี้เป็นของ LINE คนไหน

ต้องส่งคำตอบกลับ LINE คนไหน

ไม่ได้ใช้เพื่อระบุตัวตนจริง


---

4. ไม่ต้องถามรหัสนักศึกษาตั้งแต่ต้น

เราเคยคิดว่าจะให้ User กรอกรหัสนักศึกษา แต่ตัดแนวคิดนี้ออกแล้ว

เพราะถ้าเราขอ Student ID จริง ๆ เราจะเริ่มเข้าสู่เรื่อง:

ต้องตรวจว่ารหัสนี้มีจริงไหม

เรียนคณะไหน

ลงวิชาอะไร

มีสิทธิ์อะไร

ข้อมูลทะเบียนเป็นอย่างไร

ต้องเชื่อมระบบมหาวิทยาลัย

ต้องจัดการ Authentication

ต้องจัดการข้อมูลส่วนบุคคล

ซึ่งทำให้โปรเจกต์ใหญ่ขึ้นมาก

ดังนั้น V1 คือ:

> เราไม่สนว่าเขาเป็นใคร เราสนว่าเขามีปัญหาอะไร




---

5. ถ้าเป็นคำถามเฉพาะบุคคล AI จะไม่เดา

ตัวอย่าง User ถาม:

> ทำไมผมลงทะเบียนวิชานี้ไม่ได้ ทั้งที่เพื่อนลงได้



AI ไม่มีข้อมูลการลงทะเบียนของ User

ดังนั้นไม่ควรแต่งคำตอบขึ้นมาเอง

AI ควรตอบประมาณ:

ตอนนี้ผมยังไม่สามารถเข้าถึงข้อมูลส่วนตัว
หรือข้อมูลการลงทะเบียนเฉพาะบัญชีของคุณได้

ผมจะรวบรวมรายละเอียดของปัญหา
และส่งต่อให้เจ้าหน้าที่ที่เกี่ยวข้องตรวจสอบเพิ่มเติมครับ

จากนั้น:

Create Ticket
        ↓
งานทะเบียน

ถ้าเจ้าหน้าที่ต้องการข้อมูลเพิ่ม ค่อยถามในภายหลัง เช่น:

กรุณาแจ้งรหัสนักศึกษาและรหัสวิชาที่พบปัญหาครับ

User เป็นคนส่งข้อมูลเอง เฉพาะเมื่อจำเป็นกับ Ticket นั้น

ไม่ต้องมีข้อมูลนักศึกษาทั้งระบบล่วงหน้า


---

6. AI เป็น First-Level Support

AI เป็นด่านแรก

แต่เป้าหมายไม่ใช่ให้ AI พยายามแก้ทุกอย่าง

AI ทำหน้าที่ประมาณ:

เข้าใจคำถาม

ตอบ FAQ

ค้นข้อมูล

Troubleshooting

ค้นเอกสาร

ค้นข้อมูลระบบ

ค้น Internet

ตรวจปัญหาคล้ายกัน

รวบรวมข้อมูลจากบทสนทนา

ตัดสินใจว่าต้องสร้าง Ticket หรือไม่


---

7. ไม่ใช้ Keyword Routing แบบง่าย

เราไม่อยากได้ระบบประมาณ:

เจอคำว่า "Wi-Fi"
→ IT

เจอคำว่า "ลงทะเบียน"
→ ทะเบียน

เพราะ User อาจพิมพ์:

> พรุ่งนี้ต้องลงวิชาแต่เว็บเข้าไม่ได้ ขึ้น error 500



AI ต้องอ่านทั้งบริบท แล้ววิเคราะห์ว่า:

{
  "intent": "report_problem",
  "category": "university_system",
  "subcategory": "registration",
  "problem": "server_error",
  "urgency": "high",
  "department": "IT",
  "needs_ticket": true
}

AI จึงเป็นตัวเข้าใจภาษา

ส่วน Backend เป็นตัวดำเนินการ


---

8. AI = สมอง / Backend = มือ

หลักการสำคัญ:

AI
= วิเคราะห์และตัดสินใจ

Backend
= ทำงานจริง

Database
= เก็บข้อมูล

LINE
= ช่องทางสื่อสาร

Dashboard
= ศูนย์ควบคุม

AI ไม่ควรสามารถยิง SQL อะไรก็ได้

เราให้ AI เรียก Tool ที่ Backend เตรียมไว้

เช่น:

searchKnowledge()

searchDatabase()

searchWeb()

findSimilarIssues()

createTicket()

getTicketStatus()

assignTicket()

escalateToHuman()


---

9. Flow ของคำถามทั่วไป

ตัวอย่าง:

> เทียบโอนรายวิชาต้องทำอย่างไร



ระบบ:

LINE
 ↓
Spam Check
 ↓
AI
 ↓
searchKnowledge()
 ↓
RAG
 ↓
พบระเบียบเทียบโอน
 ↓
AI สรุป
 ↓
ตอบ LINE

ไม่มี Ticket

ไม่มีเจ้าหน้าที่เข้ามาเกี่ยวข้อง


---

10. Flow ของปัญหาที่ AI แก้เองได้

เช่น:

> Wi-Fi ต่อไม่ได้



AI อาจถาม:

ใช้อุปกรณ์อะไรครับ?

มี Error ขึ้นว่าอะไร?

เคยเชื่อมต่อ Wi-Fi นี้มาก่อนหรือไม่?

จากนั้น:

RAG
+
Internet Search
+
Troubleshooting

ถ้าแก้ได้:

Resolved by AI

จบ


---

11. Flow ของปัญหาที่ AI แก้ไม่ได้

ตัวอย่าง:

> ทำตามหมดแล้วแต่ยังต่อ Wi-Fi ไม่ได้



หรือ:

> คอมในห้อง 304 เปิดไม่ติด



AI อาจรวบรวม:

อาคาร
ห้อง
อุปกรณ์
Error
สิ่งที่ลองทำแล้ว

แล้ว:

Create Ticket
     ↓
Department = IT
     ↓
Status = WAITING_STAFF

จากนั้น AI แจ้ง User ว่าเรื่องถูกส่งต่อแล้ว


---

12. Ticket System

Ticket จะเป็นหัวใจของ Human Support

ตัวอย่าง:

Ticket ID:
T-2026-00125

User:
Anonymous #A82F

Problem:
ลงทะเบียนรายวิชาแล้วรายวิชาไม่แสดง

Category:
Registration

Department:
Registrar

Priority:
Medium

Status:
WAITING_STAFF

Created:
...

รวมถึง Conversation History


---

13. AI จะหยุดตอบเมื่อ Human Takeover

ตอนเจ้าหน้าที่รับ Ticket แล้ว

เราจะเปลี่ยน:

mode = AI

เป็น:

mode = HUMAN

AI จะไม่ตอบข้อความที่เกี่ยวกับ Ticket นั้นเอง

เพราะไม่ต้องการให้เกิด:

เจ้าหน้าที่ตอบ
AI ตอบ
เจ้าหน้าที่ตอบ
AI ตอบ

ซึ่งจะทำให้ User งง


---

14. AI ยังทำงานเบื้องหลังตอน Human Mode ได้

แม้ AI จะไม่ตอบ Student เอง

แต่ยังช่วยเจ้าหน้าที่ได้ เช่น:

สรุป Ticket

สรุปบทสนทนา

แนะนำคำตอบ

ค้น Knowledge

ค้น Ticket คล้ายกัน

แนะนำฝ่ายที่จะส่งต่อ

วิเคราะห์ Severity

แต่ต้องให้เจ้าหน้าที่เป็นคนกดส่งข้อความจริง


---

15. Ticket Lifecycle

เราจะควบคุมการสนทนาด้วย State

ประมาณ:

NEW
 ↓
AI_HANDLING
 ↓
WAITING_STAFF
 ↓
STAFF_HANDLING
 ↓
WAITING_USER
 ↓
RESOLVED
 ↓
CLOSED

ตัวอย่าง:

เจ้าหน้าที่กด:

[รับเรื่อง]

→

STAFF_HANDLING
mode = HUMAN

เจ้าหน้าที่ถาม User:

ขอข้อมูลเพิ่มเติมครับ

→

WAITING_USER

Student ตอบ

→ Ticket เดิมยังเป็น Human Mode


---

16. จบ Human Conversation อย่างไร

AI ไม่ควรเป็นคนเดาว่าเรื่องจบแล้วหรือยัง

เจ้าหน้าที่เป็นคนกด:

[แก้ไขเรียบร้อย]

หรือ:

[ปิด Ticket]

จากนั้น:

RESOLVED
 ↓
CLOSED

Conversation ของ Ticket นี้จบ

AI สามารถกลับมารับคำถามใหม่ของ User ตามปกติได้


---

17. User สามารถมีหลายเรื่องพร้อมกันได้

อันนี้สำคัญมาก

สมมุติ User มี Ticket:

T-001
ลงทะเบียนไม่ได้
mode = HUMAN

แต่ User พิมพ์:

> ห้องสมุดปิดกี่โมง



นี่ไม่ใช่เรื่องเดิม

ระบบไม่ควรส่งไปให้เจ้าหน้าที่ทะเบียน

AI Router จะวิเคราะห์ว่าเป็น คำถามใหม่

แล้วสร้าง Conversation ใหม่:

C-002
Library Hours
mode = AI

AI ตอบได้ตามปกติ

ขณะที่:

T-001 Registration

ยังคงดำเนินต่อ


---

18. ถ้า AI ไม่แน่ใจว่าเป็นเรื่องเดิมหรือเรื่องใหม่

ใช้ Quick Reply

ตัวอย่าง:

ข้อความนี้เกี่ยวข้องกับปัญหา
การลงทะเบียนที่กำลังดำเนินการอยู่หรือไม่?

[🎫 ปัญหาเดิม]
[✨ คำถามใหม่]

User เป็นคนเลือก

ทำให้ Routing ไม่ต้องพึ่ง AI 100%


---

19. Quick Reply ไม่ได้เด้งทุกข้อความ

เราจะใช้ Quick Reply เฉพาะสถานการณ์ที่จำเป็น

เช่น:

AI แยก Context ไม่ออก

ต้องการให้ User เลือก

ต้องการยืนยัน Action

พอ User กดหรือส่งข้อความใหม่ Quick Reply จะหาย

ดังนั้นไม่รบกวนการสนทนา


---

20. Rich Menu

นอกจาก Quick Reply เราสามารถมี Rich Menu ถาวรด้านล่าง LINE เช่น:

┌─────────────────────────┐
│ 🤖 ถาม AI │ 🎫 Ticket ของฉัน │
├─────────────────────────┤
│ 📚 คู่มือ │ 📢 ติดต่อเจ้าหน้าที่ │
└─────────────────────────┘

Rich Menu เป็นเมนูหลัก

ส่วน Quick Reply เป็นเมนูเฉพาะสถานการณ์


---

21. Conversation Router

Backend ควรมีส่วนกลางชื่อประมาณ:

Conversation Router

ทำหน้าที่ตัดสิน:

Message นี้

→ AI ?

→ Ticket เดิม ?

→ Ticket ใหม่ ?

→ Human ?

→ Spam ?

Flow:

Student Message
       ↓
Spam Guard
       ↓
Conversation Router
       ↓
มี Active Ticket หรือไม่?
       ↓
Message เกี่ยวกับ Ticket ไหน?
       ↓
┌──────────────┬──────────────┐
AI Conversation     Human Ticket
       ↓                   ↓
      AI                Staff


---

22. Spam Protection

Spam ต้องถูกกรอง ก่อนถึง AI

เพราะเป้าหมายของเราคือใช้ฟรีให้มากที่สุด

ถ้าปล่อย Spam เข้า AI ทุกครั้ง เราเสีย API quota

Flow:

LINE
 ↓
Webhook
 ↓
Spam Guard
 ↓
Rate Limit
 ↓
Duplicate Check
 ↓
Conversation Router
 ↓
AI


---

23. วิธีป้องกัน Spam

เราใช้ LINE userId ได้เลย

ไม่ต้องรู้ว่าเป็นใคร

ตัวอย่างตั้ง:

5 messages / 10 sec

20 messages / minute

100 messages / hour

ตัวเลขจริงค่อย Tune ทีหลัง

ตรวจข้อความซ้ำด้วย

เช่นส่ง:

ลงทะเบียนยังไง
ลงทะเบียนยังไง
ลงทะเบียนยังไง
ลงทะเบียนยังไง

ภายในไม่กี่วินาที

ระบบสามารถ ignore/cooldown โดยไม่เรียก AI


---

24. RAG

RAG เป็น Knowledge Base ของมหาวิทยาลัย

ตัวอย่างเอกสาร:

คู่มือนักศึกษา

ระเบียบเทียบโอน

คู่มือลงทะเบียน

คู่มือ Wi-Fi

Microsoft 365 Guide

ระเบียบกิจกรรม

FAQ

ประกาศ

เราไม่ได้ Train AI ใหม่

แต่ให้ AI ค้นเอกสารก่อนตอบ


---

25. RAG Flow

Admin Upload PDF:

PDF
 ↓
Extract Text
 ↓
Clean
 ↓
Chunk
 ↓
Embedding
 ↓
Supabase pgvector

ตอน User ถาม:

Question
 ↓
Embedding
 ↓
Vector Search
 ↓
Relevant Chunks
 ↓
LLM
 ↓
Answer


---

26. Database กับ RAG แยกกัน

Database ใช้ข้อมูล Structured

เช่น:

tickets
departments
conversations
messages
activities
providers
models

RAG ใช้ข้อมูล Document

เช่น:

PDF
Word
คู่มือ
ประกาศ
FAQ


---

27. Internet Search

AI สามารถใช้ Search Web ได้ด้วย

Tool:

searchWeb()

แต่คำถามมหาวิทยาลัยต้องให้ข้อมูลภายในสำคัญกว่า Internet

ลำดับประมาณ:

University DB
 ↓
University RAG
 ↓
Official University Website
 ↓
Internet

เช่นคำถาม:

> เทียบโอนยังไง



ไม่ควรไปเอาระเบียบมหาวิทยาลัยอื่นมาตอบ


---

28. AI Similar-Issue Detection

ระบบสามารถตรวจปัญหาที่มีความหมายเหมือนกัน

เช่น:

Wi-Fi ตึกวิทย์ใช้ไม่ได้

เน็ตอาคารวิทยาศาสตร์พัง

ต่ออินเทอร์เน็ตที่ตึกวิทย์ไม่ได้

Embedding อาจพบว่าเป็นปัญหาเดียวกัน

แล้วรวมเป็น Incident:

Incident:
Wi-Fi อาคารวิทยาศาสตร์

Reports:
28

Status:
Investigating

นี่จะเป็นจุดเด่นของระบบมาก


---

29. Severity

AI ช่วยประเมิน:

Low
Medium
High
Critical

แต่ไม่ปล่อย AI ตัดสินอย่างเดียว

Backend สามารถมี Rules ประกอบ

เช่น:

1 เครื่องเสีย
→ Medium

นักศึกษา 100 คนเข้า Registration ไม่ได้
→ High/Critical


---

30. Dashboard

Dashboard คือที่ทำงานจริงของเจ้าหน้าที่

หน้าแรกอาจมี:

Questions Today

AI Resolved

Human Escalations

Open Tickets

Urgent Tickets

Active Incidents

Common Problems

AI Provider Status


---

31. Dashboard Modules

โครงหลัก:

Overview

Tickets

Incidents

Departments

Knowledge Base

Activities

AI Providers

AI Models

Fallback Rules

Usage

Analytics

Logs

Settings

ไม่มี Student Management ใน V1


---

32. AI Provider Management

เราจะไม่ผูกกับ AI เจ้าเดียว

มี AI Gateway กลาง

AI
 ↓
AI Gateway
 ↓
┌──────────┬──────────┬──────────┐
Zen      OpenRouter    Provider X

Admin เพิ่ม Provider จาก Dashboard ได้

ไม่ต้องแก้ Code ทุกครั้ง


---

33. ข้อมูล Provider

ประมาณ:

Provider Name

Base URL

API Key

Enabled

Priority

Health Status

Models:

Model ID

Supports Tools

Supports JSON

Supports Vision

Priority

Enabled


---

34. Provider Fallback

ไม่ใช้ Random

ใช้ Priority

Model A
 ↓ fail
Model B
 ↓ fail
OpenRouter Model C
 ↓ fail
Paid Emergency Model

Fallback เมื่อ:

429
timeout
5xx
model unavailable
provider down


---

35. Provider Health Check

Dashboard อาจแสดง:

Zen          🟢 Healthy

OpenRouter   🟢 Healthy

Provider X   🟠 Rate Limited

Provider Y   🔴 Offline

ถ้า Provider เสีย ระบบจะ skip ได้


---

36. AI Usage

เก็บสถิติ:

Requests Today

Provider Usage

Primary Success

Fallback Rate

Timeout

429

Errors

Estimated Cost

เพื่อดูว่า Free Provider เพียงพอหรือไม่


---

37. LINE Reply และเป้าหมาย Free

จุดสำคัญคือเราอยากให้ AI ตอบเร็วภายใน Reply window ของ LINE

Flow:

Message
 ↓
Webhook
 ↓
Return HTTP 200
 ↓
Loading Animation
 ↓
AI
 ↓
Reply API

เน้นให้คำถามทั่วไปตอบจบภายในประมาณไม่กี่วินาที

ถ้า AI Provider ช้า:

Primary Model
 ↓ timeout
Fallback Model


---

38. LINE Reply Deadline

เราไม่ควรรอจนเกือบหมดเวลา

ตัวอย่าง:

AI target:
< 20 sec

AI hard timeout:
~45 sec

Reply:
ก่อน ~50 sec

เพื่อเหลือ buffer


---

39. Loading Animation

ระหว่าง AI คิด เราไม่จำเป็นต้องส่งข้อความ:

> กรุณารอสักครู่



เพราะจะเปลือง message

ใช้ Loading Indicator ของ LINE แทนได้

User จะเห็นเหมือนระบบกำลังพิมพ์/ประมวลผล


---

40. Push Message

ถ้าเจ้าหน้าที่มาตอบ Ticket หลังจากผ่านไปนานแล้ว

Backend จะใช้ Push Message จาก Student OA ไปยัง User

ดังนั้น:

AI ตอบทันที
→ Reply

เจ้าหน้าที่ตอบภายหลัง
→ Push

เป้าหมายคือให้ AI จบเคสได้เยอะที่สุด เพื่อลดการใช้ Push


---

41. Hermes

Hermes จะเป็น Optional Agent Orchestrator

หน้าที่ประมาณ:

AI ควร Search RAG ไหม

Search Web ไหม

Create Ticket ไหม

เรียก Tool ไหนต่อ

ต้อง Escalate ไหม

แต่ Hermes ไม่ควรถือ API keys ทั้งหมดเอง

Provider management อยู่ที่ AI Gateway


---

42. แยก Hermes กับ AI Gateway

Hermes
= คิดว่าจะทำอะไร

AI Gateway
= เลือกว่าจะใช้ Model/Provider ไหน

เช่น:

Hermes:
ต้อง searchKnowledge()

Backend:
Execute

Hermes:
ต้อง summarize

AI Gateway:
เลือก Zen

Zen fail

AI Gateway:
เลือก OpenRouter

ทำให้ Architecture ไม่ผูกกัน


---

43. Development Agent

AI ที่ใช้สร้างระบบคนละส่วนกับ AI ที่อยู่ในระบบ

Development AI
= Codex

Runtime AI
= Zen / OpenRouter / Provider ต่าง ๆ

ช่วงเริ่มต้นใช้ Codex เป็น Coding Agent หลักได้

ไม่จำเป็นต้องสร้าง Multi-Agent ตั้งแต่วันแรก


---

44. Supabase

Supabase จะเป็น Data Layer หลัก

ใช้:

PostgreSQL

Storage

Auth สำหรับ Staff

Realtime ถ้าต้องใช้

pgvector

ยังไม่ต้องมี Vector DB แยก


---

45. Database V1

ตอนนี้ฐานข้อมูลน่าจะมีประมาณ:

staff

departments

line_sessions

conversations

messages

tickets

ticket_messages

ticket_history

incidents

documents

knowledge_chunks

activities

ai_providers

ai_models

ai_usage_logs

ai_errors

system_settings

ไม่มี students table


---

46. Staff Authentication

ต่างจากนักศึกษา

เจ้าหน้าที่ควร Login จริง

เพราะมีสิทธิ์เข้าถึง Ticket

เช่น:

IT Staff

Registrar Staff

Student Affairs

Admin

Super Admin

และ LINE OA #2 ของเจ้าหน้าที่สามารถ Bind กับ Staff Account ได้


---

47. Staff Routing

ตัวอย่าง:

Ticket
Department = IT

ระบบหา:

Staff
WHERE department = IT
AND active = true

แล้วแจ้งเฉพาะ IT

ไม่ Broadcast ให้ทุกฝ่าย


---

48. Sensitive Ticket

บางเรื่องอาจต้องจำกัดสิทธิ์

เช่น:

General
→ Department Staff

Sensitive
→ Supervisor

Restricted
→ Authorized Staff only

Notification ใน LINE OA #2 อาจแสดงแค่:

Sensitive Ticket
Priority: High

[Open Dashboard]

ไม่แสดงรายละเอียดใน LINE


---

49. Privacy

หลักการ V1 คือ Data Minimization

เก็บเท่าที่จำเป็น

ไม่เก็บ:

ชื่อจริง
รหัสนักศึกษา
คณะ
หลักสูตร
ผลการเรียน
ข้อมูลทะเบียน

ถ้า User ส่งข้อมูลบางอย่างใน Ticket ก็เก็บเฉพาะเท่าที่จำเป็นกับเคสนั้น


---

50. Deployment ช่วงพัฒนา

เราสามารถรัน:

Laptop / PC
 ↓
Docker
 ↓
Backend / Hermes

แล้วใช้:

Cloudflare Tunnel

เปิด webhook ให้ LINE ยิงเข้ามา

เหมาะกับ:

Development
Testing
Demo


---

51. Production

ถ้ามหาวิทยาลัยรับไปใช้

สามารถย้ายไป:

University Server
 ↓
Docker
 ↓
Backend
 ↓
Hermes

LLM ยังเรียก External API ได้

ไม่จำเป็นต้องมี GPU เว้นแต่ต้องการรัน LLM เอง


---

52. Technology Stack ล่าสุด

ส่วน	เทคโนโลยี

Student Interface	LINE OA #1
Staff Alert	LINE OA #2
Dashboard	Next.js
Backend	Next.js / Node.js
Database	Supabase PostgreSQL
Staff Auth	Supabase Auth
RAG	Supabase pgvector
Storage	Supabase Storage
LLM	AI Gateway
Agent	Hermes optional
Internet Search	Search API
Development	Codex
Version Control	GitHub
Dev Webhook	Cloudflare Tunnel
Production	Vercel / Server มหาวิทยาลัย



---

Flow สมบูรณ์ตัวอย่างที่ 1

User:

> ลงทะเบียนเรียนยังไง



Student OA
 ↓
Spam Check
 ↓
Conversation Router
 ↓
AI
 ↓
RAG
 ↓
ตอบ
 ↓
จบ

ไม่สร้าง Ticket


---

Flow สมบูรณ์ตัวอย่างที่ 2

User:

> เข้าเว็บ reg ไม่ได้ ขึ้น 500



Student OA
 ↓
Spam Check
 ↓
AI วิเคราะห์
 ↓
RAG
 ↓
Similar Issue Search
 ↓
พบหลายคนมีปัญหาเหมือนกัน
 ↓
Incident Detection
 ↓
Create Ticket
 ↓
ส่ง IT
 ↓
Staff OA แจ้ง IT

AI แจ้ง User ว่าได้รับเรื่องแล้ว


---

Flow สมบูรณ์ตัวอย่างที่ 3

User:

> ทำไมวิชานี้ผมลงไม่ได้



AI:

ไม่มีข้อมูลส่วนบุคคล
 ↓
ไม่เดาคำตอบ
 ↓
Create Ticket
 ↓
ส่งงานทะเบียน

เจ้าหน้าที่เปิด Dashboard:

ขอทราบรหัสนักศึกษาและรหัสวิชาครับ

Backend ส่งผ่าน Student OA ไป User

User ตอบ

เจ้าหน้าที่ตรวจสอบ

เสร็จแล้วกด:

[แก้ไขเรียบร้อย]

Ticket → Resolved

AI กลับมารับคำถามใหม่


---

Flow สมบูรณ์ตัวอย่างที่ 4

ระหว่าง Ticket ยังเปิดอยู่ User ถาม:

> ห้องสมุดปิดกี่โมง



Conversation Router ตรวจ:

ไม่เกี่ยวกับ Ticket เดิม

จึง:

New AI Conversation
 ↓
RAG
 ↓
ตอบ

ในขณะที่ Ticket เดิมยังอยู่กับเจ้าหน้าที่ต่อ


---

จุดเด่นของโปรเจกต์

นี่ไม่ใช่ Chatbot ธรรมดาแบบ:

ถาม
→ ตอบ

แต่เป็น:

ถาม
 ↓
เข้าใจบริบท
 ↓
ค้น Knowledge
 ↓
ค้น Internet ถ้าจำเป็น
 ↓
Troubleshooting
 ↓
ตรวจปัญหาซ้ำ
 ↓
AI แก้ได้ → จบ

AI แก้ไม่ได้
 ↓
Ticket
 ↓
Route Department
 ↓
Human Takeover
 ↓
สนทนาผ่านระบบกลาง
 ↓
Resolve
 ↓
AI กลับมารับช่วง

ดังนั้นชื่อเชิงระบบจริง ๆ จะใกล้กับ:

> AI-Powered University Student Support and Intelligent Helpdesk System via LINE



มากกว่าเรียกว่า Chatbot เฉย ๆ


---

สิ่งที่เรายังไม่จำเป็นต้องกำหนดตอนนี้

ยังไม่ต้องล็อก:

LLM Model หลักตัวไหน

Embedding Model ตัวไหน

Search Provider ตัวไหน

Hermes ต้องใช้ตั้งแต่ V1 หรือไม่

Production Hosting ตัวไหน

Database Schema รายละเอียดทั้งหมด

เพราะ Architecture เราออกแบบให้เปลี่ยน Provider ได้


---

สิ่งที่ควรทำเป็นขั้นถัดไป

จากจุดนี้ Concept และ Flow หลักค่อนข้างชัดแล้ว

ลำดับที่เหมาะคือ:

Requirement Final
 ↓
System Architecture
 ↓
Conversation / Ticket State Diagram
 ↓
ER Diagram
 ↓
Supabase Migration
 ↓
Next.js Project Structure
 ↓
LINE OA 2 Accounts
 ↓
Webhook
 ↓
AI Gateway
 ↓
RAG
 ↓
Ticket
 ↓
Staff Dashboard
 ↓
Human Takeover
 ↓
Spam Protection
 ↓
Testing

และสิ่งที่ผมคิดว่า ควรออกแบบก่อนเขียนโค้ดจริงที่สุด คือ Conversation + Ticket State Diagram เพราะมันเป็นหัวใจที่ทำให้ AI, นักศึกษา และเจ้าหน้าที่คุยกันโดยไม่ชนกัน หลังจาก State ตรงนี้ชัดแล้ว ER Diagram และ Migration จะออกแบบได้ง่ายขึ้นมากครับ


ภาพรวมด้านบนคาดว่าใช้เวลากี่วันครับ ให้ ai agent พัฒนา