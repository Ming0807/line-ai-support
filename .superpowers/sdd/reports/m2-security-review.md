# M2 development deployment and auth security review

**Review verdict: pass; no current actionable security findings in the reviewed scope.** The earlier development-target query-override issue is fixed by the current allowlist guard and regression cases. The credential ACL path now fails closed unless the owner is the current SID or SYSTEM and the protected DACL contains exactly the two expected non-inherited Allow/FullControl entries. New temporary credential files are restricted before any credential bytes are written.

## Review notes

- Remote database paths require certificate verification; development setup requires the explicit development environment and matching project identity.
- `requireStaff()` resolves the subject from verified Supabase claims and the active role from `staff_profiles`; authorization does not rely on user-editable metadata. Login errors are bounded, and logout clears the current browser's auth cookies.
- The database verifier checks RLS, rollback privacy fixtures, effective browser grants, positive `service_role` table privileges, and the worker claim function privilege.
- Parent-reported evidence: 17 focused guard/auth tests passed; the updated Windows credential ACL fixture and repeat-bootstrap check passed; the current credentials file owner and two protected DACL entries were verified; the remote role/RLS/grant fixture passed; all three accounts passed API claims/profile/logout and headless browser login, server-role rendering, reload, logout, and post-logout redirect.
- The parent reported typecheck success after the ACL change. Full repository test, lint, and build reruns after that change were still pending when I closed this review, so they are not reported here as passing.
- I did not run tests or query remote state in this review. I did not open `.env` or credential contents, or print auth tokens or raw LINE identities.

## Scope

Reviewed the development-target guard, migration apply/security verification, auth bootstrap and verification helpers, browser auth flow, server-side staff authorization, and login/logout actions. Read the repository instructions, M2 plan, and Supabase security guidance. This review changed only this report.
