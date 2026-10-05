# IMP-01C — Private Storage review

Date: 5 October 2026
Reviewer: `/root/imp_operations_docs` (Luna high)
Verdict: **PASS for the reviewed component and local loopback Storage/RLS integration; Development/production Storage acceptance remains pending**

## Scope

Read-only review of `lib/imports/original-storage.ts`, the Storage path in `lib/imports/import-staging.ts`, `supabase/migrations/20261005133939_knowledge_private_storage_originals.sql`, `tests/import-original-storage.test.ts`, and `tests/database/import-storage.integration.ts`, against the frozen original-reference, privacy, and retention requirements in `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`. Only this report was created. No source, shared docs, environment files, credentials, or live Storage objects were changed or inspected.

The review covers private Storage adapter behavior, the receipt/staging boundary, and the tested loopback Supabase Storage service. It does not accept Development/production Storage configuration or policy, UI workflow, parsing, review/publication, or M7/V1 completion.

## Review findings

No actionable P1, P2, or P3 defect was identified in the reviewed code.

The adapter accepts only the configured loopback Supabase endpoint or a canonical HTTPS Supabase project origin, rejects URL credentials, path/query/fragment, and rejects unsafe key characters. Every SDK request is constrained to the expected bucket or the single object path and method; redirects are rejected and the response URL must remain unchanged. Upstream errors are normalized to `IMPORT_STORAGE_UNAVAILABLE` without exposing provider response text. The service key stays server-side in the adapter configuration and is not returned in staging DTOs or audit metadata.

The bucket check fails closed unless `knowledge-originals` is private and has the exact configured size and MIME limits. Provisioning creates the bucket only when it receives a not-found response; it inspects an existing bucket and never changes or deletes it. Object paths contain only validated lower-case UUIDs and a fixed `.yrue` suffix. Uploads require the encrypted envelope’s exact expected size, use `application/octet-stream`, disable upsert, and expose no signed/public URL. Downloads are bounded to the declared original size plus envelope overhead and must match that exact size before decryption. The operation has a 15-second total deadline, uses abort/cancellation, and bounds both metadata and streamed response bodies.

The staging service defaults to `PRIVATE_STORAGE`. It reserves an encrypted, immutable technical receipt before object upload, performs Storage calls outside SQL transactions, and records `UPLOADED`/`UNKNOWN` outcomes without deleting an object whose outcome may be uncertain. It rechecks active `SUPER_ADMIN` before linking the source into an import job. Concurrent checksum losers retain unlinked receipts/objects; repeated duplicates do not upload again. Original reads authorize before download and reauthorize after download/decryption, checking the source revision before audit/return. Storage failures and corrupt ciphertext do not reveal upstream details or create a successful read audit. No parser, publication, or active-knowledge write is part of this path.

The migration puts receipts in the private schema, enables RLS, revokes browser-role grants, grants the server role, and constrains original metadata/status/link state. Its trigger protects receipt identity, encrypted source metadata, and creation time; linked receipts cannot be changed. Runtime code has no object-delete operation. The legacy `PRIVATE_DATABASE` backend is available only when explicitly selected in tests; it does not replace the default Storage path.

## Verification

- `pnpm exec vitest run tests/import-original-storage.test.ts`: **6/6 passed**. Coverage includes opaque path and no-upsert behavior, private-bucket mismatch rejection, unsafe configuration/reference rejection, bounded download and normalized errors, timeout cancellation, and create-only provisioning.
- `pnpm exec eslint lib/imports/original-storage.ts lib/imports/import-staging.ts tests/import-original-storage.test.ts tests/database/import-storage.integration.ts`: **passed with no diagnostics**.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/import-staging.integration.ts tests/database/import-storage.integration.ts`: first attempt during the local stack restart failed before assertions because PostgreSQL at `127.0.0.1:54422` refused connections. After root reported the stack healthy, the single retry passed **17/17** (11 staging and 6 Storage integration tests), including effective PostgreSQL RLS/grant, immutable receipt, no-idle-transaction Storage seam, reauthorization, deduplication, and failure-retention checks. Storage calls in this integration suite use an injected in-memory adapter; this does not verify the Supabase Storage HTTP service.
- Root separately ran `tests/database/original-storage-http.integration.ts` against the literal loopback Supabase services and reported **1/1 passed**. The integration created a local Auth fixture, confirmed a private bucket and zero `storage.objects` policies, exercised a real service-role encrypted upload/download and byte-exact authorized original read, and verified anon/authenticated read/list/write denial, public-route denial, duplicate upload rejection without ciphertext change, and no Storage request after admin revocation. This is root-provided evidence, not an independent rerun by this reviewer. The test used only UUID-scoped generated loopback fixtures and cleaned those fixtures; runtime adapter code has no delete operation.
- No full suite, build, replay, advisors, Development DB sync, or live provider work was run for this review.

## Remaining acceptance boundary

The loopback Storage HTTP/RLS integration now passes as reported above, so those service-level controls are accepted for the tested local stack. A passing local integration does not establish Development or production credentials, endpoint, bucket policy, or operational behavior. Uploaded, uncertain, and deduplication-loser objects/receipts are retained; no cleanup or retention workflow is implemented or accepted here.

This review accepts only the adapter and source-staging component contracts. It does not accept UI, parser/extraction, publication, real-corpus quality, production deployment, or M7/V1 completion.
