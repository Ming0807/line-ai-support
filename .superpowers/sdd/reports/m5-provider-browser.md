# M5 Provider Dashboard Browser Runner

Status: authored; static checks passed; **not executed**. Root owns the local production server and serial browser run.

The runner in `scripts/qa/provider-browser.mjs` uses the existing dev staff credential file for real Supabase Auth logins and temporary PG54422 `auth.users` / `staff_profiles` mirrors. It fails if any trusted mirror already exists. Its UI coverage creates the provider and model, edits model configuration, verifies blank-key preservation and key rotation, checks stale-revision and foreign-origin rejection, and confirms ordinary staff cannot access the provider page, API, or health endpoint. It also checks key privacy in the browser DOM and API response, then captures the 390 px page at `.superpowers/staging/m5-provider-mobile.png` after an overflow check.

The script restricts its database connection and browser URL to local targets. Fixture setup is transactional, and `finally` removes only the provider, its models, usage/error/audit rows tied to its generated ID, and the local auth/profile mirrors it inserted. It does not call the provider health button or health endpoint, contact provider HTTP services, or read any live key. Error output contains only a fixed stage/check summary; credential and key values are never printed.

`node --check scripts/qa/provider-browser.mjs` and focused ESLint on that file both passed. No database or browser execution has been performed by this authoring task.

## Development deployment smoke runner

`scripts/qa/provider-development-browser.mjs` is a read-only browser smoke runner for `http://localhost:3000`. It enforces the development environment and Supabase project reference from `.env` against the credential file, signs in as the three real accounts, verifies the Super Admin dashboard link and safe provider DTO/page, and verifies ordinary staff receive API 403 and a rendered 404. It allows an empty provider list, checks page errors and reloads, then logs out each account and confirms the provider API returns 401. It performs no provider writes, health checks, provider HTTP requests, or SQL access.

This runner is authored but **not executed**. Only `node --check scripts/qa/provider-development-browser.mjs` and focused ESLint should be run before the root-owned live development smoke pass.

## Root execution evidence

Root ran the local production runner on3001 after clean migration replay: all 12 cases passed, with an explicit not-found heading check for Staff and no horizontal overflow at390px. Root visually inspected the screenshot. Root then ran the read-only main development runner on3000: all three actual accounts pass role links, provider access/denial, reload, logout and post-logout401; the development registry is empty. Both runs exited0; local fixtures were removed. No live provider HTTP or remote configuration mutation occurred in these runners.
