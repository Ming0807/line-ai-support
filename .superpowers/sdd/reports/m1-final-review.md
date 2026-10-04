# M1 Foundation Final Review

Re-reviewed the refreshed package `.superpowers/staging/m1-foundation-review-2.diff`, current source, and updated queue/RLS reports. The three earlier worker findings are corrected in source and each has RED→GREEN PostgreSQL regression evidence.

## Spec compliance verdict: Pass for reviewed M1 scope

The M1 source satisfies the reviewed requirements: anonymous identity with encrypted LINE IDs and payloads; signature verification before JSON parsing; durable persistence before acknowledgment; event deduplication per channel; per-channel/user enqueue ordering with independent lanes; expired-lease fencing and rollback; explicit Admin department grants; independent sensitivity permissions; Super Admin scope; browser role/grant/ticket/queue write denial; strict remote TLS; consistent ticket-history actors; and removal of browser sequence privileges.

No open spec finding remains. The previous same-user ordering race is addressed in [inbox.ts](D:/project-next/line-ai-yru/lib/queue/inbox.ts:7), which locks sorted `(channel,user_hash)` enqueue lanes through transaction commit before allocating sequence values. The two-transaction regression waits on the real advisory lock, confirms the later same-user row is not visible early, verifies another user's transaction can commit, and checks sequence order ([ingress.integration.ts](D:/project-next/line-ai-yru/tests/database/ingress.integration.ts:62)).

The message-rate guard now counts only earlier `MESSAGE` rows in the current event's receipt-time window ([process-inbox.ts](D:/project-next/line-ai-yru/lib/queue/process-inbox.ts:29)). Regressions cover follow events, a delayed 21-message backlog, and the 20-message cap ([ingress.integration.ts](D:/project-next/line-ai-yru/tests/database/ingress.integration.ts:36)).

## Code quality verdict: Pass for reviewed M1 source

The worker and receiver share a discriminated event schema. Text messages require nonempty text, so malformed text events are marked unsupported without creating empty messages ([events.ts](D:/project-next/line-ai-yru/lib/line/events.ts:10), [ingress.integration.ts](D:/project-next/line-ai-yru/tests/database/ingress.integration.ts:53)). Event-kind metadata contains only a bounded classification and supports the indexed rate query; event content remains encrypted ([20261004065637_inbox_event_classification.sql](D:/project-next/line-ai-yru/supabase/migrations/20261004065637_inbox_event_classification.sql:1)).

The updated RLS fixture now checks isolated cross-department sessions and related rows, inactive and missing-profile access after those rows exist, and browser access across all exposed public/private tables. The report says those assertions pass and end in rollback.

## Verification status

The updated queue report records 11/11 PostgreSQL integration tests passing, including the three new RED→GREEN regressions; full typecheck and lint also pass. The current queue and ingress tests contain no explicit TypeScript `any[]` annotations. Root reports the five-migration replay and full unit/build gate are still pending, so this review does not claim those final checks have completed.

No source changes or remote database operations were made during this re-review.
