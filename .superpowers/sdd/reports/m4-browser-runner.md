# M4 Browser/API runner report

## Runner

Added `scripts/qa/ticket-browser.mjs`, an actual Chromium acceptance runner for the local production server on port 3001. It reads the ignored development-account file only when executed, verifies its project reference against `DEV_SUPABASE_PROJECT_REF`, logs in through the real Auth UI, and mirrors the three verified subjects into local `auth.users` and `staff_profiles` for the local ticket service.

The runner creates three scoped local ticket fixtures (IT general, Library general, and IT restricted), then checks unauthenticated redirects and API denial, Super Admin list/detail scope, IT and Library queue scope, foreign/restricted 404 behavior in the API and UI, accept/reply/resolve/close actions, idempotent reply replay, stale-revision conflict, cross-origin rejection, and 390px list/detail overflow. Reply delivery remains queued locally; the runner never invokes LINE delivery.

Fixture setup is local-only and transactionally committed for the server to read. `finally` closes Chromium and removes only tracked fixture rows in foreign-key order. A pre-existing local auth/profile subject fails closed rather than being overwritten. Logs contain fixed case labels and booleans/status codes only; they omit credentials, emails, database IDs, request bodies, LINE data, and raw errors.

## Verification

- `node --check scripts/qa/ticket-browser.mjs`: passed.
- `pnpm exec eslint scripts/qa/ticket-browser.mjs`: passed.
- The browser runner was not executed in this authoring task; the root runs it after the local PostgreSQL security gate against the isolated production server.

Run with `node scripts/qa/ticket-browser.mjs` while the local production server is listening on port 3001 and `PLAYWRIGHT_RUNTIME_PATH` points to the bundled Playwright runtime. The runner itself hardcodes the dedicated local database at port 54422 and does not use dotenv `DATABASE_URL`.
