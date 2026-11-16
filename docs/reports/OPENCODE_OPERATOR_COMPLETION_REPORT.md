# OC-OPERATOR-06 Completion report — operator workspace counterexamples, staff onboarding UX, Incident batch reply UX

Round: OC-OPERATOR-06 (16-task round). Report date: 2026-10-30 (ICT), written at the
round's final local state. Worktree: `D:/project-next/line-ai-yru-opencode-staff`,
branch `codex/opencode-inbox-workflows`. All commits local; nothing pushed/merged;
Root repo read-only (documentation reads only, no git commands in root).

## 0. What this report is

Completion report for the round requested in
`docs/agents/OPENCODE_OPERATOR_COMPLETION_PROMPT.md` (root): three mounted
counterexamples (CX1 authority epoch/reset, CX2 read-ack scoped room, CX3 stale-note
cross-room + global busy), four regressions (RX1-RX4), staff onboarding/approvals UX
(OP06-11/12), Incident batch reply UX (OP06-13/14), bounded harness evidence (OP06-10),
and the coverage/report/errata set (OP06-16). Coverage board (task-by-task, status
labels, evidence labels): `docs/ui/OC_OPERATOR_06_COVERAGE.md`. This file does NOT claim
V1 completion; component/mounted-fixture evidence only.

## 1. Scope actually changed (allowlisted paths only)

- `app/(dashboard)/tickets/[id]/chat-thread-ops.ts`, `app/(dashboard)/inbox/**`,
  `app/tickets/**` as touched by commits 2-3 (CX1-CX3/RX1-RX4; full detail in plan §3).
- Commit 4: `app/staff/apply/onboarding-controller.ts`,
  `app/staff/apply/apply-client.tsx`, `app/staff/application/status-client.tsx`
  (OP06-11); `tests/staff-onboarding-ui.test.ts` (29/29 incl. 7 new OP06-11 cases).
- Harness: `tests/browser/oc-inbox/harness/{scenarios,server}.mjs`
  (S16-S24 added across commits 1-4; fixtures incl. new
  `tests/browser/oc-inbox/fixtures/incident-batch-entry.tsx`).
- Docs: `docs/ui/OC_OPERATOR_06_PLAN.md` (commit 1), this report + `OC_OPERATOR_06_COVERAGE.md`
  + dated OC-INBOX-05 errata (commit 5).
- NOT touched: `.env*`, package/lockfile, `next.config`, auth/shared shell, all
  `lib/**`, `types/**`, DB/schema/backend, frozen evaluator fixtures, existing
  incident styles — verified by the per-commit `scripts/security/check-staged.mjs`
  run (scenario JSONs carry no credentials; the checker passed each commit).

## 2. Commit chain (exact SHAs; newest last)

| # | SHA | Content (one line each) |
|---|---|---|
| 1 | `b9019b99c36d271dfea1c2902e64c25ca0f0c41f` | plan + bounded harness (caps + H1 real-JSON serialization) + S16-S18 + honest-RED at pinned HEAD |
| 2 | `21b0b4a224f879422d472cf5189a1a68e3d6b427` | CX1 whole-actor epoch + reveal gate; RX2 requestId-guard clears; RX3 monotone ack cap; RX4 contiguous ack frontier; CX2 ticketId-aware lane |
| 3 | `e00e03c5f02bbd3074db2f425766002798036c45` | CX3 per-room write state + completion fences; RX1 lifecycle access-loss revalidation lane; S19 |
| 4 | `28a75689a4bed411afbc14e099e7748d946673a0` | OP06-11 onboarding UX + incident batch mounted verification (S20-S24) + fixture boot/route for incident batch |
| 5 | (commit 5, docs+errata — SHA recorded in commit 6's doc update) | coverage board + this report + dated OC-INBOX-05 errata |
| 6 | (final evidence commit — branch tip at report time) | full mounted matrix label `op06-c5` at the round's final HEAD: 24 OK / 0 FAIL |

## 3. RED-first traces (mounted production components, pinned HEAD before any fix)

| Scenario | At pinned HEAD (label `red-op06e` / `head-regression-op06`) | After the fix (labels) |
|---|---|---|
| S16 list-denial resurrection (CX1) | FAIL 3/7 — stale private record + draft re-render on re-select while the fresh GET was in flight | `op06-c2` 7/7; regression matrix dirty S01-S18 at commit 2 (S11+S18 still RED by design) |
| S17 read-ack cross-room closure (CX2) | FAIL — 403 on A's ack while B open closed B and lost B's draft | `op06-c2` 6/6 |
| S18 stale note cross-room + global busy (CX3) | FAIL 3/8 — B composer blocked by A's pending note; A's valid-200 AND 5xx outcomes leaked into B (both paths, after harness H1 fix made object bodies real JSON) | `op06-c3-targets` 8/8 |
| S11 (old OC-INBOX-05 pass, H1) | FAIL 0/1 — the old PASS was produced by `[object Object]` bodies; with real JSON the real leak reproduces; superseded; S18 carries the both-path proof | `op06-c3-targets` 1/1 (frozen-check rerun) + errata |

`head-regression-op06` full run at pinned HEAD: 14 OK / 4 FAIL (S01-S10, S12-S15 frozen
evidence unchanged; S11, S16, S17, S18 RED). No frozen scenario was edited; no old
transcript rewritten — old evidence stays and is superseded only by dated errata.

## 4. Final mounted matrix (round's final sources, label `op06-c4`)

**24 OK / 0 FAIL** (S01-S24; run at the exact tree that became commit 4
`28a75689a4bed411afbc14e099e7748d946673a0`): S01 12/12, S02 4/4, S03 1/1, S04 3/3,
S05 2/2, S06 1/1, S07 3/3, S08 2/2, S09 6/6, S10 3/3, S11 1/1, S12 2/2, S13 4/4,
S14 2/2, S15 9/9, S16 7/7, S17 6/6, S18 8/8, S19 7/7, S20 18/18, S21 13/13,
S22 4/4, S23 3/3, S24 4/4. Earlier chain labels preserved: `op06-c2` (S16/S17),
`op06-c2-regression` (16 OK/2 intended FAIL), `op06-c3-targets` (9 OK),
`op06-c3-realtime` (S19 7/7), `op06-c3-matrix` (19 OK/0 FAIL), `op06-c4b` (focused
S21 13/13 + S22 4/4 after the boot-load/`page.reload` fixture fixes).

## 5. Gates re-measured (exit codes/values; no reuse of old numbers)

| Gate | Commit 3 state | Final (commit 4) state |
|---|---|---|
| `pnpm typecheck` | 0 errors (exit 0) | 0 errors (exit 0) |
| `pnpm lint` | 0 errors / 4 warnings | 0 errors / 4 warnings (baseline) |
| `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` | 3603 passed / 1 pre-existing platform skip | **3610 passed / 1 pre-existing platform skip** (265 files) |
| `git diff --check` | clean | clean |
| `node scripts/security/check-staged.mjs` | PASS | PASS (`STAGED_CREDENTIAL_CHECK_PASSED`) |
| Mounted runner | labels above | `op06-c4` 24/24 (+ `op06-c4b`) |
| Frozen evaluator fixture SHA256 (`tests/fixtures/assistant-conversations.json`) | `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` | re-measured this session — unchanged |
| `pnpm build` | BLOCKED | BLOCKED (ROOT_DEPENDENCY — worktree junction Turbopack panic, same as OC-INBOX-04/05) |

## 6. Defects fixed this round (summary; detail in plan §3 and coverage §3)

1. CX1 — list-denial did not reset the actor workspace. Fix: whole-actor authority
   epoch (`revokeActorAuthority` bumps + `fence.revokeAuthority()`); a record reveals
   only when its epoch matches the current one AND a fresh GET confirmed after the
   bump; ticket-scope erase (`eraseTicketOwner`) does NOT bump the whole-actor epoch.
2. CX2 — read-ack denial closed the wrong room. Fix: `onThreadAccessLost(status, ticketId)`
   closes only the matching selection; the denied room's record/drafts/notes/attempts are
   erased in ops; survivors keep their own state (A→B→A reauthorization re-verifies only A).
3. CX3 — stale completion crossed rooms; one global busy blocked permitted rooms. Fix:
   per-room write state (`busy`/notice maps + per-room lease fence keyed by ticketId,
   `setRoomBusy`/`setRoomNotice`); deferred completions apply strictly to their
   `(actorId, ticketId, attempt.requestId)`; returning to A reveals A's own outcome
   (success OR honest uncertain) with no B impact.
4. RX1-RX4 — lifecycle access-loss revalidation lane, requestId-guarded attempt clears
   (late OLD responses cannot clear newer attempts), monotone read-ack merge with the
   current cursor (server cursor capped at `latestSequence`), and contiguous-ack frontier
   (never claims unloaded gap sequences; POSTs `throughSequence: contiguousReadTarget(...)`).
5. OP06-11 — apply/status: strict 200-shape requires `loginAvailable`; LINE OAuth entry
   only when configured; approved-but-not-yet-active accounts land on the generic
   unavailable state whose honest reason renders where the controller notice exists;
   REJECTED/SUSPENDED fixed terminal copy with server-recorded reviewer facts only; no
   fake applications/manual activation of any kind.
6. OP06-13/14 — verified (component + contracts + NEW mounted S20/S21): selection
   caps/tiers/attestation/late-arrivals, reviewed-preview truth (QUEUED≠SENT), edit
   invalidation, 409-forced fresh review, per-recipient partial delivery truth, retry
   only for server-modeled recipients (no self-minted batch/new request ids).
7. OP06-12 — controller contract verified as already satisfying the documented
   semantics (401/403 clears, uncertainty requestId retention, retained dialog across
   page/tab changes); no correction was needed; the mounted S15 evidence stands.

## 7. Honest limits (NOT passes)

- Real LINE/OAuth/hosted provider/Realtime/Supabase traffic and the live auth-gated
  routes: NOT_RUN this round by design (`FIXTURE`-labelled synthetic adapters only).
- `pnpm build`: ROOT_DEPENDENCY (documented above; Root must run the branch build).
- OP06-15 viewport limits: mobile/focus/dialog evidence remains the OC-INBOX-05-era
  S09 shape (6/6) plus the fixed-viewport incident/onboarding scenarios; wider a11y
  sweeps remain future work.
- Root-authored items carried from OC-INBOX-05 unchanged (staff onboarding API routes
  remain PROPOSED at root; root-side interactive QA; root build/route audit).

## 8. Review handoff

Codex review should diff the five/six commits above (SHA list in §2) on
`codex/opencode-inbox-workflows` and re-run the gates (commands in coverage §4/§9 of
the plan), then mount:

```
node tests/browser/oc-inbox/harness/run-scenarios.mjs --label=codex-review S16-list-denial-actor-reset S17-read-ack-denial-scoped-room S18-stale-note-completion-scoped-room S19-realtime-phase-gates S20-incident-batch-select-review S21-incident-batch-confirm-status-retry S22-onboarding-login-availability S23-onboarding-approved-inactive S24-onboarding-rejected-terminal
```

Positive reviewer confirmation expected: `9 OK / 0 FAIL` (one abort would mean a
fixture-environment difference, not an application defect).

---

## Erratum (2026-11-15 ICT) — Root onboarding API routes + OC-07 follow-on round

### E1. Dated erratum correcting §7 (`staff onboarding API routes remain PROPOSED`)

Original OC-OPERATOR-06 text in §7 line 123–124 stated that `staff onboarding API routes remain PROPOSED at root`. That statement is superseded by Root commit truth:

- Root implemented these routes in commit `0968451349ed020171e7aa397e9e7271b8295011` (`2026-10-29T13:53:05+07:00`, `"feat(staff): add verified LINE onboarding and admin approval"`):
  - `app/api/staff/onboarding/route.ts`
  - `app/api/staff/applications/route.ts`
  - `app/api/staff/applications/[id]/decision/route.ts`
  - `app/api/staff/applications/[id]/suspend/route.ts`
  - `app/auth/line/route.ts`
  - `app/auth/callback/route.ts`
  - `supabase/migrations/20261029030355_staff_onboarding.sql`
- Those routes exist at Root; they were absent only from the `opencode-staff` branched baseline/worktree fixture, not unimplemented at Root. Root-side live interactive QA and Root integration build remain root-owned.

### E2. OC-07 follow-on summary (from pinned `851625aa61703276ecb17a4e1eb21959e8959556`, local commits only)

- **Commits**:
  - `4fbb8676cc2ca99e3496c9dc8deca1ed5d935f14` — RED-first unit tests (`tests/opencode-operator-authority.test.ts`, `tests/opencode-inbox-state.test.ts`) + sparse fixture diversity & mounted RED scenarios (`S25`–`S27`, `S16` Root B-selected repro, `S17`/`S18` React commit barriers) in `tests/browser/oc-inbox/harness/scenarios.mjs`.
  - `338aac33bbde809d4b5998cb1516a2bd8e3bc68c` — fixes for P2/RX4 sparse non-1 read-ack frontier & history `empties`/`hasMore:false` proofs (`chat-thread-state.ts`, `chat-thread-ops.ts`), P3-1 immediate whole-actor reset on `401` (`chat-thread-ops.ts`, `inbox.tsx`), P3-2 epoch-bound `POST /read` failure guard (`chat-thread-ops.ts`), and scrolled tail-sentinel alignment in `S25` (`scenarios.mjs`).
  - Subsequent docs+errata commit on `codex/opencode-inbox-workflows` (this update; zero production code or scenario changes after `338aac33bbde809d4b5998cb1516a2bd8e3bc68c`).
- **RED before fix (`oc07-red`, `4fbb867` pre-fix)**:
  - Unit (3 targeted suites): `5 failed | 34 passed (39)` (`opencode-inbox-state.test.ts`: 3 failed; `opencode-operator-authority.test.ts`: 2 failed; `opencode-inbox-read.test.ts`: 7 passed).
  - Mounted matrix (`OC_INBOX_ARTIFACTS_DIR=D:/codex-cache/yru-ui-qa/oc07`, `--label=oc07-red`): **24 OK / 3 FAIL** (`S01`–`S24` OK including `S16` 13/13, `S17` 9/9, `S18` 10/10; `S25` FAIL 1/6, `S26` FAIL 0/5, `S27` FAIL 1/4); 29 artifact files; `summary.json` SHA256 `0A00817B3EA9EF81B888CE52137512D9C868E6A712832B803B167FDBDF6A9E50`, `summary.md` SHA256 `446708EFD255299E33AB3F0DC3C2E2CE6769757D6380C821A1E3DC0B4661DBB5`.
- **GREEN after fix (`oc07-final`, at `338aac3`)**:
  - `pnpm typecheck`: exit `0` (0 errors).
  - `pnpm lint`: exit `0` (0 errors, 4 baseline warnings in `tests/browser/oc-inbox/harness/{run-scenarios,scenarios,server}.mjs`).
  - Full Vitest (`pnpm exec vitest run --maxWorkers=1 --testTimeout=20000`): exit `0`, **265/265 files passed, 3615 passed | 1 pre-existing platform skip (`hermes-staff-runtime.test.ts`)**.
  - `pnpm build`: exit `1` (`BLOCKED` — `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`); Root runs build after integration.
  - Frozen evaluator fixture SHA256 (`tests/fixtures/assistant-conversations.json`): `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` (unchanged).
  - Mounted matrix (`OC_INBOX_ARTIFACTS_DIR=D:/codex-cache/yru-ui-qa/oc07`, `--label=oc07-final`, artifacts stored out-of-repo — nothing committed under `tests/browser/oc-inbox/artifacts/**`): **27 OK / 0 FAIL** (`S01`–`S24` all passing plus `S25` 6/6, `S26` 5/5, `S27` 4/4); 29 files (27 scenario JSONs + `summary.json` + `summary.md`); `summary.json` SHA256 `AC0F34C8D6B897E2FBFBB5ECF3A070CB472CF8ED16936AE2C358A7D3999F7DD0`, `summary.md` SHA256 `0AE4D35C6D86BCFC4751D6FD2F0240FEE35911CC77CBEA1EACD3BD5CA7FB2893`.
- **Honest scope limits unchanged**: synthetic `FIXTURE` browser adapters only; NO real LINE, OAuth, hosted AI provider, Realtime traffic, Flow A–F, or overall V1 completion claimed.
