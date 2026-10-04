# M3 — durable LINE ingress and isolated worker

Accepted on 4 October 2026. Student and Staff routes can now acknowledge verified events only after the encrypted inbox transaction commits. The existing echo mode remains available; the development server is configured in durable mode after database verification. This milestone has no outbound reply, ticket, AI, or Staff binding logic.

## Verification

- Clean replay of all six migrations on the dedicated local database; full actual-role RLS/grant fixture passes. Local security advisors report no issues.
- 108 unit tests and 18 PostgreSQL integration tests pass. Typecheck, lint and production build pass.
- An actual isolated Next production server received signed HTTP requests and committed two channel-separated inbox rows before 200. The actual worker produced one Student message and one encrypted private Staff message. Redelivery before/after completion produced no duplicates. Staff did not create a Student identity/session. Fixtures were removed.
- Lease/channel validation, per-user order, rate limiting and finite five-attempt DEAD behavior pass database tests. The unchanged echo regression tests still pass.
- Independent review: `.superpowers/sdd/reports/m3-final-review.md`, no actionable findings. Reviewer test evidence is explicitly parent-reported; root verified the final gates separately.
- Reviewed additive migration applied to the selected development Supabase project: six matching versions, 13 tables with RLS, nine departments. Remote effective-role privacy fixture and real IT/Library/Super Admin subject fixture pass and roll back.

## Runtime and remaining evidence

Development `LINE_WEBHOOK_MODE=durable` and the inbox worker are running. Fresh localhost and public tunnel verification requests return 200; invalid signature returns 401; GET returns 405 for both routes. Public URL is temporary. Durable mode stores messages without the earlier echo response until the next milestone supplies outbox delivery.

A fresh human Student/Staff OA message proving durable storage on the remote project remains a manual check, deferred by the user's instruction to continue the full implementation. Earlier human-confirmed echo tests prove the OA configuration, and are separate evidence. No AI provider call or ticket operation is claimed here.
