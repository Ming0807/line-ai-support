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
| Generation | `YRU_AI_ENABLED`, reserved `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` | ไม่ bootstrap model/key; `YRU_AI_ENABLED=false` จนผ่าน foundation/knowledge gates; generationตั้งผ่านDashboard |
| Embedding infrastructure | `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`, `EMBEDDING_MODEL_REVISION`, `EMBEDDING_API_URL`, optional `EMBEDDING_API_KEY` | Default local CPU E5/384; server-only. Cache rootอยู่ในignored `services/embedding/.env`; ไม่ต้องเพิ่มEmbedding Modelผ่านUI |
| Development guards | `YRU_DEPLOYMENT_ENV`, `DEV_SUPABASE_PROJECT_REF` | ใช้กับ scripts ที่จำกัดเป้าหมาย development |

Generation เริ่มด้วย `FREE_ONLY`; Zen/OpenRouterต้องตรวจราคา/capabilityจริง Unknown/paidถูกบล็อก; paidเป็นมหาวิทยาลัยเลือกภายหลังผ่านUI. Embeddingใช้local CPU E5/384 ตามคำยืนยัน5October ไม่ต้องเลือกdimensionเอง. LiveAIยังปิดจนผ่านfoundation/freegeneration quality/corpusreview และ[checklist](FINAL_SETUP_CHECKLIST.md); independent implementation/fixturesดำเนินต่อได้

## Embedding service

จาก root ใช้ `& services/embedding/.venv/Scripts/python.exe services/embedding/run.py`. [Service README](../../services/embedding/README.md) มีconfig/cache/offline/API/remote-auth commands. Cacheถูกคัดลอกไป `D:\AI\Models\huggingface`; C:ยังเก็บไว้ ไม่มีredownload. Backendเรียก `http://127.0.0.1:8000`; browserเห็นread-only healthที่ `/providers` ผ่านNext.js. Query/passage prefixes, normalized384 และfixedrevisionตาม[design](../architecture/EMBEDDING_SERVICE_DESIGN.md); endpointmoveไม่เปลี่ยนfingerprint

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

6October private extraction/preview acceptance: `/knowledge` and `/knowledge/import?id=<job UUID>` are SUPER_ADMIN-only; upload/official URL staging is explicit, followed by Analyze, located preview and reason-bound page/table-cell edits. `/api/knowledge/analyze` and private preview/edit routes append encrypted revisions and never publish documents. Local+DEVELOPMENT23 migrations/DEV34RLS tables/9departments,1219unit/123integration/replay/advisors0/type/lint/build and14actualbrowser groups passed in [extraction report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md). Conflict reload preserves only genuine drafts, updates untouched fields and requires comparison before keeping changed values. DEVELOPMENT Storage setup: `pnpm exec tsx scripts/storage/setup-development.ts` inspects the guarded target; `--provision` creates only a missing exact private bucket. DEVELOPMENT private bucket/object role-denial is verified; production policy/restore remains pending. Root used the compiled application on3000 and verified default `next dev --port 3001`; temporary host-memory failures did not justify changing the bundler or weakening checks. Metadata/review/approval/publication remain the next implementation, not a setting for the user to supply.

ก่อน production ต้องยืนยัน hosting ที่ดูแล HTTP และ worker lifecycle, stable HTTPS domain, webhook, staff roles, verified TLS, database/storage access, backups, encryption-key custody, queue/error monitoring, rollback และ approved corpus. Build ผ่านหรือ provider fixture ผ่านอย่างเดียวไม่ใช่ production acceptance; Flow A–F และการตรวจ manual ที่เหลือต้องมีหลักฐานตาม checklist

6October **IMP-03A private review draft** passed1235unit/135PG/type/lint/build,24replay/RLS,0advisorWARN+ERROR (89INFO) and21actualbrowser groups; [review report](../reports/IMP_REVIEW_DRAFT_REPORT.md). Local+DEVELOPMENT24migrations/DEV35RLS tables/9departments. SUPER_ADMIN `/knowledge/import?id=<job UUID>` can save incomplete metadata/false attestations/reason-bound warning choices through private GET/PUT `/api/knowledge/imports/<id>/review`. The compiled app is verified onlocalhost3000. Save does not approve, advance extraction or index chunks; target resolution/publication is the next code task. Never expose originals via Storage or commit local account credentials.


6October version-choice component: private GET `/api/knowledge/imports/[id]/versions` uses only saved review metadata and exact expected job/extraction/review query counters. In the import UI, save metadata, inspect available choices, explicitly select action/target, then save the private draft. Lookup failure/stale targets retain drafts; clear or confirmed reload recovers pending choices. This is not approval/publication. Initial reference data dry-run: `pnpm exec tsx scripts/database/seed-document-families-development.ts`; human-selected DEVELOPMENT apply: same command with `--apply`. The guard checks the selected development target before connecting and preserves existing catalog values; production is not targeted. Root applied19initial families and verified repeat0inserts. Schema remains24migrations. See [report](../reports/IMP_VERSION_RESOLVER_REPORT.md).
