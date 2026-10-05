# YRU Knowledge Import and Versioning Implementation Plan

> **Full V1 scope reminder:** PDF/HTML acquisition below is the first slice only. [IMP-02 in current board](../../tasks/V1_TASK_BOARD.md) adds DOCX/XLSX/CSV; master §0(17) requires all five PDF/DOCX/XLSX/CSV/URL inputs. IMP-03 must explicitly test base + every ACTIVE/effective amendment, exclude inactive amendments and preserve the base; additional document is not replacement. Do not accept M7 solely from a PDF/HTML demo. See [requirements](../../requirements/V1_REQUIREMENTS_MATRIX.md) and [system design](../../architecture/YRU_V1_DESIGN.md).

> **For agentic workers:** Use superpowers:executing-plans task by task with review checkpoints. The user authorized continuous execution and deferred live configuration. The previously assigned reviewers reached their usage limit, so root implements and records self-review honestly rather than claiming an independent verdict.

**Goal:** Deliver authenticated Upload/URL → extraction/analyze → editable preview → explicit approval → atomic publication and version history, preserving the M6 delivery fence and unpublished real corpus.

**Execution prerequisite satisfied 5 October:** The original free Zen/OpenRouter scope and provider UI/network contracts passed automated gates in [provider acceptance](../../reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md). Root resumes Import contract work; live free quality/account/corpus/OA evidence remains deferred by the user, never claimed as PASS. Paid services are later university opt-in only. The existing five-format/versioning scope remains intact.

**Architecture:** Import originals and staged analysis stay encrypted in private import jobs. Network fetch, binary parsing and optional provider/embedding work occur outside business transactions. Approval snapshots a reviewed revision, prepares embeddings without locks, then reauthorizes the actor, verifies the immutable revision and locks family/document scopes before atomically publishing.

**Tech Stack:** Installed Next16.3.8/React19.3/TypeScript/Zod4/Postgres17/pgvector; bounded Node PDF parser child process; HTML parser; existing provider gateway and queue contracts.

Current root contract: [Knowledge Import design](../../architecture/KNOWLEDGE_IMPORT_DESIGN.md). IMP-01A/02A creates `lib/imports/types.ts`, `source.ts`, `analyzer.ts` and source/analysis behavioral tests before binary acquisition/parser/staging work. All five upload formats share one source/extraction boundary; URL is acquisition. Private Storage backend is still required, not assumed from encrypted DB staging. Pure classifier preserves exact table candidates and defaults missing schema to RAG. Root records self-review if Luna work is usage limited.

IMP-01B-HTML owner Luna max `/root/prv_compatible_review`: `lib/imports/html-parser.ts`, `tests/import-html-parser.test.ts`, assigned parser report only. Installed pinned parse5@8.0.1 [primary parse API](https://parse5.js.org/functions/parse5.parse.html). Return `LocatedExtraction` (`locations.pages/tables`, measured `report`) defined by root; no source/types/analyzer/shared docs/DB edits. Root implements CSV and validates located extraction centrally before staging/publication. HTML parser does no fetch or render: safe text/title/heading/table traversal; skip scripts/styles/templates/frames/SVG/MathML/resource-bearing or hidden content with review warnings, cap nodes/depth/text/cells/output, exact tables plus merged-cell warnings, nullable page and stable block/heading/table location. RED→GREEN malformed/entities/Thai/tables/hidden/resource/limits; no actual URL/server/storage claim until those components pass.

## Global Constraints

### Office semantics continuation — IMP-02C (5 October)

Requirements CH036/048/061, USR-IMPORT5; master all five inputs and original versioning exact cells/review. Depends on accepted ZIP boundary and generic XML tests. Root owns `lib/imports/office-package.ts`, `tests/import-office-package.test.ts`, shared generated Office fixtures, contracts and integration. Strict package content types, root officeDocument relationship and target resolution select the actual main part; reject missing/wrong/duplicate content types, dangling or unsafe internal targets, invalid relationship IDs/modes and macro/embedded active parts. Parse every XML/relationship part with the inert XML boundary. Preserve external relationships as review evidence without fetching. Support Transitional and Strict namespace identity; unsupported features stay blocking/review evidence, never silently trusted.

Frozen shared interface: `readOfficePackage(source:ImportSource, signal?:AbortSignal):Promise<OfficePackage>`, exposing `mainPath:string`, `main:SafeXmlElement`, `parts:ReadonlyMap<string,SafeXmlElement>`, `relationships(partPath:string):readonly OfficeRelationship[]`, `hasExternalLinks:boolean`. `OfficeRelationship` has `id:string`, `type:string`, `target:string|null`, `external:boolean`; internal targets are validated canonical package paths, external targets are null and never exposed/fetched. Fixed package/semantic error `IMPORT_PARSE_INVALID`. Root supplies real ZIP fixtures through `tests/fixtures/import-office.ts`.

- IMP-02C-DOCX: Luna max when available; owns `lib/imports/docx-parser.ts`, `tests/import-docx-parser.test.ts`, `.superpowers/sdd/reports/imp-docx-parser.md`. `parseDocxSource(source,signal?):Promise<LocatedExtraction>`. Preserve body-order blocks/headings and exact paragraph/tab/break/table strings, nullable page numbers and DOCX block/heading/table locations. Hidden/deleted revisions/fields/media/unsupported nested or merged table content cannot silently become clean approved text; record warnings, no field execution/external resources. Bound all output through existing extraction schema/validator. Actual generated ZIP semantic and malformed/feature fixtures; scoped unit/type/lint plus root integration review.
- IMP-02C-XLSX: root until a separate Luna max accepts; owns `lib/imports/xlsx-parser.ts`, `tests/import-xlsx-parser.test.ts` and scoped report. `parseXlsxSource(source,signal?):Promise<LocatedExtraction>`. Resolve workbook sheet relationships, shared strings and explicit sparse cell coordinates; preserve exact stored strings and blank cells/row and column ranges. No inferred locale formatting, serial-date conversion or formula evaluation. Formula caches/styles/hidden sheets/rows/columns, external links and unsupported merged/feature content require review. Detect invalid/missing/out-of-range or duplicate coordinates and bounded sparse expansion. Generated ZIP tests cover Thai/rich shared strings/multiple sheets/sparse ranges/exact numeric strings and failures.
- IMP-02C-REVIEW: available Luna max read-only generic XML/package/parser review in owned report. Root records actual verdict or usage failure; an unavailable reviewer adds no acceptance evidence.
- IMP-01B-CHILD: root next; fixed parser child argv/stdin with no inherited credentials, 15s total deadline, 256MiB JS heap and 32MiB stdout, kill/reap/cancel and fixed sanitized errors. Actual subprocess timeout/output/secret-environment tests required. Heap cap is not an OS RSS isolation claim. PDF dependency/fixtures and extraction staging integration remain separate required tasks.

No Office semantic component pass is M7 completion: child, PDF, staged extraction/edit/review/publication/UI and locations through citations still remain.

IMP-01B-PDF continuation (CH043/048/061): delegated Luna max when available. Own `lib/imports/pdf-parser.ts`, `tests/import-pdf-parser.test.ts`, `tests/fixtures/import-pdf.ts` and scoped report `.superpowers/sdd/reports/imp-pdf-parser.md`; root owns pinned dependency/lockfile and child integration. `parsePdfSource(source,signal?):Promise<LocatedExtraction>` reads verified bytes only, disables evaluation/embedded script/external resources and never chooses a URL/password/OCR service. Inspect actual pinned pdf-parse@2.4.5 APIs after primary maintainer docs. Preserve proved one-based page and PDF block/table locations, exact text/table strings and bounds; blank/scanned/replacement/unsupported layout yields unresolved quality warnings. Supported table extraction must have generated real PDF fixtures and candid limitations; no unsupported layout reconstructed as exact. Destroy parser on success/failure/cancel. Malformed/encrypted/limits fixed error, encrypted original remains retained upstream. Tests use generated deterministic public fixtures, no university/private content or paid OCR; child15s/heap/output and actual corpus/font review remain root/separate gates. Actual ownership and review verdict recorded, not inferred from dispatch.

Parser supervisor files for IMP-01B-CHILD: `lib/imports/parser-process.ts`, `lib/imports/parser-child-protocol.ts`, `lib/imports/parse-source.ts`, `scripts/import-parser-child.ts`, `tests/import-parser-process.test.ts`, `tests/fixtures/parser-child.mjs`. Internal test hooks select a trusted test script only; runtime selects fixed checked-in script. Header is bounded schema metadata followed by immutable raw bytes; no uploaded paths/filenames in argv. Child environment allowlist omits credentials, NODE_OPTIONS and proxy/runtime injection, disables loader cache, and includes only essential Windows OS variables when present. Observe actual process close before returning cancellation/timeout/output errors, reject invalid UTF8/JSON/output, cap stderr without forwarding it. All runtime formats use supervised parsing; parent revalidates full located output against original checksum/format. Runtime tsx loader must be a production dependency and deploy include requirements documented; JS heap is not OS RSS/network sandboxing.

IMP-02B-XML root continuation (CH048/061, master all5formats): dependencies safe archive/root contract review. Files `lib/imports/safe-xml.ts`, `tests/import-safe-xml.test.ts` and parser component report. Install pinned saxes@6.0.0 after its primary README check. Buffer-only fatal UTF-8/XML1.0 with declared UTF-8 encoding, no DTD/entities/processing instructions/external resolution; namespace-aware ordered element/text tree with exact string values, caps16MiBinput/100000elements/depth64/256attributes/5Mtext+attributecharacters. Fixed `IMPORT_XML_INVALID` errors, no logs/resources/filesystem access. Tests actual Thai/entities/CDATA/namespaces/order, malformed/duplicateattrs/DTD/PI/brokenencoding/depth/size/text bounds. Semantic DOCX/XLSX package/relationship/content-type/hidden/formula/locations checks and bounded child remain separate gates; no parser acceptance from generic XML.

IMP-01B-QUERY root follow-up (CH044/061): `lib/imports/url-query-policy.ts`, `source.ts`, acquisition/provenance guards and `tests/import-url-query-policy.test.ts`. Replace the incomplete credential-name denylist with bounded allowed public query pairs derived from the actual YRU catalog (view/menu/page/group/t), plus canonical numeric public CMS identifiers and explicit Drive `usp=sharing` for manually staged external provenance. Reject unknown/duplicate/opaque/credential query fields before acquisition and retained metadata. This is an application URL admission policy, not a claim that arbitrary path content can never contain sensitive data. RED→GREEN ordinary-name credential and known catalog/Drive compatibility tests; rerun acquisition/provenance/source/PG and scoped review. Unsupported query links can be uploaded with separately reviewed canonical provenance, not secretly sanitized into a false original URL.

### Current team assignments — 5 October continuation

- IMP-02B-ARCHIVE: delegated Luna max, CH048/061, depends only on frozen source/location limits. Own `lib/imports/safe-archive.ts`, `tests/import-safe-archive.test.ts`, `tests/fixtures/import-zip.ts` and scoped report. Root installs pinned yauzl after reading its primary documentation; use buffer-only lazy entries, strict filenames, validateEntrySizes, bounded entry count (2000), per-entry16MiB and total64MiB declared AND actual inflated output, reject encrypted/multidisk/symlink/duplicate/case-collision/path traversal/nested archive and macro executable parts. CRC integrity is required, not inferred from size. Never extract to disk or fetch. Return immutable `Map<string,Uint8Array>` of package parts; fixed `IMPORT_ARCHIVE_INVALID` errors, optional abort. Tests actual generated ZIP bytes/metadata tampering and compressed expansion; no parser/process/RSS acceptance inferred. Root reviews security contracts before Office parsers consume this utility.
- IMP-01C-STORAGE: root, CH036/045/048/061. Own `lib/imports/original-storage.ts`, storage unit and actual local Storage+PG tests, additive migration and staging integration, setup script/checklist/design/decision updates. Runtime defaults to private Supabase Storage; explicit PRIVATE_DATABASE remains controlled fixture/legacy backend. Encrypt before upload, opaque UUID object path, no upsert/delete/signed URL, verify private bucket and bounded authenticated transport outside SQL. Active-admin preflight/dedup snapshot commits before upload; final reauthorization/checksum serialization determines one job. Failed/losing uploads are retained as encrypted orphan receipts rather than deleted. Original reads snapshot→bounded download/decrypt outside SQL→reauthorization/revision/audit. Prove real anon/authenticated read/list/write denial and service upload/download, inactive during network no job, concurrency/dedup/no idle transaction, immutability and byte-exact recovery. Backend grants/privacy do not follow merely from a private flag. No remote destructive operation or original automatic deletion.

- IMP-01B-HTML: Luna max `/root/prv_compatible_review`, owns HTML parser/test and its scoped report; shared source/extraction contracts belong to root.
- IMP-01B-URL: Luna max `/root/docs_provider_review`, owns `lib/imports/url-importer.ts`, `tests/import-url-importer.test.ts` and its report. Acquisition returns requested/final URL and bounded redirect chain separately from `ImportSource`; original and final provenance must both reach staging. Acceptance: official domain/credential/port/redirect/mixed public DNS/socket pin/deadline/body overflow tests, fixed errors and no network inside SQL. Actual availability/result is recorded when received.
- DOC-OPS-IMPORT: Luna high `/root/imp_operations_docs`, owns `docs/operations/LOCAL_SETUP.md` and its report; remove stale OPENAI-only/RED claims using accepted provider evidence, keep live/manual limitations explicit.
- IMP-01C-ENVELOPE: root, CH036/045/048/061, depends on verified source and frozen original-reference contract. Files `lib/imports/original-envelope.ts`, `tests/import-original-envelope.test.ts`, component report and current board/matrix. Implement bounded binary AES-256-GCM with domain-separated HKDF, fresh nonce and authenticated job/original ID, backend, format, byte length, checksum and key version. RED→GREEN exact original byte roundtrip, nonce freshness, wrong key/context/format/length/checksum, envelope tampering/truncation and fixed safe errors; typecheck/scoped lint. This is encryption only: no claim of Storage/auth/staging acceptance before actual integration tests.
- IMP-01C-STAGING: root, same requirements plus CH049. Files `lib/imports/staging-envelope.ts`, `lib/imports/import-staging.ts`, corresponding unit tests and `tests/database/import-staging.integration.ts`, CLI-generated additive private staging migration, DB test runner. Initial slice stores immutable encrypted original plus separately encrypted source metadata bound to job/checksum/purpose/revision; active SUPER_ADMIN is checked before source work and again before commit/read return, checksum duplicates return the original job without replacing bytes, failed state retains its original. Private table RLS/explicit server grants/indexes and immutable-original constraints/trigger; no browser object path/ciphertext/ref in list/preview. Actual PG acceptance: unauthorized/inactive denial, byte-exact admin read and safe audit, concurrent dedup, non-publication, retained failure, immutable original and effective browser/server role grants. No external HTTP/parser inside SQL. Storage backend, parser/extraction/review/publication remain subsequent gates and are not inferred from this slice.
- IMP-01C-READ-API: root, CH036/047/048/061, depends on staging authorization/DTO. Files `lib/imports/import-api.ts`, GET routes `app/api/knowledge/imports/route.ts`, `[id]/route.ts`, `[id]/original/route.ts`, `tests/import-read-routes.test.ts`. Read installed Next route guide first. Acceptance: authenticated subject→backend active SUPER_ADMIN, fixed 401/403/404/409/503 mapping without upstream details, private no-store metadata and attachment-only original bytes with nosniff/CSP sandbox and correctly encoded filename. Direct route tests use controlled auth/DB dependencies; actual PG covers authorization. Actual authenticated browser/production route compilation remain separate gates. Upload/analyze/approve/UI and private Storage are not claimed by read routes.
- IMP-01C-URL-PROVENANCE: root integration after URL worker termination, CH036/044/045/048. Files `lib/imports/source-provenance.ts`, `import-staging.ts`, source-provenance unit and actual staging PG tests. Revalidate bounded canonical official requested/final/redirect chain against verified source, persist inside immutable encrypted source metadata, expose reviewed acquisition metadata while omitting original reference/checksum. `createOfficialUrlImportJob` authorizes before DNS/network, performs acquisition outside SQL, then reauthorizes through staging; tests prove unauthorized causes zero DNS, network observes no open transaction, actor deactivation prevents persistence, canonical redirect provenance and checksum duplicates preserve first record. URL imports without complete provenance remain rejected; upload metadata has null acquisition.
- IMP-01C-WRITE-API: root, CH048. Files `lib/imports/import-api.ts`, `app/api/knowledge/import/route.ts`, `tests/import-write-route.test.ts`. Same-origin write + authenticated subject + active SUPER_ADMIN preflight before body processing; multipart file and optional provenance or bounded JSON official URL input, max20MiB original plus64KiB multipart overhead, total body10s/cancel, strict field/count rules and source validation, only staging. New job201/duplicate200; safe no-store errors, no raw upstream body/filename/token logs. Test unauthorized-before-read/network, cross-origin, malformed/unsupported/multiple files/body limit/cancel, URL strict fields, expected staging status and fixed failure mapping. No analyze/approve/publication or Storage acceptance inferred; actual browser upload/download still pending.

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
// Canonical all-format source/extraction contracts live in lib/imports/types.ts.
// sourceUrl is nullable while staging an upload; public approval requires review.
import type { ImportSource, Extraction } from '@/lib/imports/types';
async function importOfficialUrl(url:string,options?:UrlImportOptions):Promise<ImportSource>;
async function extractSource(source:ImportSource,signal?:AbortSignal):Promise<Extraction>;
```

- [ ] RED tests reject unofficial/credential/port URLs, private DNS, private redirect, response overflow; fake pinned transport checks the original hostname. PDF test fixture with text/pages is extracted, a scan has review flags, malformed PDF fails fixed. HTML entities/headings/table rows preserved; scripts/styles excluded.
```ts
await expect(importOfficialUrl('https://127.0.0.1/a')).rejects.toThrow('IMPORT_SOURCE_INVALID');
expect(parseHtml('<h1>เรื่อง</h1><script>secret</script><table><tr><td>วันที่</td></tr></table>').pages[0].text).not.toContain('secret');
```
- [ ] Run `pnpm exec vitest run tests/import-source.test.ts tests/import-parsers.test.ts --maxWorkers=1`; record RED.
- [ ] Implement bounded acquisition and a memory/time/output-limited PDF child with fixed filenames/arguments and stdin bytes. Do not interpolate uploaded filenames into a shell.
- [ ] Re-run focused cases; use actual shortlisted PDF/text-quality samples without approving them. Record any OCR/font warnings rather than hiding them.

This Task1 is the PDF/HTML acquisition slice only. The complete parser dispatcher and staging must also use IMP-02 DOCX/XLSX/CSV contracts, preserve format-specific source locations/report warnings and original references from the current design. Do not mark M7 complete after this subset.

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
