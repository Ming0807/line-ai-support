# ADV-04A — LINE loading transport component report

Date: 8 October 2026. Owner: root-delegated LINE transport implementation (Luna high assignment). Scope is limited to `lib/line/loading.ts`, `tests/line-loading.test.ts`, this report, and [the execution plan](../superpowers/plans/2026-10-08-yru-line-loading.md). Root owns all worker integration, authentication, configuration, privacy policy, database/outbox behavior and final acceptance.

## Protocol verified

The official LINE Messaging API reference currently specifies `POST https://api.line.me/v2/bot/chat/loading/start`, bearer channel access token, JSON `chatId` and optional `loadingSeconds`; the accepted values are exactly 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, and 60 seconds. A successful request returns HTTP 202 with an empty JSON object. The guide says this is for one-to-one chats, the indicator may not display when the user is not viewing the chat, and it disappears after its duration or when a new Official Account message arrives. [LINE loading animation guide](https://developers.line.biz/en/docs/messaging-api/use-loading-indicator/) · [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)

The implementation requires an explicit duration and token; it does not adopt LINE's optional 20-second API default, read environment variables, or self-enable. The fixed endpoint rejects redirects. The implementation checks only the HTTP status, never reads a response body, logs nothing, and returns only a fixed outcome/error code with the observed status where applicable. It makes no retries and emits no student text or reply token. Fetch is injectable, caller abort is relayed, and a local 3-second timeout is bounded to a maximum of 10 seconds; this is a transport safeguard, not a production enablement decision.

## Focused evidence

- TDD RED: `pnpm exec vitest run tests/line-loading.test.ts` failed at import because `lib/line/loading.ts` did not exist.
- GREEN: the same command passed **19 tests** after implementation, including in-flight abort settlement when an injected fetch ignores the signal and cleanup of the timeout/listener after a response.
- Lint: `pnpm exec eslint lib/line/loading.ts tests/line-loading.test.ts` exited 0.
- Typecheck: `pnpm typecheck` exited 0 on the root checkout at this source point.
- No live LINE/OA request, browser check, full unit suite, build, database test, or worker integration was run. HTTP 202 is only a platform acceptance signal; it does not prove the end user saw an animation.

## Root-owned integration proposal

The inspected worker flow is `runAICycle` in `lib/ai/run-worker.ts`: it claims a leased AI job, takes a committed snapshot under the conversation lock, verifies the active session/conversation revision and AI mode, and suppresses processing if an active HUMAN ticket exists. If no prior AI result is saved, it then calls `produceBounded`; finalization rechecks lease, revision, eligibility and evidence before writing the outbound message. `lib/ai/jobs.ts` stores the original `receivedAt` and optional reply token encrypted in the job request. `lib/queue/outbox.ts` derives the current conservative 20-second reply deadline from that original event time; `lib/queue/run-outbox.ts` decides REPLY versus PUSH before its first send and preserves HUMAN/lease/evidence fences.

The plausible future hook is root-owned `runAICycle`, immediately before provider generation, after a fresh short-transaction preflight verifies the current AI-job lease, active Student session, AI conversation mode/revision and absence of an active HUMAN ticket. The preflight can select the encrypted Student identity and encrypted request context; decrypt only in the server worker, close the transaction, then call `startLineLoading` outside SQL. Do not add loading to webhook request handlers or hold a DB transaction across LINE/provider HTTP. Skip when an AI result is already saved and generation will not run. The current `AISnapshot` does not contain a LINE recipient ID or reply deadline, so this task deliberately adds neither.

Before wiring, root must explicitly decide the enablement/config source, chosen duration (only from the verified enum), request timeout, how remaining time to the existing reply deadline gates the call, and behavior when the signal/job lease becomes stale. Loading must never extend the reply deadline, trigger a message fallback, change existing REPLY→PUSH policy, or bypass HUMAN suppression. No hook or configuration is enabled by this report.

## Remaining acceptance

CH058 remains component evidence only. CH021/CH059/ADV-04 still require root integration and tests proving loading is attempted only for eligible Student AI work, the call runs outside SQL under valid lease/ownership, HUMAN/stale work is skipped, the original reply deadline survives retries/workers, and late responses use the existing Push path. Actual LINE behavior and the full student-to-worker-to-outbox flow remain unverified.
