# Development database and staff authentication

The selected development Supabase project now has all five reviewed foundation migrations, twelve RLS-protected application tables and nine departments. TLS verifies the certificate and hostname; development provisioning rejects project/environment/connection overrides. No reset, table deletion, existing-row overwrite or email invitation was performed.

Three confirmed development accounts were created: `admin@yru-helpdesk.test` (SUPER_ADMIN), `it@yru-helpdesk.test` (IT STAFF), and `library@yru-helpdesk.test` (Library STAFF). Passwords exist only in the ignored local `.superpowers/staging/dev-staff-credentials.json`; Windows permissions were inspected and grant access to the current user and SYSTEM only, with no inherited entries. Repeating bootstrap left credential bytes unchanged and reused the same accounts/profiles.

Observed verification:

- Remote migration history matches all five reviewed timestamps; all twelve tables have RLS.
- Actual Postgres-role privacy fixture passes on development: public/private table grants, sequence/function privileges, anonymous/inactive/ungranted-Admin and cross-department/restricted denial. All fixture inserts roll back.
- A separate nonempty ticket fixture uses the three real Auth subjects: IT sees its one general ticket, Library its one general ticket, SUPER_ADMIN all three; staff cannot see the cross-department or restricted ticket. Self-profile visibility is one row. Fixtures roll back.
- Public Supabase Auth API: all three accounts sign in, verified claims match stored IDs, trusted profile role/department match, cross-profile reads are denied, and local signout clears the session. Anonymous claims/profile access is denied. API ticket checks alone were empty-data checks; nonempty negative evidence comes from the real-subject SQL fixture.
- Actual Chromium through Next.js: invalid password rejected; all three accounts log in, render their server-resolved role, retain session after reload, log out, remove auth cookies and are redirected to login when revisiting the protected queue.
- Browser test originally retried before React finished its action/reset transition; only one POST was observed. Waiting for the enabled form before refilling produced the successful retry and all three complete flows. No product authentication logic was weakened.
- Development target override regression first failed for host/user/database query parameters; the centralized allowlist fixed all three cases. Quoted CLI-generated table names have their own failing-then-passing migration-manifest regression.
- Windows-only negative ACL test grants the Users group read access to fake temporary credentials; the reader rejects the file before reading its content. Current/SYSTEM ownership and the exact protected DACL are required. Temporary cleanup resolves and verifies containment before recursive removal.
- Final full unit suite:90/90 passing; typecheck, ESLint (no warnings), and production Next.js build pass. Fresh Student/Staff HTTP smoke passes signed-empty200, modified/missing401, cross-channel401 and GET405. Independent security/spec review passes with no remaining actionable findings.

Root final unit/type/lint/build evidence and independent final review are recorded in `.superpowers/sdd/progress.md`. This milestone verifies development foundation/authentication only. Ticket processing, AI, knowledge publication and production deployment are later scope.
