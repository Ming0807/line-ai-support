# F2/F3 Review

Reviewed the supplied diff and implementation report against the master guide, Phase 1 roadmap, and review brief. I accepted the reported 12 crypto/ingress unit tests and the local SQL suite plus four Postgres integration tests as fresh evidence; I did not rerun them.

## Verdicts

- **Spec compliance: Partial; do not pass yet.** The foundation is otherwise aligned with Phase 1: it keeps V1 anonymous, seeds nine departments, encrypts LINE identifiers and inbox payloads, applies explicit table grants and RLS, persists ingress before acknowledging, and keeps the public teaching webhook separate. No AI or outbound delivery implementation is claimed. However, the SQL policy gives `ADMIN` unrestricted cross-department access to every general ticket, contrary to the master guide's “Admin sees several parts according to permission” rule and the brief's department-scope requirement.
- **Code quality: Needs a security correction before remote database use.** Ingress, encryption, lease fencing, and transaction boundaries are clearly separated. The remote PostgreSQL TLS configuration disables certificate verification by default. The reported passing checks do not cover that risk or several advertised RLS and race properties.

## Findings

### High (P1) — Admin bypasses department grants

`supabase/migrations/20261004043829_foundation.sql:277` treats `ADMIN` and `SUPER_ADMIN` identically for department scope. An active Admin therefore sees all `GENERAL` tickets across departments, even though there is no per-department permission record to narrow that access. The SQL fixture codifies this behavior by expecting an Admin with no department grant to see two tickets from IT and Library (`tests/database/foundation.sql:33`). This conflicts with `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md:1142` and can expose unrelated student support content. Add explicit Admin department grants and use them in the SQL policy; retain cross-department access for `SUPER_ADMIN` according to the approved policy.

### High (P1) — Remote database TLS accepts unverified certificates

`lib/database/connection.ts:11` sets `rejectUnauthorized:false` whenever `DATABASE_SSL_CA_PATH` is absent. Remote connections are encrypted, but the client accepts any server certificate, so a network or DNS attacker able to intercept the connection can impersonate the database and read or alter its traffic. Verify certificates by default using the system trust store, with an optional configured CA for environments that need one.

### Moderate (P2) — Restricted-ticket RLS is not exercised

`tests/database/foundation.sql:22`–`45` checks department scoping and `SENSITIVE` access, but creates no `RESTRICTED` ticket and never checks `can_view_restricted`. The policy has a distinct `RESTRICTED` branch at `supabase/migrations/20261004043829_foundation.sql:280`. A regression could therefore expose restricted tickets without failing the reported SQL suite. Add cases for staff, Admin, and Super Admin both with and without the restricted permission.

### Moderate (P2) — Reported SQL RLS coverage omits several exposed tables

The SQL suite checks ticket/message reads and selected grants, but does not assert scoped reads for `line_sessions`, `conversations`, or `ticket_history`, nor the intended `departments` and `staff_profiles` visibility (`tests/database/foundation.sql:22`–`45`). These tables have separate policies in the migration. The implementation may be correct, but the reported suite does not establish those privacy boundaries; add cross-department and inactive-staff fixtures for them.

### Moderate (P2) — Multi-worker ordering and different-user independence are not demonstrated

Same-user ordering is tested by sequential claims through one client (`tests/database/queue.integration.ts:10`–`28`). The concurrency test races two workers for a single event (`tests/database/queue.integration.ts:31`–`42`), so it does not show that two workers cannot lease later events for one user while the earlier event is processing. Also, the burst test is named as proving another user's progress, but inserts and processes only one user's events (`tests/database/ingress.integration.ts:29`–`47`). Add concurrent claims for multiple events sharing one hash and a second user's ready event; assert ordering and independent progress.

### Moderate (P2) — The database ingress integration does not exercise the persistence helper

`tests/database/ingress.integration.ts:8`–`17` inserts directly into `private.webhook_inbox` and calls the processor. The ingress unit test uses a stub `persist` callback (`tests/line-webhook.test.ts:36`–`49`), while the SQL dedup check manually repeats an insert (`tests/database/foundation.sql:48`–`50`). Thus the reported verification does not execute `persistWebhookEvents` against Postgres or demonstrate rollback of a partially failing webhook batch. The code's transaction wrapper looks appropriate, but its transactional behavior is not established by the claimed evidence.

### Minor (P3) — Ticket-history actor type and actor ID can disagree

`supabase/migrations/20261004043829_foundation.sql:195`–`200` validates the `actor_type` enum and references staff profiles, but permits `actor_type='STAFF'` with a null `actor_id` or a non-STAFF row with a staff `actor_id`. This can leave incomplete or misleading audit history. Add a check tying STAFF events to a non-null actor and requiring non-STAFF actor IDs to be null, if that matches the chosen audit contract.

### Minor (P3) — Initial migration grants anon access to the ticket sequence

`supabase/migrations/20261004043829_foundation.sql:464`–`478` grants `SELECT`, `UPDATE`, and `USAGE` on `tickets_ticket_seq_seq` to `anon` and `authenticated`; the later explicit-privileges migration revokes those grants. The final reset state is protected, but the foundation migration temporarily exposes and allows advancing the ticket counter during staged migration application. Remove those grants at their source and grant sequence access only to the server role.

## Scope note

The prepared inbox/worker is not wired into the separate basic student webhook route. The brief explicitly says that route is a separate committed teaching step and that this task prepares receiveWebhook/worker for later integration, so I do not count the separation or the absence of AI/outbound delivery as a finding.
