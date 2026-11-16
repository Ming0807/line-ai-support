# OC-OPERATOR-06 Coverage board — 16-task operator round (RED-first, bounded evidence)

Round: OC-OPERATOR-06 (16 tasks: CX1-CX3 counterexamples + RX1-RX4 regressions + staff
onboarding/approval UX + Incident batch reply UX + bounded harness evidence).
Date: 2026-10-30 (ICT). All times ICT. All work local commits in the worktree
`D:/project-next/line-ai-yru-opencode-staff`, branch `codex/opencode-inbox-workflows`;
nothing pushed, merged, rebased, reset or cleaned. Prior OC-INBOX-04/05 evidence is
preserved below the round's commits.

Pinned baseline (verified in plan §1): `90db3d3b0f932a97ece0958b271a18ee47c75310`,
working tree clean; frozen evaluator fixture SHA
`E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` unchanged through
the round (re-measured at the final HEAD, see report §5).

Status labels (plan §9 — nothing else may be read as "passed"):

- `IMPLEMENTED` — code changed this round + helper/unit proof attached.
- `COMPONENT_PASS` — the REAL production component exercised inside the fixture browser
  (harness compiles the worktree sources; synthetic same-contract adapters; no production
  module modified by the fixture).
- `FIXTURE_PASS` — fixture-only behavior; not a live-server claim.
- `NOT_RUN` — not exercised this round; reason stated. Never a pass.
- `ROOT_DEPENDENCY` — blocked by a root-owned item. Never a pass.

## 1. Commit chain (local only; newest last)

| Commit | Scope |
|---|---|
| `b9019b99c36d271dfea1c2902e64c25ca0f0c41f` (commit 1, plan/RED) | round plan `docs/ui/OC_OPERATOR_06_PLAN.md` + bounded harness (per-scenario caps + real-JSON serialization fix H1 in `server.mjs`) + S16-S18 scenarios + honest-RED runs at pinned HEAD (`red-op06e`, `head-regression-op06`) |
| `21b0b4a224f879422d472cf5189a1a68e3d6b427` (commit 2, authority/cache) | CX1 whole-actor authority epoch + reset/reveal gate; RX3 monotone ack merge cap; RX4 contiguous ack frontier; RX2 requestId-guarded attempt clears; CX2 event lane with ticketId-aware `onThreadAccessLost` |
| `e00e03c5f02bbd3074db2f425766002798036c45` (commit 3, async/realtime) | CX3 per-room write state (busy/notices keyed per room + per-room lease fence, completion strictly `(actorId,ticketId,requestId)`); lifecycle access-loss lane (RX1 current-thread revalidation); S19 realtime phase/gate scenario |
| `28a75689a4bed411afbc14e099e7748d946673a0` (commit 4, onboard/incident) | OP06-11 onboarding real-contract UX (`apply-client`, `status-client`, `onboarding-controller` strict context shape incl. `loginAvailable`); OP06-13/14 Incident batch reply verified against contracts + FIRST mounted coverage S20/S21 (+S22-S24 onboarding states); `incident-batch-entry` fixture; `/fixture/incident-batch` route; suites extended (`tests/staff-onboarding-ui.test.ts` 29/29) |
| `b7f396e158972e66839c96f360c2ffe7d10a86b8` (commit 5, docs+errata) | coverage board (this file) + completion report + dated OC-INBOX-05 errata |
| final evidence commit (branch tip) | full mounted matrix label `op06-c5` at the round's final HEAD: **24 OK / 0 FAIL** (S01-S24) |

## 2. Mounted harness evidence (all labels from this round's runner, artifacts committed)

| Label | State | Outcome |
|---|---|---|
| `red-op06e` | pinned HEAD `90db3d3`, BEFORE any app fix | 0 OK / 4 FAIL: S11 0/1 (real leak after harness H1 fix), S16 3/7, S17 4/6-listed-as-FAIL, S18 3/8 (plan §11 for signatures) |
| `head-regression-op06` | pinned HEAD `90db3d3`, full S01-S18 | 14 OK / 4 FAIL (S01-S10, S12-S15 unchanged; S11+S16+S17+S18 RED) |
| `op06-c2` | commit 2 state | S16 7/7, S17 6/6 (list) |
| `op06-c2-regression` | commit 2 state, full S01-S18 | 16 OK / 2 FAIL — S11 and S18 still RED at that mid-state (intended; CX3 landed in commit 3) |
| `op06-c3-targets` | commit 3 state (targets incl. S11) | 9 OK: S10 3/3, S11 1/1, S18 8/8 + S13-S15 |
| `op06-c3-realtime` | commit 3 state | S19 7/7 (realtime visible-timer passthrough gated the same as realtime markers; hidden/offline via 700 ms + count-unchanged) |
| `op06-c3-matrix` | commit 3 state, full S01-S19 | **19 OK / 0 FAIL** |
| `op06-c4` | commit 4 state, full S01-S24 | **24 OK / 0 FAIL** — S20 18/18, S21 13/13, S22 4/4, S23 3/3, S24 4/4 |
| `op06-c4b` | commit 4 state (focused post-fix re-run after the boot-load/`page.reload` fixes) | 2 OK: S21 13/13, S22 4/4 (identical outcomes to the full matrix) |

Artifacts live under `tests/browser/oc-inbox/artifacts/<label>/` (per-scenario JSON +
combined `summary.{json,md}`) and are committed in the respective commits. Old
OC-INBOX-05 oversized raw artifacts stay on disk only (indexed in plan §5; never re-added).

## 3. Task-by-task coverage (OP06-01..16)

| Task | Round coverage | Status label | Evidence |
|---|---|---|---|
| OP06-01..04 (authority epoch / cache / async fences subject areas) | Covered by CX1-CX3 + RX1-RX4 work in commits 2-3 (plan §3 defect table rows CX1, RX2, CX3+, RX1) | IMPLEMENTED + COMPONENT_PASS | `opencode-operator-authority.test.ts` (epoch reveal gate, whole-actor vs ticket-scope resets, requestId-guard clears, contiguous/monotone acks) + mounted S16/S17/S18 + `op06-c2`/`op06-c2-regression`/`op06-c3-targets`/`op06-c3-matrix` |
| OP06-05 (browser/evidence) | Harness bounded caps (requests 250 / body 16384 / console 120) + real-JSON serialization (H1) landed in commit 1; S19-S24 added | IMPLEMENTED | `red-op06e`, `head-regression-op06`, `op06-c4` |
| OP06-06 (read-ack) | RX3 monotone merge + RX4 contiguous frontier landed commit 2 | IMPLEMENTED | authority suite + S17 6/6 (`op06-c2`, matrix) |
| OP06-07 (authority assist/revision on detail) | Verified behavior preserved (initialThread seed anchored on detail route; epoch gates); no new fix needed | COMPONENT_PASS | S05 2/2 + S16-S18 epoch gates within `op06-c3-matrix` |
| OP06-08 (private invalidation cross-room) | Per-room notice/busy isolation (CX3) + access-loss lanes (CX2/RX1) | COMPONENT_PASS | S18 8/8, S19 7/7 |
| OP06-09 (realtime phase gates) | S19 added commit 3: visible timer passes the same `trigger` gate; hidden/offline lane never announces live | COMPONENT_PASS | `op06-c3-realtime`, `op06-c3-matrix` |
| OP06-10 (bounded artifact sizes) | Per-scenario caps active in every round-run after commit 1; largest artifact this round ~16.6 KB (S20 JSON) | IMPLEMENTED | Cap ledger: `run-scenarios.mjs` with `CAPS`; every committed label ≤ 17 KB per scenario JSON |
| OP06-11 (staff onboarding real-contract UX) | Strict `isContextShape` requires `loginAvailable:boolean` (200 without it → honest unavailable; no invented login); LINE OAuth button renders ONLY with `loginAvailable:true` or the missing-context 401 fallback (both honest entries); approved+`staffActive:false` → generic unavailable state whose lead renders the controller notice (manual review reason; no reapply form, no auto-activation); REJECTED/SUSPENDED recorded terminal copy fixed with server-provided `reviewerName`/`decisionReason` only; dashboard link gated on `staffActive`; unchanged frozen DTO (`types/staff-applications.ts` untouched) | IMPLEMENTED + COMPONENT_PASS | Suites `tests/staff-onboarding-ui.test.ts` 29/29 (7 new OP06-11 cases) + mounted S22 4/4, S23 3/3, S24 4/4 (`op06-c4`) |
| OP06-12 (approval uncertain/access-loss paths) | Verified remaining contract already implemented in `applications-controller.ts`: 401/403 list load clears list+dialog; `unavailable` keeps the last list; uncertain keeps `requestId`; retained dialog survives tab/page changes; decision body immutable | COMPONENT_PASS | code-read verification (controller L262-295 area) + existing `staff-approval-ui` suite + S15 9/9 in `op06-c3-matrix` |
| OP06-13 (incident recipient selection) | Component (consolidated from verified prior rounds) verified against contracts + mounted for the first time: per-case eligibility tiers ('OTHER_ASSIGNEE'/'UNASSIGNED' disabled), cap-100 select-all action copy, intervention attestation gating, real workload counts on screen, per-existing options only; late arrivals render in a refreshed list but are NEVER auto-selected nor sneaked into a reviewed preview | COMPONENT_PASS | S20 18/18 (`op06-c4`) + `tests/incident-batch-selection.test.ts` (7 cases incl. drift rejection) |
| OP06-14 (batch review/partial delivery UX) | Reviewed preview shows message + per-recipient packets before confirm with the QUEUED≠SENT line; edit invalidates the preview (epoch; no silent re-preview); confirm carries the stored receipt; 409 clears the pending receipt AND the selection (fresh review forced; text kept); 202 acceptance copy never claims delivery/read; per-recipient delivery truth (safe failure labels; SENT annotated as not-a-read-receipt); retry offered ONLY where server marks `retryable:DEAD`, reuse of stored batchId/recipientCodes/requestId semantics (no self-minted batch/new request id on the retry lane) | COMPONENT_PASS | S21 13/13 (`op06-c4`) + `tests/incident-batch-ui.test.tsx` (incl. uncertain-retry id reuse) |
| OP06-15 (mounted browser/a11y matrix) | Desktop 1440x900 for all incident/onboarding scenarios; S09 remains the mobile/focus/dialog evidence (6/6); no viewport beyond the harness capability claimed | COMPONENT_PASS (within fixed viewport limits) | `op06-c4` |
| OP06-16 (gates/report/errata) | This file + `docs/reports/OPENCODE_OPERATOR_COMPLETION_REPORT.md` + dated errata in `docs/ui/OC_INBOX_05_COVERAGE.md`; gates re-measured per commit | IMPLEMENTED | report + gates table below |

## 4. Gates (re-measured per commit this round; exact values, no reuse of old numbers)

| Gate | Commit 2 state | Commit 3 state | Commit 4 (= final sources) state |
|---|---|---|---|
| `pnpm typecheck` | 0 errors | 0 errors | 0 errors |
| `pnpm lint` | 0 errors / 4 warnings (baseline) | 0 errors / 4 warnings | 0 errors / 4 warnings (baseline: `run-scenarios.mjs` HARNESS_DIR + unused-disable, `scenarios.mjs` `defer`, `server.mjs` `url`) |
| Full vitest (`--maxWorkers=1 --testTimeout=20000`) | 3603 passed / 1 skipped | 3603 passed / 1 skipped | **3610 passed / 1 skipped** (+7 OP06-11 tests; the 1 skip is the pre-existing `it.skipIf` platform gate) |
| `git diff --check` + `check-staged.mjs` | PASS | PASS | PASS (`STAGED_CREDENTIAL_CHECK_PASSED`) |
| Mounted runner | `op06-c2` + regression | `op06-c3-*` labels | `op06-c4` **24/24**, `op06-c4b` 2/2 |
| Frozen evaluator SHA | unchanged | unchanged | re-measured at this state — see report §5 |

## 5. Still open (explicit — none of these is a pass)

1. `pnpm build` (Turbopack) — ROOT_DEPENDENCY: worktree junction panic (same defect as
   OC-INBOX-04/05); Root must build the branch.
2. Live-server auth-gated flows and real LINE/OAuth/hosted provider/Realtime/Supabase
   traffic — NOT_RUN by design in this round (synthetic same-contract adapters; fixture
   pages always self-identify `FIXTURE`).
3. OP06-11 logo/visual/style follow-ups — the approved-inactive reason text replaces the
   standing lead copy only where the controller notice exists; broader onboarding visual
   passes remain root-owned coordinated work (see plan §4 OP06-11 wording per design doc).
4. OP06-12 drawer-clearing beyond the controller contract (approvals-client drawer
   specifics already satisfy the documented controller semantics; no UI correction was
   required this round; nothing is claimed beyond the controller contract).
5. Root-authored interactive QA and PROPOSED root items (staff onboarding endpoints
   remain PROPOSED at the backend level) — unchanged carrying items from OC-INBOX-05.

V1 overall completion is NOT claimed by this round: component-level + mounted-fixture
evidence only; "missing live evidence is not a pass" applies to every row above.

---

## Erratum (2026-11-15 ICT) & OC-07 follow-on closure

- **Erratum to §5 item 5**: Original OC-06 text stated that Root staff onboarding endpoints remain `PROPOSED` at the backend level. Root already implemented them in commit `0968451349ed020171e7aa397e9e7271b8295011` (`2026-10-29`): `app/api/staff/onboarding/route.ts`, `app/api/staff/applications/route.ts`, `app/api/staff/applications/[id]/decision/route.ts`, `app/api/staff/applications/[id]/suspend/route.ts`, `app/auth/line/route.ts`, `app/auth/callback/route.ts`, and `supabase/migrations/20261029030355_staff_onboarding.sql`.
- **OC-07 follow-on from `851625a`**:
  - `4fbb8676cc2ca99e3496c9dc8deca1ed5d935f14` (RED tests + `S25`–`S27` + `S16` B-selected repro + `S17`/`S18` commit barriers; `oc07-red` **24 OK / 3 FAIL**, targeted unit **5 failed | 34 passed**).
  - `338aac33bbde809d4b5998cb1516a2bd8e3bc68c` (P2 RX4 sparse non-1 `hasMore:false` / single-window / proven `empties` read-ack + `loadEarlier` empty tracking; P3-1 immediate whole-actor reset on `401`; P3-2 epoch-bound read-ack error guard; `S25` tail-scroll alignment; `oc07-final` **27 OK / 0 FAIL**, artifacts outside repo under `D:/codex-cache/yru-ui-qa/oc07/oc07-final`, `summary.json` SHA256 `AC0F34C8D6B897E2FBFBB5ECF3A070CB472CF8ED16936AE2C358A7D3999F7DD0`).
  - Full Vitest `265/265` files (`3615 passed | 1 skipped`), `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm build` BLOCKED exit 1 (`TurbopackInternalError` junction in worktree), frozen fixture SHA256 `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` unchanged. No live LINE/OAuth/Realtime/Flow A–F or V1 completion claimed.
