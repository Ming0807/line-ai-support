# YRU Knowledge Import and Versioning Implementation Plan

> **Full V1 scope reminder:** PDF/HTML acquisition below is the first slice only. [IMP-02 in current board](../../tasks/V1_TASK_BOARD.md) adds DOCX/XLSX/CSV; master §0(17) requires all five PDF/DOCX/XLSX/CSV/URL inputs. IMP-03 must explicitly test base + every ACTIVE/effective amendment, exclude inactive amendments and preserve the base; additional document is not replacement. Do not accept M7 solely from a PDF/HTML demo. See [requirements](../../requirements/V1_REQUIREMENTS_MATRIX.md) and [system design](../../architecture/YRU_V1_DESIGN.md).

> **For agentic workers:** Use superpowers:executing-plans task by task with review checkpoints. The user authorized continuous execution and deferred live configuration. The previously assigned reviewers reached their usage limit, so root implements and records self-review honestly rather than claiming an independent verdict.

**Goal:** Deliver authenticated Upload/URL → extraction/analyze → editable preview → explicit approval → atomic publication and version history, preserving the M6 delivery fence and unpublished real corpus.

**Execution prerequisite satisfied 5 October:** The original free Zen/OpenRouter scope and provider UI/network contracts passed automated gates in [provider acceptance](../../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md). Root resumes Import contract work; live free quality/account/corpus/OA evidence remains deferred by the user, never claimed as PASS. Paid services are later university opt-in only. The existing five-format/versioning scope remains intact.

**Architecture:** Import originals and staged analysis stay encrypted in private import jobs. Network fetch, binary parsing and optional provider/embedding work occur outside business transactions. Approval snapshots a reviewed revision, prepares embeddings without locks, then reauthorizes the actor, verifies the immutable revision and locks family/document scopes before atomically publishing.

**Tech Stack:** Installed Next16.3.8/React19.3/TypeScript/Zod4/Postgres17/pgvector; bounded Node PDF parser child process; HTML parser; existing provider gateway and queue contracts.

## Global Constraints

- Preserve Student/Staff raw-body signatures, durable queues, anonymous sessions, HUMAN ticket state and auth/RLS boundaries.
- No auto publish by AI. PENDING_REVIEW corpus remains unpublished until explicit review.
- Unknown structured datasets use RAG and never generate DDL. M8 installs seven fixed schemas.
- Maximum original20MiB, extracted5M characters/1000pages, staged chunks≤2000. Reject malformed input with fixed errors; never print original content or credentials.
- Only active SUPER_ADMIN can inspect staged originals, edit/approve or publish V1 knowledge. Browser roles receive no direct table privileges.
- URL import allows HTTPS YRU domains only, no auth/nondefault ports, each redirect revalidated, public IPv4 DNS pinned to HTTPS transport; bounded response/time.
- Approval uses sorted `knowledge-family:<uuid>` then sorted `knowledge-document:<uuid>` transaction advisory locks, then row locks. No provider HTTP in a transaction.
- File checksum is immutable provenance. Corrections to extracted text require explicit review and change the staging revision; they never change the original checksum.
- Dates, authority, official provenance and applicability are human-reviewed, not inferred from fetch time. PUBLIC publication refuses unresolved sensitivity/extraction warnings.
- Small V1 retrieval retains exact prefiltered distance with filter indexes. ANN needs an explicit vector cohort and measured recall, outside this initial import path.

### Task1: extraction and safe acquisition

Files: `lib/imports/source.ts`, `lib/imports/url-importer.ts`, `lib/imports/pdf-parser.ts`, `lib/imports/html-parser.ts`, `scripts/imports/parse-pdf.mjs`, `tests/import-source.test.ts`, `tests/import-parsers.test.ts`.

Interfaces:
```ts
type ImportSource={bytes:Uint8Array;mimeType:'application/pdf'|'text/html';filename:string;sourceUrl:string;fetchedAt:string|null};
type Extraction={title:string|null;pages:ExtractedPage[];containsTables:boolean;flags:string[]};
async function importOfficialUrl(url:string,options?:UrlImportOptions):Promise<ImportSource>;
async function extractSource(source:ImportSource):Promise<Extraction>;
```

- [ ] RED tests reject unofficial/credential/port URLs, private DNS, private redirect, response overflow; fake pinned transport checks the original hostname. PDF test fixture with text/pages is extracted, a scan has review flags, malformed PDF fails fixed. HTML entities/headings/table rows preserved; scripts/styles excluded.
```ts
await expect(importOfficialUrl('https://127.0.0.1/a')).rejects.toThrow('IMPORT_SOURCE_INVALID');
expect(parseHtml('<h1>เรื่อง</h1><script>secret</script><table><tr><td>วันที่</td></tr></table>').pages[0].text).not.toContain('secret');
```
- [ ] Run `pnpm exec vitest run tests/import-source.test.ts tests/import-parsers.test.ts --maxWorkers=1`; record RED.
- [ ] Implement bounded acquisition and a memory/time/output-limited PDF child with fixed filenames/arguments and stdin bytes. Do not interpolate uploaded filenames into a shell.
- [ ] Re-run focused cases; use actual shortlisted PDF/text-quality samples without approving them. Record any OCR/font warnings rather than hiding them.

### Task2: analyzer and publication contract

Files: `lib/imports/analyzer.ts`, `lib/imports/classifier.ts`, `lib/imports/schemas.ts`, `lib/imports/version-resolver.ts`, `tests/import-analysis.test.ts`.

Interfaces: `analyzeExtraction(source,extraction):ImportAnalysis` returns conservative title/type/family/department/year/table/sensitivity suggestions and null dates/authority unless reviewed. `approvalSchema` owns title/family/category/department/version/stream/year/scope/dates/authority/source/visibility/storage/action/target revision and explicit extraction/sensitivity attestations. Actions are exactly NEW_FAMILY, ADD_ADDITIONAL, REPLACE_CURRENT, ADD_HISTORICAL, AMEND_EXISTING.

- [ ] RED: table+narrative→BOTH suggestion; unknown schema→RAG; sensitive names/studentID/phone/email/grade/medical/personal finance→review; fetch time never becomes effective date. Invalid dates/replacements/applicability/action combinations reject.
```ts
expect(analyzeExtraction(source,extraction).effectiveFrom).toBeNull();
expect(approvalSchema.safeParse({...reviewed,effectiveFrom:'2026-02-30'}).success).toBe(false);
```
- [ ] Run `pnpm exec vitest run tests/import-analysis.test.ts --maxWorkers=1`, implement pure deterministic conservative suggestions and strict DTOs, rerun GREEN. Optional future AI analyzer must use the same schemas and cannot approve.

### Task3: encrypted private staging

Files: CLI-generated `supabase/migrations/<timestamp>_knowledge_imports.sql`, `lib/imports/import-service.ts`, `lib/imports/authorization.ts`, `tests/database/import-staging.integration.ts`.

Interfaces:
```ts
async function stageImport(staffId:string,source:ImportSource,options?:ImportOptions):Promise<{id:string;revision:number;duplicate:boolean}>;
async function analyzeImport(staffId:string,id:string,input:{revision:number;pages?:ExtractedPage[]},options?:ImportOptions):Promise<ImportPreview>;
async function getImportPreview(staffId:string,id:string,options?:ImportOptions):Promise<ImportPreview>;
```

- [ ] ActualPG RED: no browser grants, inactive/ordinary staff denied, duplicate immutable checksum returns existing job, extraction parser outside SQL transaction, stale edit conflicts, failed extraction leaves staged original recoverable and unpublished.
```ts
const a=await stageImport(admin,source,options);const b=await stageImport(admin,source,options);
assert.equal(a.id,b.id);assert.equal(b.duplicate,true);
assert.equal((await pool.query('select count(*) from public.documents')).rows[0].count,baseline);
```
- [ ] CLI-generate additive table with encrypted original/staged JSON, unique checksum, status/revision, actor/document FKs and browser-denied RLS. Apply locally only after tests establish RED.
- [ ] Implement short5s staging transactions; reauthorize before persisting extraction with revision compare. Re-run actualPG cases and add to `scripts/database/test-local.ps1`.

### Task4: atomic reviewed publication and version resolution

Files: `lib/imports/publish-service.ts`, `lib/imports/version-resolver.ts`, `tests/database/import-publish.integration.ts`, amendment cases in `tests/database/knowledge-retrieval.integration.ts`.

Interface: `approveImport(staffId,id,approval,options):Promise<{documentId:string;revision:number}>`, with injected `embed` callback compatible with existing `EmbedInput→EmbedResult` for tests and configured Dashboard embeddings in runtime.

- [ ] ActualPG RED:2568current→stage2569 remains2568→approve replaces only the same reviewed stream, preserves2568SUPERSEDED and returns2569current only. Historical/additional/amendment actions do not supersede base. Scope mismatch, stale preview/target, unresolved sensitivity and forced insert failure produce no document/chunk/audit partial effects.
```ts
assert.equal(old.status,'SUPERSEDED');assert.equal(old.is_current,false);
assert.equal(current.supersedes_document_id,old.id);
assert.deepEqual((await searchKnowledge(client,query)).map(x=>x.documentId),[current.id]);
```
- [ ] Prepare all vectors outside SQL and require one matching fingerprint/dimension cohort; persist only after successful final compare. Concurrent approval returns one result, no duplicate chunks; receipt job status/document reference makes retries idempotent.
- [ ] Lock family then referenced docs, verify action/stream/target, change old current before inserting new, add SUPERSEDES/AMENDS/RELATED relationships, chunks and activity, mark jobCOMPLETED in one transaction. Add review-only draft save separate from approval.
- [ ] Actual barrier proves family publication waits for paused LINE delivery and embedding HTTP has no open business TX. Rerun worker/history/ticket regressions.

### Task5: authenticated API and Dashboard

Files: `lib/imports/api.ts`, `app/api/knowledge/import/route.ts`, `app/api/knowledge/analyze/route.ts`, `app/api/knowledge/approve/route.ts`, `app/api/knowledge/imports/[id]/route.ts`, `app/(dashboard)/knowledge/page.tsx`, `app/(dashboard)/knowledge/import/page.tsx`, `app/(dashboard)/knowledge/import/import-form.tsx`, `app/knowledge.css`, dashboard link.

- [ ] Read installed Next route/dynamic/page docs before writing; follow `provider-api.ts` same-origin/auth/body-limit patterns. File multipart body is byte-bounded before `Request.formData`; URL uses strict JSON. API returns safe fixed errors and authenticated staged preview only.
- [ ] UI provides Upload/URL, analyze, extracted page/chunk preview and warning counts, editable reviewed metadata/action/target, explicit attestations and approval. It does not precheck approval or guess source dates. Show no structured rows as supported until fixed registry exists; unknown dataset is RAG with visible explanation.
- [ ] Knowledge page lists family/version/department/status/current/effective/source/import/storage/history. Only verified active role gets a link/access; errors render bounded Thai messages.
- [ ] Actualproduction browser QA logs in all3real test accounts: admin import/preview/approve controlled fixture succeeds, Staff403/404 denied, forged origin denied, refreshed version history persists, stale approval409, mobile390px layout inspected. Scoped fixtures cleaned; no real source approved.

### Task6: acceptance and development synchronization

- [ ] Clean local migration replay after preflight proves no user-owned rows will be deleted; fullRLS/PG/unit/type/lint/build/advisors.
- [ ] Signed Student current/historical/amendment retrieval fixture verifies published output and takeover suppression. Upload PDF/HTML and URL acquisition get real bounded parser/acquisition evidence; no paid provider/realOA claim.
- [ ] Record honest self-review and any later independent review in `docs/reports/M7_KNOWLEDGE_IMPORT_REPORT.md`, preserve external gates. Guarded additive DEVELOPMENT apply and role/privacy verification follow reviewed local gates.
- [ ] Stage explicit files, run `scripts/security/check-staged.mjs`, commit and noninteractive push/ls-remote. Continue fixed structured schemas in M8 and M9/finalV1 audit; do not stop at this component.
