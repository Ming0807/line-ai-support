# YRU AI Student Support / Helpdesk

ระบบช่วยนักศึกษาผ่าน LINE OA พร้อม RAG, ticket และเจ้าหน้าที่รับช่วงผ่าน Dashboard โดย V1 เป็น anonymous. Runtime AI เริ่มจากบริการฟรี Zen/OpenRouter; มหาวิทยาลัยเลือกเพิ่มบริการเสียเงินผ่าน UI ภายหลัง

เริ่มอ่าน [project index](docs/PROJECT_INDEX.md), [task board](docs/tasks/V1_TASK_BOARD.md), [system design](docs/architecture/YRU_V1_DESIGN.md), [requirements](docs/requirements/V1_REQUIREMENTS_MATRIX.md). Agent อ่าน [AGENTS.md](AGENTS.md) ก่อนแก้โค้ด; UX ใช้ [PRODUCT](PRODUCT.md), [DESIGN](DESIGN.md) และ brief ของหน้า

## สถานะ

M1–M4 มี automated evidence. M5/M6 **reopened**: gateway/RAG components มีแล้ว แต่ free provider และ Provider UI ยังไม่ครบ. Import/structured/incidents/full Flow A–F ยังอยู่ในแผน ไม่ใช่ระบบ production ที่เสร็จแล้ว. ดู [provider audit](docs/reports/AI_PROVIDER_SPEC_AUDIT.md)

Current pricing test เป็น RED เพราะยังไม่มี `lib/ai/pricing.ts`; ผล unit/build ที่ผ่านก่อนหน้านั้นเป็น checkpoint ตาม [M6 report](docs/reports/M6_RAG_REPORT.md). ห้ามอ่าน README แล้วถือว่าสถานะปัจจุบัน all-green

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

เอกสารที่ดาวน์โหลดอยู่ใน [documents/yru](documents/yru/README.md), [catalog](documents/yru/CATALOG.md), [completeness](documents/yru/COMPLETENESS.md). 187 resources และ shortlist15 เป็นแหล่งที่รวบรวมไว้ ยังไม่ใช่ approved knowledge. M7 จะเพิ่ม Upload/URL→Preview→Approve สำหรับ PDF/DOCX/XLSX/CSV/URL; ตอนนี้ยังไม่มี import UI/API ให้ใช้งานจริง

ดู [final setup checklist](docs/operations/FINAL_SETUP_CHECKLIST.md) สำหรับสิ่งที่ผู้ใช้ต้องเลือก/ตั้งค่าเอง และ production notes. การ deployต้องมี worker lifecycle, stable HTTPS domain, schema/role gates และ approved corpus ไม่ถือว่า `next build` ผ่านแล้ว deployครบ
