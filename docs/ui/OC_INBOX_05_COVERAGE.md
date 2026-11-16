# OC-INBOX-05 Coverage — operator workspace hardening (16-task board, RED-first)

Round: OC-INBOX-05 (hardening) · Date: 2026-10-29 (ICT) · Worktree
`D:/project-next/line-ai-yru-opencode-staff` · branch `codex/opencode-inbox-workflows`
· pinned baseline `87257b53548b04ebcc902346199d5a476f1df0bc` (OC-INBOX-04 final HEAD).
All work local commits; nothing pushed. RED measured at pinned HEAD BEFORE any fix
(label `red-final`: 12 scenarios RED, 3 already-fixed regression-proof PASS).

Status labels (plan §8 — nothing else may be read as "passed"):

- `FIXED` — code changed this round + mounted/vitest proof attached.
- `PRODUCTION_PATH_PASS` — the REAL production path exercised inside the fixture
  (fixture compiles the real sources via repo TypeScript with synthetic same-contract
  adapters; no production module modified).
- `FIXTURE_BROWSER_PASS` — fixture-only browser interaction, NOT a live-server claim.
- `NOT_RUN` — could not be exercised in this round; reason stated. Never a pass.
- `ROOT_DEPENDENCY` — blocked by a root-owned item. Never a pass.

## Commit chain (newest last; local only)

| Commit | Scope | Mounted label + outcome |
|---|---|---|
| `fe0c29c9612282448d6153065b0fb6a2e90b9a9a` (commit 1, plan/RED) | plan + mounted harness + RED transcript at pinned HEAD | `red-final` 12 RED / 3 regression-proof PASS (plan §11 Full) |
| `d2c849ad81bfb0e7af249948bfe0e8c2fddba32c` (commit 2, lifecycle/cacheguard) | D1/D3/D9/D2/D10/D6 + task-4 guards (ticket-actions + apply-client) | `green-c2`: targeted scenarios green; S05/S06/S09/S10/S13 intentionally still RED |
| `1a6804ba3a809bdffac266fe0ca62310b37ab4e2` (commit 3, callback/currentauthority) | D4/D5/D7/D8 + history precedence + actor cleanup | `green-c3-1` (11 OK/4 abort ⇒ two defects isolated, see §12 of the plan) → `green-c3-2` **15/15** |
| `307f1fd48faaae7a6788c9fefbc156a6cac63145` (commit 4, browser/regressions) | GREEN runs + in-flow FIXTURE screenshots + onboarding backlogs | `green-c4` **15/15** + `browser-proofs` **9/9** (17 screenshots OUTSIDE the repo) |
| This docs commit (report) | coverage + hardening report + dated errata in OC-INBOX-04 docs | — |

## 16-task board (execution order per plan §4)

| # | Task | Status | Evidence + caveats |
|---|------|--------|--------------------|
| 1 | Inventory + plan | FIXED | `docs/ui/OC_INBOX_05_PLAN.md` (commit 1). Pinned baseline + frozen evaluator SHA re-measured in-session; RED transcript committed before any fix. |
| 2 | Immutable lifecycle authority | FIXED | `ticket-action-workspace.ts`: write-once attempt keyed (actorId,ticketId,action); retry posts original endpoint/body/requestId/revision only. Mounted S01 12/12 (A→B→A never hands A's body to B). |
| 3 | Uncertain-action UX | FIXED | S02 4/4: invalid-shape 200 keeps the attempt ("กำลังตรวจคำขอเดิม"), no auto-resend; retry buttons not keyed on Thai prefixes. |
| 4 | Synchronous submit guard | FIXED | Same-tick double click → one POST/one requestId: ticket-actions guard (commit 2) + apply-client guard (`app/staff/apply/apply-client.tsx`, commit 2). S12 2/2 + proof P09 2/2 (screenshots outside repo). |
| 5 | Actual response validation | FIXED | `parseReplyResult`/`parseActionResult`/`parseChatNote` in `chat-thread-state.ts`, workspace delegates (D3/D9); S02 4/4; unknown-shape 200 keeps attempt + draft. |
| 6 | Access-loss erasure | FIXED | `eraseTicketOwner` owner-side (record/seed/read cursor/pending writes/drafts/attempts) on 401/403/404 for list and thread paths incl. history/catch-up; 409/network keep state. S03 1/1 + S04 3/3. |
| 7 | All callback epochs | FIXED | `ThreadRequestFence.begin(actorId,id)` + `fence.accepts(token)`/`activeRef` guards on history/catch-up; per-room busy state (honest `historyBusy` set). S06 1/1. Submit concurrency is serialized by the write-once attempt workspace (per-attempt, same-tick guard) — not by an additional per-request fence; cross-room stale history writes are impossible by fence/ownership (S06). |
| 8 | One current detail authority | FIXED | `chat-thread-live.tsx` bridge owns conversation section + live record + TicketActions; `page.tsx` no SSR-prop shadowing; applyWindow revision-epoch authority; assistant onDraft binds live record revision. S05 2/2 (boot-seed swallowing fixed inside this same commit — see plan §12). |
| 9 | Realtime/reconnect both routes | FIXED | `useStaffInvalidateSupervisor` in `chat-thread-ops.ts` — one private `staff:<actorId>:inbox` subscription, payload-less `invalidate` marker → refetch, `installVisibleRefresh(document, window, trigger, 5000)`, cleanup removes exactly its own channel. Inbox and detail route share the hook. S10 3/3 (subscribe + private config + refetch + removed() records the true name). |
| 10 | Query/deep link | FIXED | Duplicate-key conflicting values dropped with note (identical repeats collapsed once); malformed ticket never fetched; out-of-range page (total>0) → explicit state + one-click `page=1` recovery. S07 3/3 + S08 2/2. |
| 11 | Transcript coverage/read | FIXED | `mergeThreadWindow` source-conditional precedence (previous copy wins on history/catch-up id repeats; incoming wins on refresh) + unit pins; S13 4/4. Read ack through rendered tail: S14 2/2 (`throughSequence===10`). |
| 12 | Actor/session cleanup | FIXED | Actor-scoped stores everywhere (workspace attempts, drafts via draftKey(actorId,…), supervisor channel per actor); unmount/single-cleanup path proven (S10 `removed()`). Logouts keep working without per-room leaks; no cross-actor residue observed in mounted runs. |
| 13 | Mobile/keyboard | FIXED | D7 focus transfer single-effect previousActiveIdRef; S09 6/6 at 390×844 (row→pane→back, never in display:none, reduced motion numeric). Commit-4 proofs: P03 (390 focus transfer) 2/2, P04 (320 composer bounds) 1/1, P05 (Thai 200% zoom usable + no >2px overflow + focus intact) 3/3, P06 (Tab×9/Shift+Tab×9 — every stop connected/displayed, reaches composer) 3/3, P07 (reduced motion) 1/1. Screenshots outside repo. |
| 14 | Mounted regression harness | FIXED | `tests/browser/oc-inbox/**` committed: fixture server (real sources compiled by repo TS into browser ESM), 15 scenarios, runners. RED `red-final` at pinned HEAD preserved untouched; final `green-c4` 15/15. |
| 15 | Onboarding/browser backlog | PRODUCTION_PATH_PASS (+ NOT_RUN parts) | Same harness mounts `apply-client`, approvals drawer (approvals-entry), S15 9/9 + P08 8/8 (dialog focus cycle/inert, close disabled while pending, Escape retained, uncertain same requestId + immutable payload, 409 exits filtered list, snapshots cleared) and S12/P09 apply form. NOT_RUN: real backend endpoints (staff onboarding API still PROPOSED, root-owned), OAuth, money flows — never claimed as passes. |
| 16 | Gates/report | FIXED | Gates re-measured per commit with real exit codes (see report); fixture JSON SHA256 unchanged `E79ADE32…801F3` throughout; this file + hardening report + dated errata. |

## Still open (explicit — none of these is a pass)

1. `pnpm build` (Turbopack) — ROOT_DEPENDENCY: worktree junction panic (same as OC-INBOX-04),
   documented in plan §7; root must build the branch.
2. Live-server flows (auth-gated `/inbox`, `/tickets/[id]`) — NOT_RUN this round: the mounted
   harness intentionally replaces `next dev` with its own compile pipeline; the prior
   FIXTURE_PASS live walkthrough remains OC-INBOX-04 evidence, not superseded by this round.
3. Real provider/LINE/OAuth/real Supabase backend traffic, money flows — NOT_RUN by design
   (synthetic same-contract adapters only).
4. PROPOSED root items carried from OC-INBOX-04 unchanged (staff onboarding endpoints
   `GET /api/staff/onboarding`, `POST /api/staff/applications`; root-authored interactive QA;
   root-side build/route audit).

"Missing live evidence is not a pass" - every NOT_RUN/ROOT_DEPENDENCY above stays listed; the
V1 overall completion status is NOT claimed by this round (component-level + mounted-fixture
evidence only).

## Dated errata for this board (2026-10-30, OC-OPERATOR-06 round)

1. **S11's original PASS on this board is superseded.** The OC-INBOX-05 mounted-harness
   serialization defect (object bodies became `[object Object]`) invalidated S11's old
   200-path result. After the shim fix (OC-OPERATOR-06 commit
   `b9019b99c36d271dfea1c2902e64c25ca0f0c41f`, H1), S11's real re-run reproduced the
   actual leak (label `red-op06e`: 0/1), and the honest both-path proof now lives in
   S18 (`op06-c3-targets` 8/8 within OC-OPERATOR-06 commit
   `e00e03c5f02bbd3074db2f425766002798036c45`). S11's own post-fix rerun stayed green
   (`op06-c3-targets` 1/1). No scenario of this board was rewritten; old artifacts remain.
2. **Unbounded raw artifact sizes** referenced by this board are superseded by the
   per-scenario caps (requests 250 / body 16384 / console 120) introduced in the same
   commit; this round's committed artifacts are all small representative transcripts
   (`tests/browser/oc-inbox/artifacts/op06-*`). The old oversized files stay on disk
   only (sizes/SHAs indexed in `docs/ui/OC_OPERATOR_06_PLAN.md` §5) and are NOT re-added
   to the branch.
3. **Frozen-scenario semantics** of this board (S01-S15) are unchanged by OC-OPERATOR-06
   fixes; every one still runs green on the round's final matrix (`op06-c4` 24/24), so
   no behavioral erratum is needed — this entry documents that verification explicitly.
