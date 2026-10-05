# IMP-01C — Import write API review

Date: 5 October 2026
Reviewer: `/root/imp_operations_docs` (Luna high)
Verdict: **PASS for bounded authenticated write-route behavior; no actionable P1/P2/P3 findings**

## Scope

Read-only review of `app/api/knowledge/import/route.ts`, `lib/imports/import-api.ts`, the staging entry points they call, `tests/import-write-route.test.ts`, `tests/import-read-routes.test.ts`, and the applicable frozen Import design requirements. This report is the only file changed for this review. No code, plan, package, database, or environment files were changed or read for secrets.

The verdict covers the authenticated POST route and existing private read routes. It does not claim import UI/browser workflow, production Storage, parser/extraction, review, publication, or complete M7 acceptance.

## Review findings

No actionable P1, P2, or P3 defect was identified in the reviewed API slice.

The POST handler checks same-origin using the request Origin, Host, and protocol before resolving the staff identity. It then calls `authorizeImportAdmin` before inspecting or consuming the body, so inactive or ordinary staff cannot trigger multipart parsing, source validation, URL DNS, or network acquisition. JSON has an 8 KiB limit and a strict `{url}` schema. Multipart input has a streamed 20 MiB + 64 KiB total cap, a 10-second receive deadline, early Content-Length rejection, and reader cancellation on timeout, abort, or overflow. After parsing, the route permits only one `file` and at most one optional `sourceUrl`; unknown fields, multiple files, missing files, unsupported extensions/media, empty files, and files over 20 MiB are rejected before staging. The actual bytes pass through `createImportSource` validation.

URL requests pass the request abort signal into official URL acquisition and then the staging path, where actor authorization is checked before DNS/network and again before persistence. Network acquisition remains outside SQL transactions. Upload and URL requests only create pending source jobs: the route does not parse, analyze, approve, publish, or create active knowledge records. Duplicate requests return HTTP 200; new staged jobs return HTTP 201.

Body/URL/staging errors map to fixed codes and statuses with private `no-store` headers. Unexpected errors log only a fixed internal marker. Multipart parser exceptions are normalized without returning parser text, and source bytes, filenames, URLs, credentials, and raw upstream bodies are not logged by this route. Existing list/detail/read routes require authentication and active SUPER_ADMIN authorization at the service boundary. Original reads return `application/octet-stream` as an attachment with `nosniff`, sandbox CSP, private no-store caching, and encoded filename; HTML originals are not rendered inline.

The receive-time and streamed-size bounds cover body ingestion. The total body cap also bounds subsequent native `formData()` parsing input; this review did not measure peak process memory under concurrent maximum-size multipart requests. That is an operational capacity question, not an observed defect in the scoped contract.

## Verification

- `pnpm exec vitest run tests/import-write-route.test.ts tests/import-read-routes.test.ts`: **21/21 passed** across the write and read route suites (12 write-route cases and 9 read-route cases).
- `pnpm exec eslint app/api/knowledge/import/route.ts lib/imports/import-api.ts tests/import-write-route.test.ts tests/import-read-routes.test.ts`: passed with no diagnostics.
- No full suite, build, PostgreSQL suite, migration replay, advisors, or browser end-to-end workflow was run for this review.

## Remaining acceptance boundary

The database original backend is currently used by this path. Production private Supabase Storage, import UI and browser role workflow, parser sandbox/quality, extraction persistence, review/version/publication APIs, and full M7/Flow A–F acceptance remain pending. No source was approved or published by this route review.
