# M1 RLS fixture report

Expanded `tests/database/foundation.sql` as a rollback-only fixture for the M1 scope-hardening migration. It uses real `authenticated` and `anon` database roles with explicit `request.jwt.claim.sub` identities. The fixture does not claim the current database policies pass.

## Assertions added

- Department directory: active staff can read the department list; inactive staff and an authenticated user without a staff profile cannot.
- Staff profiles: each caller reads its own profile only, including an inactive caller's own profile.
- Department grants: no-grant Admin sees no tickets; an explicit IT grant sees only IT; an Admin with IT and Library grants sees only its own grant records; other users see no grants; browser writes are denied.
- Scope and sensitivity: home-department STAFF/SUPERVISOR access, cross-department denial, STAFF sensitive-only and restricted-only access, Admin explicit department scope with both flags absent/present, and SUPER_ADMIN access to all departments and levels.
- Related data: `line_sessions` appears when at least one scoped ticket exists; conversations require every conversation ticket to be authorized; messages and ticket history follow their ticket's scope.
- Missing/inactive identities: inactive staff has no scoped access; an auth user without a staff profile has no staff data access.
- Private surfaces: anon/authenticated cannot read or write private inbox tables; browser cannot claim private inbox work; anon cannot execute the ticket helper.
- Browser write and sequence boundaries: authenticated cannot write any of the eight exposed public tables; anon cannot read or write any of them; neither browser role can access any of the four private tables; both are denied ticket-sequence access.
- Isolated cross-department records: a second Library-only session, conversation, ticket, message, and history row is visible to Library and hidden from IT STAFF, IT sensitive STAFF, and IT restricted SUPERVISOR.
- Inactive and missing-profile identities: after the isolated rows exist, each still sees zero sessions, conversations, tickets, messages, and ticket history; inactive staff retains its own profile.
- Admin home-department edge: an ADMIN with IT as home department but no explicit grant cannot see IT or Library tickets.
- Ticket-history actor contract: rejects `STAFF` with null actor and non-`STAFF` with a staff actor; accepts valid `STAFF` and `SYSTEM` fixture rows and checks scoped reads.
- Inbox deduplication: duplicate `(channel,event_id)` insert leaves one row. All fixture inserts roll back.

## Execution status

The first attempt against the empty local database stopped at the first public fixture insert because migrations had not yet been replayed. After replay, a second attempt showed the fixture relied on seed data; the fixture now inserts the same nine departments as `supabase/seed.sql` inside its rollback transaction.

Final run after all four local migrations: passed with `ON_ERROR_STOP=1`, ended in `ROLLBACK`, and printed `foundation RLS/privacy checks passed`. The strengthened fixture includes the isolated Library-only records and full table privilege loops. Anon privilege checks inspect catalog OIDs because anon has no `USAGE` on schema `private`. No policy or grant mismatch remains from the assertions in this fixture. No remote database was written or queried by this fixture.
