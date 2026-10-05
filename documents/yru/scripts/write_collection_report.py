import json
from archive_sources import ROOT

records=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
stats=json.loads((ROOT/'verification.json').read_text(encoding='utf-8'))
families=[
('ACADEMIC_CALENDAR','ปฏิทินวิชาการ','มี PDF 2569 ภาคปกติ/กศ.บป./ค้าปลีก และ 2568 สำหรับทดสอบ historical; แยก semester/audience ก่อน import'),
('REGISTRATION_GUIDE','การลงทะเบียน','มีคู่มือที่เว็บเรียก NEW และคำร้องเกินหน่วยกิต; คู่มือเก่าอีกลิงก์ timeout สองครั้ง ไม่กระทบการเก็บ NEW'),
('TRANSFER_REGULATION','ระเบียบเทียบโอน','มีฉบับ 2568 และฉบับเก่า/แก้ไข; ต้องอ่านการยกเลิกและ AMENDS ก่อนกำหนด current'),
('TRANSFER_GUIDE','ขั้นตอนเทียบโอน/ยกเว้น','มีคู่มือบริการจากเว็บเดิมและใหม่พร้อมขั้นตอน ต้องตรวจว่าไฟล์ซ้ำ/ฉบับแทนกันหรือไม่'),
('TRANSFER_COURSE_TABLE','ตารางเทียบโอน','เก็บ 10 ตารางหลักสูตรปรับปรุง 2568 ที่แสดงในคลัง; หลายไฟล์สแกน ต้อง OCR และตรวจรายวิชา/หน่วยกิต'),
('TUITION_FEE','ค่าธรรมเนียม','มีตารางเว็บ, ประกาศหลายปี และหน้า กศ.บป. 2569; cohort 62–64/65 เป็นต้นไป และภาคเรียนต้องไม่ปนกัน'),
('EXAM_REGULATION','การสอบ','มีระเบียบการปฏิบัติของผู้เข้าสอบ; ตรวจว่ามีประกาศแก้ไขใหม่และข้อยกเว้นในคู่มือ 2569'),
('GRADING_REGULATION','วัดผล/ประเมินผล','มีหลักเกณฑ์ปี 2566 และฉบับเก่า; หลายไฟล์ดึงข้อความไม่ได้ ต้อง OCR ก่อนตอบ'),
('TRANSCRIPT_GUIDE','Transcript','มีขั้นตอนและคู่มือสำหรับผู้เข้าศึกษาก่อน 2549 แยกกัน'),
('CERTIFICATE_GUIDE','หนังสือรับรอง/หลักฐานการศึกษา','มีคู่มือหลายบริการ; ตรวจเวลา/ราคาเทียบเอกสารต้นฉบับ'),
('COURSE_WITHDRAWAL_GUIDE','ยกเลิกรายวิชา','มีคู่มือบริการและแบบฟอร์ม; วันสุดท้ายต้อง query ปฏิทินตามกลุ่มผู้เรียน'),
('SPECIAL_COURSE_GUIDE','เปิดรายวิชากรณีพิเศษ','มีคู่มือ; ขั้นตอนทั่วไปไม่แทนกำหนดการเฉพาะ semester'),
('WIFI_GUIDE','Wi-Fi/802.1X','มีเว็บวิธีเชื่อมต่อ Android/iOS/Windows และ troubleshooting; หน้าหลายรายการปี 2563–2566 ต้อง IT ยืนยันค่าปัจจุบัน'),
('YRU_PASSPORT_GUIDE','YRU Passport','มีหน้าบริการ/คำแนะนำเว็บ แต่คู่มือแนบ Drive ยังเข้าถึงไม่ได้; ต้องได้ขั้นตอนกู้บัญชีปัจจุบันจาก IT'),
('MICROSOFT_365_GUIDE','Microsoft 365','มีข้อความสมัคร O365 ผ่าน Passport เท่านั้น ยังขาดคู่มือเฉพาะ M365 และ troubleshooting ปัจจุบัน'),
('LIBRARY_GUIDE','ห้องสมุด','มีเว็บบริการ/เวลาเปิด/ติดต่อและ 2 PDFs; กฎยืมและค่าธรรมเนียมเว็บเก่ามีข้อขัดแย้งกับแบบฟอร์ม ต้องยืนยันกับห้องสมุด'),
('STUDENT_ACTIVITY_RULE','กิจกรรม/ชมรม','มีประกาศ 2568 และข้อมูลกิจกรรม2569; ข้อกำหนดรหัส66–67 ไม่ยืนยันครอบคลุม68–69'),
('VOLUNTEER_ACTIVITY_RULE','จิตอาสา','มีประกาศ2569และหลักเกณฑ์รหัส66–67; OCRและตรวจกลุ่มเป้าหมายก่อนเลือกฉบับ'),
('DORMITORY_RULE','หอพัก','พบระเบียบ2567ใหม่กว่าฉบับ2562 และเอกสารค่าใช้จ่าย2568; ตรวจวันมีผล/ฉบับแก้ไขก่อนใช้')]

lines=['# ตรวจความครบของเอกสาร YRU','', 'วันที่ตรวจ: 4 ตุลาคม 2569 เทียบกับ 19 families ใน section 64 ของ master guide และรายการเอกสารแนบ ขอบเขตนี้ไม่ใช่การเก็บทั้งเว็บไซต์มหาวิทยาลัย','',f"เก็บได้ **{stats['downloaded']} resources**: PDF **{stats['pdf']}** ไฟล์ และ HTML snapshot **{stats['html']}** หน้า รวม {stats['total_bytes']/1048576:.1f} MiB มีเนื้อหาที่ checksum ไม่ซ้ำ {stats['unique_content_hashes']} ชุด; count resources อาจรวมฉบับซ้ำจากคนละ URL มี {stats['archive_only']} รายการเก็บเพื่อ archive/งานภายใน ไม่นับเป็นแหล่งเปิดตอบอัตโนมัติ",'',f"ตรวจ SHA-256/จำนวนไบต์/ไฟล์มีอยู่จริงผ่านทั้งหมด PDF {stats['needs_ocr_or_font_review']} รายการถูก flag ด้วยการดึงข้อความ/อัตราข้อความต่อหน้า/อักขระเสียว่าอาจต้อง OCR หรือแก้ font extraction การ flag เป็นการคัดกรอง ไม่ใช่ผล OCR ที่ตรวจแล้ว ตรวจภาพตัวอย่างปฏิทิน2569 คู่มือเทียบโอน ตารางบัญชี และหน้าปกคู่มือ2569 ไว้ใน qa/",'', '**ผล:** พบแหล่งอ้างอิงครบ 19 หมวด แต่ยังไม่ถือว่าเอกสารปัจจุบันครบหรือพร้อม public RAG โดยเฉพาะ Passport/M365, cohort กิจกรรม และเงื่อนไขเวลา/ค่าธรรมเนียมห้องสมุด เอกสารทุกฉบับเป็น PENDING_REVIEW และ is_current=null','', '| Family | หมวด | เอกสารที่พบ | สถานะความครบ/สิ่งต้องตรวจ |','|---|---|---:|---|']
for code,name,note in families:
    found=[r for r in records if code in (r.get('family_codes') or [r.get('family_code')]) and r['download_status']=='downloaded' and not r['archive_only'] and r.get('resource_role')!='source_index']
    lines.append(f'| {code} | {name} | {len(found)} | {note} |')
lines += ['', '## ช่องว่างที่ต้องปิดก่อนเปิดใช้','', '1. OCR/ตรวจภาษาไทยและตาราง โดยเฉพาะคู่มือนักศึกษา2569 (536หน้า,302.1MiB) ซึ่งข้อความดึงได้เพียงบางหน้า จึงไม่ควรอ้างว่า indexed แล้ว','2. ขอคู่มือ Passport/account recovery และ Microsoft365 ล่าสุดจาก IT; การมีเมนูบริการหรือข้อความ signup ไม่เท่ากับคู่มือ troubleshooting','3. ตรวจข้อกิจกรรมสำหรับ cohort68–69 และลำดับ amendment/replacement; ปีใหม่กว่าไม่แทนทุกกลุ่มโดยอัตโนมัติ','4. ยืนยันกฎยืมคืน/ค่าปรับ/ค่าสมาชิก/เวลาห้องสมุดจากเจ้าของบริการ เมื่อแหล่งข้อมูลขัดกัน','5. ยืนยัน effective dates, student_type, program/curriculum, cohort และ authority ก่อนเลือก current ของปฏิทิน ค่าเทอม และตารางเทียบโอน','6. ลิงก์คู่มือลงทะเบียน old PDF timeout สองครั้ง; ไฟล์ NEW เก็บแล้ว รายละเอียดใน failed-downloads.json ส่วน attempted links ของ IT อยู่ใน 03-it-library/failed-source-attempts.json เมื่อรายงานเสร็จ','', '## Demo shortlist ก่อน import','', 'เลือก 15 แหล่งนี้เพื่อให้ demo ครอบคลุม FAQ/troubleshooting/history/structured โดยต้องผ่าน admin review ทุกฉบับก่อนเปิดใช้','']
selectors=[
('ปฏิทินภาคปกติ2569',lambda r:r.get('family_code')=='ACADEMIC_CALENDAR' and r.get('academic_year')==2569 and r.get('audience')=='ภาคปกติ'),
('ปฏิทินกศ.บป.2569',lambda r:r.get('family_code')=='ACADEMIC_CALENDAR' and r.get('academic_year')==2569 and r.get('audience')=='กศ.บป.'),
('ปฏิทินภาคปกติ2568สำหรับhistory',lambda r:r.get('family_code')=='ACADEMIC_CALENDAR' and r.get('academic_year')==2568 and r.get('audience')=='ภาคปกติ'),
('เกิน22หน่วยกิต',lambda r:'เกิน 22' in r['title'] and 'กศ.บป.' not in r['title']),
('เกินหน่วยกิตกศ.บป.',lambda r:'เกินหน่วยกิต' in r['title'] and 'กศ.บป.' in r['title']),
('เทียบโอน2568',lambda r:r['title']=='การเทียบโอนผลการเรียน 2568'),
('ยกเว้น2568',lambda r:r['title']=='การยกเว้นหน่วยกิต 2568'),
('Transcript2568',lambda r:r['title']=='การขอใบรายงานผลการศึกษา (Transcript) 2568'),
('ใบรับรอง2568',lambda r:r['title']=='การขอใบรับรองต่างๆ 2568'),
('เปิดรายวิชาพิเศษ2568',lambda r:r['title']=='เปิดรายวิชากรณีพิเศษ 2568'),
('ยกเลิกรายวิชา2568',lambda r:r['title']=='ยกเลิกรายวิชา 2568'),
('ตารางค่าเทอมเว็บ',lambda r:r['title']=='tuition_fees'),
('คู่มือMAC WiFi',lambda r:'คู่มือการลงทะเบียนอุปกรณ์' in r['title']),
('แก้ปัญหาWiFi',lambda r:'การแก้ไขปัญหาเบื้องต้นสำหรับการใช้งาน YRU-WiFi' in r['title']),
('เวลาห้องสมุด',lambda r:r.get('family_code')=='LIBRARY_GUIDE' and 'เวลาเปิดทำการ' in r['title'])]
shortlist=[]
for label,test in selectors:
    rec=next((r for r in records if r['download_status']=='downloaded' and test(r)),None)
    if rec:
        shortlist.append(rec)
        lines.append(f"- **{label}** — [{rec['catalog_id']} เปิดต้นฉบับ](<{rec['local_path']}>) / [source]({rec['source_url']}); {rec.get('text_quality')}")
(ROOT/'COMPLETENESS.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
(ROOT/'demo-shortlist.json').write_text(json.dumps(shortlist,ensure_ascii=False,indent=2),encoding='utf-8')
readme=f'''# คลังเอกสาร YRU สำหรับ AI Helpdesk

เก็บวันที่ 4 ตุลาคม 2569: **{stats['pdf']} PDF + {stats['html']} HTML snapshots** ({stats['total_bytes']/1048576:.1f} MiB) จากแหล่งทางการ/ไฟล์ Drive ที่ลิงก์โดยมหาวิทยาลัย

เริ่มอ่าน [COMPLETENESS.md](COMPLETENESS.md) เพื่อตรวจว่าครอบคลุมอะไรและยังขาดอะไร แล้วใช้ [CATALOG.md](CATALOG.md) เปิดแต่ละไฟล์ [manifest.csv](manifest.csv) ใช้ตรวจใน spreadsheet และ [manifest.json](manifest.json) สำหรับ import staging ภายหลัง

จำนวน HTML ใน catalog นับ URL ไม่ซ้ำ {stats['html']} แหล่ง ในเครื่องมี HTML ต้นฉบับ {stats['physical_html_files']} ไฟล์ เพราะหน้า Passport เดียวกันถูกเก็บเป็นสำเนาแยกสำหรับหลักฐานการกล่าวถึง M365 หนึ่งครั้ง manifest รวม `family_codes` เพื่อรักษาทั้งสองความหมาย และตรวจ checksum ของสำเนาด้วย

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

ตรวจความซ้ำด้วย checksum ตอน import และเก็บ provenance ทุกแหล่ง ชุดที่ตรวจครั้งนี้มี checksum ไม่ซ้ำ {stats['unique_content_hashes']} ชุด เอกสาร archive-only/ปีเก่าไม่ใช่เอกสาร current โดยอัตโนมัติ PDF สแกนหรือ font เสียต้อง OCR/แก้ extraction ก่อนใช้ RAG

PDF ต้นฉบับและภาพ QA ถูก Git ignore เพราะมีไฟล์ใหญ่มาก คลังทั้งหมดอยู่ในเครื่องตามคำขอ เมื่อพัฒนาจริงเก็บต้นฉบับใน Supabase Storage/object storage และเก็บ manifest/checksum ใน Git
'''
(ROOT/'README.md').write_text(readme,encoding='utf-8')
print(json.dumps({'families':len(families),'demo_shortlist':len(shortlist),'report':'COMPLETENESS.md'},ensure_ascii=False))
