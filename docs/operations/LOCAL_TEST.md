# ทดลอง YRU Helpdesk บนเครื่องนี้

## เปิดและหยุดด้วยคำสั่งเดียว

เปิด PowerShell ในโฟลเดอร์โปรเจกต์แล้วรัน:

```powershell
pnpm local:test
```

หรือดับเบิลคลิก `start-local.cmd` ที่โฟลเดอร์หลัก รอข้อความ `[READY]` เว็บจะอยู่ที่ **http://127.0.0.1:3000/login** ตัวรันเปิด Next dev, local E5 จาก cache เดิม, Inbox/AI/Outbox/Incidents และ Cloudflare HTTPS tunnel รวมกัน และแสดง URL webhook ทั้งสองเส้นให้คัดลอก ไม่ต้อง deploy Vercel

Local ในที่นี้หมายถึงเว็บและ workers อยู่บนเครื่องคุณ ฐานข้อมูลยังเป็น Supabase DEVELOPMENT ที่ตั้งไว้เดิม การทดสอบจะบันทึกข้อมูลลงฐาน development และ workers จะประมวลผลงานในคิวตามปกติ ไม่มีการล้างข้อมูล/รัน migration/ดาวน์โหลดโมเดล/อนุมัติเอกสารแทนคน

หยุดจาก terminal เดิมด้วย **Ctrl+C** หรือจากอีก PowerShell:

```powershell
pnpm local:stop
```

Workers จะจบรอบและปิด connection ก่อน ตัวรันหยุดเฉพาะ process ที่เปิดเอง หากรอนานเกิน90วินาทีจึงหยุด process เหล่านั้นแบบบังคับ กลไก lease/idempotency เดิมยังควบคุมการกู้คืน พอร์ตเว็บที่มีโปรแกรมใช้อยู่จะไม่ถูกยึด; ถ้ามี E5 ที่ตรวจ model/revision/384/auth ผ่านอยู่แล้วจะใช้ร่วมและไม่หยุดตัวเดิม

ตรวจ prerequisites โดยยังไม่เปิด services:

```powershell
pnpm local:check
```

ทดสอบ Dashboard อย่างเดียวโดยไม่สร้าง public tunnel:

```powershell
pnpm local:test --no-tunnel
```

ถ้าพอร์ต3000ถูกใช้ ให้หยุด server เดิมเอง หรือเลือก `pnpm local:test --port 3001` ระบบจะสร้าง webhook/ลิงก์ด้วยพอร์ตที่เลือก อย่าเปิด runners ซ้อนกัน

## เริ่มทดสอบครั้งแรก

1. เข้าหน้า `/login` บัญชี development ที่มีอยู่เก็บใน `.superpowers/staging/dev-staff-credentials.json` บนเครื่องเดิม เปิดไฟล์เองเพื่อดูบัญชี SUPER_ADMIN/เจ้าหน้าที่ ไม่ส่งรหัสผ่านในแชตหรือรายงาน
2. เปิด **Providers** กดทดสอบโมเดลฟรีที่ตั้งไว้ ตรวจ HTTP/ผลลัพธ์จริง แล้วจัดลำดับขึ้น/ลงตามต้องการ สคริปต์เปิด `YRU_AI_ENABLED=true` กับ `LINE_WEBHOOK_MODE=durable` เฉพาะ process รอบนี้ ค่า `.env` ไม่เปลี่ยน ระบบ generation ยังรักษา FREE_ONLY และค้นเว็บภายนอกยังปิดอยู่
3. เปิด **Settings** ตรวจ E5 และเวลาที่พบ Inbox/AI/Outbox/Incidents หลังเริ่มรัน เวลา check-in เป็นเพียงสิ่งที่สังเกตได้ ให้ตรวจการทำงานจริงประกอบ
4. เปิด **Knowledge → Import** นำเข้าเอกสารทางการที่ได้รับอนุญาตจาก `documents/yru/` หรือเอกสารของคุณ กดวิเคราะห์ ตรวจข้อความ/ตาราง/ข้อเสนอ/ปี/ขอบเขต/คำเตือน เลือกวิธีจัดเก็บและแก้ส่วนที่ยังไม่ครบ แล้วอนุมัติอย่างชัดเจน การดาวน์โหลดไว้ยังไม่ทำให้เอกสารเป็น approved
5. ใน LINE Developers ตั้ง Student และ Staff **Messaging API → Webhook URL** ตาม `[READY]` ที่แสดงใน terminal กด **Verify** ทั้งสอง เปิด Use webhook และปิด auto-reply ที่ตอบซ้ำ ตัวรันได้ทดสอบ signed `events: []` และ invalid signature แล้ว แต่ยังต้อง Verify จาก LINE จริง
6. ให้เจ้าหน้าที่เข้าบัญชีของตนที่ Dashboard → Settings → สร้างรหัสเชื่อมต่อ → ส่งคำสั่งนั้นเข้า **Staff OA** ภายใน10นาที แล้วกลับมาตรวจว่าเชื่อมต่อแล้ว

Quick tunnel ได้ URL ใหม่เมื่อเปิดใหม่ ต้องแก้ Webhook URL ทั้งสองเมื่อ URL เปลี่ยน ตัวรันตั้ง APP_BASE_URL เป็น URL รอบนั้นก่อนเปิดเว็บ/workers เพื่อให้ลิงก์เปิด ticket จาก Staff OA ใช้ผ่านมือถือได้

## ทดสอบข้อความและงานจริง

เริ่มส่ง **“สวัสดี”** เข้า Student OA ดูว่าคำขอถูกบันทึก/ประมวลผลและตอบกลับ พร้อมตรวจ terminal ตอนนี้ใช้ durable+AI จึงไม่ใช่รูปแบบ echo “ได้รับข้อความแล้วครับ” จากการทดสอบรอบแรก คำตอบอ้างอิงเอกสารต้องมีข้อมูลที่อนุมัติแล้ว; ถ้าข้อมูลไม่พอให้ระบบแจ้งข้อจำกัดหรือขอรายละเอียด

จากนั้นทำ A–F ตามตาราง **“ข้อความและผลที่ต้องตรวจใน LINE จริง”** ใน [final setup](FINAL_SETUP_CHECKLIST.md): FAQ อ้างอิงและไม่เปิด ticket, Wi-Fi ถามเพิ่ม/แนะนำ/ยืนยันแก้ได้, แก้ไม่ได้แล้วกดยืนยันส่งต่อ IT, Staff รับเรื่อง/ตอบเอง/HUMAN/ปิดงาน, หัวข้อใหม่ระหว่าง HUMAN และนำเข้าเอกสารรุ่นใหม่โดยคงรุ่นเก่า

ตรวจทั้ง Student OA, Staff OA และ Dashboard; การได้รับ HTTP200 เพียงอย่างเดียวไม่ยืนยัน AI/source/LINE delivery ผ่าน ปุ่มยืนยันต้องมาจากบทสนทนานั้น เจ้าหน้าที่ต่างหน่วยงานหรือยังไม่ผูก OA ต้องไม่รับแจ้งเตือนข้อมูลที่ไม่มีสิทธิ์ ไม่กดส่งให้ผู้รับจริงอื่นระหว่างทดสอบ

## ดู log และแก้การเริ่มระบบ

Terminal ที่รันจะแยกบรรทัด `[WEB]`, `[E5]`, `[INBOX]`, `[AI]`, `[OUTBOX]`, `[INCIDENT]`, `[TUNNEL]` และเก็บ log ที่ผ่านการปกปิด credentials ใน `.superpowers/staging/local-test/run-*.log` ถ้าต้องการดูจากอีก PowerShell:

```powershell
$localLog = Get-ChildItem .superpowers/staging/local-test/run-*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content -LiteralPath $localLog.FullName -Tail 80 -Wait
```

| ข้อความ | การแก้ |
|---|---|
| `LOCAL_WEB_PORT_IN_USE` | หยุดเว็บเดิมเองหรือใช้ `--port 3001` |
| `LOCAL_SESSION_ALREADY_RUNNING` | ใช้ terminal เดิม หรือ `pnpm local:stop` แล้วเปิดใหม่ |
| `LOCAL_MISSING_…` / `LOCAL_ENV_FILES_MISSING` | ตรวจชื่อค่าจาก `.env.example`; เติมค่าจริงในไฟล์ ignored โดยไม่ทับไฟล์เดิม |
| `LOCAL_DEVELOPMENT_REQUIRED` / target mismatch | เลือก development ตาม `.env` เดิม ไม่ชี้ production |
| `LOCAL_EMBEDDING_…` | ตรวจ service `.env`, virtualenv/cache เดิม, model/revision/384 และ key ตรงกัน; ไม่มี automatic download |
| `LOCAL_MIGRATION_HISTORY_MISMATCH` / `LOCAL_STRUCTURED_NOT_READY` | ตรวจประวัติฐาน development ตาม runbook; ตัวรันไม่ apply/reset ฐานอัตโนมัติ |
| `LOCAL_CLOUDFLARED_MISSING` / tunnel timeout | ตรวจ cloudflared ใน PATH/เครือข่าย หรือใช้ `--no-tunnel` สำหรับ Dashboard |
| `LOCAL_FREE_ONLY_REQUIRED` | ปิด provider ที่อนุญาต paid แล้วใช้ FREE_ONLY ใน Providers สำหรับรอบทดสอบนี้ |

Log ต่อไฟล์จำกัด10MiB การมี process ทำงานและ signed smoke ผ่านยังไม่แทน live model/corpus/OA A–F หลักฐาน local ที่รันจริงและข้อจำกัดอยู่ใน [รายงานตัวรัน](../reports/LOCAL_TEST_RUNNER_REPORT.md)
