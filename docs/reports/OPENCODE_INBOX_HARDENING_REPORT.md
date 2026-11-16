# OPENCODE INBOX HARDENING REPORT (OC-INBOX-05)

Runner: delegated implementation on the prepared worktree, all work is
**local commits (no push/merge/rebase/reset/deploy)** · Reported by: implementation agent ·
Date: 2026-10-29 (all run timestamps ICT) · Prompt source (root-only, untouched):
`D:/project-next/line-ai-yru/docs/agents/OPENCODE_INBOX_HARDENING_PROMPT.md`.

- Worktree: `D:/project-next/line-ai-yru-opencode-staff`
- Branch: `codex/opencode-inbox-workflows`
- Baseline pinned at round start (verified this session): `87257b53548b04ebcc902346199d5a476f1df0bc`
  (OC-INBOX-04 final chain preserved on top of `d51e73278b557b75a778cdd2305388ba623debc7`)
- Final code HEAD (before this docs commit): `307f1fd48faaae7a6788c9fefbc156a6cac63145`
- Root repo: read-only (prompt read only; no files touched, no git commands there)
- Frozen evaluator `tests/fixtures/assistant-conversations.json` SHA256 re-measured in-session
  and unchanged: `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3`

## Commit chain + scope (newest last)

| SHA (full) | Subject | Scope |
|---|---|---|
| `fe0c29c9612282448d6153065b0fb6a2e90b9a9a` | plan: mount harness + RED evidence at pinned HEAD | `docs/ui/OC_INBOX_05_PLAN.md` + full harness + committed RED transcript |
| `d2c849ad81bfb0e7af249948bfe0e8c2fddba32c` | lifecycle/cacheguard | D1 write-once attempts (ticket-action-workspace), D3/D9 strict DTO commits, D2/D10 owner-side erasure, D6 URL dup/malformed + out-of-range recovery, task-4 same-tick submit guards (ticket-actions + `app/staff/apply/apply-client.tsx`) |
| `1a6804ba3a809bdffac266fe0ca62310b37ab4e2` | callback/currentauthority | D4 one authority (live bridge owns panel/actions/assist revision), D5 fences + per-room history busy + merge precedence, D7 mobile focus transfer, D8 shared realtime supervisor both routes; harness fixes (supabase removeChannel contract, S09 duration normalization) |
| `307f1fd48faaae7a6788c9fefbc156a6cac63145` | browser/regressions | green-c4 15/15 + 9 in-flow FIXTURE-labelled screenshot proofs (screenshots stored OUTSIDE the repo) + plan §12 measured transcript |
| Final docs commit | this report + coverage + dated errata in the OC-INBOX-04 docs | docs only |

## Tree delta vs pinned baseline

`git diff --shortstat 87257b5…307f1fd`: **187 files, +521 410 / −208.**

- 22 non-artifact files — production/app (8): `app/(dashboard)/inbox/inbox.tsx`,
  `app/(dashboard)/tickets/[id]/chat-thread-live.tsx`, `chat-thread-ops.ts`,
  `chat-thread-state.ts`, `page.tsx`, `ticket-actions.tsx`, new
  `ticket-action-workspace.ts`, `app/staff/apply/apply-client.tsx`;
  tests (3): `tests/opencode-inbox-state.test.ts` (S13 merge pins added),
  new `tests/opencode-inbox-hardening-state.test.ts`,
  `tests/opencode-inbox-actions.test.tsx`;
  browser harness (10): 5 fixtures + `server.mjs`/`scenarios.mjs`/`run-scenarios.mjs` (commit 1)
  + `proofs.mjs`/`run-proofs.mjs` (commit 4); docs: `docs/ui/OC_INBOX_05_PLAN.md` (commit 1).
- 165 artifact files: JSON/MD transcripts only (`red*`, `green-c2/c3-1/c3-2/c4`,
  `browser-proofs`, `smoke-s14`) — no binaries committed; screenshots live in
  `D:/codex-cache/yru-ui-qa/oc-inbox-05-artifacts/**` (outside the repo by design).
- Untouched (allowlist honored, no exceptions): `lib/**`, `types/**`, `app/api/**`,
  `supabase/**`, AI panels, `next.config`, package/lockfile, `.env*`, root repo.
  (`chat-thread-state.ts` gains only the source-conditional merge rule and URL helpers
  already listed above.)

## Gates (real exit codes, measured in-session; no reused numbers)

| Gate | Command | Commit 2 (`d2c849a`) | Commit 3 (`1a6804b`) | Commit 4 (`307f1fd`) | Final HEAD (docs staging) |
|---|---|---|---|---|---|
| typecheck | `pnpm typecheck` | PASS | PASS | PASS | PASS (re-run at staging) |
| lint | `pnpm lint` | 0 errors (5 harness warnings) | 0 errors (5 harness warnings) | 0 errors (5 harness warnings) | 0 errors (5 harness warnings) |
| full unit | `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` | 263 files / 3588 passed / 1 skipped | 264 files / 3590 passed / 1 skipped | 264 files / 3590 passed / 1 skipped | PASS (re-run at staging) |
| `git diff --check` / `git diff --cached --check` | per commit | clean | clean (summary.md trailing blanks trimmed before staging) | clean (same discipline) | clean (re-run at staging) |
| creds | `node scripts/security/check-staged.mjs` | STAGED_CREDENTIAL_CHECK_PASSED | STAGED_CREDENTIAL_CHECK_PASSED | STAGED_CREDENTIAL_CHECK_PASSED | STAGED_CREDENTIAL_CHECK_PASSED |
| mounted runner | `node …/run-scenarios.mjs --label=…` | `green-c2` (partial by design) | `green-c3-1` ⚠ → `green-c3-2` 15/15 | `green-c4` 15/15 | `green-c4` 15/15 + `browser-proofs` 9/9 |
| `pnpm build` | — | — | — | — | **BLOCKED (ROOT_DEPENDENCY)** — not re-run; see plan §7 (Turbopack worktree-junction panic, same as OC-INBOX-04 report). Root builds the branch. |

The final full-unit/`git diff`/staged-scan/credential gates are re-measured as part of this
docs commit's staging and their exact outputs land in the commit-time terminal record.

## RED → GREEN per scenario (counts per mount run, all measured)

| Scenario | RED (`red-final`, pinned HEAD) | Commit 2 | Commit 3 | Commit 4 |
|---|---|---|---|---|
| S01 cross-case lifecycle retry | 7/8 + abort | 12/12 | 12/12 | 12/12 |
| S02 invalid-success-200 | 0/2 + abort | 4/4 | 4/4 | 4/4 |
| S03 list-denial erasure | 0/1 | 1/1 | 1/1 | 1/1 |
| S04 thread-denial owner erasure | 1/3 | 3/3 | 3/3 | 3/3 |
| S05 authority/assist revision | 0/2 + abort | RED (in scope) | 2/2 | 2/2 |
| S06 history fence cross-room | 0/1 + abort | RED (in scope) | 1/1 | 1/1 |
| S07 page out-of-range recovery | abort | 3/3 | 3/3 | 3/3 |
| S08 duplicate params | 1/2 | 2/2 | 2/2 | 2/2 |
| S09 mobile focus transfer | 4/6 | RED (in scope) | 6/6 | 6/6 |
| S10 detail private invalidation | 0/2 + abort | RED (in scope) | 3/3 | 3/3 |
| S11 stale-note notice | 1/1 (regression-proof) | 1/1 | 1/1 | 1/1 |
| S12 apply double-submit | 0/2 | 2/2 | 2/2 | 2/2 |
| S13 history authority regression | 3/4 | RED (in scope) | 4/4 | 4/4 |
| S14 read-ack tail | 2/2 (regression-proof) | 2/2 | 2/2 | 2/2 |
| S15 approvals backlog | 9/9 (regression-proof) | 9/9 | 9/9 | 9/9 |

Commit-4 browser proofs (in-flow screenshots, all PASS): P01 3/3 · P02 2/2 · P03 2/2 ·
P04 1/1 · P05 3/3 · P06 3/3 · P07 1/1 · P08 8/8 · P09 2/2 — re-proving already-green
behaviours with captured evidence; no new acceptance is introduced by the proofs.

## Harness-side defects found and fixed during the round (never misattributed to the app)

1–6 as documented with details in plan §11 (router identity cyclone, Map-key drainer,
deferred-key resolution, missing `?` route boundaries, Node-closure leakage into
`page.evaluate`, S15 selector raciness) — fixed inside commit 1.
7. Fixture supabase `removeChannel` wrapper did not mirror the real channel contract →
   cleanup bookkeeping recorded `undefined` instead of the channel name; fixed in commit 3
   (`name`/`__channel` resolution, cited in that commit message).
8. S09 evidence compared raw computed duration strings while Chrome normalizes
   `0.01ms` to `1e-05s`; the comparator now measures numeric milliseconds (commit 3).

App-side: the commit-3 development stage also carried a boot-seed regression
(`initialThreadRef` identity guard swallowed the first SSR seed), caught by
`green-c3-1` (S04/S10/S13/S14 aborts), isolated, and fixed before the commit landed
(`green-c3-2` 15/15) — documented in plan §12.

## Explicit status classification (prompt task 16)

- `FIXED` + `PRODUCTION_PATH_PASS`: task rows 1–14 and 16 of the coverage board
  (`docs/ui/OC_INBOX_05_COVERAGE.md`) — real production sources exercised inside the
  fixture at every point.
- `PRODUCTION_PATH_PASS` (+ NOT_RUN parts): task 15 onboarding backlogs — apply form and
  approvals drawer are fully proven; the surrounding real backend is NOT implemented
  upstream and is NOT claimed as a pass.
- `PRODUCTION_PATH_PASS` for the realtime path is partial by contract: private-channel +
  invalidate + interval refresh + `removeChannel` cleanup are all measured (S10, proofs),
  but reconnect scenarios (CHANNEL_ERROR/TIMED_OUT transitions mid-flight) remain
  verified only at the `realtimePhaseMapper` unit level — listed, not upgraded.
- `FIXTURE_BROWSER_PASS`: all mounted/proof evidence is fixture-browser-class; these are
  NOT live-server claims (`/inbox`, `/tickets/[id]` live routes were NOT exercised this round).
- `NOT_RUN`: live-server flows, real OAuth/provider/LINE/Supabase backend, money flows,
  interactive drawer QA against a real backend 401/409 source.
- `ROOT_DEPENDENCY`: `pnpm build` (Turbopack junction panic); root-side interactive QA.

## Honest leftovers (even with full-unit green)

1. A full green unit suite does NOT make V1 complete: the PROPOSED root items from
   OC-INBOX-04 remain open (staff onboarding endpoints, root-authored interactive QA,
   root-side build/route audit) and are re-stated unchanged by this round.
2. The realtime reconnect/hidden-path scenario set is partially proven (unit-level only
   for CHANNEL_ERROR/TIMED_OUT status transitions; mounted proof covers
   invalidate-refetch/interval/cleanup).
3. Screenshots live outside the repo intentionally; reviewers can re-run
   `node tests/browser/oc-inbox/harness/run-proofs.mjs` to regenerate them (free port,
   own process, dedicated `D:/codex-cache/yru-ui-qa/` profile).

## Handoff verification set

1. `git diff --name-status 87257b53548b04ebcc902346199d5a476f1df0bc..HEAD` — allowlist parity.
2. `docs/ui/OC_INBOX_05_COVERAGE.md` — task/status mapping vs sources.
3. `docs/ui/OC_INBOX_05_PLAN.md` §11–§12 — RED lists and measured GREEN progression.
4. Erratum sections appended to `docs/ui/OC_INBOX_04_COVERAGE.md` and
   `docs/reports/OPENCODE_INBOX_WORKFLOWS_REPORT.md` — dated corrections only,
   original contents untouched.
5. Screenshots (outside the repo): `D:/codex-cache/yru-ui-qa/oc-inbox-05-artifacts/browser-proofs/`.
