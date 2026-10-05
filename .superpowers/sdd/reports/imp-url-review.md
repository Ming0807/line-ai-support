# IMP-01B-URL security review

**Date:** 2026-10-05
**Owner:** `/root/prv_compatible_review` (Luna max)
**Scope:** Read-only review of `lib/imports/url-importer.ts` and `tests/import-url-importer.test.ts`; only this report was written.
**Review provenance:** Independent focused review of the URL worker's source and tests. No claim of an external independent review or a live acquisition/TLS acceptance.

## Findings

### [P1] A compressed response stream error can become an unhandled process error

`decodedBody` pipes the native `IncomingMessage` into a zlib transform at `lib/imports/url-importer.ts:112-123`, then iterates only the transform. It does not forward the source response's `error` event. The request-level listener at line 164 only listens on `ClientRequest`; after headers it calls `destroy()` without delivering a safe failure to the response-body reader.

Node v24 documents that an `IncomingMessage` can emit an `error` after a premature close that occurs after response headers, and that `readable.pipe()` does not forward source errors to its destination. A local Node stream reproduction of the same `Readable.pipe(PassThrough)` arrangement followed by `source.destroy(error)` exited with an unhandled `error` (exit 1). Since this importer negotiates gzip, deflate, and Brotli, a connection reset during one of those bodies can escape the normalized `OfficialUrlImportError` boundary and terminate the Node process. Depending on how the peer closes the source, the decoder consumer may instead remain pending until the total timeout.

Handle the response source and decoder as one error-propagating, abortable stream operation (for example, `pipeline` or an explicit response error/close bridge installed before piping). Keep the body limit on decoded bytes. Add a regression that sends headers and then errors/closes the source for each compressed path; assert a fixed safe import error, no uncaught exception, and response/request/decoder cleanup. Node's [HTTP response event sequence](https://nodejs.org/docs/latest-v24.x/api/http.html#http_event_aborted) documents response errors after premature close, and its [stream pipe documentation](https://nodejs.org/docs/latest-v24.x/api/stream.html#readablepipedestination-options) describes the lack of source-error forwarding.

### [P2] Credential-like query keys outside the blacklist are retained in source provenance

`canonicalizeOfficialUrl` rejects many sensitive query-key names at line 97, but the key-pattern blacklist is incomplete. In a local fake-transport check, the importer accepted `sig`, `code`, `ticket`, and `jwt` query keys and returned those URLs in `requestedUrl`, `finalUrl`, `redirectChain`, and `ImportSource.sourceUrl`. A signed URL can use `sig`; `code`, `ticket`, and `jwt` can carry one-time or bearer credentials. Percent-encoded key names remain a relevant bypass case because `URLSearchParams` decodes them before matching.

This conflicts with the import design's prohibition on URL query credentials and risks carrying a credential into staged provenance or later APIs. The importer does not log these URLs itself, but its returned provenance includes them. Prefer an explicit benign-query allowlist or a stricter, reviewed policy shared with `source.ts`; reject credential-bearing queries before DNS and on every redirect. Keep failures fixed and do not echo the key or value. Add tests for the omitted keys, case variation, and encoded names, asserting no DNS/transport call and no query value in error output.

## Controls that appear correct in this source review

- Input and redirect URLs are capped at 2,048 characters; query length is capped at 1,024 and `Location` at 2,048. Raw spaces, backslashes, controls, fragments, credentials, non-HTTPS schemes, non-default ports, IP literals, non-YRU hosts, and numerous credential-like query keys are rejected before resolving the target. Relative redirects are resolved against the prior URL and revalidated; the existing test covers a root-relative redirect.
- Every hop gets a fresh call to the public-address resolver. Its returned complete A/AAAA set is checked and rejected as a whole if any answer is unsafe; the transport connects through a lookup callback that returns only the selected validated address. The request retains the official hostname and explicit SNI, with `rejectUnauthorized: true`, TLS minimum 1.2, and `agent: false`. This matches Node's documented HTTPS/TLS options for SNI, CA validation, and hostname identity ([HTTPS request options](https://nodejs.org/docs/latest-v24.x/api/https.html#httpsrequestoptions-callback), [TLS identity and verification](https://nodejs.org/docs/latest-v24.x/api/tls.html#tlscheckserveridentityhostname-cert)). This is a source-level assessment only; the tests replace the native request function and do not establish a wire-level TLS result.
- At most three redirects are followed. The one 10-second timer spans DNS, requests, redirects, and body consumption. The importer ignores `Content-Length` for admission and enforces the 20 MiB cap while consuming decoded body bytes. Incomplete reads call response cancellation and request/decoder teardown; late transport values are cancelled. All surfaced failures use fixed `OfficialUrlImportError` codes, and this module has no logger.
- Native requests set `insecureHTTPParser: false` and a 16 KiB header cap. Selected header values have separate length/control checks, malformed or unsupported content type/encoding is rejected with a fixed code, and non-200 statuses are cancelled and normalized to `IMPORT_URL_UNAVAILABLE`. The native header/error branches do not have direct malformed-header tests.
- `createImportSource` verifies byte/container or text shape after download and fixes the MIME/format pairing. This review found no direct format/filename path traversal from `Content-Disposition`; filenames are reduced to a basename, sanitized, length limited, and assigned a fixed fallback.

## Verification and coverage

- Runtime inspected: `node --version` returned `v26.1.0`; `package.json` requires Node `>=24`.
- `pnpm exec vitest run tests/import-url-importer.test.ts`: **1 file, 12 tests passed**.
- `pnpm exec eslint lib/imports/url-importer.ts tests/import-url-importer.test.ts`: **0 errors**, with three existing unused-parameter warnings in test callbacks.
- Isolated TypeScript check for the importer, tests, and their imports passed: `pnpm exec tsc --noEmit --skipLibCheck --strict --esModuleInterop --module esnext --moduleResolution bundler --target ES2017 --lib "dom,dom.iterable,esnext" lib/imports/url-importer.ts tests/import-url-importer.test.ts`.
- Existing tests cover URL rejection before DNS, mixed public/private DNS rejection, redirect pin/revalidation and redirect cap, content-type/signature mismatch, raw and decoded body-size limits, a total DNS timeout/caller abort, and request-option assertions for hostname/SNI/pinned lookup/gzip decoding.
- No test in this slice exercises a native response error after headers, body-stall timeout, abort during streamed body/decompression, malformed native headers, relative `..`/query-only/protocol-relative redirects, or live TLS certificate/hostname validation. Current tests mock DNS and the transport/request seam. These are acceptance gaps, not claims that the untested behavior passes. No remote host, provider, database, full suite, or build was used.

## Source and primary references

- Current import policy: `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md` (official YRU HTTPS only; fresh public A/AAAA resolution; every redirect revalidated; decoded body stream capped at 20 MiB; one 10-second acquisition deadline).
- Original source: `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, §44; requirement CH044 in `docs/requirements/V1_REQUIREMENTS_MATRIX.md`.
- [Node.js v24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), [Node.js v24 streams](https://nodejs.org/docs/latest-v24.x/api/stream.html), [Node.js v24 HTTPS](https://nodejs.org/docs/latest-v24.x/api/https.html), and [Node.js v24 TLS](https://nodejs.org/docs/latest-v24.x/api/tls.html) are the primary runtime references used for the event, piping, SNI, and certificate-verification observations above.

## Follow-up review — 5 October 2026

Read-only re-review of `lib/imports/url-importer.ts`, `tests/import-url-importer.test.ts`, `lib/imports/source-provenance.ts`, and the staging provenance path. The earlier findings remain above as historical evidence. The fixes resolve the specific stream-error and short-alias cases described there:

- **P1 stream error resolved for the reviewed compressed path.** `decodedBody` now connects the response and decompressor with `pipeline`, whose callback consumes completion errors, while the async reader maps stream failures to fixed import error codes. The added regression emits an upstream error before valid gzip bytes; acquisition rejects with `IMPORT_URL_UNAVAILABLE`, destroys the request, and exposes no upstream error text. This closes the unhandled source-error path reproduced in the first review.
- **P2 short aliases resolved for acquisition and retained chain validation.** URL validation now rejects `sig`, `code`, `ticket`, `jwt`, and tested compound/case variants before DNS or transport. `source-provenance.ts` applies the same aliases to every canonical requested/final/redirect URL, so a caller cannot bypass the acquisition check by constructing staging provenance directly. Staging stores the validated acquisition metadata encrypted and the existing immutable-original database guard protects it; this follow-up did not rerun the PostgreSQL suite.

### [P2] Unknown query parameter names can still retain credential values

The importer and acquisition-provenance validator reject query keys that match their sensitive-name denylist, but accept other keys and preserve their values in `requestedUrl`, `finalUrl`, `redirectChain`, and `ImportSource.sourceUrl`. For example, an official URL with `?download=fixture` passes these predicates. If an upstream system places a credential in a benignly named parameter, that URL is retained in encrypted source metadata and later returned as acquisition provenance. The current checks therefore cover known credential-key conventions, but cannot establish the design invariant that query credentials are absent regardless of parameter name. Use an explicit reviewed allowlist, reject query strings for this importer, or separate the fetch URL from sanitized persisted provenance; add a benign-key regression at both acquisition and provenance validation boundaries. This finding depends on the requirement that query credentials are forbidden independent of key name.

## Follow-up verification and limits

- `pnpm exec vitest run tests/import-url-importer.test.ts tests/import-source-provenance.test.ts tests/import-source.test.ts`: **3 files, 33 tests passed**.
- `pnpm exec eslint lib/imports/url-importer.ts lib/imports/source-provenance.ts lib/imports/source.ts tests/import-url-importer.test.ts tests/import-source-provenance.test.ts tests/import-source.test.ts`: **passed with no diagnostics**.
- Targeted strict TypeScript check over those source and test files: **passed**.
- These tests use mocked DNS and transport/native-request seams. No real HTTP request, certificate handshake, live TLS validation, or remote acquisition was run. This follow-up did not run the full test suite, build, database integration, or deployment checks.

## Public query policy review — 5 October 2026

Read-only review of `lib/imports/url-query-policy.ts` and its integration through `source.ts`, `url-importer.ts`, and `source-provenance.ts`. The P2 about credentials under unrecognized query-key names is **resolved for these acquisition and persistence boundaries**. `hasPublicImportQuery` is the shared admission rule: the importer reaches it through `isOfficialYruUrl`, and both source creation and retained acquisition-chain validation use that same source predicate. Queries are limited to 1,024 characters, eight unique parameters, and 40 characters per value. Official YRU URLs admit only the reviewed numeric public CMS keys and fixed Joomla/public-view values; nonofficial upload provenance admits only Drive `usp=sharing`. Unknown, duplicate, opaque, oversized, or otherwise unlisted pairs fail validation. Acquisition rejects an unlisted pair before DNS/transport, and source/provenance validation prevents it from being retained through direct staging inputs.

The allowlist matches the catalog's observed public routes, including `group=17&view=standard`, `menu=manual`, `view=info_guide|guide|aor|doc_form|fee`, `page=rule&t=n4`, and Drive `usp=sharing`. The policy constrains query syntax and values; it does not certify that every resource reachable from an allowed public CMS identifier is suitable for publication. Content authority, sensitivity, and publication still require the separate review gates in the import design.

Follow-up verification:

- `pnpm exec vitest run tests/import-url-query-policy.test.ts tests/import-url-importer.test.ts tests/import-source-provenance.test.ts tests/import-source.test.ts tests/import-staging-envelope.test.ts`: **5 files, 43 tests passed**. New coverage exercises catalog query pairs, ordinary-key opaque-value rejection before DNS/transport, and the shared rule across uploaded source metadata and every retained provenance URL.
- Scoped ESLint over the query-policy, source, importer, provenance, and focused tests: **passed with no diagnostics**.
- Targeted strict TypeScript check over the query-policy, source, importer, provenance, and tests: **passed**.
- No remote HTTP request or live TLS/certificate handshake was performed. Full build, database suite, and deployment acceptance remain outside this review.

Updated scoped verdict: **PASS for reviewed public-query admission and URL provenance retention**. The previous P2 remains above as dated history; no new actionable finding was identified in the shared query-policy integration.
