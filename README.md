# YRU AI Student Support / Helpdesk

ระบบช่วยนักศึกษาผ่าน LINE OA พร้อม RAG, ticket และเจ้าหน้าที่รับช่วงผ่าน Dashboard โดย V1 เป็น anonymous. Runtime AI เริ่มจากบริการฟรี Zen/OpenRouter; มหาวิทยาลัยเลือกเพิ่มบริการเสียเงินผ่าน UI ภายหลัง

เริ่มอ่าน [project index](docs/PROJECT_INDEX.md), [task board](docs/tasks/V1_TASK_BOARD.md), [system design](docs/architecture/YRU_V1_DESIGN.md), [requirements](docs/requirements/V1_REQUIREMENTS_MATRIX.md). Agent อ่าน [AGENTS.md](AGENTS.md) ก่อนแก้โค้ด; UX ใช้ [PRODUCT](PRODUCT.md), [DESIGN](DESIGN.md) และ brief ของหน้า

## สถานะ

9 ตุลาคม 2026: LINE สอง OA, Ticket/HUMAN, Staff login, Provider/Model UI, FREE_ONLY gateway, RAG/ข้อมูลตาราง, นำเข้าและอนุมัติเอกสาร, Dashboard, Staff OA, troubleshooting และ Incidents มีโค้ดและหลักฐานทดสอบระดับ component แล้ว ฐานข้อมูล local/DEVELOPMENT มี 38 migrations และ 59 ตารางที่เปิด RLS รวมข้อมูลตารางความรู้ 7 ชนิด ระบบใช้ local CPU E5-small/384 สำหรับ embedding แยกจากหน้า Provider

งาน code/test/docs ที่จำเป็นผ่านการตรวจรับอัตโนมัติแล้ว รวมค้นเว็บมหาวิทยาลัย→ข้อมูลทั่วไปและ Flow A–F: unit 2,087 ข้อ, ฐานทดสอบแยก 389 ข้อ/25 กลุ่ม, Flow A–F 8/8, normal PG 53 ข้อ, TypeScript/lint/build และ compiled Staff browser ผ่าน ดู [รายงานรับงาน](docs/reports/V1_AUTOMATED_ACCEPTANCE_REPORT.md) และ [สิ่งที่ต้องตั้งค่าจริง](docs/operations/FINAL_SETUP_CHECKLIST.md) บัญชี AI ฟรี เอกสารทางการ E5/LINE และ production/restore จริงยังต้องยืนยัน จึงยังไม่ใช่ live V1 ผ่านครบ

## เริ่มพัฒนา

Prerequisites: Node.js 24 ที่ใช้ทดสอบ, pnpm ตาม `package.json` (10.33.4), Docker สำหรับ local Supabase, LINE Student/Staff OA และ Supabase development project. ใช้ repository นี้เป็น workspace

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
pnpm dev
```

ตั้งค่าที่ [Local setup](docs/operations/LOCAL_SETUP.md): ENV, Supabase/migrations/seed, Staff login, LINE paths, Cloudflare Tunnel และ inbox/outbox/AI workers. `.env` มีอยู่แล้วให้แก้เฉพาะค่าที่จำเป็น ไม่ copy ทับ

## ทดสอบ

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
```

`test:db` ต้องมี dedicated local Supabase ของโปรเจกต์และ migrations ปัจจุบัน; ใช้ actual PostgreSQL/RLS/concurrency fixtures. Signed HTTP/browser harnessesอยู่ใน `scripts/qa/` ต้องใช้ isolated fixture setup ตามแผน/รายงาน ไม่ใช่คำสั่งยิง production. RED task ต้องทำ GREEN ก่อนรับ milestone

## Knowledge และการส่งต่อ

เอกสารที่ดาวน์โหลดอยู่ใน [documents/yru](documents/yru/README.md), [catalog](documents/yru/CATALOG.md), [completeness](documents/yru/COMPLETENESS.md). 187 resources และ shortlist15 เป็นแหล่งที่รวบรวมไว้ ยังไม่ใช่ approved knowledge. หน้า `/knowledge/import` รองรับ PDF/DOCX/XLSX/CSV/URL พร้อม Preview/Review และอนุมัติ RAG/STRUCTURED/BOTH ตามความพร้อมและหลักฐานของแหล่งข้อมูล เอกสารตารางต้องตรวจ mapping และยืนยันแถวที่ใช้ก่อนอนุมัติ ระบบไม่สร้าง schema ใหม่ตามปีและไม่เผยแพร่เอง

ดู [final setup checklist](docs/operations/FINAL_SETUP_CHECKLIST.md) สำหรับสิ่งที่ผู้ใช้ต้องเลือก/ตั้งค่าเอง และ [production runbook](docs/operations/PRODUCTION_RUNBOOK.md) สำหรับ artifact, คำสั่ง web/worker, parser child, shutdown/monitoring และ backup/restore. การ deployต้องมี worker lifecycle, stable HTTPS domain, schema/role gates และ approved corpus ไม่ถือว่า `next build` ผ่านแล้ว deployครบ
