# ตรวจความครบของเอกสาร YRU

วันที่ตรวจ: 4 ตุลาคม 2569 เทียบกับ 19 families ใน section 64 ของ master guide และรายการเอกสารแนบ ขอบเขตนี้ไม่ใช่การเก็บทั้งเว็บไซต์มหาวิทยาลัย

เก็บได้ **187 resources**: PDF **154** ไฟล์ และ HTML snapshot **33** หน้า รวม 489.5 MiB มีเนื้อหาที่ checksum ไม่ซ้ำ 187 ชุด; count resources อาจรวมฉบับซ้ำจากคนละ URL มี 12 รายการเก็บเพื่อ archive/งานภายใน ไม่นับเป็นแหล่งเปิดตอบอัตโนมัติ

ตรวจ SHA-256/จำนวนไบต์/ไฟล์มีอยู่จริงผ่านทั้งหมด PDF 89 รายการถูก flag ด้วยการดึงข้อความ/อัตราข้อความต่อหน้า/อักขระเสียว่าอาจต้อง OCR หรือแก้ font extraction การ flag เป็นการคัดกรอง ไม่ใช่ผล OCR ที่ตรวจแล้ว ตรวจภาพตัวอย่างปฏิทิน2569 คู่มือเทียบโอน ตารางบัญชี และหน้าปกคู่มือ2569 ไว้ใน qa/

**ผล:** พบแหล่งอ้างอิงครบ 19 หมวด แต่ยังไม่ถือว่าเอกสารปัจจุบันครบหรือพร้อม public RAG โดยเฉพาะ Passport/M365, cohort กิจกรรม และเงื่อนไขเวลา/ค่าธรรมเนียมห้องสมุด เอกสารทุกฉบับเป็น PENDING_REVIEW และ is_current=null

| Family | หมวด | เอกสารที่พบ | สถานะความครบ/สิ่งต้องตรวจ |
|---|---|---:|---|
| ACADEMIC_CALENDAR | ปฏิทินวิชาการ | 9 | มี PDF 2569 ภาคปกติ/กศ.บป./ค้าปลีก และ 2568 สำหรับทดสอบ historical; แยก semester/audience ก่อน import |
| REGISTRATION_GUIDE | การลงทะเบียน | 9 | มีคู่มือที่เว็บเรียก NEW และคำร้องเกินหน่วยกิต; คู่มือเก่าอีกลิงก์ timeout สองครั้ง ไม่กระทบการเก็บ NEW |
| TRANSFER_REGULATION | ระเบียบเทียบโอน | 12 | มีฉบับ 2568 และฉบับเก่า/แก้ไข; ต้องอ่านการยกเลิกและ AMENDS ก่อนกำหนด current |
| TRANSFER_GUIDE | ขั้นตอนเทียบโอน/ยกเว้น | 9 | มีคู่มือบริการจากเว็บเดิมและใหม่พร้อมขั้นตอน ต้องตรวจว่าไฟล์ซ้ำ/ฉบับแทนกันหรือไม่ |
| TRANSFER_COURSE_TABLE | ตารางเทียบโอน | 10 | เก็บ 10 ตารางหลักสูตรปรับปรุง 2568 ที่แสดงในคลัง; หลายไฟล์สแกน ต้อง OCR และตรวจรายวิชา/หน่วยกิต |
| TUITION_FEE | ค่าธรรมเนียม | 9 | มีตารางเว็บ, ประกาศหลายปี และหน้า กศ.บป. 2569; cohort 62–64/65 เป็นต้นไป และภาคเรียนต้องไม่ปนกัน |
| EXAM_REGULATION | การสอบ | 3 | มีระเบียบการปฏิบัติของผู้เข้าสอบ; ตรวจว่ามีประกาศแก้ไขใหม่และข้อยกเว้นในคู่มือ 2569 |
| GRADING_REGULATION | วัดผล/ประเมินผล | 4 | มีหลักเกณฑ์ปี 2566 และฉบับเก่า; หลายไฟล์ดึงข้อความไม่ได้ ต้อง OCR ก่อนตอบ |
| TRANSCRIPT_GUIDE | Transcript | 4 | มีขั้นตอนและคู่มือสำหรับผู้เข้าศึกษาก่อน 2549 แยกกัน |
| CERTIFICATE_GUIDE | หนังสือรับรอง/หลักฐานการศึกษา | 6 | มีคู่มือหลายบริการ; ตรวจเวลา/ราคาเทียบเอกสารต้นฉบับ |
| COURSE_WITHDRAWAL_GUIDE | ยกเลิกรายวิชา | 2 | มีคู่มือบริการและแบบฟอร์ม; วันสุดท้ายต้อง query ปฏิทินตามกลุ่มผู้เรียน |
| SPECIAL_COURSE_GUIDE | เปิดรายวิชากรณีพิเศษ | 2 | มีคู่มือ; ขั้นตอนทั่วไปไม่แทนกำหนดการเฉพาะ semester |
| WIFI_GUIDE | Wi-Fi/802.1X | 11 | มีเว็บวิธีเชื่อมต่อ Android/iOS/Windows และ troubleshooting; หน้าหลายรายการปี 2563–2566 ต้อง IT ยืนยันค่าปัจจุบัน |
| YRU_PASSPORT_GUIDE | YRU Passport | 2 | มีหน้าบริการ/คำแนะนำเว็บ แต่คู่มือแนบ Drive ยังเข้าถึงไม่ได้; ต้องได้ขั้นตอนกู้บัญชีปัจจุบันจาก IT |
| MICROSOFT_365_GUIDE | Microsoft 365 | 1 | มีข้อความสมัคร O365 ผ่าน Passport เท่านั้น ยังขาดคู่มือเฉพาะ M365 และ troubleshooting ปัจจุบัน |
| LIBRARY_GUIDE | ห้องสมุด | 7 | มีเว็บบริการ/เวลาเปิด/ติดต่อและ 2 PDFs; กฎยืมและค่าธรรมเนียมเว็บเก่ามีข้อขัดแย้งกับแบบฟอร์ม ต้องยืนยันกับห้องสมุด |
| STUDENT_ACTIVITY_RULE | กิจกรรม/ชมรม | 6 | มีประกาศ 2568 และข้อมูลกิจกรรม2569; ข้อกำหนดรหัส66–67 ไม่ยืนยันครอบคลุม68–69 |
| VOLUNTEER_ACTIVITY_RULE | จิตอาสา | 3 | มีประกาศ2569และหลักเกณฑ์รหัส66–67; OCRและตรวจกลุ่มเป้าหมายก่อนเลือกฉบับ |
| DORMITORY_RULE | หอพัก | 7 | พบระเบียบ2567ใหม่กว่าฉบับ2562 และเอกสารค่าใช้จ่าย2568; ตรวจวันมีผล/ฉบับแก้ไขก่อนใช้ |

## ช่องว่างที่ต้องปิดก่อนเปิดใช้

1. OCR/ตรวจภาษาไทยและตาราง โดยเฉพาะคู่มือนักศึกษา2569 (536หน้า,302.1MiB) ซึ่งข้อความดึงได้เพียงบางหน้า จึงไม่ควรอ้างว่า indexed แล้ว
2. ขอคู่มือ Passport/account recovery และ Microsoft365 ล่าสุดจาก IT; การมีเมนูบริการหรือข้อความ signup ไม่เท่ากับคู่มือ troubleshooting
3. ตรวจข้อกิจกรรมสำหรับ cohort68–69 และลำดับ amendment/replacement; ปีใหม่กว่าไม่แทนทุกกลุ่มโดยอัตโนมัติ
4. ยืนยันกฎยืมคืน/ค่าปรับ/ค่าสมาชิก/เวลาห้องสมุดจากเจ้าของบริการ เมื่อแหล่งข้อมูลขัดกัน
5. ยืนยัน effective dates, student_type, program/curriculum, cohort และ authority ก่อนเลือก current ของปฏิทิน ค่าเทอม และตารางเทียบโอน
6. ลิงก์คู่มือลงทะเบียน old PDF timeout สองครั้ง; ไฟล์ NEW เก็บแล้ว รายละเอียดใน failed-downloads.json ส่วน attempted links ของ IT อยู่ใน 03-it-library/failed-source-attempts.json เมื่อรายงานเสร็จ

## Demo shortlist ก่อน import

เลือก 15 แหล่งนี้เพื่อให้ demo ครอบคลุม FAQ/troubleshooting/history/structured โดยต้องผ่าน admin review ทุกฉบับก่อนเปิดใช้

- **ปฏิทินภาคปกติ2569** — [YRU-010 เปิดต้นฉบับ](<01-academic/calendars/ปฏ_ท_นว_ชาการ_สำหร_บน_กศ_กษาภาคปกต_ป_การศ_กษา_2569_1d96b8d0.pdf>) / [source](https://drive.google.com/file/d/1yOpKqOFfJqL1xYdjBuRbewitK9C4cglD/view?usp=sharing); text_extractable_sample
- **ปฏิทินกศ.บป.2569** — [YRU-011 เปิดต้นฉบับ](<01-academic/calendars/ปฏ_ท_นว_ชาการ_สำหร_บน_กศ_กษาภาค_กศ_บป_ป_การศ_กษา_2569_86ec43ef.pdf>) / [source](https://drive.google.com/file/d/1V1sw9eShbBT5evyo4mDM4t_GPkTy5Ony/view?usp=sharing); text_extractable_sample
- **ปฏิทินภาคปกติ2568สำหรับhistory** — [YRU-014 เปิดต้นฉบับ](<01-academic/calendars/ปฏ_ท_นว_ชาการ_สำหร_บน_กศ_กษาภาคปกต_ป_การศ_กษา_2568_d8bc7662.pdf>) / [source](https://drive.google.com/file/d/1Em0NFZ6qo-hfLo0t15kK4FHUuvvSXvsX/view?usp=sharing); text_extractable_sample
- **เกิน22หน่วยกิต** — [YRU-034 เปิดต้นฉบับ](<01-academic/forms/คำร_องขอลงทะเบ_ยนเร_ยนเก_นหน_วยก_ตท_กำหนด_กรณ_เก_น_22_หน_วยก_ต_และข_นตอนการย_นคำร_อง_f7561e46.pdf>) / [source](https://drive.google.com/file/d/1TgNlSuwTIosJinyuQcVDkXg-pYuImLIH/view?usp=sharing); text_extractable_sample
- **เกินหน่วยกิตกศ.บป.** — [YRU-035 เปิดต้นฉบับ](<01-academic/forms/คำร_องขอลงทะเบ_ยนเร_ยนเก_นหน_วยก_ตท_กำหนด_สำหร_บน_กศ_กษาโครงการ_กศ_บป_กรณ_เก_น_18_หน__ce026d08.pdf>) / [source](https://drive.google.com/file/d/1V4sHyBVWfEQ_gwteZFX7wWD6DtNgkyEo/view?usp=sharing); text_extractable_sample
- **เทียบโอน2568** — [YRU-047 เปิดต้นฉบับ](<01-academic/guides/การเท_ยบโอนผลการเร_ยน_2568_57dcffbc.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%80%E0%B8%97%E0%B8%B5%E0%B8%A2%E0%B8%9A%E0%B9%82%E0%B8%AD%E0%B8%99%E0%B8%9C%E0%B8%A5%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%80%E0%B8%A3%E0%B8%B5%E0%B8%A2%E0%B8%9968.pdf); text_extractable_sample
- **ยกเว้น2568** — [YRU-048 เปิดต้นฉบับ](<01-academic/guides/การยกเว_นหน_วยก_ต_2568_a1b00baa.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A2%E0%B8%81%E0%B9%80%E0%B8%A7%E0%B9%89%E0%B8%99%E0%B8%AB%E0%B8%99%E0%B9%88%E0%B8%A7%E0%B8%A2%E0%B8%81%E0%B8%B4%E0%B8%9568.pdf); text_extractable_sample
- **Transcript2568** — [YRU-051 เปิดต้นฉบับ](<01-academic/guides/การขอใบรายงานผลการศ_กษา_Transcript_2568_cb2d55c7.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD%E0%B9%83%E0%B8%9A%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%9C%E0%B8%A5%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A8%E0%B8%B6%E0%B8%81%E0%B8%A9%E0%B8%B2%20(Transcript)68.pdf); text_extractable_sample
- **ใบรับรอง2568** — [YRU-054 เปิดต้นฉบับ](<01-academic/guides/การขอใบร_บรองต_างๆ_2568_7a6bc1d4.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD%E0%B9%83%E0%B8%9A%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B8%A3%E0%B8%AD%E0%B8%87%E0%B8%95%E0%B9%88%E0%B8%B2%E0%B8%87%E0%B9%8668.pdf); text_extractable_sample
- **เปิดรายวิชาพิเศษ2568** — [YRU-055 เปิดต้นฉบับ](<01-academic/guides/เป_ดรายว_ชากรณ_พ_เศษ_2568_b8670691.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B9%80%E0%B8%9B%E0%B8%B4%E0%B8%94%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%A7%E0%B8%B4%E0%B8%8A%E0%B8%B2%E0%B8%81%E0%B8%A3%E0%B8%93%E0%B8%B5%E0%B8%9E%E0%B8%B4%E0%B9%80%E0%B8%A8%E0%B8%A968.pdf); text_extractable_sample
- **ยกเลิกรายวิชา2568** — [YRU-056 เปิดต้นฉบับ](<01-academic/guides/ยกเล_กรายว_ชา_2568_f0de3b0e.pdf>) / [source](https://eduservice.yru.ac.th/files/info_guide/%E0%B8%A2%E0%B8%81%E0%B9%80%E0%B8%A5%E0%B8%B4%E0%B8%81%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%A7%E0%B8%B4%E0%B8%8A%E0%B8%B268.pdf); text_extractable_sample
- **ตารางค่าเทอมเว็บ** — [YRU-007 เปิดต้นฉบับ](<01-academic/fees/tuition_fees_029abd03.html>) / [source](https://eduservice.yru.ac.th/page/?view=fee); html_snapshot_needs_main_content_review
- **คู่มือMAC WiFi** — [YRU-171 เปิดต้นฉบับ](<03-it-library/nse/mac_registration_detailed_page79.html>) / [source](https://nse.yru.ac.th/page/79/%E0%B8%84%E0%B8%B9%E0%B9%88%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A5%E0%B8%87%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%99%E0%B8%AD%E0%B8%B8%E0%B8%9B%E0%B8%81%E0%B8%A3%E0%B8%93%E0%B9%8C_(Mac_Address)_%E0%B8%AA%E0%B9%8D%E0%B8%B2%E0%B8%AB%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%A3%E0%B8%B0%E0%B8%9A%E0%B8%9A%E0%B9%80%E0%B8%84%E0%B8%A3%E0%B8%B7%E0%B8%AD%E0%B8%82%E0%B9%88%E0%B8%B2%E0%B8%A2%E0%B8%AD%E0%B8%B4%E0%B8%99%E0%B9%80%E0%B8%97%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%80%E0%B8%99%E0%B9%87%E0%B8%95%E0%B9%84%E0%B8%A3%E0%B9%89%E0%B8%AA%E0%B8%B2%E0%B8%A2_YRU-WiFi.html); good
- **แก้ปัญหาWiFi** — [YRU-178 เปิดต้นฉบับ](<03-it-library/nse/wifi_troubleshooting_page33.html>) / [source](https://nse.yru.ac.th/page/33/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%81%E0%B8%81%E0%B9%89%E0%B9%84%E0%B8%82%E0%B8%9B%E0%B8%B1%E0%B8%8D%E0%B8%AB%E0%B8%B2%E0%B9%80%E0%B8%9A%E0%B8%B7%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B8%95%E0%B9%89%E0%B8%99%E0%B8%AA%E0%B8%B3%E0%B8%AB%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%87%E0%B8%B2%E0%B8%99_YRU-WiFi.html); good
- **เวลาห้องสมุด** — [YRU-182 เปิดต้นฉบับ](<03-it-library/library/library_contact.html>) / [source](https://library.yru.ac.th/contact); good
