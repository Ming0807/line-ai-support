# IMP-01C — Private import staging review

Date: 5 October 2026
Reviewer: `/root/imp_operations_docs` (Luna high)
Verdict: **PARTIAL PASS for upload staging; resolve two P2 contract gaps before exposing the DTO or accepting URL imports**

## Scope

Read-only review of `lib/imports/staging-envelope.ts`, `lib/imports/import-staging.ts`, `supabase/migrations/20261005093910_private_knowledge_import_staging.sql`, the focused unit/actual-PostgreSQL tests, `lib/imports/source.ts`, `lib/imports/types.ts`, and `lib/imports/original-envelope.ts`. Compared with the frozen original-reference/access and staging contracts in `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md` and the current execution plan. Only this report was created; no code, shared docs, package files, or database state were changed outside the assigned test fixtures.

This review covers the private-database, `UPLOAD` staging slice. It does not accept the API, production Storage backend, URL acquisition, parser/extraction, review/publication, or full M7.

## Findings

### [P2] `ImportJobView` exposes the server-only original checksum (`lib/imports/import-staging.ts:13,37`)

`ImportJobView` includes `checksum`, and `view()` returns it from the internal staging row. The frozen contract marks the complete `OriginalRef` as server-only, and the execution assignment requires list/preview DTOs to omit the reference. The DTO correctly omits `original_id`, backend, ciphertext, and envelope, but exposing one reference field is still an unnecessary leak and makes it easy for a future route to serialize part of the private reference. A checksum is not a decryption capability, but it enables cross-record correlation and is not needed by the current list/preview UI contract. Keep checksum in the persistence/encryption layer and omit it from `ImportJobView`/serialized API responses; extend the DTO regression assertion to cover it.

### [P2] URL sources can be staged without requested/final URL provenance (`lib/imports/import-staging.ts:18,48,53`)

`createImportJob()` accepts `ImportSource` values with `acquiredFrom: 'URL'`, but metadata persistence records only `sourceUrl` and `fetchedAt`. The current contracts require requested URL, final URL, and redirect provenance to survive acquisition through staging. Since the URL importer/API are not implemented, this service can currently persist an incomplete URL-import record if called directly. Enforce the declared upload-only scope by rejecting URL sources until the provenance fields are wired end to end, or extend the staging contract and encrypted metadata before allowing URL imports. No URL acceptance is claimed here.

No P1 finding was identified. The following controls are present for the upload slice:

- Every service operation checks that the actor is an active `SUPER_ADMIN`. Creation authorizes before source verification/encryption and authorizes again for the final transaction. Original reads authorize for the snapshot, decrypt outside SQL, then reauthorize and compare revision before returning bytes and recording the read audit.
- The table is in `private`, RLS is enabled, browser grants are revoked, and explicit `service_role` grants exist. The trigger rejects changes to original identity, checksum, format/backend, byte length, key version, ciphertext, source metadata, or creation time.
- Source verification, original encryption, and source-metadata encryption happen before the final write transaction. No network, parser, provider, or LINE call occurs in the staging service.
- Original bytes use the reviewed authenticated envelope. Source metadata uses AES-GCM with a staging-specific HKDF purpose and authenticated job ID, checksum, revision, and purpose. The metadata is encrypted separately from original bytes.
- Checksum advisory locking plus the unique constraint makes concurrent duplicates resolve to the existing job. Duplicate calls do not replace the original filename/metadata/ciphertext. Failed status updates are revision-checked, use a fixed error-code allowlist, and retain immutable original bytes.
- Audit records contain actor/job and byte count or a fixed error code, not source bytes, filename, URL, upstream body, key, or ciphertext. Unexpected service errors are normalized to `INTERNAL_ERROR`; invalid keys are not returned as crypto-library diagnostics.
- DTOs omit original ID, backend, ciphertext, encrypted metadata, Storage object path, and public/signed URL. The checksum exposure above is the remaining DTO issue.

## Verification

- `pnpm exec vitest run tests/import-staging-envelope.test.ts`: **7/7 passed**.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-staging.integration.ts`: **7/7 actual PostgreSQL tests passed**, including effective RLS/grant checks, safe original read audit, inactive/ordinary/missing actor denial, concurrent deduplication, failure retention/stale revision rejection, immutable-original trigger enforcement, and wrong-key/no-partial-write behavior.
- `pnpm exec eslint lib/imports/staging-envelope.ts lib/imports/import-staging.ts tests/import-staging-envelope.test.ts tests/database/import-staging.integration.ts`: passed with no diagnostics.
- No full suite, build, typecheck, replay, advisors, Development DB sync, Storage test, or live-service test was run. The scoped checks do not accept the API or the wider import flow.

## Remaining acceptance boundary

The migration and actual-PG evidence cover private local database staging only. Private Supabase Storage, authenticated streaming with a final reauthorization immediately before response bytes, API/session binding and safe response mapping, URL requested/final redirect provenance, parser failures from real format implementations, extraction revision storage, publication locks, and three-role browser checks remain pending. Original bytes remain unpublished; this task does not approve any corpus or complete M7.

## Follow-up review — 5 October 2026

Reviewer rechecked the two P2 findings above against the new URL provenance path, staging DTO, and private read API routes. Both findings are **resolved in the current source**; the original findings remain above as dated history. No new actionable P1/P2/P3 finding was identified for the reviewed paths.

- `ImportJobView` and list/detail JSON no longer include the checksum or any other `OriginalRef` field. The read-route test fixture asserts the DTO fields, and the actual-PG integration checks serialized DTOs for `checksum`, original ID/backend, ciphertext, private storage identifiers, and envelope markers.
- URL imports now require a validated acquisition object with canonical official `requestedUrl`, `finalUrl`, and a redirect chain of 1–4 canonical official URLs. The first and last chain entries must match the requested and final URL; the final URL must match the verified `ImportSource.sourceUrl`. Query credentials/secrets, external/mixed provenance, malformed and oversized chains are rejected. The validated provenance is stored inside encrypted source metadata and protected by the immutable-original trigger. Duplicate content keeps the winning record's original provenance.
- `createOfficialUrlImportJob` checks active SUPER_ADMIN before URL acquisition, runs DNS/HTTP outside SQL transactions, and reauthorizes before persisting. Actual-PG coverage observes no idle transaction at the network seam and confirms a deactivated admin cannot persist a fetched source.
- List/detail/original read routes require an authenticated actor, rely on the staging service's active SUPER_ADMIN authorization, use private no-store headers, map errors to bounded JSON, and do not log underlying exception text. The original route returns an attachment with `application/octet-stream`, `nosniff`, sandbox CSP, and encoded filename; it does not render active HTML.

Follow-up evidence:

- `pnpm exec vitest run tests/import-staging-envelope.test.ts tests/import-source-provenance.test.ts tests/import-read-routes.test.ts`: **19/19 passed** across 3 files.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-staging.integration.ts`: **11/11 actual PostgreSQL tests passed**.
- Scoped ESLint over staging/provenance/API routes and their focused tests: passed with no diagnostics.
- No full suite, build, replay, advisors, or Development DB sync was run as part of this review.

Updated scope verdict: **PASS for local private-database upload and controlled official-URL staging contracts reviewed here.** This does not accept a production Storage backend, streaming implementation, import UI or upload API, parser/extraction, review/publication, production deployment controls, or M7/V1 as complete. No real corpus was approved.
