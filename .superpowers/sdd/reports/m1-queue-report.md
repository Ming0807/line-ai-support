# M1 durable ingress and queue verification

## Controller follow-up after independent review

The review identified a commit-visibility race between two concurrent same-user enqueues. A new real PostgreSQL regression first failed because the second persistence call committed despite an earlier transaction holding the enqueue lane. The persistence helper now locks all unique `(channel,user_hash)` lanes in sorted order before allocating event sequences, keeping the locks through commit. The regression now confirms an advisory wait, no early visibility, independent progress for another user and sequence order after commit. Suites claiming a real queue are run with `--test-concurrency=1`; individual queue tests still race multiple database clients.

Three additional regressions first failed: follow events consumed the message budget (0 messages instead of1), delayed bursts escaped it (21 instead of20), and malformed text was persisted (2 messages instead of0). Validated encrypted events now expose only internal event-kind metadata; rate calculations use the current event's receipt window and message-kind rows. Shared discriminated validation requires nonempty text for text events. The same three regressions now pass. Event classification unit test also demonstrated RED→GREEN.

Final controller gate: **12/12 PostgreSQL integration tests passed**, including concurrent oppositely ordered multi-user batches with no deadlock or interleaved commit sequences. Clean replay of5 migrations, expanded SQL/RLS fixture,70unit tests, typecheck/lint/production build all exited0. Local security advisors returned no issues. Independent re-review has spec PASS and quality PASS. M1 accepted; the earlier seven/eleven-test evidence below is historical.

## Scope

Updated `lib/queue/inbox.ts` with an optional `Pool` argument for `persistWebhookEvents`, preserving its default application pool behavior. Expanded only `tests/database/queue.integration.ts` and `tests/database/ingress.integration.ts`. The existing Student/Staff echo tests were left untouched. No later milestone work was started.

## Evidence and results

The integration suites use the dedicated local PostgreSQL database configured by the existing test files. Fixtures use random event/user IDs and delete only their own rows. The database was not reset by this task; the root agent replayed migrations before verification.

The persistence integration test calls the real `persistWebhookEvents` helper with a real pool. It establishes that a successful batch commits, repeated event IDs deduplicate within a channel, the same event ID remains distinct in another channel, and a database constraint failure on the second item rolls back the first item in that batch.

Queue tests establish that concurrent workers can lease the first event for a user and a ready event for another user, while the later event for the first user remains blocked. They also check lease extension, non-reclaim of a renewed lease, expiry reclaim with a new fencing token and incremented attempt count, stale-token rejection, stable same-user event order, exclusive claims for one event, and transition to `DEAD` after the fifth lease expires. The processing test checks that a lease expiring while `processInboxEvent` is running rejects completion and rolls back created identity/session effects. Existing encrypted-message processing and 20-per-minute burst coverage still pass.

The lease-expiry regression first ran RED against the prior implementation: after a 400 ms lease expired during a 600 ms pause in the processing transaction, the test failed with `AssertionError: Missing expected rejection`. This exposed PostgreSQL transaction-time `now()` keeping the lease valid for the transaction. After the root agent changed the initial and completion lease checks (and claim expiry logic) to use wall-clock time, the same regression passed.

Final targeted results: **7/7 PostgreSQL integration tests passed**. Targeted ESLint and `tsc --noEmit` also passed.

## Commands

Run from `D:\project-next\line-ai-yru` with the requested Node 24 runtime and pnpm launcher:

```powershell
& 'C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\NOTEBOOK\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' exec tsx --test tests/database/queue.integration.ts tests/database/ingress.integration.ts
& 'C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\NOTEBOOK\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' exec eslint lib/queue/inbox.ts tests/database/queue.integration.ts tests/database/ingress.integration.ts
& 'C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\NOTEBOOK\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.cjs' exec tsc --noEmit
```

## Notes

The schema has no dedicated lease-renewal function. The renewal assertion therefore exercises a token-matched server-side `UPDATE` against the real local database and confirms that a still-valid renewed lease cannot be reclaimed. No credentials or user payloads were written to this report.
