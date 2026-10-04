# F1: Bootstrap and auth

**Status:** DONE_WITH_CONCERNS

Implemented a runnable Next.js 16.3.8 App Router scaffold with pinned pnpm dependencies and scripts for development, production build, start, lint, typecheck, Vitest, local database tests, and the worker. Added Zod environment readers that tolerate unset integrations, prefer Supabase publishable keys over legacy anon keys, validate encryption key and timeout settings, and expose only URL/publishable key values through the browser reader.

Added cookie-backed browser/server Supabase clients and a Next.js 16 `proxy.ts` session refresh path using verified `getClaims()`. Staff routes resolve `staff_profiles` with the verified auth subject (`id`), require an active recognized role, and redirect denied users without exposing database errors. Admin sensitivity access comes from the explicit permission field; super admins bypass that check. Login uses email/password only, validates inputs, rejects external redirect targets, provides pending/error states, and signs users out. The Thai login and dashboard use a compact responsive layout and contain no fabricated ticket data.

The protected dashboard uses `force-dynamic`. The first production build classified it as static; after adding the route setting, the final build reports `/dashboard` and `/dashboard/queue` as dynamic, so staff access is evaluated for each request. Next.js added `.next/dev/types/**/*.ts` to `tsconfig.json` during the build.

## Verification

- `pnpm install` — completed under bundled Node 24 with pnpm 10.33.4; generated `pnpm-lock.yaml`.
- `pnpm test` — passed: 4 test files, 19 tests.
- `pnpm typecheck` — passed (`tsc --noEmit`).
- `pnpm lint` — passed (`eslint .`).
- `pnpm build` — passed on Next.js 16.3.8; `/dashboard` and `/dashboard/queue` are dynamic routes, `/login` is dynamic, and `/` is static.

The install warned that pnpm ignored build scripts for `esbuild` and `unrs-resolver`; the test, lint, typecheck, and production build commands all completed successfully. No `.env` values were edited or printed. No live email/password login was attempted, so provider credentials and an active staff account are still needed to verify a real sign-in against Supabase.

The SSR client follows the current [Supabase Next.js server-side client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), including `proxy.ts` refresh and `getClaims()` verification.
