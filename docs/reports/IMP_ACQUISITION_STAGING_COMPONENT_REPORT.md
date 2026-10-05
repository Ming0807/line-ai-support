# Import acquisition and staging component checkpoint — 5 October 2026

Status: **PARTIAL / COMPONENT_GREEN; M7 remains IN_PROGRESS.** This report records a source checkpoint for continuing the authorized Import implementation. It is not M7, M6, or V1 acceptance.

## Latest verified continuation — private Storage and ZIP boundary

Root integrated default private Supabase Storage with encrypted opaque UUID originals and immutable private upload receipts. Active admin preflight/reservation commits before network; technical outcomes preserve failed/uncertain/losing objects; final staging reauthorizes and checksum-deduplicates. Reads download/decrypt outside SQL, then check active admin/revision and audit before returning exact original bytes. Legacy fixtures explicitly select PRIVATE_DATABASE. No upsert, signed URL or runtime object delete is provided.

Current gates: **1,065/1,065 unit tests across63files**, `pnpm test --maxWorkers=1`; **110/110 integration tests** from `pnpm test:db` (85 existing,7provider,11DBstaging,6Storage-staging,1actualStorageHTTP) plus foundation RLS; whole-workspace typecheck/lint PASS with no diagnostics; isolated **21-migration** replay/foundation RLS PASS and local advisors0issues. Final optimized build after these additions passed (exit0), compiling all4 Import API routes and bothLINE routes. Earlier timed-out concurrent-build test and the preceding1,033/20-migration checkpoint remain dated evidence below.

The comprehensive loopback Auth/Storage HTTP test creates a real local Auth session, verifies private bucket/zero object policies, encrypted service upload/download and byte-exact authorized backend recovery. Anonymous/authenticated direct download/list/upload and the public object route are denied; duplicate no-upsert upload preserves ciphertext; revoking admin causes no Storage request. Only generated loopback fixture objects/Auth profiles are explicitly cleaned. Local startup preserved21 migrations and created an ignored617229-byte database backup before restarting only this project's stack; no reset, volume deletion or other-project stop. DEV still19migrations; DEV/production Storage gates remain pending.

Shared public-query allowlist independent follow-up now passes (root48focused/reviewer43focused); the prior ordinary-query P2 is resolved in acquisition and retained provenance. Luna max ZIP utility builder23tests and root security-contract self-review pass. Independent ZIP reviewer and latest docs continuation errored at usage limit, with no verdict claimed. [Root ZIP review](../../.superpowers/sdd/reports/imp-safe-archive-root-review.md), [Storage scoped independent review](../../.superpowers/sdd/reports/imp-storage-review.md), [URL follow-ups](../../.superpowers/sdd/reports/imp-url-review.md).

Current remaining M7 gates: PDF/DOCX/XLSX semantics and bounded parser child, extraction→staging/edit/review→chunks/dataset/citations, warnings/dispositions/redaction, atomic version/AMENDS/CANCELS/publication fencing,19families, minimal import/history UI and actual browser acceptance. OS parser supervision/production Storage, live free Thai quality/corpus/OA/deployment remain distinct gates. No real corpus approval or paid inference occurred.

## Earlier acquisition/API source checkpoint

## Scope and current result

The current local source contains component implementations and evidence for source validation/analyzer/CSV/location validation; inert HTML extraction; an authenticated original AES-256-GCM envelope; encrypted source metadata and private PostgreSQL staging; bounded official URL acquisition and requested/final/redirect provenance; and authenticated import write/list/detail/original-read routes. Upload and URL requests stage source records only. They do not run a parser, analyze or approve knowledge, publish documents, or create active chunks.

The exact component evidence includes:

- Source/analyzer/CSV/located extraction: **41 focused tests**; typecheck and scoped lint passed at that component checkpoint. See [source and CSV report](IMP_SOURCE_ANALYSIS_COMPONENT_REPORT.md).
- HTML parser: **10 focused tests**, scoped lint and isolated TypeScript check passed. The parser report records a component result and production parser process/resource supervision remains pending. See [HTML component report](../../.superpowers/sdd/reports/imp-html-parser.md).
- Original envelope plus existing identity checks: **20 focused tests** and scoped lint passed. The scoped review found no actionable P1/P2/P3 defect in encryption; it did not accept persistence or authorization by itself. See [envelope review](../../.superpowers/sdd/reports/imp-original-envelope-review.md).
- Staging envelope: **7 focused tests**. Private local PostgreSQL staging: **11 actual PostgreSQL integration tests**, including effective browser denial/server grants/RLS, active-admin authorization, safe original-read audit, concurrent checksum deduplication, failure retention, stale-revision rejection, immutable-original enforcement, and wrong-key failure. See [staging review and follow-up](../../.superpowers/sdd/reports/imp-staging-review.md).
- Read/write API routes: **21 focused route tests** (12 write, 9 read) and scoped lint passed. See [write API review](../../.superpowers/sdd/reports/imp-write-api-review.md).
- Root subsequently added `lib/imports/url-query-policy.ts`, a shared restricted query allowlist that preserves known official catalog routes and rejects unknown, duplicate, opaque, or credential-like values before DNS and before provenance persistence. Root reports **48 focused source/query/acquisition/provenance/write tests passing** after this change. These tests use controlled DNS/transport fixtures, not live TLS or live YRU acquisition. The independent URL reviewer follow-up is still pending, as is a whole-workspace test rerun on the allowlist change; do not treat the query policy as fully reviewed yet. See [URL security review](../../.superpowers/sdd/reports/imp-url-review.md).

## Combined verification at this source checkpoint

- Before the newest public-query allowlist change, `pnpm test --maxWorkers=1`: **1,033/1,033 passed across 60 files** on the separated rerun. This full result is not attributed to the newest source until rerun.
- The earlier full-suite attempt ran concurrently with a build and timed out one existing auth-bootstrap credential ACL test after **1,032 passed**. The test passed **6/6** when run in isolation; the single-worker full-suite rerun then passed without increasing timeouts or weakening code/tests. Preserve the earlier timeout as historical evidence; it is not the final result for this rerun.
- Root reported actual PostgreSQL **103/103**: 85 existing + 7 provider + 11 import-staging tests; foundation RLS also passed.
- Isolated local replay and RLS passed at **20 migrations**. Local database advisors reported **zero warning/error issues**.
- On that 1,033-test checkpoint, root reported whole-workspace typecheck and lint exited 0 with zero errors and zero warnings, and optimized Next.js 16.3.8 build passed compiling the four Import API routes plus both LINE webhook routes. Whole-workspace type/lint/build verification after the latest allowlist change is pending.
- DEVELOPMENT remains at **19 migrations**. This checkpoint did not apply the Import migration to DEVELOPMENT and did not perform a new push. The preceding provider acceptance push is recorded separately in the historical provider report/ledger.

The latest query-policy change has a 48-test focused result, but the combined verification listed above applies to the immediately preceding source checkpoint. Earlier PRV results are a separate checkpoint in the [provider acceptance report](PRV_COMPATIBLE_ACCEPTANCE_REPORT.md).

## Review provenance

- The source/import contract review findings were incorporated in the current design; see [contract review](../../.superpowers/sdd/reports/imp-contract-review.md).
- The encryption envelope received a scoped read-only PASS. The first staging review found two P2 gaps (checksum in the DTO and missing URL acquisition chain); root corrected both, and the follow-up verified the current DTO and encrypted requested/final/redirect provenance. The follow-up verdict covers local database staging and controlled URL staging only.
- The write API received a scoped read-only PASS for same-origin/authentication ordering, bounded bodies, error handling and attachment behavior.
- The HTML component report records its implementation tests and root corrections; it does not claim a fresh independent visual or production resource-isolation review.
- The URL review closed the specific stream-error and known-alias findings. Root has now implemented and focused-tested a restricted public-query policy addressing the broader benign-query-key concern; independent reviewer follow-up and whole-workspace rerun remain pending, so report the fix as implemented/focused-tested, not fully accepted.

## Remaining gates

M7 remains open. The following work has no acceptance evidence from this checkpoint:

- Production private Supabase Storage, its object policy and equivalent encrypted envelope, upload/no-upsert behavior, and streaming access controls.
- PDF, DOCX and XLSX parser acceptance; safe archive-entry/expansion handling; process-level resource supervision for RSS/CPU/network/filesystem; and actual format quality fixtures. HTML/CSV component checks do not imply other formats pass.
- Resolve and review the query-credential provenance policy before treating URL import as security accepted. Current mocked URL tests do not prove live TLS, certificate validation, or acquisition from a YRU service.
- Persisted extraction and format locations through preview, edit, chunks/datasets and citations; review warnings/dispositions; import UI and three-role browser workflow.
- Explicit review and atomic version publication, replacement/additional/historical/AMENDS/CANCELS cases, delivery fencing, structured M8 datasets, and final signed LINE Flow A–F evidence.
- Live free provider/model/dimension and Thai quality, approved university corpus, real OA, and production hosting/deployment evidence remain `MANUAL_PENDING` in the [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). No real corpus was approved, and no paid inference was called by this checkpoint.

No `node_modules/next/dist/docs` guide was needed for this report-only checkpoint. The route implementation reads were already completed by the scoped write-route review; this report does not change Next.js code.
