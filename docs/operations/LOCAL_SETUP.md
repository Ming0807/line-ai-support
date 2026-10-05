# Local development and operational entry points

คู่มือนี้อิง scripts และชื่อตัวแปรจาก repository ปัจจุบัน สถานะงานล่าสุดอยู่ใน [task board](../tasks/V1_TASK_BOARD.md) และ [final setup checklist](FINAL_SETUP_CHECKLIST.md). การตั้งค่า manual ที่เลื่อนไปทำภายหลังไม่หยุดงาน implementation ที่ได้รับอนุญาต

## Environment

ใช้ [.env.example](../../.env.example) ดูชื่อตัวแปรเท่านั้น เก็บค่าลับไว้ใน `.env` ที่ ignored; อย่าใส่รหัสผ่าน, API key, LINE token หรือค่า secret ในเอกสาร, log หรือคำสั่งที่บันทึกไว้ Provider/model keys จัดการผ่านหน้า Dashboard และเก็บแบบเข้ารหัส

| กลุ่ม | ชื่อตัวแปร | หมายเหตุ |
|---|---|---|
| Supabase ใน browser | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ใช้ publishable key |
| Supabase ฝั่ง server | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | secret key ต้องอยู่ฝั่ง server |
| PostgreSQL | `DATABASE_URL`, `DIRECT_URL`, `DATABASE_SSL_CA_PATH` | ใช้ TLS กับฐานข้อมูล remote ตามที่ระบบกำหนด |
| เข้ารหัสข้อมูล | `ENCRYPTION_KEY` | สร้างตามรูปแบบที่ `.env.example` ระบุ และเก็บ key เดิมไว้เพื่ออ่านข้อมูลที่เข้ารหัสแล้ว |
| LINE Student | `LINE_STUDENT_CHANNEL_SECRET`, `LINE_STUDENT_CHANNEL_ACCESS_TOKEN` | แยกจาก channel ของ Staff |
| LINE Staff | `LINE_STAFF_CHANNEL_SECRET`, `LINE_STAFF_CHANNEL_ACCESS_TOKEN` | แยกจาก channel ของ Student |
| แอปและ webhook | `APP_BASE_URL`, `LINE_WEBHOOK_MODE` | `echo` ใช้ demo; `durable` ต้องมีฐานข้อมูลและ workers |
| AI | `YRU_AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL` | ค่า AI provider/model ใน env เป็น reserved/compatibility fields; ไม่ bootstrap model/key. `YRU_AI_ENABLED=false` ใน local เป็นค่าเริ่มต้นโดยตั้งใจ; ตั้ง provider/model/key ผ่าน Dashboard |
| Development guards | `YRU_DEPLOYMENT_ENV`, `DEV_SUPABASE_PROJECT_REF` | ใช้กับ scripts ที่จำกัดเป้าหมาย development |

AI เริ่มด้วย `FREE_ONLY`; ใช้ Zen/OpenRouter ที่ตรวจราคาและ capability แล้วเป็นทางเลือกหลัก Unknown pricing ถูกบล็อก ส่วนบริการเสียเงินเป็นการเลือกภายหลังของมหาวิทยาลัยผ่าน UI เท่านั้น ห้ามเปิด paid inference ใน startup checks. ยังไม่เปิด local AI จนผู้ใช้ตั้ง free model และ embedding dimension จริง, ตรวจคุณภาพและ corpus, และผ่าน manual safety checks ที่อยู่ใน [checklist](FINAL_SETUP_CHECKLIST.md). ระหว่างนั้นสามารถทำงาน code และ fixture ต่อได้

## Supabase, migrations, and seed

โปรเจกต์ local แยกใช้ `supabase/config.toml` (`line-ai-yru`): API `54421`, database `54422`, shadow database `54420`. Migration script pin Supabase CLI `2.119.0`; ต้องเปิด Docker ก่อน

```powershell
pnpm dlx supabase@2.119.0 start
pnpm dlx supabase@2.119.0 migration up --local
```

ตรวจ database target และ migration history ก่อนเปลี่ยน schema อย่าใช้ `db reset` กับข้อมูลที่ต้องเก็บ Clean replay ใช้ disposable fixture หลังตรวจ preflight ตาม plan. Seed มี 9 departments; `pnpm test:db` ใช้ dedicated local database และป้องกันการเขียนทับค่าที่มีอยู่

ตรวจ guarded DEVELOPMENT migration แบบ dry run:

```powershell
pnpm exec tsx scripts/database/apply-development.ts
```

การเพิ่ม `--apply` เปลี่ยนฐานข้อมูลจริง: ทำได้ภายหลัง local migration, RLS, test gates และ target guard ผ่านการ review แล้วเท่านั้น ไม่ใช้เป็นขั้นตอน setup ทั่วไปหรือโหลด knowledge

## Dashboard login

เริ่มเว็บด้วย `pnpm dev` (ปกติที่ `localhost:3000`) แล้วเปิด `/login`, `/dashboard`, `/tickets` หรือ `/providers`. รายงาน M2–M5 มี automated auth และ browser evidence รวมถึง provider configuration; อย่าใช้บัญชี development เป็นหลักฐาน production

บัญชีทดสอบ development อยู่ใน ignored `.superpowers/staging/dev-staff-credentials.json` บนเครื่องนี้ อย่าเปิดเผยรหัสผ่านใน README, report หรือ log. Bootstrap script เก็บรักษาบัญชี/profile/password ที่มีอยู่ ไม่ได้สร้าง SUPER_ADMIN ใหม่ทุกครั้ง

## LINE OA and Cloudflare Tunnel

Webhook paths คงที่:

```text
https://<current-https-domain>/api/line/student/webhook
https://<current-https-domain>/api/line/staff/webhook
```

รันเว็บก่อน แล้วเปิด tunnel ไปยัง port ที่ใช้งานจริง:

```powershell
cloudflared tunnel --url http://localhost:3000
```

ใช้ HTTPS URL ปัจจุบันที่ tunnel แสดงใน LINE Developers สำหรับแต่ละ webhook แล้ว Verify และเปิด UseWebhook. Quick tunnel URL เปลี่ยนเมื่อเริ่มใหม่; URL เก่าเป็นเพียงประวัติ. ตั้ง automatic response ของ OA ให้ไม่ตอบซ้ำกับ backend

ทั้งสอง route ตรวจ raw-body HMAC ก่อน parse JSON. Student/Staff echo เคยผ่าน LINE จริง แต่ durable ticket flow, AI answer quality และ Flow A–F ยังต้องทดสอบตาม checklist; provider fixture ไม่ใช่ live service evidence

## Web app and workers

Durable mode ต้องใช้ database, encryption/config ที่พร้อม และ process แยกกัน:

```powershell
pnpm dev
pnpm worker
pnpm worker:outbox
pnpm worker:ai
```

เปิดแต่ละ process ใน terminal แยกหรือ managed service. AI worker จะคง disabled เมื่อ `YRU_AI_ENABLED` ไม่ใช่ `true`; อย่าเปลี่ยนค่านี้เพื่อข้ามการตั้งค่า free model, dimension และการตรวจ safety. เมื่อเปลี่ยน env ให้ restart process ที่เกี่ยวข้อง; Next reload ไม่ได้ restart worker ทุกตัว

## Current evidence and checks

Provider prerequisite automated acceptance เป็น checkpoint ก่อนหน้าตาม [PRV acceptance report](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md): 919 unit tests, 92 PostgreSQL tests, 19 migration replay, 31 RLS tables, 8 browser groups และ signed free fixture มี 9 catalog กับ 9 inference calls; paid native calls เป็น 0. นี่ไม่ใช่ full-suite evidence ของ Import checkpoint ปัจจุบัน และไม่ยืนยัน live free-account availability, Thai quality, live quota, corpus approval, LINE production flow หรือ deployment

M7 Import ยังเป็น PARTIAL/IN_PROGRESS. Latest1065unit/63files,110integration (including actual loopback Auth/Storage), foundationRLS,21isolatedmigrationreplay/advisors0/type/lint/build PASS. Privateencrypted Storage/source/CSV/HTML/URL/query/staging/API components have evidence; independent URL/Storage reviews passed, ZIP23tests/rootselfreview passed but independent reviewer usage limited. Earlier1033unit/20-migration checkpoint preserved in report, including corrected load-related auth ACL timeout. Local21 vsDEV19; PDF/DOCX/XLSX/child/extraction/edit/review/publication/UI/citations/fullformats remain pending. Livefree/corpus/OA/production unverified. See [Import report](../reports/IMP_ACQUISITION_STAGING_COMPONENT_REPORT.md).

เมื่อจำเป็นกับการเปลี่ยนแปลง ให้ใช้ scripts ที่มีใน `package.json`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
```

`pnpm test:db` ต้องใช้ dedicated local Supabase database/container. Signed HTTP/browser harnesses ใน `scripts/qa/` ใช้ isolated fixtures ตามรายงานและแผน; ห้ามชี้ fixture ไปฐานข้อมูล production. ผลจาก checkpoint ก่อนหน้าไม่ใช่ผลทดสอบ source ปัจจุบัน

## Knowledge import

อ่าน [corpus README](../../documents/yru/README.md), [completeness](../../documents/yru/COMPLETENESS.md) และ [catalog](../../documents/yru/CATALOG.md) ก่อนเลือกเอกสาร. Script ที่มีอยู่ `pnpm exec tsx scripts/knowledge/stage-shortlist.ts` สร้าง metadata ที่รอตรวจใน ignored `.superpowers/staging/m6-shortlist.json`; ไม่ได้ approve, publish หรือสร้าง embeddings. Shortlist ทั้ง 15 แหล่งยังเป็น pending review

Import supports all5formats in the frozen source contract; CSV/HTML/officialURL/private originals/staging/API components pass, but Office/PDF parsing and review/publication/UI remain implementation work. PUBLIC approval will require source/dates/authority/applicability/sensitivity/extraction review; no corpus was autoapproved. User configuration remains deferred in the final checklist.

Local database + Auth + Storage startup: `pnpm exec tsx scripts/storage/start-local.ts`. It captures CLI key-bearing output, backs up the current database before expanding a database-only stack and preserves migrations; never uses reset or `--no-backup`. `pnpm test:db` now requires the local Storage/Auth service as well as PostgreSQL and includes an actual loopback private-object test. Do not print raw CLI status credentials. Runtime original access defaults to private `knowledge-originals`, application AES-GCM, MIME application/octet-stream and20971553byte envelope limit; backend-only service access/no-upsert/no signed URL/delete. DEV/production bucket/policy/restore gates remain separate.

## Production readiness

ก่อน production ต้องยืนยัน hosting ที่ดูแล HTTP และ worker lifecycle, stable HTTPS domain, webhook, staff roles, verified TLS, database/storage access, backups, encryption-key custody, queue/error monitoring, rollback และ approved corpus. Build ผ่านหรือ provider fixture ผ่านอย่างเดียวไม่ใช่ production acceptance; Flow A–F และการตรวจ manual ที่เหลือต้องมีหลักฐานตาม checklist
