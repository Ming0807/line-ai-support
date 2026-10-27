# ทดลอง YRU Helpdesk บนเครื่องนี้

## ทดสอบ AI สนทนาแบบใหม่โดยตรง

เมื่อถึงรอบทดสอบที่ส่งมอบให้แล้ว ใช้ **`pnpm local:ai`** และรอ `[READY]` คำสั่งนี้เปิดเว็บ/E5/workers/tunnel เหมือนเดิม พร้อมบังคับ `YRU_ASSISTANT_ENABLED=true` เฉพาะ child session ทั้งก่อนและหลังสร้าง tunnel ไม่แก้ `.env` หรือ provider/model/key คำสั่ง `start-local.cmd --assistant-preview` ใช้แทนกันได้

นี่คือ **preview ของโมเดลที่ยังไม่ผ่านเกณฑ์คุณภาพทั้งหมด** ไม่ใช่การเปิด production หรือรับรอง V1; จะประมวลผลคิว DEVELOPMENT และส่งคำตอบ LINE จริงเมื่อมีงานอยู่ ระบบยังตรวจ FREE_ONLY/source/ownership/HUMAN ตามเดิม ไม่เปิด evidence-first MIXED experiment และไม่รัน Hermes เว้นแต่ใส่ `--hermes-check` เอง

`pnpm local:test` ใช้ค่า natural assistant เดิม ซึ่งตอนนี้ยังปิดอยู่ จึงอาจกำลังทดสอบ legacy support pipeline หากต้องการทดสอบ AI แบบใหม่ให้เลือก `local:ai` ชัดเจน อย่าเปิด runners ซ้อนกัน หยุดด้วย `pnpm local:stop` หรือ Ctrl+C

ล่าสุด root ตรวจ startup ของคำสั่งนี้จริงแล้ว signed local/public Student+Staff8checks และ workers4 ผ่าน จากนั้นหยุด session เรียบร้อย URL เก่าใช้ไม่ได้จนกว่าจะเปิดใหม่ **ผู้ใช้เลื่อน actual LINE tests ไปท้ายงาน จึงยังไม่ต้องทดสอบตอนนี้** ดู [สถานะหลัก](../tasks/V1_TASK_BOARD.md)

## รอบทดสอบงานเจ้าหน้าที่ก่อนเปิด AI เต็มรูปแบบ

ใช้ `pnpm local:staff` แล้วรอ `[READY]` และคัดลอก URL Student/Staff ของรอบนั้น คำสั่งนี้ปิด natural assistant เฉพาะ session แม้ `.env` เคยเปิดไว้ แต่ **legacy support AI ยังทำงาน** สำหรับ flow เดิม ไม่ใช่โหมดปิด AI ทั้งหมด และไม่รับรองคุณภาพคำตอบทั่วไป ไม่รัน Hermes หรือเปลี่ยน model/key โดยอัตโนมัติ

1. Login Dashboard ด้วยบัญชี Staff → Settings → เชื่อมบัญชี LINE ส่วนตัวกับ Staff OA
2. Student OA ส่ง “ติดต่อเจ้าหน้าที่” และเลือกฝ่ายที่มี Staff ทดสอบ
3. ให้ Staff สองคนในฝ่ายเดียวกันลองรับเคสเดียวกัน ผู้ชนะต้องมีคนเดียว
4. ผู้รับกดเปิดคุยเคสนั้นแล้วตอบ ตรวจรหัสเคสและผู้รับใน Student OA
5. ลองอีกเคสและสลับเคสอย่างชัดเจน การรับแจ้งเตือนใหม่ต้องไม่เปลี่ยนผู้รับข้อความเอง
6. ปิดเคส แล้วลองปุ่มเก่า ต้องไม่ส่งข้อความใหม่เข้าเคสที่ปิด

ข้อใดไม่ตรงให้หยุดส่งข้อความและแจ้งเวลา/รหัสเคส ไม่ส่ง token หรือข้อมูลส่วนตัวจริง การตรวจนี้ไม่แทนการทดสอบคุณภาพ AI และ Flow A–F ทั้งหมด

## เปิดและหยุดด้วยคำสั่งเดียว

เปิด PowerShell ในโฟลเดอร์โปรเจกต์แล้วรัน:

```powershell
pnpm local:test --hermes-check
```

หรือดับเบิลคลิก `start-local.cmd` ที่โฟลเดอร์หลัก รอข้อความ `[READY]` เว็บจะอยู่ที่ **http://127.0.0.1:3000/login** ตัวรันเปิด Next dev, local E5 จาก cache เดิม, Inbox/AI/Outbox/Incidents และ Cloudflare HTTPS tunnel รวมกัน และแสดง URL webhook ทั้งสองเส้นให้คัดลอก ไม่ต้อง deploy Vercel

`--hermes-check` เพิ่มการทดสอบ Hermes CLI สองข้อความสังเคราะห์ผ่าน FREE_ONLY ในคำสั่งเดียว และแสดง PASS/FAIL พร้อมขั้นตอนที่หยุด โดยไม่พิมพ์คำตอบหรือ credentials ใช้เวลาได้ถึง150วินาที ซึ่งครอบคลุมงบเปิด interpreter15วินาทีและ Python110วินาที พร้อมช่วงเริ่ม/ปิดบริการ หาก pilot ไม่ผ่านจะแสดง FAIL แต่เว็บกับ workers ยังทำงานได้ Hermes ยังเป็น pilot แยก ไม่ใช่ตัวตอบ LINE โดยตรง; `[READY]` แสดงสถานะการเปิด natural assistant แยกต่างหาก การรัน `pnpm local:test` หรือดับเบิลคลิกโดยไม่ใส่ flag จะข้ามการทดสอบ Hermes เพื่อไม่เรียกโมเดลทุกครั้ง

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

## เปิดค้นเว็บแบบเลือกใช้ภายหลัง

ค่าเริ่มต้นยังปิดอยู่ และการค้นที่มีในระบบเป็น **การแสดงลิงก์แหล่งข้อมูลที่จำกัด** หลังตรวจไม่พบข้อมูลภายในที่เข้าเงื่อนไข ไม่ใช่การค้นทุกเว็บไซต์หรือรับรองคำตอบทางการจากเว็บโดยอัตโนมัติ. การตั้งค่าพร้อมไม่เท่ากับผลตรวจ provider หรือผลค้นจริงผ่าน

เมื่อมีบัญชี Tavily และผู้ดูแลตรวจยืนยันว่าเป็น Researcher ฟรี ปิด Pay-as-you-go และไม่ผูกบัตร ให้จำกัด key ไม่เกิน500เครดิตต่อเดือน ใส่ `TAVILY_API_KEY` และ `TAVILY_FREE_NO_PAYG_ATTESTED=true` ใน `.env` ของเครื่อง จากนั้นใช้คำสั่งนี้เพื่อแสดงเฉพาะ fingerprint ของ key และเวลาปัจจุบัน UTC แล้วคัดลอกทั้งสองบรรทัดใส่ใน `.env` (คำสั่งไม่พิมพ์ key):

```powershell
node -e "const fs=require('fs'),d=require('dotenv'),c=require('crypto');const e=d.parse(fs.readFileSync('.env'));if(!e.TAVILY_API_KEY)throw Error('TAVILY_API_KEY missing');console.log('TAVILY_FREE_KEY_SHA256='+c.createHash('sha256').update(e.TAVILY_API_KEY).digest('hex'));console.log('TAVILY_FREE_ATTESTED_AT='+new Date().toISOString())"
```

เริ่ม session ด้วย `pnpm local:ai --web-search`. ข้อมูลยืนยันต้องตรงกับ key และมีอายุไม่เกิน24ชั่วโมง เมื่อหมดอายุต้องตรวจบัญชีอีกครั้งแล้วสร้างเวลายืนยันใหม่ด้วยคำสั่งเดิม. สคริปต์ปฏิเสธการตั้งค่าที่ขาดหรือไม่ตรงก่อนเปิดบริการ; ก่อนค้นจริง backend จะตรวจบัญชี/โควต้าและเงื่อนไขแหล่งข้อมูลอีกครั้ง. หากไม่มี key หรือต้องการทดสอบระบบส่วนอื่น ใช้ `pnpm local:ai` ตามปกติ.

## เริ่มทดสอบครั้งแรก

1. เข้าหน้า `/login` บัญชี development ที่มีอยู่เก็บใน `.superpowers/staging/dev-staff-credentials.json` บนเครื่องเดิม เปิดไฟล์เองเพื่อดูบัญชี SUPER_ADMIN/เจ้าหน้าที่ ไม่ส่งรหัสผ่านในแชตหรือรายงาน
2. เปิด **Providers** กดทดสอบโมเดลฟรีที่ตั้งไว้ ตรวจ HTTP/ผลลัพธ์จริง แล้วจัดลำดับขึ้น/ลงตามต้องการ สคริปต์เปิด `YRU_AI_ENABLED=true` กับ `LINE_WEBHOOK_MODE=durable` เฉพาะ process รอบนี้ ค่า `.env` ไม่เปลี่ยน ระบบ generation ยังรักษา FREE_ONLY และค้นเว็บภายนอกยังปิดอยู่
3. เปิด **Settings** ตรวจ E5 และเวลาที่พบ Inbox/AI/Outbox/Incidents หลังเริ่มรัน เวลา check-in เป็นเพียงสิ่งที่สังเกตได้ ให้ตรวจการทำงานจริงประกอบ ดู **Logs/Usage/Tickets** เพื่อตามผลประมวลผลและการส่งข้อความด้วย Workers ไม่พิมพ์เนื้อหาส่วนตัวหรือผลทุก cycle ลง terminal
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

## DuckDuckGo ผ่าน DDGS — ทางสำรองฟรี

ROOT-WEB-DDGS-02: เมื่อเปิดด้วย `pnpm local:ai --web-search` ระบบใช้ Tavily ก่อน แล้วลอง DDGS ได้ครั้งเดียวเมื่อบริการหลักไม่พร้อม/โควต้าหมด โดยยังตรวจสิทธิ์และเอกสารก่อน/หลังค้น หากสถานะบันทึกคำขอไม่แน่นอนหรือเป็นคำขอซ้ำจะหยุด ไม่สลับซ้ำไปมา. DDGS ไม่ต้องมี API key และไม่ต้องยืนยันบัญชี Tavily แต่ต้องติดตั้ง `scripts/qa/requirements-ddgs.txt` ใน Python environment แยกและตั้ง `DDGS_ENABLED=true`, `DDGS_PYTHON_PATH` เป็นพาธเต็มของ Python ที่ติดตั้งไว้. เครื่องนี้ใช้ D:/codex-cache/yru-ddgs/.venv/Scripts/python.exe; ไม่มีการดาวน์โหลดตอนเปิดแอป.

ตรึงddgs9.16.1และใช้backendDuckDuckGoเท่านั้น ไม่สลับengine/proxyเพื่อหลบการจำกัด. Libraryไม่รับรองโควต้าหรือความพร้อมไม่จำกัด; แอปจำกัดDDGSห่างกัน10วินาที และนับร่วมเพดาน50คำขอ/วัน500/เดือนตามUTC. เพดานนี้เป็นของแอป ไม่ใช่ข้อเสนอของผู้ให้บริการ. เมื่อถูกจำกัด/ค้นไม่ได้จะแจ้งข้อจำกัดตามระบบเดิม ไม่สร้างหลักฐานว่าไม่มีข้อมูล. ผลเป็นลิงก์ให้อ่านต่อ ไม่ใช่ข้อเท็จจริงที่อนุมัติแล้ว. Tavilyยังต้องผ่านattestationและfreequotaของตัวเองทุกครั้ง.
