# F1 controller correction evidence

- Actual browser `/login` reproduced a ZodError rejecting the existing valid 32-byte encryption key. Added valid32/invalid31/invalid33 cases: RED 1 failure; replaced incorrect base64-count regex with decoded-length plus canonical re-encoding: GREEN 6/6 env tests.
- Task reviewer identified logout failure handling. Added returned-error, thrown-error, local-cookie failure and local-scope tests: RED 4/4; implemented explicit current-session cookie chunk removal even when provider revocation fails, and a recoverable signout_failed page notice: GREEN 4/4.
- Added public URL validation case: RED 1/7; public-only Zod schema: GREEN as part of final suite.
- SUPER_ADMIN restricted permission DTO now matches SQL's existing role override.
- Fresh full checks: unit suite 5 files/25 tests passed, typecheck passed, lint passed, build passed (dynamic dashboard/login/webhook). Actual browser reload displayed the Thai login with no error.
- F2 integration dependencies resolved locally: staff profile columns exist; actual RLS denies direct browser updates, inactive staff, other-department access, and sensitive access without flags. Live staff login remains pending provisioning.
