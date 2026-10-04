# M3 durable LINE ingress — final security and spec review

**Reviewed diff:** changes since `731d776` in the M3 implementation files and tests.  
**Spec:** `docs/superpowers/plans/2026-10-04-yru-durable-line.md` (M3).

## Findings

No actionable defects found in the reviewed M3 scope.

## Spec verdict: Pass

The durable route branch is opt-in and leaves the existing echo branch as the default. Each route supplies a fixed channel and channel-specific signing secret; the shared receiver checks the raw-body signature before JSON parsing, bounds the body, awaits the inbox persistence promise, and returns bounded errors. The inbox insert is transactional and idempotent per channel/event ID. The durable route does not initiate outbound requests.

The worker validates the database-claimed channel against the locked lease row before dispatch. Staff text handling writes only encrypted content to the private Staff table; the composite source-event foreign key fixes its channel to `STAFF`, and the Staff branch does not use Student identity/session/conversation/message persistence. Unsupported Staff events complete as ignored. The claim function preserves per-user arrival order within each channel, which also serializes Staff rate-limit evaluation through the worker. Lease tokens are checked while holding the row lock and again at completion; retry counts terminate at five. Logging in the reviewed durable path is limited to channel, event count, stage, and bounded codes.

## Quality/security verdict: Pass

The additive migration enables RLS and revokes browser-role table access, while granting server access. The reviewed integration assertions cover effective browser/server grants and reject a Student source event through the Staff table’s foreign key. I found no scope creep into outbound delivery, tickets, Staff binding, or AI/RAG work.

## Verification evidence and limits

I inspected the current source, migration, and test assertions; I did not run database or application tests as part of this review. The root agent reported the focused route suite (18 durable cases plus 34 echo regressions), Staff PostgreSQL isolation suite, worker retry/fencing suite, and signed HTTP-to-local-PostgreSQL worker smoke passing. The root also reported the end-to-end smoke fixtures cleaned and the local server stopped. These results are parent-reported rather than independently reproduced here.

The last full-gate status provided to this review was that migration replay, PostgreSQL/unit suites, typecheck, lint, build, and advisors were still running. This report does not claim those gates passed. User-only LINE/manual evidence remains deferred as required by the plan and is not labeled passed. No environment-file values, staging credentials, tokens, or raw LINE identifiers were read for this review.

## Addendum — final M3 gates

After this review was written, the root agent independently inspected and reported: clean six-migration replay; full effective-role foundation fixture; 18/18 PostgreSQL integration tests; 108/108 unit tests; typecheck, lint, and production build passed; local security advisors reported no issues. Root also reported the production-mode local HTTP → PostgreSQL → both worker lanes/idempotency smoke passed with fixture cleanup verified. These final gate results are parent-reported here, not independently rerun by this reviewer. User-only LINE/manual evidence remains deferred.
