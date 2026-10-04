# M1 durable ingress and queue acceptance

Work in D:/project-next/line-ai-yru on the existing feature branch. Read the F2/F3 review and existing implementations first. This is foundation verification, before remote database use.

Own only tests/database/queue.integration.ts, tests/database/ingress.integration.ts and lib/queue/inbox.ts. You may add a backwards-compatible optional Pool parameter to persistWebhookEvents for real PostgreSQL integration tests; root owns migrations and process-inbox.ts. Do not commit, push, alter .env, print credentials, reset the database or touch unrelated containers. Use the local database already specified by the test files. Coordinate test execution with root if a migration is pending.

Use test-first behavior evidence. Exercise the real persistence helper: a valid batch commits, redelivery is deduplicated within a channel, the same event ID in another channel is distinct, and a failing second item rolls back the whole batch. Test concurrent claims with multiple events from the same user and a second user; only the first same-user event can be leased while an unrelated user's ready event progresses. Cover lease renewal/reclaim, stale lease tokens, lease expiry during processing and attempts exhaustion. Existing tests must continue passing. Report actual bugs to root before changing production files outside your ownership. Use deterministic coordination and unique fixture IDs; clean only your fixtures.

Write evidence, commands, results and concerns to .superpowers/sdd/reports/m1-queue-report.md and return a concise status. Do not begin subsequent milestones.
