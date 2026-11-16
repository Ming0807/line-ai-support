# OPENCODE INBOX WORKFLOWS REPORT (OC-INBOX-04)

Runner: delegated implementation on the prepared worktree, all work is **local commits (no push)**.
Reported by: implementation agent · Date: 2026-10-29 (all run timestamps in ICT).

- Worktree: `D:/project-next/line-ai-yru-opencode-staff`
- Branch: `codex/opencode-inbox-workflows`
- Baseline (exact, verified): `d51e73278b557b75a778cdd2305388ba623debc7`
- Root repo: read-only (no files touched, no git commands run there)
- Fixture prompt source: `D:/project-next/line-ai-yru/docs/agents/OPENCODE_INBOX_WORKFLOWS_PROMPT.md` (root-only, untouched)

## Commit chain (newest last)

| SHA (full) | Time (ICT) | Subject |
|---|---|---|
| `1b0a214bbe1b67a2faf1ff274eb58531a03fc5ec` | 05:43:10 | docs(inbox): OC-INBOX-04 plan |
| `b303162aa96c38cd32397330b459d1c385ff7e71` | 05:47:31 | test(inbox): OC-INBOX-04 RED — suites only; shared modules still untracked at that point per plan |
| `054b42d40554f6485c24b1c98ae6df464ee9fa1f` | 06:26:38 | Implement shared chat workspace engine across inbox and ticket detail |
| `1d389d78d9e3d684e636e4b3d34cbde179ccfee1` | 06:29:17 | Style unified chat workspace states and pin the delivery evidence matrix |
| `147300020626c66d239e43ba9803361f7a752c0e` | 06:36:01 | docs(inbox): fixture browser walkthrough transcript |

A sixth local commit carries this report + `docs/ui/OC_INBOX_04_COVERAGE.md`; its exact SHA is
stated in the runner's handoff message (the report cannot contain its own SHA).

Tree delta vs baseline: **18 files, +2373 / −477** — every path inside the prompt allowlist
(see Allowlist proof): 16 code/test files plus this report and the coverage board (allowlist
item 7's two doc files; the third, `docs/ui/OC_INBOX_04_PLAN.md`, is part of commit 1). Nothing outside `app/(dashboard)/inbox/**`,
`app/(dashboard)/tickets/[id]/**` (page/ticket-actions + new `chat-*` helpers only),
`tests/**` (allowlisted files + four new `tests/opencode-inbox-*` + `tests/browser/oc-inbox/README.md`),
and the two prompt docs files. Untouched (verified by name-status): `lib/**`, `types/**`,
`supabase/**`, `services/**`, `app/api/**`, `scripts/**`, `app/incidents.css`,
`app/(dashboard)/incidents/IncidentBatchReply.tsx`, `app/staff/**`,
`app/(dashboard)/staff-applications/**`, `app/staff-onboarding.css`, `app/tickets.css`,
existing `tests/chat-inbox-ui/staff-*` suites, package/lockfile, middleware/proxy, next.config.

## Gate evidence (exit codes as observed, in order run)

| Gate | Command | Result | Notes |
|---|---|---|---|
| Baseline vitest (at `d51e732`, pre-work) | `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` | 0 — 259 files / 3546 pass / 1 skip | proven in-session at baseline |
| Baseline typecheck / lint / `git diff --check` | — | 0 / 0 / 0 | at `d51e732` |
| Fixture JSON SHA256 | prompt-mandated unchanged | **`E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3`** (unchanged) | not modified |
| Commit 2/3/4/5 pre-commit | `node scripts/security/check-staged.mjs` + `git diff --check` | PASSED / 0 each time | staged allowlist honored; one log line per commit verified |
| Final typecheck | `pnpm typecheck` | **0** | tsc --noEmit clean |
| Final lint | `pnpm lint` | **0** — “0 problems”, no warnings | |
| Final full vitest | `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` | **0 — 263 files / 3574 pass / 1 skipped (3575), 131.12 s** | baseline +4 files / +28 cases (+26 in the four new suites, +2 regression cases in `incident-batch-selection.test.ts`) |
| Final `git diff --check` | — | **0** | clean tree (after restoring `next-env.d.ts`, below) |
| Final `node scripts/security/check-staged.mjs` | per commit | PASSED every time | credential scan clean |
| `pnpm build` | `next build` (Turbopack) | **BLOCKED — exit 1 (ROOT_DEPENDENCY)** | exact error below |

`pnpm build` failure, verbatim (worktree junction is a root-environment constraint; no
next.config/lib edits were allowed to work around it):

```
FATAL: An unexpected Turbopack error occurred.
Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid, it points out of the filesystem root
  … Execution of find_package failed → resolve → resolve_internal → try_get_next_package
```

This matches the pre-declared ROOT_DEPENDENCY for this worktree: Turbopack refuses the
`node_modules` junction that points outside the worktree’s filesystem root. Building this
branch requires a root-side run. (A webpack secondary blocker at the copilot route — Hermes
URL init — was previously diagnosed on the root; it was not reached here because Turbopack
failed first.)

## RED → GREEN mapping

- RED commit `b303162` contains **only** suites: behavior assertions for single-composer
  structure, merge/gap semantics, outcome tables, plus scaffolds for the then-untracked
  state/chat-thread modules. Module-missing RED is labeled scaffold; behavior RED asserts
  against committed baseline sources where the files existed (e.g. second-composer behavior on
  the old detail page markup).
- GREEN landed in `054b42d` (implementation) and `1d389d7` (delivery matrix pin) — the
  suites above now prove the production sources, full final run 3574 pass / 0 fail.
- Recorded amendment (truthful correction of the earlier plan note): the React SSR string
  serializes the composer attribute as camelCase `maxLength`; the suite therefore matches
  `/maxlength="4000"/i` case-insensitively and adds the negative `maxlength="3000"` check. The
  committed comment in the suite documents this.

## Fixture browser walkthrough (Task 15 + 11/16 evidence) — FIXTURE_PASS

Fixture server: `pnpm exec next dev --webpack --port 3344` (worktree; root ports 3000/3012
untouched; server exited by itself after the run — OOM during an HMR rebuild, after all
captures; environmental, not a UI observation).

- Full dated transcript + reproduction steps: `tests/browser/oc-inbox/README.md` (commit `1473000`).
- Exercised live (public, no session): `/staff/apply` HTTP 200 → honest unavailable state on
  `GET /api/staff/onboarding` 404 (route absent in baseline; backend is a PROPOSED root item),
  retry click refetches and stays honest (no fake success/no dropped retry id);
  `/staff/application` loading→“โหลดสถานะไม่สำเร็จ” (same honest state), retry idempotent;
  `/login` renders its form; a11y probe: focusable order healthy, `lang="th"`, 0 negative
  tabindices.
- `/inbox` unauthenticated: dev-server log records `GET /inbox 307` → login.
- NOT_RUN (recorded, not claimed): interactive drawer/focus-cycle/real approval/OAuth flow
  (no backend 401 source in fixture); viewport matrix 1440/390/320 (browser harness cannot
  resize; `window.resizeTo` no-effect was measured). The unauthenticated-side 401→login-phase
  mapping is proven at component level by the 61 staff suite cases.
- No allowlisted staff UI defect was proven by the fixture run → per instructions no
  `app/**` staff files were changed.

## Fixed working-copy observation (transparency)

`pnpm dev` regenerated `next-env.d.ts` (dev-type pointer swap `.next/types` →
`.next/dev/types`). That file is outside this task’s allowlist; it was restored with
`git checkout -- next-env.d.ts` and is not part of any commit (final `git status` clean).

## PROPOSED backend / root items (requested explicitly — none were invented or implemented)

1. **Staff onboarding endpoints** — `GET /api/staff/onboarding`, `POST /api/staff/applications`
   (documented contract used by `onboarding-controller.ts`): absent in this baseline
   (fixture observed 404). UI-side honest uncertainty handling proven; root owns the API.
2. **Interactive QA on a root-authored environment** — the three deferred browser flows from
   the task board (drawer focus cycle, 409-row outside filtered list, real approval paths) on
   a root host with functioning sessions.
3. **Viewport/mobile QA matrix** (1440×900 / 390×844 / 320px) — browser harness here has no
   device emulation; static CSS audit is committed in the walkthrough README + coverage.
4. **Branch build/route audit** — `pnpm build` BLOCKED (Turbopack junction panic above);
   root must run the production build for this branch.

## Honest status of the 16-task board

- IMPLEMENTED + proven at component level: tasks 1–10, 12–14 (suite mapping per
  `docs/ui/OC_INBOX_04_COVERAGE.md`).
- Task 11: implemented CSS states; static audit recorded; interactive viewport matrix NOT_RUN.
- Task 15: component pass (existing 61 staff suite cases retained, sources untouched) +
  fixture browser walkthrough FIXTURE_PASS for the public surfaces; interactive sessioned
  flows deferred to root (rule: “missing live evidence is not a pass” — these are listed as
  deferred, not claimed).
- Task 16: this report + coverage doc; all gates reported with real exit codes; fixture hash
  unchanged; only local commits; handoff below.

## Handoff for review (codex)

Review set: the commits above plus the final docs commit (six local commits total, baseline
`d51e732…` → HEAD). Suggested checks:
1. `git diff --name-status d51e73278b557b75a778cdd2305388ba623debc7..HEAD` — allowlist parity
   (16 files).
2. Suite↔acceptance mapping in `docs/ui/OC_INBOX_04_COVERAGE.md` against sources.
3. `tests/browser/oc-inbox/README.md` transcript vs the dev-server log excerpts embedded there
   (fetch codes, retry idempotence, `/inbox` 307).
4. `pnpm build` on a root-side run (Turbopack junction constraint documented).

## Dated erratum (2026-10-29, OC-INBOX-05 round — corrections only; the contents above stay as written)

1. Route/behavior over-claims corrected by re-measurements at the OC-INBOX-05 baseline
   `87257b53548b04ebcc902346199d5a476f1df0bc`: (a) the stale room-A submit notice appeared
   in room B; (b) a late history window could merge into the cached record while another
   room was open and could overwrite newer detail/permissions or lower a delivery badge;
   (c) the fresh assistant draft after a reply was rejected because the callback sent the
   INITIAL revision; (d) `page=10000` with `total>0` presented a normal total instead of an
   out-of-range state. All four are FIXED with mounted evidence in the OC-INBOX-05 chain —
   `docs/ui/OC_INBOX_05_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_HARDENING_REPORT.md`,
   `docs/ui/OC_INBOX_05_PLAN.md` §11–§12, transcripts under `tests/browser/oc-inbox/artifacts/`.
2. Task 15's "NOT_RUN drawer/focus-cycle/real approval" and Task 11's "interactive viewport
   matrix NOT_RUN" (cf. also follow-ups 2–3 of `docs/ui/OC_INBOX_04_COVERAGE.md`) were
   addressed during OC-INBOX-05 by the mounted harness: S09 + proofs P03/P04/P05/P06
   (viewports 1440/390/320, Thai 200% zoom, Tab/Shift+Tab, reduced motion, composer bounds)
   and S15 + proof P08 (native dialog focus/inert, Escape retained during uncertain,
   immutable applicant payload, 409 exits the filtered list, 401/403 snapshot cleanup).
3. Still standing unchanged after OC-INBOX-05: the staff onboarding endpoints are a
   PROPOSED root item (synthetic same-contract responses are used by the fixture; no real
   backend claims), and `pnpm build` remains ROOT_DEPENDENCY for the root to run.
   "Missing live evidence is not a pass" applies to both.
