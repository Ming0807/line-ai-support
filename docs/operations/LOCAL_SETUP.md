# Local development / operational entry points

อิง scripts/config ปัจจุบัน 4 ต.ค. 2026 คู่มือนี้ไม่เปิด provider, overwrite `.env`, reset DB หรือ publish knowledge อัตโนมัติ. [สถานะและข้อที่ยังขาด](../tasks/V1_TASK_BOARD.md)

## ENV

ใช้ [.env.example](../../.env.example) เป็นรายการชื่อและ defaults. Secrets อยู่ local ignored `.env`; keys ของ AI เก็บ encrypted server registryผ่าน Dashboard หลัง PRV correction ไม่ต้องแก้ source ทุก instance

| กลุ่ม | ชื่อค่าที่ใช้ | หมายเหตุ |
|---|---|---|
| Browser Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | modern key; legacy ANON compatibleตามenvreader |
| Server Supabase | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | server secretไม่อยู่ clientbundle |
| PostgreSQL | `DATABASE_URL`, `DIRECT_URL`, `DATABASE_SSL_CA_PATH` | remote verified TLS; direct/session connectionสำหรับmigration/advisorylockpaths |
| Identity/key encryption | `ENCRYPTION_KEY` | base64 random32bytes ตามZod; ห้ามเปลี่ยนจนอ่านencryptedrecordsเดิมไม่ได้ |
| LINE Student | `LINE_STUDENT_CHANNEL_SECRET`, `LINE_STUDENT_CHANNEL_ACCESS_TOKEN` | Studentchannelเท่านั้น |
| LINE Staff | `LINE_STAFF_CHANNEL_SECRET`, `LINE_STAFF_CHANNEL_ACCESS_TOKEN` | Staffchannelเท่านั้น |
| Application | `APP_BASE_URL`, `LINE_WEBHOOK_MODE` | `echo` preserves demo; `durable` requires DB/workers |
| AI | `YRU_AI_ENABLED`, timeout fields | falseจนfreecontracts/models/reviewedknowledgeพร้อม; ไม่มีautobootstrapจากreservedAI_*fields |
| DEV guards | `YRU_DEPLOYMENT_ENV`, `DEV_SUPABASE_PROJECT_REF` | migration/account scriptsจำกัดselecteddevelopmenttarget |

Generation/embedding model และ dimensionเลือกผ่าน `/providers` เมื่อแก้ scopeแล้ว. `AI_*`/`EMBEDDING_*` ใน env example เป็น reserved/compatibility ไม่เป็นเหตุให้เดา modelหรือเรียกpaidprovider

## Supabase / migrations / seed

Dedicated local project: `supabase/config.toml` project_id `line-ai-yru`; API54421, DB54422, shadow54420. CLI ที่ development migration script pinไว้คือ2.119.0; Dockerต้องพร้อม

```powershell
pnpm dlx supabase@2.119.0 start
pnpm dlx supabase@2.119.0 migration up --local
```

ตรวจ target/historyก่อนเพิ่ม migration; ไม่ run reset บนข้อมูลที่ต้องเก็บ. Clean replayใช้ dedicated disposable fixtureและempty preflightตามplan ไม่ถือว่าคำสั่ง resetเป็นsetupทั่วไป. `supabase/seed.sql` มี9departments; `pnpm test:db`/guardedDEVscriptแปลงseedเป็นDO NOTHINGเพื่อไม่ overwriteexistingvalues

Remote development scriptอ่าน ignored.envและverifiedCA. คำสั่งไม่ใส่ `--apply` เป็นinspect/dry-run:

```powershell
pnpm exec tsx scripts/database/apply-development.ts
```

การใช้ `--apply` เป็นmutation: rootทำหลังadditivemigrationreview/localRLS/testgatesและtargetguard ไม่ใช้เป็นขั้นตอนแก้เอกสารหรือโหลดknowledge. Scriptผูกdevelopmentprojectที่ผู้ใช้ให้ ไม่ใช่productionmigratorทั่วไป

## Login และ Dashboard

Webใช้ `pnpm dev` (localhost3000เมื่อportว่าง), หน้า `/login`, `/dashboard`, `/tickets`, `/providers`. Actual3role auth/browserมีevidenceในM2–M5reports; ProviderยังOPENAI-onlyจนPRVcorrection

บัญชีทดสอบสร้างไว้ใน ignored `.superpowers/staging/dev-staff-credentials.json` (WindowsACLจำกัดowner). เปิดไฟล์localเพื่ออ่าน credentials ไม่ pasteรหัสในREADME/log. Bootstrapdevelopmentscriptรักษาบัญชี/profile/passwordเดิม; ไม่สร้างSUPER_ADMINใหม่ทุกครั้งที่run

## LINE OA และ Cloudflare Tunnel

Webhookpathsที่คงเดิม:

```text
https://<current-https-domain>/api/line/student/webhook
https://<current-https-domain>/api/line/staff/webhook
```

พัฒนาใช้ tunnelไปwebserverportที่รันจริง เช่น:

```powershell
cloudflared tunnel --url http://localhost:3000
```

อ่านHTTPSURLที่processสร้างและใส่แต่ละpathในLINEDevelopers→MessagingAPI→WebhookURL→Verify→UseWebhook. Quick tunnelเปลี่ยนURLเมื่อrestart; URLเก่าในlearning/progressเป็นhistory ไม่ยืนยันว่าปัจจุบันreachable. ตั้งOAautomaticresponseตามflowเพื่อไม่ตอบซ้ำกับbackend

Student/Staffใช้rawbodyHMACก่อนJSONและยอมรับvalidverificationevents:[]. Echoคำว่า “สวัสดี” เคยผ่านจริง; durable/AI/ticketต้องทดสอบmanualอีกชุดตามfinalchecklist

## Web และ workers

Durable modeต้องมีseparateprocessesพร้อมDB/encryption/config:

```powershell
pnpm dev
pnpm worker
pnpm worker:outbox
pnpm worker:ai
```

แต่ละคำสั่งอยู่คนละterminalหรือmanagedservice. AIworkerแสดงdisabledเมื่อ `YRU_AI_ENABLED` ไม่ใช่true; **อย่าเปิดตอนนี้เพื่อข้ามPRV gate**. Inbox/outboxทำงานอย่างอิสระและเก็บdurableretries. Changingruntime.envหรือworker/sourceต้องrestartprocessที่เกี่ยวข้องตามlifecycle ไม่สมมติว่าNextreloadทุกworker

## Tests และ evidence

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm build` ตาม README. DBtestsใช้dedicatedcontainer `supabase_db_line-ai-yru`และrollback/ownedfixtures. ActualsignedHTTP/localproductionharnessในscripts/qaใช้isolatedtarget/fixturesตามรายงาน ห้ามชี้testfixturesไปDBจริงโดยไม่มีguard

ตอนนี้focusedpricingtestRED; ดูtaskboardก่อนสรุปallpass. Documentation-onlycheckpointตรวจlocal links/sourcehash/chaptercoverage ไม่แอบนับเป็นappregressionpass

## เริ่ม knowledge ชุดแรก

อ่าน [corpus README](../../documents/yru/README.md)/completeness/sourceURLsก่อน. คำสั่งที่มีจริงตอนนี้สร้างpendingreviewmetadataเท่านั้น:

```powershell
pnpm exec tsx scripts/knowledge/stage-shortlist.ts
```

ผลอยู่ignored `.superpowers/staging/m6-shortlist.json`; ไม่publish/สร้างembedding. Upload/URL/analyze/approveUIยังต้องทำM7. เมื่อพร้อมเลือกfreeembeddingdimensionsแล้ว adminตรวจsourceauthority/effectivedates/audience/academicYear/sensitivity/OCRและexplicitapproveทีละversionตามfinalchecklist

## Production notes

เลือกhostingที่รันworkerและHTTP lifecycleตามdesign; stableHTTPSdomainทั้งOA, verifiedTLS, productionAuthroles,backup/encryptionkey/storageaccess, queue/errorobservability และrollbackrunbookต้องผ่านก่อนส่งมอบ. ไม่พาtestaccounts/pendingcorpus/mockadapterไปถือเป็นproductionevidence
