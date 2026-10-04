# M2 development staff auth scripts

Added a guarded development-only bootstrap and public-API authentication verifier. The bootstrap targets only project `tqgbodenouvcwepoxwbu`, requires `YRU_DEPLOYMENT_ENV=development` and `DEV_SUPABASE_PROJECT_REF` to match, checks the Supabase HTTPS URL and direct/session-pooler database identity, and uses the existing strict TLS `databaseConnection` helper. Database URL options that could redirect the connection are rejected; TLS options removed by that helper are accepted and then stripped before connecting.

The bootstrap creates confirmed Auth users without invitations for `SUPER_ADMIN` (`admin@yru-helpdesk.test`), IT STAFF (`it@yru-helpdesk.test`), and Library STAFF (`library@yru-helpdesk.test`). It does not set authorization metadata. It verifies recorded Auth IDs and existing profile values, creates only missing profiles, and fails on an unrecorded existing account or mismatched profile instead of changing it. A lock prevents concurrent runs. A generated password is durably written as a `pending` record before each Auth create call; after Auth returns, the ID is persisted immediately. If the process stops between Auth creation and ID persistence, the next run can recover the existing account by authenticating with that saved pending password. Credentials are stored only in the ignored `.superpowers/staging/dev-staff-credentials.json` file.

The verifier authenticates all saved accounts with the publishable key, checks `getClaims()` subject and server-owned `staff_profiles` data, proves unauthenticated profile denial, tests cross-profile denial for each account, checks staff cross-department ticket denial, confirms role is absent from Auth user metadata, and confirms local logout removes the verified session. It prints only assertion labels, roles, and counts. Neither remote script was run by this agent; root owns deployment and execution against the development project.

## Commands

From the repository root, after root confirms migrations are applied:

```powershell
pnpm exec tsx scripts/auth/bootstrap-development.ts
pnpm exec tsx scripts/auth/verify-development-auth.ts
```

The bootstrap will stop if the staging file contains mismatched or incomplete account records. To recover from an OS-level forced termination that leaves `.superpowers/staging/dev-staff-credentials.json.lock`, first verify no bootstrap process is running, then remove only that stale lock file and rerun. The pending password and any already completed account credentials remain in the ignored JSON file.

## Local checks

- `pnpm exec vitest run tests/auth-bootstrap.test.ts`: 5 tests passed.
- `pnpm typecheck`: passed.
- `pnpm exec eslint scripts/auth tests/auth-bootstrap.test.ts`: passed with no warnings.

These checks do not establish live Auth or browser behavior. Root will run the guarded bootstrap and verifier against development, then run the local browser check using the same credentials file. No remote database write was performed here.
