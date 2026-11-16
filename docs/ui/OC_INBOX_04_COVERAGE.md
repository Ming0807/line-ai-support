# OC-INBOX-04 Coverage — operator chat workspace (16-task board)

Statuses: `IMPLEMENTED` (code merged in the listed commit) · `COMPONENT_PASS` (proven by vitest
suites against the production sources) · `FIXTURE_PASS` (proven live on the worktree fixture dev
server, dated) · `NOT_RUN` (could not be exercised here; reason given) · `ROOT_DEPENDENCY` (blocked
by root-owned items).

Branch `codex/opencode-inbox-workflows` · baseline `d51e73278b557b75a778cdd2305388ba623debc7`
· full-baseline vitest 259 files / 3546 pass / 1 skip.
Commit chain (local only, not pushed):

| Commit | Date (ICT) | Scope |
|---|---|---|
| `1b0a214bbe1b67a2faf1ff274eb58531a03fc5ec` | 2026-10-29 05:43 | plan (16 tasks) |
| `b303162aa96c38cd32397330b459d1c385ff7e71` | 2026-10-29 05:47 | RED suites (behavior assertions; shared modules still untracked-RED) |
| `054b42d40554f6485c24b1c98ae6df464ee9fa1f` | 2026-10-29 06:26 | shared workspace engine + inbox/ticket-detail/actions restructure |
| `1d389d78d9e3d684e636e4b3d34cbde179ccfee1` | 2026-10-29 06:29 | workspace CSS states + delivery-evidence matrix pin |
| `147300020626c66d239e43ba9803361f7a752c0e` | 2026-10-29 06:36 | fixture browser walkthrough transcript |

## Task board

| # | Task | Status | Evidence + caveats |
|---|------|--------|--------------------|
| 1 | Inventory + plan | IMPLEMENTED | `docs/ui/OC_INBOX_04_PLAN.md` (commit 1). Baseline gates run at `d51e732` in-session (typecheck/lint/vitest/diff-check/fixture-hash all green). |
| 2 | One conversation workspace | IMPLEMENTED + COMPONENT_PASS | `chat-thread.tsx` single presentational composer set; `chat-thread-live.tsx` detail bridge; server `page.tsx` seeds `readThread(..., {limit:50})` without a duplicate client first-fetch. Suites: `opencode-inbox-chat-thread.test.tsx` (single reply composer + note composer structure), `opencode-inbox-actions.test.tsx` (no second lifecycle composer). Interactive `/tickets/[id]` walk NOT_RUN (fixture lacks auth/data; see report). |
| 3 | Case lifecycle actions | IMPLEMENTED + COMPONENT_PASS | `ticket-actions.tsx` is lifecycle-only (ACCEPT/RESOLVE/CLOSE/REASSIGN/REOPEN, permission-driven, removed from header usage; success AND 409 trigger `notifyThreadListeners` + `router.refresh()`); pinned in `opencode-inbox-actions.test.tsx`. Backend state machines untouched. |
| 4 | Isolation of recipients/drafts | IMPLEMENTED + COMPONENT_PASS | Drafts/pending writes keyed `draftKey(actorId, ticketId, kind)`; both list-route (parent `DraftStore` state mirror) and detail-route (memory store) mounts; suite pins URL builders contain no draft text and record/store rely on keys, not latest-ticket routing. |
| 5 | Unknown outcomes | IMPLEMENTED + COMPONENT_PASS | `writeAttemptOutcome(status|null, responseKind)`, `pendingWriteDecision` immutability, `composeAfterSuccess` clears the composer only when the draft is unchanged (`opencode-inbox-state.test.ts`): retry reuses the original requestId/body; 409 keeps the draft; success of request A does not clear draft text typed for B. |
| 6 | Real queue filters | IMPLEMENTED + COMPONENT_PASS | All filters (view/q/category/department/status/priority/assignee/sensitivity/from/to/page) wired to validated query keys; unknown params dropped with visible note; `pagination` absent → distinct "ไม่ทราบ" text; zero vs out-of-range distinct with one-click `page=1` recovery (`opencode-inbox-state.test.ts` pagination-label + dropped-keys pins). Server deep-link + popstate reasoning pinned at helper level; live browser interaction NOT_RUN (auth-gated page in fixture). |
| 7 | Fencing | IMPLEMENTED + COMPONENT_PASS | `ThreadRequestFence` reused for read/history/submit; `ListRequestGate` for the list; stale-response acceptance pins + `realtimePhaseMapper`/401-scope clearing pins in `opencode-inbox-state.test.ts`; actor remount via `actorMountKey` key prop rerender (page.tsx unchanged in gate). |
| 8 | Realtime/reconnect | IMPLEMENTED (wiring partly unpinned) | Existing graph kept: private `staff:<actorId>:inbox` broadcast `invalidate` → authorized refetch + `refresh()`; SUBSCRIBED→live; CHANNEL_ERROR/TIMED_OUT/CLOSED→polling text (`realtimePhaseMapper` ×5 pins); `installVisibleRefresh(document, window, …, 5000)` reused as-is; catch errors → polling. Caveat: the new `CHAT_THREAD_REFRESH_EVENT` listener branch inside `inbox.tsx` has no dedicated suite yet (listed in report follow-ups). |
| 9 | History and gaps | IMPLEMENTED + COMPONENT_PASS | `mergeThreadWindow` dedupe/sort/adjacency-merge, `firstCatchUpBeforeSpans` hole detection, proven-absence catch-up `catchUpAfterFetch` bounded ≤2 fetches/click with honest continuation; gap loader with spinner pinned in chat-thread suite; scroll anchor preserved via `pendingScrollRef` (revealed only for the active ticket). |
| 10 | Read/unread + delivery | IMPLEMENTED + COMPONENT_PASS | `shouldAcknowledgeRead` graph kept monotone; delivery badge matrix pin (commit 4): 6 non-sent statuses labeled distinctly, plus SENT/DEAD/SUPPRESSED tones and “ยังไม่มีหลักฐานการส่ง” for STAFF/AI without evidence; every matrix case asserts `not.toContain('อ่านแล้ว')`; no student online/typing/read receipts anywhere. |
| 11 | Minimal UI + keyboard/mobile | IMPLEMENTED + static-CSS audit (viewport-matrix NOT_RUN) | `inbox.css`: desktop 3-pane (L27–29), ≤1200px 2-pane (L184), ≤760px single-pane + `.inbox-mobile-hidden` (L188/194/196) + mobile back button (L159/198); `:focus-visible` in all four CSS files; bubble/attachment wrap via `overflow-wrap:anywhere` (L100/108–110); reduced-motion gated (L209; tickets.css L363; staff-onboarding.css L153; incidents.css has no animation to gate). `app/tickets.css` audited — no proven defect, so unmodified (allowlist honored). Interactive viewport matrix 1440/390/320 `window.resizeTo` impossible in harness → NOT_RUN; not recorded as mobile QA. |
| 12 | Private notes and assistance | IMPLEMENTED + COMPONENT_PASS | Note composer exactly 4000 (counter “4,000”), reply 5000 — suite regex `/maxlength="4000"/i` + negative on 3000 (recorded amendment: React SSR serializes the attribute camelCase, matched case-insensitively); assistant draft apply goes through `assistantDraftDisposition` (actor/ticket/revision match + permission + confirm-on-typed-draft); AI panels untouched. |
| 13 | Media readiness | IMPLEMENTED + COMPONENT_PASS | Attachment rows rendered only from server DTO fields with status labels; no href unless READY; `_long` attachment variant pins long-name/overflow class (`opencode-inbox-chat-thread.test.tsx`); no public-URL builder, no fake upload. |
| 14 | Common-incident workflow | IMPLEMENTED + COMPONENT_PASS | Context aside links real `/incidents?department=<uuid>` (verified against `incidentQuerySchema` = uuid filter; no invented endpoint); explicit “ไม่ใช่บทสนทนาเดียวกัน” honesty note + recipient-check warning; `incident-batch-selection.test.ts` +2 regressions (late arrivals never auto-selected; preview drift rejected) — existing batch contract untouched. |
| 15 | Onboarding browser acceptance | COMPONENT_PASS + FIXTURE_PASS (+ NOT_RUN parts) | Component: 6 acceptance behaviors proven by `staff-onboarding-ui` + `staff-approval-ui` + `chat-inbox-ui` (61 cases, untouched-from-baseline sources, all green). Fixture browser: `tests/browser/oc-inbox/README.md` transcript — public gate honest-unavailable + retry idempotence, status page same, `/login` renders, `/inbox`→307 login, a11y focusable order probe; server-log cross-check. NOT_RUN: drawer/focus-cycle/real approval/OAuth (no backend 401 source; no device emulation). No allowlisted UI defect was proven → no staff CSS/TSX changes (allowlist honored). |
| 16 | Evidence/gates/report | IMPLEMENTED (this file + report) | Gates: typecheck 0 · lint 0 (0 problems) · full vitest 263 files / **3574 pass + 1 skipped (3575)** · `git diff --check` 0 · `check-staged` PASSED per commit · `pnpm build` **BLOCKED** (Turbopack panic, ROOT_DEPENDENCY, exact error in report). Fixture JSON SHA256 unchanged (`E79ADE32…801F3`). |

## Suite → acceptance mapping (new/changed tests only)

| Suite | Cases | Proves |
|---|---|---|
| `tests/opencode-inbox-state.test.ts` | 12 | merge/dedupe/gap/burst catch-up, pending-write immutability, outcome table, `ListRequestGate`, URL/deep-link/dropped-params, pagination labels ×4, realtime phase mapping |
| `tests/opencode-inbox-read.test.ts` | 7 | server `readThread` seed contract (detail+messages+notes asc+latestSequence+readThroughSequence+hasMore/nextBefore), thread endpoint builders, note payload parse, access-lost trim semantics |
| `tests/opencode-inbox-chat-thread.test.tsx` | 6 | single reply+note composer structure, delivery badge matrix + never-read-receipt, history loader + mid-gap control, attachment variants incl. long-name |
| `tests/opencode-inbox-actions.test.tsx` | 1 | lifecycle-only panel, no second composer |
| `tests/incident-batch-selection.test.ts` (+2) | 6 total (4 pre-existing) | late-arrival purity, preview exact-set parity/drift rejection |

Baseline delta reconciliation: +26 cases from the four new files, +2 cases added to
`incident-batch-selection.test.ts` ⇒ **+28** pass cases vs baseline 3546 ⇒ 3574. Files 259 → 263
(the four new suites; the browser README is not a test file).

## Follow-ups (root-owned / deferred)

1. `CHAT_THREAD_REFRESH_EVENT` listener branch: pin with a unit test when a harness for
   mountable inbox wiring exists (currently the callback graph is editor-kept from the baseline
   install/graphs and phase mapping is pinned).
2. Interactive viewport matrix (1440/390/320) + mobile QA: NOT_RUN (harness cannot resize);
   root-session QA per plan.
3. Full `/staff/apply` → login → approval browser flow: needs staff onboarding backend + a
   sessioned fixture (PROPOSED below).
4. `pnpm build`: ROOT_DEPENDENCY — Turbopack refuses the worktree junction
   (“Symlink [project]/node_modules is invalid, it points out of the filesystem root”); root
   must run the build/route audit for this branch.

## PROPOSED backend items (nothing was implemented or invented by this task)

- `GET /api/staff/onboarding` and `POST /api/staff/applications` — the documented onboarding
  contract referenced by `onboarding-controller.ts` is absent in the baseline (`404` in the
  fixture live run); UI already honest-fails into its unavailable state. Root owns creation
  per OC-STAFF-03 scope.
- Ticket↔incident grouping endpoints — deliberately NOT invented; the department-scoped
  `/incidents?department=` link reuses the real existing filter.

## Dated erratum (2026-10-29, OC-INBOX-05 round — corrections only; every original row above stays untouched)

Measured at the OC-INBOX-05 pinned baseline `87257b53548b04ebcc902346199d5a476f1df0bc`
(the final HEAD of the OC-INBOX-04 chain above). The prompt-consolidated Luna Spec review and
the mounted runs corrected rows above as follows — the original wording is retained for the
record, and these corrections supersede it where they conflict:

1. Row 7 over-claim: at this chain's final HEAD `ThreadRequestFence` covered ONLY the read
   path (`fetchThread`). History/catch-up ("load earlier"/"fill gaps") carried no
   (actorId, ticketId, request epoch) binding at all, and lifecycle/reply/note submits were
   not request-fenced; a single `historyLoading` bool was shared across rooms. The scope
   this row promised exists only as measured RED evidence
   (`tests/browser/oc-inbox/artifacts/red3*`, `red4*`) and was FIXED during OC-INBOX-05
   (commit `1a6804b`: fences, per-room honest busy state, source-conditional merge;
   commit `d2c849a`: write-once attempt workspace + same-tick guard for submits —
   a per-attempt serialization, not a thin request fence).
2. Stale A submit shows its notice in room B (measured RED at baseline): fixed in commit 2.
3. Stale history could overwrite NEWER detail/permissions and lower a message's delivery
   badge (measured RED, S06/S13): fixed in commit 3.
4. A fresh assistant draft after a reply was rejected because the callback still sent the
   INITIAL revision (measured RED, S05): fixed in commit 3.
5. `page=10000` with `total=42,tickets=[]` rendered as a normal total without recovery
   (measured RED, S07): fixed in commit 2 (out-of-range + one-click `page=1`).

Evidence: per-scenario JSON/MD under `tests/browser/oc-inbox/artifacts/` (labels
`red-final` → `green-c2` → `green-c3-2` → `green-c4`), plan §11–§12 and the final report in
`docs/reports/OPENCODE_INBOX_HARDENING_REPORT.md`; coverage mapping in
`docs/ui/OC_INBOX_05_COVERAGE.md`. This erratum changes no status claim of rows above by
itself — statuses are superseded only where the named OC-INBOX-05 evidence exists.
