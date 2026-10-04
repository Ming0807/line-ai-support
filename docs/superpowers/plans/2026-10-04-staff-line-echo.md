# LINE Staff OA Webhook Test Implementation Plan

> **For agentic workers:** Use the existing controller implementation and independent Luna review workflow. Steps use checkbox syntax for tracking.

**Goal:** Verify Staff OA text replies using `Staff webhook received: {original_message}`.

**Architecture:** Add a separate Staff route and echo helper. Reuse the unchanged `verifyLineSignature(body: Uint8Array, signature: string | null, secret: string): boolean`. Leave the working Student route, helper and tests unchanged. Read raw bytes, verify the Staff signature, then parse and validate the events envelope. Reply to text events through LINE's reply endpoint; safely acknowledge valid envelopes even if a reply fails.

**Tech Stack:** Next.js 16.3.8 Node.js route handlers, Zod 4.6.5, native fetch, Vitest 5.0.3, Node.js 24.

## Constraints

- Staff configuration: `LINE_STAFF_CHANNEL_SECRET` and `LINE_STAFF_CHANNEL_ACCESS_TOKEN` only.
- Endpoint: `/api/line/staff/webhook`; no AI, RAG, database, tickets, staff notifications or other phase work.
- No secret, access-token or reply-token values in logs; log event counts, indexes, fixed error codes and API status only.
- Ignore unsupported/malformed event siblings; support verification with `events: []`.
- Preserve original whitespace and Unicode. Split long echoes at <=5000 UTF-16 units without splitting surrogate pairs; safely skip replies needing more than5 messages.
- Keep the full V1 goal paused; this is a separately authorized Staff echo test.

## Task: Staff route, echo helper and regression verification

**Files:** Create `app/api/line/staff/webhook/route.ts`, `lib/line/staff-echo.ts`, `tests/staff-webhook-route.test.ts` and `docs/learning/LINE_STAFF_ECHO_TEST.md`.

**Interfaces:** Export `POST(request: Request): Promise<Response>` from the route and `replyToStaffTextEvent(event: unknown, eventIndex: number, accessToken: string | undefined): Promise<void>` from the helper.

- [x] Add behavioral tests for signed empty verification, Staff-only credentials, raw-body verification before parsing, exact echo request, unsupported events, missing configuration, failed LINE calls, safe logging and long Unicode boundaries. Run `pnpm test tests/staff-webhook-route.test.ts`; expect RED against a 501 route scaffold before implementation.
- [x] Implement the Staff handler and helper with the reference behavior. Run the Staff tests; expect GREEN. Neither the Student route nor its helper is refactored for this task.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, then `pnpm build`. Confirm the Student regression tests still pass and `git diff HEAD -- app/api/line/student/webhook/route.ts lib/line/student-echo.ts lib/line/signature.ts tests/student-webhook-route.test.ts` is empty.
- [x] Test the public HTTPS Staff route with signed `events: []` (200), tampered/missing/cross-channel signatures (401) and GET (405). Validate the Staff access token using read-only bot-info, without printing credentials or routing identifiers.
- [x] Give the user the verified current URL, ask them to configure/Verify/enable the Staff webhook and send `สวัสดี`. Inspect live logs for Staff signature acceptance, Reply API200 and webhook200. Record whether the human receives `Staff webhook received: สวัสดี`; do not claim full E2E before that evidence.
- [x] Complete a scoped independent review, save a test report and create a local commit of only Staff-task files. Stop at this test.

## Manual configuration

Current tunnel origin: `https://outstanding-division-added-hats.trycloudflare.com`.
Webhook URL: `https://outstanding-division-added-hats.trycloudflare.com/api/line/staff/webhook`.
Expected test reply: `Staff webhook received: สวัสดี`.
