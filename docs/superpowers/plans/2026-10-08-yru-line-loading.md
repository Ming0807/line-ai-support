# ADV-04A — LINE loading indicator implementation plan

> **For agentic workers:** Follow this plan in order; each behavior starts with a failing Vitest test. Root owns worker hooks, auth, outbox, configuration and final integration.

**Goal:** Add a bounded, injectable server-side client for LINE's loading animation that reports only a safe outcome and never enables itself or emits interim student text.

**Architecture:** `lib/line/loading.ts` will validate a LINE user recipient, explicit channel access token, and the official `loadingSeconds` enum before making one fixed HTTPS POST. It will use an injected `fetch`, abort on caller cancellation or a bounded timeout, reject redirects, inspect only the HTTP status, and never read or log response bodies. It remains an unused pure transport component until root explicitly wires it into the AI worker.

**Tech Stack:** Existing TypeScript/Node 24, built-in `fetch`/`AbortController`, Vitest. No package or environment changes.

## Global constraints

- Requirements: CH021 and CH058; master guide §§58–59; original overview §§38–40; ADV-04.
- Official request: `POST https://api.line.me/v2/bot/chat/loading/start`, `Authorization: Bearer …`, `Content-Type: application/json`, JSON `{chatId, loadingSeconds}`; accepted seconds are exactly 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, or 60; success is HTTP 202. The request has no message text or reply token.
- Call only when a caller explicitly invokes the client with a configured Student channel token, an authorized/eligible user ID, and an explicit duration; no env lookup, automatic enablement, recipient lookup, worker/outbox mutation, or DB transaction occurs in this task.
- Never log or return access tokens, recipient IDs, request/response bodies, or provider error text. The client reads status only and uses fixed result codes.
- Keep HTTP outside SQL transactions. Do not alter worker, webhook, outbox, auth, configuration, schema, or shared project status documents.
- No live LINE request, full-suite/build claim, or production hook claim.

---

### Task 1: Freeze the transport result and prove input/request behavior

**Files:**
- Create: `tests/line-loading.test.ts`
- Create later: `lib/line/loading.ts`

**Interface:**
- `startLineLoading(input, options): Promise<LineLoadingResult>`
- Input: `{ recipientId: string; loadingSeconds: LineLoadingSeconds }`, where `LineLoadingSeconds` is the exact twelve-value LINE enum.
- Options: `{ accessToken?: string; fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }`.
- Results: `{status:'ACCEPTED'; httpStatus:202}` or `{status:'NOT_SENT'; errorCode: 'CHANNEL_NOT_CONFIGURED'|'INVALID_RECIPIENT'|'INVALID_DURATION'|'INVALID_TIMEOUT'|'ABORTED'|'TIMEOUT'|'NETWORK_ERROR'|'HTTP_REJECTED'|'UNEXPECTED_HTTP_STATUS'; httpStatus?:number}`.
- Timeout default is a local transport bound of 3,000 ms and may be lowered/raised only up to 10,000 ms; invalid non-positive/non-finite values return `INVALID_TIMEOUT`. This bounds the network call but does not activate it.

- [ ] Write tests for the exact URL, POST headers/body, bearer token, no redirects, explicit duration, and HTTP 202 result.
- [ ] Verify the request JSON contains only `chatId` and `loadingSeconds`; no student message, reply token, webhook event, or other text is sent.
- [ ] Verify missing/blank token, malformed recipient, and each non-enum duration do not call fetch.
- [ ] Verify non-202 responses return only bounded status/code, never consume response text, and never echo token/recipient/body/provider error text.
- [ ] Verify network rejection returns a fixed error code.
- [ ] Verify timeout aborts the fetch and caller cancellation aborts the fetch; both clear timeout/listener resources.
- [ ] Run `pnpm exec vitest run tests/line-loading.test.ts`; confirm RED because `lib/line/loading.ts` is absent.
- [ ] Add the minimal implementation in `lib/line/loading.ts`; rerun the same test and confirm GREEN.

### Task 2: Validate the integration boundary and record evidence

**Files:**
- Modify: `docs/reports/LINE_LOADING_COMPONENT_REPORT.md`
- Verify only: `lib/line/delivery.ts`, `lib/ai/run-worker.ts`, `lib/ai/jobs.ts`, `lib/conversation/student-processing.ts`, `lib/queue/run-outbox.ts`, `docs/superpowers/plans/2026-10-04-yru-ticket-core.md`

- [ ] Run `pnpm exec eslint lib/line/loading.ts tests/line-loading.test.ts` and `pnpm exec tsc --noEmit`; record exact results.
- [ ] Record the source files, commands, tests, model/reasoning provenance supplied by root, official protocol source, and that no live OA/browser/full-suite/build verification ran.
- [ ] In the report, recommend a future root-owned hook only after the AI worker's committed snapshot confirms the AI job lease, active Student session, AI conversation mode/revision, and absence of an active HUMAN ticket; invoke immediately before provider generation. That location is outside SQL, uses the Student token and an ID decrypted from the private identity record only in the worker, and must never extend an expired/unsafe reply deadline or change the existing outbox REPLY→PUSH decision. Root must decide explicit enablement, duration selection, deadline budget, secret/config source, and abort/timeout policy before wiring. The current AI snapshot does not contain the LINE recipient ID or reply deadline, and this task must not add either dependency.
- [ ] Keep worker, webhook, outbox, auth, environment, schema, requirements matrix, task board, shared index, and live LINE configuration untouched.

## Official source checked

- [LINE Developers — Display a loading animation](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/): one-to-one chat only; animation ends after the requested 5–60 seconds or a new Official Account message; not shown unless the user is viewing the chat.
- [LINE Messaging API reference — Display a loading animation](https://developers.line.biz/en/reference/messaging-api/nojs/): exact endpoint, request headers/body, accepted duration values, and HTTP 202 response.

The plan implements transport only. It does not close CH021, CH058, CH059, or ADV-04; end-to-end worker leases, reply-deadline/Push fallback, HUMAN takeover fencing, integration and live acceptance remain root-owned.
