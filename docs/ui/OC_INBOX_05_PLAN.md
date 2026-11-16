# OC-INBOX-05 Plan — prove and harden the operator workspace

Round: OC-INBOX-05 (hardening). Date written: 2026-10-29 (ICT). All times ICT.
Local-commits only; no push/merge/rebase/reset/clean.

## 1. Pinned baseline (verified in this session, not copied from an old report)

| Item | Value |
|---|---|
| Worktree | `D:/project-next/line-ai-yru-opencode-staff` |
| Branch | `codex/opencode-inbox-workflows` |
| Exact starting HEAD | `87257b53548b04ebcc902346199d5a476f1df0bc` (verified via `git rev-parse HEAD`) |
| Working tree at start | clean (`git status --short` empty) |
| OC-INBOX-04 original baseline | `d51e73278b557b75a778cdd2305388ba623debc7` (commit chain preserved on top; nothing reset) |
| Root repo | `D:/project-next/line-ai-yru` — read-only (docs/agents prompt read; no writes, no git commands there) |
| Frozen evaluator | `tests/fixtures/assistant-conversations.json` SHA256 re-measured this session = `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` (unchanged; not modified anywhere in this round) |
| Focused vitest at pinned HEAD (before any edit of this round) | `pnpm exec vitest run --maxWorkers=1` over `tests/opencode-inbox-{state,read}.test.ts` + `tests/opencode-inbox-{chat-thread,actions}.test.tsx`: **4 files / 26 passed / 0 failed** (2.16 s) |
| Playwright tooling probe | bundled library at `C:/Users/NOTEBOOK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright` + installed Edge headless + owned synthetic profile under `D:/codex-cache/yru-ui-qa/**`: viewport set to exactly 390×844 and 1440×900 verified live in-session (`PLAYWRIGHT_PROBE_OK`). Tooling capability only; not claimed as Inbox acceptance. |
| Node | v26.1.0; pnpm 10.33.4; no package/lockfile touched |

## 2. Authoritative sources actually read this round

- Root prompt (root-only): `D:/project-next/line-ai-yru/docs/agents/OPENCODE_INBOX_HARDENING_PROMPT.md` — compare-all-paragraphs match with this round's brief; OC-INBOX-04 prompt `OPENCODE_INBOX_WORKFLOWS_PROMPT.md` (root copy; worktree copy absent by design).
- `AGENTS.md` (worktree), `docs/tasks/V1_TASK_BOARD.md` + `docs/decisions/DECISION_LOG.md` DEC-187/DEC-188 (worktree), `docs/superpowers/plans/2026-10-28-chat-inbox-implementation.md`.
- Contracts (read-only): `types/inbox.ts`, `types/tickets.ts` (`ticketActionSchemas`, `TicketActionResult {id,status,revision}`, filters schema), `types/staff-applications.ts`, `lib/chat/contracts.ts` (view/enum/date/page bounds, note `{text 1..4000, requestId uuid}`), `lib/chat/api.ts` + `lib/chat/service.ts` shapes (list/thread/read/note), `lib/tickets/api.ts` + `lib/tickets/ticket-service.ts` (all lifecycle routes incl. reply→`TicketActionResult`).
- Installed Next `node_modules/next/dist/docs/` entry points consulted for the APIs the mounted client code uses: client components, `<Link>`, `useRouter`/`router.replace/refresh`, popstate deep-links (route group `app/(dashboard)`).
- OC-INBOX-04 deliverables this round must correct (dated erratum allowed): `docs/ui/OC_INBOX_04_COVERAGE.md` (row 7 over-claim: read/history/submit fencing) and `docs/reports/OPENCODE_INBOX_WORKFLOWS_REPORT.md`; neither file has its contents rewritten — only a dated erratum section is added.

## 3. Defect table (reproduce → files → acceptance). Every fix is RED-first via a mounted production-component scenario (see §5); no acceptance rests on source-string checks.

| ID | Defect (root-observed) | Reproduction (mounted, fixture browser) | Files (allowlisted) | Acceptance (GREEN) |
|---|---|---|---|---|
| D1 | P1 cross-case lifecycle retry: Inbox renders `TicketActions` without a ticket key; `PendingAction` stores only action/fields/body and `execute` posts to `id` prop current value | Select A → click ACCEPT → response held (deferred 200/5xx) → select B → click same action → POST goes to `/api/tickets/B/...` carrying A's requestId/revision | `ticket-actions.tsx`, new `ticket-action-workspace.ts`, `inbox.tsx` | Attempt is write-once `{actorId,ticketId,action,endpoint,revision,requestId,body}` in per-actor workspace memory; execution uses attempt.endpoint/attempt.body only; A→B→A: B never receives A's body; A's pending attempt survives B and retry posts to A's endpoint; B's own attempt independent |
| D2 | P1 private snapshot retained after denial: list non-OK only setError; thread denial only optional callback (detail route passes none) so cached messages/metadata still render after 401/403/404 | Inbox list 401: rows stay rendered + clickable; detail thread 403: messages/metadata still rendered; owner state keeps data without any parent callback | `inbox.tsx`, `chat-thread-ops.ts`, `controller.ts` (helpers), mount-level tests | 401/403/404 current-scope: list cleared to server-unknown, selection closed, that ticket's record/drafts/attempts/queued callbacks erased inside the owner hook itself (works with zero parent callbacks); 409/network strictly do NOT erase (drafts survive) |
| D3 | P2 uncertain lifecycle lost: `response.ok` = success without validating the success DTO (empty `{}`, wrong-ticket id, malformed 200) | ACCEPT gets 200 `{"error":"..."}`-like or `{}` → panel reports success, requestId dropped although nothing committed | `ticket-actions.tsx`, `ticket-action-workspace.ts` | 200 must parse `TicketActionResult {id,status enum,revision int}` AND satisfy identity (`id === attempt.ticketId`); invalid/wrong-identity → same as network-uncertain: attempt retained, "กำลังตรวจคำขอเดิม" shown, no auto-resend; definitive 4xx/409 releases per contract |
| D4 | P2 multiple authority sets on detail: lifecycle permissions/revision come from SSR props while ChatThreadLive refresh state is separate; initialThread effect ignores every RSC refresh after once seeded; assistance onDraft closed over initial revision | `router.refresh()` after ACCEPT passes fresh `initialThread` → hook keeps stale permissions/revision; fresh AI draft after reply is rejected because callback still sends initial revision | `chat-thread-live.tsx`, `chat-thread-ops.ts`, `page.tsx` | One authority: ops record state detail/permissions/revision feeds chat, assistance, and the lifecycle panel (TicketActions mount moved into the live bridge); a newer-authority RSC update enters the record (detail/permissions/revision by revision epoch) without letting a late history window replace detail or newer messages; assistance onDraft binds the record's live revision |
| D5 | P2 missing callback fences: loadEarlier/loadCatchUp carry no actor/ticket/epoch fence at all; single historyLoading bool is shared across rooms | Load earlier of A → switch to B → A's late history merges into A's cached record while B is open; B click on โหลดช่วงที่ขด flips A's spinner | `chat-thread-ops.ts` | Every history/catch-up/read/submit response is bound to `(actorId,ticketId,requestEpoch)`; a stale response may not (a) write into any record, (b) flip another room's busy/notice, (c) touch cursor; per-room busy state; read-error path only touches its own room |
| D6 | P2 URL ambiguity: repeated params silently pick the first value; `page=10000` with `total>0,tickets=[]` shows a normal total label and no recovery | `/inbox?page=10000&…` on a populated queue shows "N รายการ" and empty grid; `?view=mine&view=all` silently picks view=mine | `chat-thread-state.ts`, `inbox.tsx` | Duplicate keys: same repeated value accepted once, conflicting values → key dropped with an explicit note; malformed ticket id is dropped, never fetched; `paginationLabel` uses server total/totalPages: page > totalPages (or zero rows on page>1 with total>0) → out-of-range with one-click `page=1` recovery; server total/cursor never claimed above rendered rows |
| D7 | P2 mobile focus: row click hides the focused row's pane; back click hides the focused back button; no focus transfer/return | 390×844 (and 320×844) viewport: click row → focused element enters `display:none` (document.activeElement = body/not connected); click back → same | `inbox.tsx` (+ `inbox.css` only if a proven overflow needs it) | Focus moves into the opened pane (its back button); back moves focus to the originating row if still present, else the queue heading; no focus ever left inside a hidden pane; verified at 1440×900/390×844/320×844 + Thai 200% zoom + Escape/Tab/Shift+Tab + reduced motion; composer never off-viewport |
| D8 | Task 9: detail route has none of the lifetime wiring Inbox has (no private-broadcast refetch, no visible/online polling, no `CHAT_THREAD_REFRESH_EVENT` mount) — and the round requires one listener set + cleanup per route and no polling while hidden/offline | Fixture: fire `invalidate` on `staff:<actorId>:inbox` channel → detail route performs zero refetch; go hidden → interval still fires | `chat-thread-ops.ts` (shared hook + adapter), `chat-thread-live.tsx`, `inbox.tsx` | Both routes refetch on private invalidation marker only (no PII payload), on visible/online polling with real `installVisibleRefresh`, listen `CHAT_THREAD_REFRESH_EVENT` once with cleanup; hidden/offline tabs do not poll; channel error/unmount/actor-change paths proven by the same synthetic adapter (status events, `removeChannel` called) |
| D9 | P2 response validation for composer writes: note `{}` → counted as success; reply identity never checked | Note POST 200 `{}` → composer cleared ("บันทึกส่วนตัวแล้ว") although there is no note | `chat-thread-state.ts` (validators), `chat-thread-ops.ts` | Note commits only on full `ChatNote` shape; reply/lifecycle commit only on `TicketActionResult` identity; unknown-shape 200 keeps the attempt (uncertain) and the typed draft; success never clears a NEWER draft the user typed meanwhile (existing rule kept) |
| D10 | Task 5/6 erasure policy boundaries inside ops (only reachable with real mount) | revoke mid-history: history waits then 401 → A's cache remains in workspace memory | `chat-thread-ops.ts` | Access-loss in any path (history, catch-up, read, refresh) erases the ticket's record + drafts + pending attempt + planned follow-ups; network/409 keeps draft per contract |

## 4. 16-task mapping (execution order → commit)

| # | Task | Where |
|---|---|---|
| 1 | Inventory/plan | this document (commit 1) |
| 2 | Immutable lifecycle authority | D1 → commit 2 |
| 3 | Uncertain-action UX | D1/D3 → commit 2 (visible per-case "ตรวจคำขอเดิม" state; retry buttons not keyed on Thai `startsWith`; form edits never mutate a posted body; no auto-resend) |
| 4 | Synchronous submit guard | ticket-actions + (mounted proof) apply-client ref guard → commit 2 (proven in commit 4 scenarios) |
| 5 | Actual response validation | D3/D9 → commit 2 |
| 6 | Access-loss erasure | D2/D10 → commit 2 |
| 7 | All callback epochs | D5/D10 → commit 3 |
| 8 | One current detail authority | D4 → commit 3 |
| 9 | Realtime/reconnect both routes | D8 → commit 3 |
| 10 | Query/deep link | D6 → commit 2 |
| 11 | Transcript coverage/read | history/delivery precedence + source-precedence merge → commit 3 |
| 12 | Actor/session cleanup | actor-scoped workspace stores + unmount/logout erasure → commit 3 |
| 13 | Mobile/keyboard | D7 → commit 3 (+ browser proof commit 4) |
| 14 | Mounted regression harness | fixture project + Playwright runner under `tests/browser/oc-inbox/**` → started as RED in commit 1, GREEN evidence commit 4 |
| 15 | Onboarding/browser backlog | same harness mounts apply-client (form + ref guard) / approvals drawer; money/OAuth/real backend stays NOT_RUN → commit 4 |
| 16 | Gates/report | every commit (staged allowlist + credentials + `git diff --check`), final coverage/report → commit 5 |

## 5. Mounted regression harness (the only "integration" claim this round)

- Fixture project lives in `tests/browser/oc-inbox/harness/**` (allowlisted). It imports the real production sources (`app/(dashboard)/inbox/inbox.tsx`, `app/(dashboard)/tickets/[id]/{chat-thread-live,chat-thread,ticket-actions}.tsx`, `chat-thread-ops.ts`, `chat-thread-state.ts`, `../inbox/controller.ts`, AI panels) and compiles them with the repo's own installed TypeScript into browser ESM at server start. No lockfile/package changes; react/react-dom/zod are served through tiny CJS→ESM re-export shims (one instance of React, no duplicates).
- Synthetic same-contract adapters (fixture-only): `next/navigation`, `next/link`, `@/lib/supabase/browser` (channel with test-fireable status + `invalidate` events), `window.fetch` capture shim (records endpoint/method/body/requestId, serves scripted responses with deferred release for A/B/ABA and error bodies), in-page router state mirroring popstate.
- Every fixture page labels itself `FIXTURE` in the DOM; screenshots carry the label. No production route, auth gate, or `next.config` change; no server auth mock.
- Runner: `node tests/browser/oc-inbox/harness/run-scenarios.mjs` (its own process; free port at runtime; only its own process is closed). Output: per-scenario PASS/FAIL with captured network requests, console errors, timestamps → `tests/browser/oc-inbox/artifacts/` (committed results carry no real data).
- RED-first: scenarios D1–D10 run against the pinned HEAD sources before any fix; the RED run transcript is committed before fixes land (see commit split below).
- Onboarding (task 15) mounts `app/staff/apply/apply-client.tsx` and `app/(dashboard)/staff-applications/applications-controller.ts`+`approvals-client.tsx` under the same adapters to prove: native dialog focus/inert/return, close-with-X/Escape during a pending/uncertain decision keeps the retry id, applicant payload immutable once a request id exists, 409 moves the row out of the filtered list, 401/403 clears snapshots, finished applications open read-only.

## 6. New vitest suites (helpers the mounted flows exercise)

- `tests/opencode-inbox-hardening-state.test.ts`: success-DTO validators (action/note/reply), duplicate/malformed URL keys, `paginationLabel` page>TotalPages vs total=0, source-precedence merge (history never regresses detail/permissions/delivery), actor-scoped attempt store semantics.
- Runner count discipline: focused suites for changed helpers + the mounted runner; full gates at the end. No root backend suite numbers are merged into this round's results.

## 7. Gates (run and reported with real exit codes; no reuse of old numbers)

`pnpm typecheck` · `pnpm lint` · `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` · `git diff --check` · `node scripts/security/check-staged.mjs` per commit · mounted runner exit per scenario · fixture browser runs (actual viewports/network/console captured). `pnpm build` stays BLOCKED (worktree junction → Turbopack panic; documented ROOT_DEPENDENCY same as the OC-INBOX-04 report — root builds the final branch separately).

## 8. Status labels used in the report

`FIXED` (code changed + mounted/vitest proof) · `PRODUCTION_PATH_PASS` (real path exercised inside the fixture, which imports the real production components) · `FIXTURE_BROWSER_PASS` (fixture-only interaction, still not a live-server claim) · `NOT_RUN` · `ROOT_DEPENDENCY`. The last two are never presented as passes.

## 9. Commit plan (reviewable local commits, never pushed)

1. `plan` — this plan + mounted harness + RED scenario runs (RED transcript at pinned HEAD).
2. `lifecycle/cacheguard` — commits 2/5/6/10 items: ticket-actions workspace store (write-once, synchronous guard, DTO validation), inbox list/connection-loss erasure, URL duplicate/malformed + pagination recovery.
3. `callback/currentauthority` — ops fences per room, one authority (RSC merge, TicketActions under live authority, assistance live revision), realtime hook for both routes, history/delivery precedence, actor-scoped cleanup, mobile focus transfer.
4. `browser/regressions` — GREEN mounted runs + screenshots (FIXTURE-labelled), onboarding backlog runs, measured transcript updates.
5. `report` — `docs/ui/OC_INBOX_05_COVERAGE.md` + `docs/reports/OPENCODE_INBOX_HARDENING_REPORT.md` + dated erratum sections in `OC_INBOX_04_COVERAGE.md` / `OPENCODE_INBOX_WORKFLOWS_REPORT.md`.

## 10. Explicit non-goals

- No backend/lib/types/API/DB/auth/media/incident implementation; no package/lockfile/next.config edits; no `.env`/credential reads; no real provider/LINE/OAuth calls; ports 3000/3012 untouched.
- The only PROPOSED (not implemented) contract items found so far remain the OC-INBOX-04 ones (root-owned staff onboarding endpoints) — re-stated in the final report with the fixture evidence that still requires them.

## 11. RED-first evidence (measured at pinned HEAD `87257b5`, before any fix of this round — 2026-10-29 ICT)

Final consolidated run: label `red-final`, runner `tests/browser/oc-inbox/harness/run-scenarios.mjs`, per-scenario artifacts + `summary.{json,md}` in `tests/browser/oc-inbox/artifacts/red-final/` (network logs + console + timestamps per scenario; JSON/MD only, no binaries). Earlier probing labels (`red`, `red-s01*`, `red2*`, `red3*`, `red4*`) are kept as the step-by-step RED transcript; `artifacts/smoke` was deleted (superseded by `red-final`).

Per-scenario truths (app-defect RED unless noted):

| Scenario | Result at HEAD | Root cause observed (app defect target) |
|---|---|---|
| S01 cross-case lifecycle | 7/8 checks then abort: retry button for A never appears after A→B→A | D1: A's pending attempt is lost across room switches (the "B receives A's body" collision is NOT reproducible at HEAD — requestId/revision are already keyed per request; the loss itself is the RED) |
| S02 invalid-success-200 | 0/2 then abort: invalid 200 shows success, no retry affordance | D3/D9: `response.ok` treated as success without DTO validation |
| S03 list-denial | 0/1: rows stay rendered + clickable after list 401 | D2 (list) |
| S04 thread-denial | 1/3: cached messages/metadata (3 messages, 2 notes) still rendered after thread 403 | D2 (thread) |
| S05 authority/assist | 0/2: reassign options keep stale authority; assist draft rejected | D4 |
| S06 history-fence-cross-room | 0/1: stale history response (deferred, resolved after A→B→A) merged into A's record → 6 bubbles `[1,2,3,1,2,3]` instead of 3 | D5: history window carries no actor/ticket/epoch fence |
| S07 page-out-of-range | abort at recovery-wait: `paginationLabel` handles out-of-range only for `total===0` (`total>0` + `page>totalPages` degrades to a normal total label) | D6 |
| S08 duplicate-params | 1/2: conflicting duplicate keys are picked silently (first-value), no dropped-note | D6 (notes) |
| S09 mobile focus | 4/6: focus does not enter the opened pane; reduced-motion computes 1e-05s jumps | D7 |
| S10 detail private invalidation | 0/2 then abort at refetch-wait: detail route has no private channel wiring, no refetch on `invalidate` | D8 |
| S11 stale-note-notice | 1/1 PASS | Root-fixed behavior already present at HEAD (notice stays with its own room) → regression-proof evidence, no change required |
| S12 apply double submit | 0/2: two POSTs fired, two different requestIds for one double-click tick | Task 4 (synchronous submit guard) |
| S13 history authority | 3/4: reply permission from the fresh snapshot is erased (returns 0) after loading earlier history | D5/D4 (authority precedence) |
| S14 read-ack tail | 2/2 PASS | Root-fixed behavior already present at HEAD (`throughSequence===10` on the production graph) → regression-proof evidence |
| S15 approvals backlog | 9/9 PASS | Root-fixed behaviors already present at HEAD (native dialog focus/inert, close disabled while retained, Escape retained, uncertain retry same requestId, payload immutable, 409 moves the row out of scope) → regression-proof evidence |

Net: 12 scenarios RED against the defect table (D1–D8 tasks), 3 scenarios PASS as already-fixed regression proof. RED evidence committed before any fix of this round.

Harness-side defects found and fixed inside the fixture (NOT app defects; classified explicitly so no RED is misattributed):

1. `server.mjs` shim `useRouter()` returned a NEW object per render → cyclonic thread GETs (11,147 GETs/8s observed) starved `waitForFunction`. Fixed with a stable `routerInstance` + `useSearchParams` identity cache, mirroring the real Next.js behaviour.
2. `server.mjs` `deferredKeys()` used `Object.keys(shim.pending)` on a `Map` (`[]` forever) → deferred release never observed. Fixed to `Array.from(pending.keys())`.
3. `server.mjs` `resolveDeferred()` resolved by `Object.keys(shim.pending)` lookups that never matched → S06 abort at the pending-drain wait. Fixed to a Map-aware key match (`key` or `key#n`).
4. Scenario routing regexes used shorthand uuid prefixes without the `?` boundary (e.g. `^/api/chat/tickets/aaaa\?limit` could never match a full-uuid URL). Fixed in S06/S07 to full-uuid patterns, with scripted queues sized against the 5s visible-refresh poll tick.
5. `page.evaluate` closures referenced Node-side helpers (`json()`, response bodies) → ReferenceError inside the browser; every deferred resolution now passes `{status, body}` through evaluate args.
6. S15 selector raciness: `button:has-text("อนุมัติ")` substring-matched the tab label «รออนุมัติ», whose click triggered a filter refetch that erased the target row before the drawer opened; the 503-uncertainty notice is transient (the conflict reload overwrites it within the same tick). S15 now scopes the row-action locator exactly and waits for durables («ไม่อยู่ในรายการล่าสุด», «ไม่มีคำขอในสถานะนี้») instead of the flash; the settled-check for row absence is scoped to list row titles (the retained draft drawer legitimately still shows the applicant). Scripted queue sized to the actual fetch count (mount + conflict reload).

## 12. GREEN progression (measured in-session, 2026-10-29 ICT — updated with each commit)

All runs on the same machine-local Edge via `run-scenarios.mjs` / `run-proofs.mjs`; per-scenario JSON + `summary.{json,md}` committed under `tests/browser/oc-inbox/artifacts/<label>/`; screenshots stored OUTSIDE the repository (D:/codex-cache/yru-ui-qa/oc-inbox-05-artifacts/<label>).

| Commit | Label | Scope | Outcome |
|---|---|---|---|
| 2 `d2c849a` | `green-c2` | lifecycle/cacheguard targets | S01 12/12 · S02 4/4 · S03 1/1 · S04 3/3 · S07 3/3 · S08 2/2 · S12 2/2; S11/S14/S15 stayed PASS; S05/S06/S09/S10/S13 intentionally RED (commit-3 scope) |
| 3 `1a6804b` | `green-c3-1` → `green-c3-2` | callback/currentauthority targets | c3-1: S05 2/2 · S06 1/1 · S09 6/6 closed; S04/S10/S13/S14 aborted mid-development and were isolated to (a) an over-strict boot-seed identity guard (app-side, fixed in this commit) and (b) the fixture supabase `removeChannel` wrapper not mirroring the real `name`/`__channel` contract (harness, fixed and cited per §11 discipline). Rerun `green-c3-2`: **15/15** — S01 12/12 · S02 4/4 · S03 1/1 · S04 3/3 · S05 2/2 · S06 1/1 · S07 3/3 · S08 2/2 · S09 6/6 · S10 3/3 · S11 1/1 · S12 2/2 · S13 4/4 · S14 2/2 · S15 9/9 |
| 4 | `green-c4` | full mounted suite at commit-4 HEAD | **15/15** (identical counts to green-c3-2) |
| 4 | `browser-proofs` | in-flow FIXTURE-labelled screenshot proofs (screenshots outside the repo; committed JSON/MD lists each file) | **9/9** — P01 trigger-capable actions pane 3/3 · P02 authority-refresh + assistant draft 2/2 · P03 mobile focus transfer 2/2 · P04 320px composer bounds 1/1 · P05 Thai 200% zoom usability 3/3 · P06 Tab/Shift+Tab cycle (no hidden stop) 3/3 · P07 reduced-motion numeric duration 1/1 · P08 approvals dialog: inert/Escape-retained-uncertain/same-requestId/409 exit 8/8 · P09 apply double-submit one-POST 2/2 |

Note: `browser-proofs` re-proves already-green behaviours with captured screenshots (commit-4 scope, plan §8 item 4: onboarding backlog mounts included); it does NOT introduce new acceptance — the acceptance set stays the RED-first scenario list of §3/§11.
