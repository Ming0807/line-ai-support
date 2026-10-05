# YRU V1 — Current task board

อัปเดต 6 ตุลาคม 2026 นี่คือ **สถานะปัจจุบัน** ที่ทุก agent ใช้ร่วมกัน. [Master](../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), [matrix](../requirements/V1_REQUIREMENTS_MATRIX.md), [design](../architecture/YRU_V1_DESIGN.md), [decisions](../decisions/DECISION_LOG.md). รายงาน/roadmap/progress เก่าเป็น dated history ไม่ทับตารางนี้

## Milestone และลำดับ

| Milestone | Master phase | สถานะปัจจุบัน | หลักฐานและส่วนที่ยังไม่ผ่าน |
|---|---|---|---|
| M1 Foundation | 1 | COMPONENT_COMPLETE | local foundation/migration/RLS ผ่านใน checkpoint; ไม่ใช่ production acceptance |
| M2 Development Auth | 1 | AUTOMATED_COMPLETE | [Auth report](../reports/M2_DEVELOPMENT_AUTH_REPORT.md), login/logout จริง 3 roles |
| M3 Durable LINE | 1 | AUTOMATED_COMPLETE | [LINE report](../reports/M3_DURABLE_LINE_REPORT.md), signed HTTP/PG/dedup; live durable final flow pending |
| M4 Ticket Core | 2 | AUTOMATED_COMPLETE | [Ticket report](../reports/M4_TICKET_CORE_REPORT.md), lifecycle/takeover/outbox/browser/PG; full real OA ticket flow pending |
| M5 AI Gateway | 3 | AUTOMATED_ACCEPTANCE / MANUAL_PENDING | [Provider acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md): free gateway/order/status/quota/probes/cooldown/compatible UI automated gates GREEN; live free account/Thai quality pending |
| M6 RAG | 4 | PARTIAL / REOPENED | [RAG component evidence](../reports/M6_RAG_REPORT.md) + [local E5 foundation](../reports/LOCAL_E5_EMBEDDING_REPORT.md): controlled RAG/worker/citation/current/history and CPU384 backend/DB/UI ผ่าน; approved-corpus indexing/live free generation/full flow ยังขาด |
| M7 Import / Versioning | 5 | PARTIAL / IN_PROGRESS | [Extraction/preview checkpoint](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md): encrypted located revisions/text+cell edits/private UI passed1219unit/123PG,23replay/RLS/advisors0/type/lint/build and14actualbrowser groups. Local+DEV23 migrations/DEV34RLS tables/private Storage role denial verified. Review metadata/version/AMENDS/CANCELS/approval/publication/locations→citations and real corpus remain |
| M8 Structured Data | 6 | PLANNED | 7 fixed datasets; ต้องแตก execution plan และเชื่อม approve/version/search |
| M9 Advanced / Staff / Analytics | 7 | PLANNED / PARTIAL | scoped notification component มีใน M4; binding/incidents/loading/web/complete dashboard ยังไม่ครบ |
| FINAL V1 | §69 | PENDING | Flow A–F และ deployment/manual report ยังไม่ผ่านครบ |

User ยืนยัน LINE → Ticket → AI/RAG; M1–M9 เป็นการแยก phase เพื่อจับ gate ละเอียดขึ้น ไม่ใช่ลำดับใหม่ที่ข้าม guide. ไม่รายงาน “ทำ 6/9 = 67%” เพราะ M5/M6 reopened และ task มีน้ำหนักต่างกัน

## Current prerequisite: docs และ provider correction

6 October: IMP-01D/IMP-04A extraction/preview/edit component acceptance PASS, [report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md). Root owns DB/auth/encryption/API/integration/actualQA; Luna high `m7_edit_draft` owns pure edit/private UI; Luna max `m7_review_contract` independently verified backend corrections; Luna max `m7_pdf_runtime` scoped PDF/runtime10tests PASS. Next active **IMP-03A review draft**, execution Task4A; root owns strict contracts/DB/CAS/API, Luna max `m7_review_contract` owns only the pure warning-reference helper/tests/report. No publication or full M7 claim; missing live evidence remains pending.

Latest human update5October: **EMB-01…05 local E5 foundation COMPONENT_PASS**, [report](../reports/LOCAL_E5_EMBEDDING_REPORT.md), [plan](../superpowers/plans/2026-10-05-yru-local-e5-embedding.md), [design](../architecture/EMBEDDING_SERVICE_DESIGN.md), USR-EMB-LOCAL. Root owns cache/service/client/DB/UI/integration. D-only offline load/no-download/Thai+English+passages384/actualHTTP/private status UI PASS; C:retained. Combined1197unit/112integration/22replay/RLS/advisors0/type/lint/build PASS. Full V1 and approved-corpus/livegeneration remain pending; `YRU_AI_ENABLED=false`. Next active implementation returns to M7 extraction preview/review/version/publication. PDF builder hit usage limit before a final independent verdict; no unavailable review is claimed.

| ID | Scope / dependencies | Actual owner | Current evidence |
|---|---|---|---|
| EMB-01 | existing cache→D:; offline CPU FastAPI; goals1–3/8 | root |19hash-matchedfiles, D-only model load with0networkattempts, real384health/query/passages,11service units PASS; C:retained |
| EMB-02 | internal provider/backend/default RAG/preparation; goals4–5/7–8 | root |Zod identity/dimension/norm,deadline/cancel/boundedHTTP/controlled errors/default composition/draft locations PASS; no registry entry required |
| EMB-03 | additive vector384 projection/retrieval; goal6 | root DB/integration/self-review |local+DEVELOPMENT22migrations, DEV33RLS tables/9departments/actualrolefixtures and generatedvector384 verified; local11knowledgechecks/replay/advisors PASS; no production apply |
| EMB-04 | generation-only normal UI/read-only health; goal4 | root + frontend/impeccable |actual6browser desktop/mobile/keyboard/backend-status/no direct8000checks and screenshots PASS; generation order/status/test controls retained |
| EMB-05 | requirements/decisions/setup/report/regression | root |source archived/hash,docs updated,1197unit/112integration/type/lint/build PASS; production/manualfullV1 pending |

| ID | Scope / requirements | Owner | สถานะ | Depends on | Acceptance / evidence |
|---|---|---|---|---|---|
| DOC-01 | index/AGENTS/product/design/tasks/matrix/source archive; CH067, CH071–072, USR-DOC | root + Luna read-only spec/UX/provider review | COMPLETE | latest user sources | [Doc report](../reports/DOCUMENTATION_CONTROL_REPORT.md): hashes/links/75chapters/Flow/tasks ผ่าน, 3planningreviews integrated; appacceptanceไม่รวม |
| PRV-01 | verified pricing + FREE_ONLY runtime generation/embedding/test; USR-FREE | root | AUTOMATED_COMPLETE / MANUAL_PENDING | DOC-01 | [Provider acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md): free gates before decrypt/inference and paid calls0; live account/quality pending |
| PRV-02 | Zen/OpenRouter protocols + explicit dimensions + compatible provider contract; CH014/029/030, USR-FREE/UI | root + Luna max adapters/review | AUTOMATED_COMPLETE / MANUAL_PENDING | DOC-01; PRV-01 interface | official protocols + compatible chat/embedding/public-DNS-pinned TLS + actual PG/UI GREEN; new protocols need code, live quality pending |
| PRV-03 | Provider/Model up/down/reorder API/persistence/preview/minimal UI; USR-ORDER/UX | root DB/API/integration + Luna high partial UI | AUTOMATED_COMPLETE | PRV-01/02 contracts | atomic PG order/pricing and actual browser order/reload/purpose/focus/compatible settings/cooldown preview GREEN |
| PRV-04 | per-model HTTP/outcome/quota/test button; USR-STATUS/QUOTA/TEST | root persistence + Luna max quota/probe/retry review | AUTOMATED_COMPLETE / MANUAL_PENDING | PRV-01/02; [provider design](../architecture/AI_PROVIDER_DESIGN.md) | true HTTP/null failure/invalid200/429/selected probe/identity-fenced retry/quota/role/concurrency GREEN; live vendor counters pending |
| PRV-05 | configured free RAG + full provider acceptance | root integration/review | AUTOMATED_COMPLETE / MANUAL_PENDING | PRV-01…04 | [Acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md):919unit/92PG/RLS/type/lint/build/19replay/advisors/8browser/signed free fixture GREEN; DEV19/31RLS/3subjects verified; push recorded in ledger; live deferred |
| RAG-01 | complete routing/output/tool/application coverage; CH023/031/032/034, original multi-context | root + planned Luna max | PARTIAL | PRV-05; M8 for exact structured | prove business intent/schema/tool mapping, explicit current/history scopes, multi-conversation HUMAN boundary และ actual free transport |

Execution plan: [free providers](../superpowers/plans/2026-10-04-yru-free-ai-providers.md). Automated provider prerequisites passed; Import continues under its current contract and execution plan. Documentation review adds no permission gate; the user authorized continued work while live configuration remains deferred.

Completed provider automated execution: [5Oct cooldown/compatible contracts](../superpowers/plans/2026-10-05-yru-provider-cooldown-compatible.md). Luna max helper/network/config scoped reviews are actual evidence; root owns integration/DB/full gates. An early Import contract-review assignment ended at usage limit; root then continued the contract and implementation. Current component reviews and their exact scopes are linked from the Import checkpoint; no unavailable review is claimed.

## งานที่เหลือใน V1

ตารางนี้ระบุ scope ก่อน implementation; M8/M9 ยังไม่ใช่ detailed execution plans และต้องแตก files/contracts/tests ก่อนเริ่มตาม working protocol

| ID | งาน | Owner / planned difficulty | สถานะ / dependency | Acceptance ที่ต้องมี |
|---|---|---|---|---|
| IMP-01 | Upload PDF/URL/HTML, private originals/storage/access, checksum, quality/sensitivity/analyze/preview | root + actual Luna reviews | PARTIAL: IMP-01D extraction/preview/edit COMPLETE as component; local+DEV originals access/recovery and actual14browser groups PASS | final metadata/version/approval/publication/locations→citations, real corpus and production supervision remain; CH036–038/043–049/061 |
| IMP-02 | DOCX/XLSX/CSV parsing + safe files + preview | root + Luna max parser/runtime/scoped reviews | PARTIAL: Office components and supervised format fixtures; synthetic PDF direct+child10PASS; included1219unit/123PG extraction checkpoint | actual all5-format persisted chunk/citation equality, Thai/font/OCR/real corpus and production resource evidence remain; [report](../reports/IMP_EXTRACTION_PREVIEW_REPORT.md) |
| IMP-03 | review receipts/family/version/replace/additional/historical/AMENDS/CANCELS, atomic publication fences | root + Luna max pure warning helper | IN_PROGRESS: Task4A/IMP-03A strict review draft; [proposal](../../.superpowers/sdd/reports/imp-publication-contract-proposal.md) is scoped input, not implementation acceptance | review CAS/metadata; base+allactive amendments; obsolete queued-answer suppression; approval rollback/idempotency/current history/source citations; CH039/040/045/050 |
| IMP-04 | knowledge list/detail/version/import UI + real shortlist review workflow | actual Luna high UI + root QA | PARTIAL: IMP-04A private source/list/analyze/page+cell edit/conflict comparison/roles/desktop/mobile14browser groups PASS | published family/current/history/version/metadata/approve screens and real corpus review remain; CH046/047/064 |
| STR-01 | migration + registry + mappers สำหรับ 7 fixed datasets | root + Luna max mapping | PLANNED หลัง IMP contracts | all7 datasets/version/applicability/authority, unknownRAG/noDDL, noyear tables; CH012/041/042 |
| STR-02 | exact query tools + BOTH atomic publication + dates/fees citations | root integration | HELD หลัง STR-01/IMP-03 | exactdate/value chooses structured; current/history guard; same approved versionสำหรับ BOTH; Flow F |
| ADV-01 | Staff OA binding/auth/actions/department+sensitive notifications | root auth + Luna high UI | PARTIAL; fullหลัง M7/M8 | boundactive staff only, no broadcast/rawidentity, realOA binding/accept/open dashboard; CH054 |
| ADV-02 | similar issues/incidents/severity backend rules + incident UI | Luna max logic + root contract | PLANNED หลัง M7/M8 | meaning similarity+scope/time/count thresholds, no sensitive leak, validatedseverity, incident→ticket actions; CH013/055–057 |
| ADV-03 | usage/logs/health/analytics/dashboard/departments/settings/activities UI | Luna high + root permissions | PARTIAL; หลัง data contracts | truthful metrics from observations, runtime/probeแยก, role/scope/filters, no secretpayloads; CH015/016, original §§30–31 |
| ADV-04 | LINE loading + Reply deadline/Push fallback operations | root | PARTIAL | CH058/059, firstreplywindow/slowprovider/outboxtests, no gratuitous interimmessage, backenddeadline survives workers |
| ADV-05 | bounded web search + optional Rich Menu decision + staff AI assistance | root plan + Luna max tools/high UI | PLANNED; original §§14/20/27 | University DB→RAG→officialYRUsite→Internet; noforeignuniversityrules/unrestrictedcrawl; authorizedstaff-onlydraft untilstaffsends; RichMenuinclusiondecisionก่อนcode |
| FINAL-01 | Flow A–F, full regression/security/migration/actual browser, README/deployment/manual handoff | root + independent reviewer when available | HELD หลัง required tasks | evidenceทุกflow, livemockแยก, workershosting/backupsetup/report, testsbuildpass on finalsources |

## ทีมและการตรวจรอบ documentation

| Agent | Model / reasoning | งานที่มอบจริง | การใช้ผล |
|---|---|---|---|
| root | controller | รวบต้นฉบับ, design/contracts, matrix/board, integrate/check | รับผิดชอบ final acceptance |
| docs_spec_review | gpt-6-luna / max | read-only original/master gaps | รีวิว requirement coverage; ไม่แก้ sharedfiles |
| docs_provider_review | gpt-6-luna / max | read-only gateway/UI/HTTP/quota design | รีวิว contract และ currentgap |
| docs_ux_review | gpt-6-luna / high | read-only minimal Provider brief | รีวิว keyboard/mobile/state/evidence; ไม่มี visualQA |

ทีมเดิมได้รับงานต่อแล้ว: docs_provider_review (Luna max) ทำ transport tests และ read-only admin review; docs_spec_review (Luna max) ทำ embedding/quota และ selected probe; docs_ux_review (Luna high) ทำ Provider UI ในไฟล์ที่กำหนด. Root ดูแล contracts/DB/API/integration. ผลตรวจ component อยู่ใน [backend report](../reports/PRV_BACKEND_COMPONENT_REPORT.md); independent review และ browser acceptance ระบุแยกตามหลักฐานจริง

## Test/evidence snapshot

Latest5October combined E5/parser checkpoint:1197/1197unit across75files,112integration(85core+7provider+2E5+11staging+6Storage+1actualAuth/StorageHTTP), foundationRLS,22isolatedreplay/advisors0/type/lint/build PASS. Local+DEVELOPMENT22migrations; DEV33RLS tables/9departments/actualrolefixtures/generatedvector384 verified. Service11units/offlineD-only/realHTTP and6browserchecks PASS. No corpus/paid/livegeneration/liveOA/production claim. Older checkpoints below are dated history.


5 ตุลาคม Import combined checkpoint before latest URL query-policy change: separated `pnpm test --maxWorkers=1` **1,033/1,033 across 60 files**; actual PostgreSQL **103/103** (85 existing + 7 provider + 11 import staging) and foundation RLS; isolated local replay **20 migrations**; local advisors **0 warning/error issues**; typecheck/lint **0 errors, 0 warnings**; optimized build PASS with four Import routes and both LINE webhook routes compiled. An earlier full-suite attempt concurrent with build timed out one existing auth-bootstrap ACL test after 1,032 passed; isolated auth-bootstrap rerun was 6/6 and the separated single-worker full run passed without timeout changes or test weakening. Root then added a restricted public-query allowlist; the latest source/query/acquisition/provenance/write focused set passed 48 tests. The independent URL-review follow-up and full-suite rerun after the policy change are pending. These checks do not accept M7 end to end. DEVELOPMENT remains at 19 migrations; no current server/tunnel, live free-model quality, corpus/OA or production acceptance is claimed. [Import checkpoint report](../reports/IMP_ACQUISITION_STAGING_COMPONENT_REPORT.md). The previous provider checkpoint remains separately documented at [PRV acceptance](../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md).

- ก่อนเพิ่ม PRV-01 RED: 426/426 unit, 81/81 actual PostgreSQL, foundation RLS, typecheck/lint/build และ controlled signed RAG/ticket/durable ingress ผ่านตาม M6 report
- Provider checkpoint: 542 unit ผ่านก่อนเพิ่ม quota/schema/preview และ review fixes; ภายหลัง focused42, schema26, quota47, preview5 และ actualPG order/pricing/admin ผ่านตาม [backend report](../reports/PRV_BACKEND_COMPONENT_REPORT.md). Source ยังเปลี่ยนต่อ ต้องรัน full checks อีกครั้งก่อนรับ PRV-05
- Local applied14 migrations (CLI-generated free-provider policy); remote DEV ยัง13ตาม checkpointเดิม. Full14-migration replay/RLS และ guarded DEV synchronization pending. ไม่อ้าง production deploy หรือ live inference
- Corpus: 187resources, 15shortlist pending, 5externalsourcewarnings; OCR/metadata/cohort reviewยังไม่เสร็จทั้งหมด

## Next action และ handoff

Latest parser continuation5October: IMP-02C XML16/package26/XLSX30/DOCX18focused PASS; root nativechild8+actual4format dispatch3 and child scoped independent review14PASS. Actual Luna max package/XLSX reviews closed behavioral regressions; DOCX builder report was received. PDF builder hit usage limit before its final report; root repaired warning-map typing and PDF tests pass in the1197unit/fulltype/lint/build checkpoint. Root owns contracts/process/DB/integration. All5-format supervised runtime/real corpus and M7 extraction/review/publication remain pending. See [parser component report](../reports/IMP_PARSER_COMPONENT_REPORT.md). No unavailable PDF review is claimed.

DOC-01 และ PRV automated prerequisitesผ่านแล้ว. Root continues IMP-03A: strict review-draft schema, encrypted independent review receipts and private API/UI. Extraction/preview/edit and DEVELOPMENT private Storage passed the 6October component gates; publication/version/AMENDS/CANCELS/citations and production Storage remain separate. M8 fixed seven-dataset schemas and M9/fullFlowA–F still required. Live free model/quality/corpus/OA MANUAL_PENDING; full V1 active/incomplete.

ทุก task ที่จบอัปเดต status, matrix และ dated report. Human-only keys/OA/corpus/deployment stepsเก็บใน [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md) ไม่ถามซ้ำระหว่างทำ independent authorized work
