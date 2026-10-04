# M3 durable webhook route verification

## Verdict

The durable-mode route contract passes its focused route tests for both Student and Staff. The tests invoke each real route, the real shared receiver, real HMAC signing, real event classification, encryption, and decryption. Only persistWebhookEvents is mocked to control commit, delay, and rejection. Global fetch is guarded and asserted unused in durable mode, so the tests cannot send network requests.

This report covers route behavior only. It does not claim the real PostgreSQL inbox/worker integration or root’s isolated local HTTP ingress smoke passed.

## Red-to-green evidence

Before the root added the durable-mode branch, the new focused test file ran 16 tests: 10 passed and 6 failed as expected. For both routes, persistence was never entered for a valid event, a mocked persistence rejection still produced HTTP 200, and malformed/unknown siblings were not durably passed to persistence. This demonstrated that the tests detected the missing durable route integration rather than merely testing the receiver.

After the branch was added, the focused suite passed 18/18. The same run with the existing Student and Staff echo route regressions passed 52/52. Original echo route tests were not edited. The invalid LINE_WEBHOOK_MODE test also passes: both handlers fail closed with 503 before reading the request body.

## Coverage

tests/durable-webhook-route.test.ts verifies, for both fixed channel routes:

- Empty signed verification envelopes return 200 without a persistence call.
- A signed valid message is encrypted, tagged with the route’s channel despite a spoofed body channel, and the route remains pending until the persistence promise resolves.
- Persistence rejection returns bounded 503 without exposing the thrown error.
- The other channel’s secret is rejected before persistence.
- Invalid raw signatures are rejected before parsing, persistence, or logging; signed malformed JSON returns 400.
- Malformed and unknown event siblings are retained as encrypted payloads without exposing the source ID, reply token, or message text in plaintext logs/persistence fields.
- Oversize input is rejected by the shared 1 MiB stream limit.
- Durable mode does not call fetch. Tests use only fake credentials and clear database URLs; there is no environment-file credential lookup or remote database access.

## Commands and results

- RED: pnpm exec vitest run tests/durable-webhook-route.test.ts — 6 expected failures of 16 against the original echo-only routes.
- GREEN: pnpm exec vitest run tests/durable-webhook-route.test.ts — 18/18 passed.
- Regression: pnpm exec vitest run tests/durable-webhook-route.test.ts tests/student-webhook-route.test.ts tests/staff-webhook-route.test.ts — 52/52 passed.
- Lint: pnpm exec eslint tests/durable-webhook-route.test.ts — exit 0.
- Typecheck: pnpm exec tsc --noEmit — currently exits 1 on a separate root-owned test: tests/database/staff-ingress.integration.ts:87:58 accesses text on a message union that also contains non-text variants. This test task did not edit that file; the exact diagnostic was sent to root.
- No source/routes/schema, package files, or environment files were edited. No remote database or LINE API was queried.

