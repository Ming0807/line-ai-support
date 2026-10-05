# YRU AI Student Support / AI Helpdesk

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

นักศึกษาและผู้ใช้ทั่วไปถามผ่าน Student LINE OA โดยไม่ login. เจ้าหน้าที่ที่มีบัญชีจริงจัดการ ticket ของฝ่ายตนผ่าน Dashboard; Staff OA รับแจ้งเตือนและเปิดงาน. Admin/Super Admin จัดการ knowledge, provider/model และการตั้งค่าตามสิทธิ์

## Product Purpose

ตอบคำถามและช่วยแก้ปัญหาเบื้องต้นจากข้อมูลมหาวิทยาลัยราชภัฏยะลา ส่งต่อเรื่องที่แก้ไม่ได้เป็น ticket ให้เจ้าหน้าที่ และรักษาการสนทนาผ่านระบบกลางจนปิดเรื่อง ความสำเร็จของ V1 ตรวจจาก Flow A–F ใน [master guide](CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md)

## Positioning

LINE เป็นทางเข้าที่ผู้ใช้คุ้นเคย; knowledge มี version/authority/applicability และมี human takeover แยกตามเรื่อง จึงรองรับคำถามใหม่ระหว่างมี ticket เดิมได้โดยไม่ให้ AI กับเจ้าหน้าที่ตอบชนกัน

## Operating Context

Development ใช้ Next.js/Supabase และ HTTPS tunnel ไป LINE. Runtime AI อยู่หลัง gateway ซึ่งเลือก provider/model ตามลำดับจาก Dashboard. ช่วงเริ่มต้นใช้ AI ฟรีเป็นหลัก Zen/OpenRouter; มหาวิทยาลัยเปิด paid services เองผ่าน UI ภายหลัง เอกสารต้อง preview/review/approve ก่อนเป็นข้อมูลที่ AI ใช้ตอบ

## Capabilities and Constraints

- Anonymous V1 ไม่มี Student Database/SSO/SIS; เก็บ technical LINE identifier เฉพาะ backend เท่าที่จำเป็น
- Backend คุมสิทธิ์และ tools; AI ไม่มี arbitrary SQL/DDL และไม่ publish document เอง
- เจ้าหน้าที่มี department/sensitivity scope; HUMAN ticket ห้าม AI ตอบเอง
- Provider/Model ต้องเพิ่ม แก้ เปิด/ปิด จัดลำดับ ตรวจสถานะ และทดสอบจาก UI ได้
- ไม่มี provider/model/embedding dimensions ที่ล็อกจากการเดา; ราคา/โควต้าที่ไม่มีหลักฐานต้องบอกว่ายังไม่ทราบ
- ข้อกำหนดในไฟล์นี้อธิบายเป้าหมาย ไม่รับรองว่าทุก capability ทำเสร็จแล้ว ดู [task board](docs/tasks/V1_TASK_BOARD.md)

## Brand Commitments

ชื่อระบบ YRU AI Support/Helpdesk, UI ภาษาไทยเป็นหลัก. ผู้ใช้ขอ **product minimal ที่ใช้ทำงานง่ายและสม่ำเสมอ** วันที่ 4 ตุลาคม 2026 ยังไม่มี official university brand assets/design manual ให้ยึด; ห้ามสร้างตรามหาวิทยาลัยหรืออ้างการรับรองขึ้นเอง

## Evidence on Hand

[ต้นฉบับ](docs/requirements/sources/README.md), master guide, code และ dated reports. มีเอกสารรวบรวม 187 resources และ shortlist pending review; จำนวนนี้ไม่เท่ากับ approved knowledge. Student/Staff echo เคยผ่าน LINE จริง; live free AI/approved corpus/full Flow A–F ยังไม่มีหลักฐานครบ

## Product Principles

1. ให้ผู้ใช้ทำงานจาก LINE และให้เจ้าหน้าที่รับช่วงอย่างชัดเจน
2. อ้างข้อมูลมหาวิทยาลัยที่ตรวจ version และ authority แล้ว
3. แสดงสถานะตามหลักฐานจริง รวมถึง UNKNOWN แทนค่าที่เดา
4. เริ่มด้วย AI ฟรีและเลือกบริการเพิ่มได้ผ่าน Dashboard
5. รักษาประวัติและสิทธิ์ทุกครั้งที่เปลี่ยน ticket/document/provider

## Open Decisions

Generation/embedding model, dimensions และคุณภาพภาษาไทยต้องตรวจ; production hosting/permanent domain และ official brand assets ยังไม่เลือก ขอบเขต V1 อื่นใช้ master/original sources ร่วมกับคำยืนยันล่าสุดใน [decision log](docs/decisions/DECISION_LOG.md)
