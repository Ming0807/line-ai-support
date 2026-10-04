# Phase 1: YRU Helpdesk foundation

> **For agentic workers:** Use subagent-driven-development, task-scoped review, and behavior-first tests. This is one phase of the full approved roadmap; completing it does not complete V1.

**Goal:** A runnable Thai staff application, verified Supabase auth, department-scoped database, and durable signed LINE ingress.

**Architecture:** Next.js App Router + TypeScript; Supabase Auth/Postgres; Node worker polling a private inbox/outbox. Dashboard uses user-scoped Supabase clients. Service credentials are server-only. Anonymous LINE identities are AES-256-GCM encrypted and HMAC indexed in a private schema. External API calls never occur inside SQL transactions.

**Stack:** pnpm; next 16.3.8; react/react-dom 19.3.0; @supabase/supabase-js 2.117.2; @supabase/ssr 0.12.7; zod 4.6.5; vitest 5.0.3. Pin other current registry versions and lock them. Node 24 LTS is the documented runtime.

## Global constraints

- Follow the master guide and approved LINE → Ticket → AI/RAG order.
- No student profile, grade, course enrollment, payment, or SSO tables in V1.
- Never expose raw LINE user IDs, encryption keys or service keys to the browser or logs. The user's later basic-webhook instruction permits logging verified payload content during this teaching step, with LINE identifiers/reply tokens protected.
- RLS and table grants exist with the first exposed table; auth uses verified claims/user, never user_metadata for staff authority.
- Roles: STAFF, SUPERVISOR, ADMIN, SUPER_ADMIN. Department scope and sensitive permissions are checked on the backend and in SQL.
- Tickets and conversations have distinct modes; human acceptance is atomic. AI send rechecks human takeover.
- Do not publish downloaded documents automatically; all remain PENDING_REVIEW.
- Do not modify .env values, archive PDFs, or remote infrastructure from delegated tasks. Do not push or commit unless the controller requests it.

## Tasks and contracts

### F1: Bootstrap and auth (Luna high)

Files: package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts, next-env.d.ts, app/layout.tsx, app/globals.css, app/page.tsx, app/login/**, app/auth/**, app/(dashboard)/layout.tsx, app/(dashboard)/dashboard/page.tsx, lib/config/**, lib/supabase/{browser,server,proxy}.ts, lib/auth/**, proxy.ts, tests/env.test.ts, tests/auth-policy.test.ts. The root page redirects; `/dashboard` is the protected landing route.

1. Scaffold manually in this existing repository; preserve research artifacts. Add dev/build/start/lint/typecheck/test scripts. Add pg, dotenv, tsx and their type packages for the controller's worker/SQL tooling.
2. Write failing behavioral tests for optional integration configuration, modern-key preference, invalid encryption/timeout config, internal-only redirect targets, inactive/unknown staff access denied. Then implement.
3. `lib/config/env.ts`: export `readServerEnv(source: NodeJS.ProcessEnv = process.env)` and `readPublicEnv(...)`. Validate with Zod; blank optional LINE/AI values mean unconfigured, never prevent app build/login. Never return secrets through public env. Server env exposes `supabaseUrl`, `supabasePublishableKey`, optional `supabaseSecretKey`, optional `databaseUrl`, optional `directUrl`, optional `encryptionKey`, `appBaseUrl`, `defaultAiTimeoutMs`, `hardAiTimeoutMs`, optional `lineStudentChannelSecret`, optional `lineStudentChannelAccessToken`, optional staff equivalents. Public env only URL/publishable key.
4. `lib/supabase/server.ts`: export async `createUserClient()` using cookies and publishable key. `browser.ts`: export `createBrowserClient()` alias wrapper. Auth refresh follows current SSR proxy docs. Use getClaims/getUser verification. No service client in agent scope.
5. `lib/auth/staff.ts`: export `requireStaff()` -> `{id:string, department_id:string|null, role:'STAFF'|'SUPERVISOR'|'ADMIN'|'SUPER_ADMIN', display_name:string, active:boolean, can_view_sensitive:boolean, can_view_restricted:boolean}`. Query `staff_profiles` by verified auth subject. Redirect unauthenticated to /login; deny inactive/non-staff without leaking SQL errors.
6. Login with Supabase email/password; no self-signup, social auth, or invented test account. Validate input, loading/error, no open redirects. Logout clears session. Dashboard guarded on server, real staff identity, empty work queue link only; later task owns ticket UI.
7. Plain accessible Thai staff UI appropriate to the approved dashboard task; no fabricated data or new marketing identity. Semantic labels, keyboard focus, mobile layout, reduced-motion support.
8. Run targeted tests, typecheck, lint, build; record evidence and known missing credentials in `.superpowers/sdd/reports/f1-bootstrap.md`. No commits.

### F2: Schema and RLS (controller)

Files: supabase/config.toml, timestamp migrations, supabase/seed.sql, tests/database/**, scripts/database/**.

1. Discover Supabase CLI help/version; initialize local Supabase. Inspect remote schema read-only before later applying anything.
2. Create departments, staff_profiles, public anonymous sessions (no private identity), conversations, messages, tickets, ticket_history. Private encrypted identity, inbox, outbox, delivery audit. Foreign-key indexes and constraints.
3. Staff select only allowed department/sensitivity; browser writes only through bounded authenticated action functions. Private schema inaccessible to anon/authenticated. Seed nine departments idempotently.
4. Test actual Postgres RLS as anon, STAFF other department, sensitive denied, ADMIN and inactive staff. Queue duplicate/reclaim/stale lease tests with actual SQL transactions.

### F3: Signed ingress and worker (controller)

Files: lib/line/**, lib/security/**, lib/queue/**, lib/spam/**, app/api/line/student/webhook/route.ts, scripts/worker.ts, tests/line-webhook.test.ts, tests/identity.test.ts.

1. RED tests: signature exact body, bad signatures, event duplicates, max size, absent config, malformed event isolation, identity encryption roundtrip/tamper, burst throttling.
2. Verify signature before parse, durably insert events before HTTP 200, empty event array accepts LINE verification. Preserve dedup ID. Do not await AI/network delivery.
3. Worker leases event, starts/reuses conversation, appends message idempotently, completes event atomically; transient errors backoff, terminal errors observable. Provider/routing remains dependency for Phase 2/3.
4. Run unit/build/SQL checks and document how to start worker and local tunnel. HTTP acceptance tests use injectable storage or local DB, never unsigned production bypass.

## Phase gate

Runnable app and authenticated staff boundary, migration resets cleanly, actual RLS/queue behavior verified, signed webhook durably accepts and deduplicates. Live LINE E2E remains pending until channel credentials and public webhook URL are available. Continue into Phase 2 after this gate; preserve full V1 requirements in roadmap and progress ledger.

## Current teaching step requested by the user

The student public route currently verifies raw bytes, logs verified payload content with protected identifiers, and acknowledges200 including events: []. It has no AI or database dependency. The durable ingress/worker is prepared separately for the later F3 integration and is not connected to this route yet. A student Channel Secret is configured locally and a temporary HTTPS tunnel is verified with simulated signed requests. Real LINE Console Verify and message delivery remain pending; this basic step does not meet the durable F3 phase gate above.
