# F2/F3 controller implementation report

Phase 1 scope only; full V1 remains in progress.

## Implemented

- Dedicated local Supabase Postgres17 project `line-ai-yru` on port54422 (other user's local projects left running).
- CLI2.119.0 initialized config, generated foundation schema, created timestamp migrations for inbox leases and explicit grants. `db pull` failed to detect newly added private queue objects after the first snapshot; the verified queue SQL was therefore saved in a CLI-created migration and its replay proven by a clean local reset.
- Nine seeded departments, staff/anonymous sessions/conversations/messages/tickets/history; no student profile/grade/enrollment tables.
- Private encrypted LINE identity and encrypted webhook payload storage. Public dashboard tables are select-only for authenticated staff with actual department/sensitivity RLS; authoritative staff rows are not client-writable.
- Signed ingress verifies raw bytes, bounds body/events, isolates malformed event siblings, acknowledges only after transactional deduplicating persistence, and returns503 for missing configuration/storage failure. Raw identifiers never enter logs or browser DTOs.
- Inbox leases serialize arrival per user, support expired lease reclaim, use fencing tokens and limit attempts. Worker atomically stores anonymous messages and completes jobs; burst20/minute is bounded at backend. Initial AI conversation selection is foundation staging and intentionally replaced by Phase2 router; no claim of completed routing/AI service.
- pg app pool uses unnamed queries, max1 for serverless and SSL require for remote poolers; optional DATABASE_SSL_CA_PATH enables CA/hostname verification. Worker shuts down on signals and logs only fixed error codes.

## Fresh evidence

- Remote database inspected read-only: Postgres17.11, no public/private app tables. No remote mutation in this report's evidence yet.
- `supabase db reset --local --yes`: three migrations replayed and nine department seeds applied successfully.
- Foundation SQL tests: IT/library/admin explicit sensitivity/inactive/anon/private-table and direct-update boundaries passed; event dedup passed, transaction rolled back.
- `tsx --test tests/database/{queue,ingress}.integration.ts`: 4 tests passed, covering simultaneous lease winner, same-user order, expiry reclaim, stale fencing, encrypted event→anonymous message, duplicate prevention and burst bound. These use actual local Postgres, not mocked SQL.
- Crypto/signature/ingress unit tests:12 passed. TDD RED before implementations: encryption stub Not implemented, signature false!==true, unconfigured ingress501!==503, missing SQL claim function, processInboxEvent NOT_IMPLEMENTED. GREEN commands above and full unit suite25 passed.
- `supabase db advisors --local --level warn`: no findings. `supabase db lint --local`: no schema errors.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed after root integration.

## Next gates

Task review, remote migration application, dev SUPER_ADMIN provisioning/live sign-in, HTTP-level smoke checks. Then Phase2 validated routing, bounded ticket actions, atomic human takeover, durable outbound LINE delivery and ticket UI. External LINE credentials/public tunnel and AI provider credentials still absent; local/mocked work continues.

## User steering: basic student webhook first

The later user instruction explicitly requested a minimal student endpoint with raw body verification, logging and200 including events: [], with no AI/database logic. The public route now implements that basic step and only imports verifyLineSignature. The durable receive-webhook function and worker described above remain prepared separately, not attached to this public endpoint. LINE paths bypass the Supabase session proxy.

Six new route tests passed with DATABASE_URL and ENCRYPTION_KEY blank: signed empty events, signed message logging with protected identifiers, verification before malformed JSON parsing, missing/tampered signature, signed malformed JSON, missing Channel Secret. After the final JSON-string log formatting adjustment, fresh checks passed: full suite31/31, typecheck, lint and production build (session81838 exit0).

The configured .env student Channel Secret is now nonempty. Actual HTTP smoke with simulated signatures passed locally and through the temporary HTTPS tunnel: signed empty events200, modified bytes401, absent signature401, GET405. This is not yet evidence of a real LINE delivery. User Console registration and Verify remain outstanding. Setup guide: docs/learning/LINE_WEBHOOK_SETUP.md.
