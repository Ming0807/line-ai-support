# คลังเอกสาร YRU สำหรับ AI Helpdesk

เก็บวันที่ 4 ตุลาคม 2569: **154 PDF + 33 HTML snapshots** (489.5 MiB) จากแหล่งทางการ/ไฟล์ Drive ที่ลิงก์โดยมหาวิทยาลัย

เริ่มอ่าน [COMPLETENESS.md](COMPLETENESS.md) เพื่อตรวจว่าครอบคลุมอะไรและยังขาดอะไร แล้วใช้ [CATALOG.md](CATALOG.md) เปิดแต่ละไฟล์ [manifest.csv](manifest.csv) ใช้ตรวจใน spreadsheet และ [manifest.json](manifest.json) สำหรับ import staging ภายหลัง

จำนวน HTML ใน catalog นับ URL ไม่ซ้ำ 33 แหล่ง ในเครื่องมี HTML ต้นฉบับ 34 ไฟล์ เพราะหน้า Passport เดียวกันถูกเก็บเป็นสำเนาแยกสำหรับหลักฐานการกล่าวถึง M365 หนึ่งครั้ง manifest รวม `family_codes` เพื่อรักษาทั้งสองความหมาย และตรวจ checksum ของสำเนาด้วย

- `01-academic/`: ทะเบียน ปฏิทิน คู่มือ2568/2569 ค่าธรรมเนียม แบบฟอร์ม ระเบียบ และตารางเทียบโอน
- `02-student-affairs/`: กิจกรรม จิตอาสา ชมรม หอพัก สวัสดิการ และรายงานของ Luna high
- `03-it-library/`: WiFi/802.1X/Passport/O365/library และรายงานของ Luna max
- `qa/`: ภาพ render ตัวอย่างเพื่อ QA; ตรวจภาพเฉพาะตัวอย่าง ไม่ใช่ทุกหน้า
- `scripts/`: เครื่องมือที่ใช้เก็บ/รวมรายงาน เป็น research tooling ไม่ใช่ application import pipeline
- `download-attempts.json`: ประวัติการพยายามดาวน์โหลด รวม error ที่แก้แล้ว
- `failed-downloads.json`: ลิงก์ใน catalog ที่ยังไม่สำเร็จ; IT source attempts อยู่ในรายงานย่อย
- `verification.json`: จำนวนรายการ ผลตรวจ checksum/bytes และ quality flags
- `demo-shortlist.json`: 15 แหล่งสำหรับเริ่ม preview/admin review ไม่ใช่ชุด ACTIVE

ทุกเอกสารเป็น `PENDING_REVIEW`, `is_current=null` ไม่ได้นำเข้า Supabase หรือสร้าง embeddings ตัวเลขค่าเทอม วันที่ cohort และ version ต้องตรวจต้นฉบับก่อน approve ไฟล์แม่แบบคำร้องเก็บเป็นลิงก์/บริการ ไม่ใช่ข้อมูลนักศึกษา

ตรวจความซ้ำด้วย checksum ตอน import และเก็บ provenance ทุกแหล่ง ชุดที่ตรวจครั้งนี้มี checksum ไม่ซ้ำ 187 ชุด เอกสาร archive-only/ปีเก่าไม่ใช่เอกสาร current โดยอัตโนมัติ PDF สแกนหรือ font เสียต้อง OCR/แก้ extraction ก่อนใช้ RAG

PDF ต้นฉบับและภาพ QA ถูก Git ignore เพราะมีไฟล์ใหญ่มาก คลังทั้งหมดอยู่ในเครื่องตามคำขอ เมื่อพัฒนาจริงเก็บต้นฉบับใน Supabase Storage/object storage และเก็บ manifest/checksum ใน Git
