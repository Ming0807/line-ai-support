# F1 server logout correction

**Status:** DONE_WITH_CONCERNS

## Changed files

- `app/auth/actions.ts` now derives the Supabase project cookie prefix from `readServerEnv().supabaseUrl`, matching the server URL precedence used by `createUserClient()`. Logout continues to use `signOut({ scope: 'local' })`; it removes only the current project's root auth token and numeric chunks. It redirects to `signout_failed` only when cookie cleanup cannot complete.
- `tests/logout.test.ts` covers a provider rejection with a server-only URL, successful local sign-out, a returned provider error, exact cookie selection, and cleanup failure.

## RED/GREEN evidence

- **RED:** `pnpm test -- tests/logout.test.ts` before the code change failed on the server-only URL case: expected the current project's token and `.0`/`.1` chunks to be deleted, but the observed deletion list was empty. The action was reading the blank public URL, so `new URL()` failed before cookie cleanup.
- **GREEN:** After switching to `readServerEnv()`, `pnpm test -- tests/logout.test.ts` passed (1 test). After adding the remaining logout cases, it passed again (4 tests).
- `pnpm test` — passed: 6 files, 31 tests.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.

## Self-review and concerns

Cookie matching deletes only `sb-<project-ref>-auth-token` and names with a numeric suffix such as `.0`; the test confirms other projects, unrelated cookies, and nonnumeric suffixes are retained. Both thrown provider errors and Supabase's returned error result still lead to local cleanup and `/login`. The `signout_failed` route is reserved for cleanup errors. No server configuration is added to browser code.

Provider calls and cookie response writes are mocked in these tests; no live Supabase logout was exercised. No `.env`, database, package, or LINE files were changed. No commit was created.
