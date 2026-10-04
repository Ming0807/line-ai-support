# LINE Staff OA text echo review

## Verdicts

- **Spec: Pass.** The Staff route uses only `LINE_STAFF_CHANNEL_SECRET` and `LINE_STAFF_CHANNEL_ACCESS_TOKEN`, checks the raw-body HMAC before parsing JSON, validates the `events` envelope, ignores unsupported or malformed events, and returns 200 for valid envelopes including `events: []`. Valid text events use their own reply token and produce `Staff webhook received: {original_message}`. Replies preserve whitespace and Unicode, split at the UTF-16 limit without splitting surrogate pairs, and skip safely if they exceed five messages. The route and helper do not call AI, RAG, Supabase, ticketing, or notification paths. The existing Student route, helper, signature utility, and tests are unchanged.
- **Code quality: Pass; no actionable findings.** Logging contains fixed error codes/statuses and event counts/indexes only; no payload, secret, access token, reply token, API error body, or exception is logged. The helper catches failed LINE calls so they do not change the webhook acknowledgement. The smoke script checks signed empty verification, tampered/missing signatures, cross-channel signature rejection when the Student secret is configured, and GET behavior without printing credentials.

## Evidence and limits

The reported checks are 18 Staff route tests and 59 total tests passing, plus typecheck and lint passing. Public HTTPS smoke returned signed `events: []` 200, tampered/missing and Student-channel signatures 401, and GET 405. Controller completion evidence confirms production build exit0 with both Staff and Student routes listed, and Student public HTTP regression smoke also passed. The live server recorded a real Staff Verify (eventCount0, POST200), then eventCount1, Reply API200 and webhook200 in491ms. The user confirmed sending `สวัสดี` and receiving exactly `Staff webhook received: สวัสดี`, establishing the requested E2E. The long-message split cases are covered by mocked tests, not a real LINE send.
