# OC-OPERATOR-06 Plan — three counterexamples, staff/onboarding UX, Incident batch reply UX, bounded evidence

Round: OC-OPERATOR-06 (16-task). Date written: 2026-10-29 (ICT). All times ICT.
Local commits only; no push/merge/rebase/reset/clean. Preserves all OC-INBOX-04/05 history (new commits on top; no prior RED evidence deleted).

## 1. Pinned baseline (verified in this session, not copied from an old report)

| Item | Value |
|---|---|
| Worktree | `D:/project-next/line-ai-yru-opencode-staff` |
| Branch | `codex/opencode-inbox-workflows` |
| Exact starting HEAD | `90db3d3b0f932a97ece0958b271a18ee47c75310` (verified via `git rev-parse HEAD`; working tree clean) |
| OC-INBOX-05 chain preserved below | `fe0c29c(plan/RED)` → `d2c849a` → `1a6804b` → `307f1fd` → `90db3d3(report)` — nothing rewrites history |
| Root repo | `D:/project-next/line-ai-yru` — read-only (docs only; no git commands in root). Root backend checkpoint cited in the report: `0968451349ed020171e7aa397e9e7271b8295011` |
| Frozen evaluator | `tests/fixtures/assistant-conversations.json` SHA256 re-measured this session = `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` (unchanged) |
| Focused vitest at pinned HEAD (before any edit) | 8 suites (`opencode-inbox-{state,read,hardening-state,chat-thread,actions}`, `incident-batch-selection`, `staff-onboarding-ui`, `staff-approval-ui`): **8 files / 99 passed / 0 failed** (4.08 s) |
| Playwright tooling | Same probe as OC-INBOX-05 (bundled library + Edge headless + owned profile); fixed in commit 1 per-scenario, not re-probed per run |
| Node/pnpm | v26.1.0 / pnpm 10.33.4; no package/lockfile touched |

## 2. Authoritative sources actually read this round

- Root prompt (root-only): `D:/project-next/line-ai-yru/docs/agents/OPENCODE_OPERATOR_COMPLETION_PROMPT.md` (OP06-01..16 table; commit split; allowlist).
- `AGENTS.md`, task board, `docs/decisions/DECISION_LOG.md` DEC-187/188 (worktree) + DEC-189/DEC-190 (root copy; staff state machine, receipts, DTO floors).
- Contracts: `types/staff-applications.ts` (frozen browser DTOs), `lib/incidents/batch-{reply,draft,confirm}-contracts.ts`, `types/inbox.ts`, `lib/chat/contracts.ts` — read-only.
- `docs/architecture/STAFF_ONBOARDING_DESIGN.md` (root): onboarding milestone acceptance; OpenCode owns the onboarding frontend corrections only.
- Production sources at HEAD: `chat-thread-ops.ts` (full), `chat-thread-state.ts`, `controller.ts`, `ticket-action-workspace.ts`, `ticket-actions.tsx`, `inbox.tsx`, `chat-thread-live.tsx`, incident `IncidentBatchReply.tsx`/`IncidentDetailView.tsx`/`presentation.ts`, staff `apply-client.tsx`/`onboarding-controller.ts`/`applications-controller.ts`/`approvals-client.tsx`.
- Harness: `tests/browser/oc-inbox/harness/{server,scenarios,run-scenarios,proofs,run-proofs}.mjs` + fixture entries.

## 3. Defect table (counterexamples verified in mounted runs at pinned HEAD; fixes RED-first)

| ID | Defect (root-observed at HEAD) | Reproduction (mounted production component) | Files (allowlisted) | Acceptance (GREEN) |
|---|---|---|---|---|
| CX1 (P1) | List-level denial does not reset the actor workspace: `requestList` 401/403/404 (`inbox.tsx:113-119`) clears only the list/selection. `useChatThreadOps` records/drafts/attempts/seeded-flags/cursors survive with no authority epoch, so re-selecting the denied ticket re-reveals the stale private record before any fresh GET confirms. | S16: load A (private content + PRIVATE draft) → list 403 → list recovers → click A with the thread GET deferred → the OLD private record + draft render immediately | `chat-thread-ops.ts`, `controller.ts`, `inbox.tsx`, `chat-thread-live.tsx` | Whole-actor authority epoch: every denial-scoped reset wipes records/drafts/attempts/queued callbacks/local cursors/seeds for the whole actor (list denial) or one ticket (thread denial) and bumps the epoch; a record may reveal only when `record.epoch === currentEpoch` AND a fresh GET confirmed after the epoch bump (ABA: A→B→A never resurrects the old snapshot) |
| CX2 (P2) | Read-ack denial closes the WRONG room: the hook passes `(status, id)` (`chat-thread-ops.ts:418/466/512`) but Inbox `onThreadAccessLost(status)` drops the ticket id and unconditionally closes the current selection (`inbox.tsx:136-141`) → B closes+loses feedback because A's ack got 403 late. | S17: A open → switch to B → resolve A's deferred read-ack with 403 → B's pane closes (RED); also A→B→A reauthorization keeps B's draft and only A is re-verified | `inbox.tsx`, `chat-thread-ops.ts` | `onThreadAccessLost(status, ticketId)`: only the matching selection closes; the denied room's own record/drafts/notes/attempts are erased in ops; the surviving room keeps drafts/messages/notice; A's read-ack after re-selection must pass a fresh authority/GET (epoch) before surfacing |
| CX3 (P2) | Stale completion surfaces in the other room + single global busy blocks a permitted room: `submitMessage` completion (`chat-thread-ops.ts:560-651`) has no (ticket,attempt) fence; global `busyRef`/`setNotice` mean A's deferred note-200 flips B's notice/busy, and `busyRef.current !== null` blocks B's composer while A's request hangs. | S18 (valid-JSON serialization — see H1): A note deferred → switch to B (B note posts fine = success path) → resolve A with valid 200 note DTO AND with 5xx body → assert B shows neither A's success nor A's error notice and B composer never disabled; A shows its outcome honestly when returned to | `chat-thread-ops.ts`, `chat-thread.tsx` | Per-room write state: `busy: Record<ticketId, DraftKind>`, per-room notices; completion applies STRICTLY to `(actorId, ticketId, attempt.requestId)` — a deferred result updates only that room's notice/busy/notes; the other room's composer stays usable at full permission; returning to A reveals A's stored outcome (honest success or honest uncertain) |
| H1 (harness defect, independent max review) | `server.mjs` fetch-shim `respondWith`/`resolveDeferred` stringifies object bodies with `String(body)` → `{"id":"note-a-1",…}` became `[object Object]`; JSON parse failed, so S11 "passed" for the wrong reason and never exercised the real 200-success path. | Harness-only defect; proven by fixing the shim and re-running S11 at HEAD: S11 then exposes the REAL CX3 leak (A's success notice lands in B) | `tests/browser/oc-inbox/harness/server.mjs` | Deferred/respond object bodies serialize via `JSON.stringify(...)` (the note DTO stays `{"id":"note-a-1",…}`; no DTO loosening); S11's old "pass" is superseded by S18's honest both-path assertions + a dated erratum in the OC-INBOX-05 docs |
| RX1 (regression) | Lifecycle action 401/403/404 clears the attempt without any current-thread revalidation; permissions/revision may be stale | Mounted/lifecycle unit: accept → 403 (deferred) → attempt must be released AND the current ticket must be revalidated (fresh GET) so stale permission/revision never lingers | `chat-thread-ops.ts`, `ticket-actions.tsx`, `controller.ts` | Access-losing lifecycle denial: release attempt by matching requestId, erase affected room per CX2 scope, force current revalidation; non-denial 4xx/409 keep draft semantics per OC-INBOX-05 |
| RX2 (regression) | Action/completion clears attempts by key alone — a late OLD response (or the round's exact case) can clear a NEWER attempt's state even when `requestId`s differ (both attempts occupy `(actorId,ticketId,action)` space while the newer request is in flight) | Workspace unit: register attempt1 → deferred completion(409) → (retry after uncertain registers attempt2 with new requestId) → resolve attempt1 FIRST → the newer attempt must survive if its requestId differs; completion with the SAME requestId clears idempotently | `ticket-action-workspace.ts`, `chat-thread-ops.ts` | Every clear carries the owning `requestId`: `clearActionAttempt(…, {requestId})` deletes only when the stored attempt's requestId matches (or wipe when actor/authority reset); note/reply clears identical |
| RX3 (regression) | Read-ack completion merges into the closure-captured `known` cursor (`chat-thread-ops.ts:402`) instead of the CURRENT record at completion time; interleaved windows/local acks can make non-monotone writes | Mounted read unit: ack response resolves AFTER the record moved forward (newer readThroughSequence) → completion must merge with the CURRENT cursor, monotone, never regress; server cursor overshoot beyond latestSequence may not be claimed | `chat-thread-ops.ts`, `chat-thread-state.ts` | At completion: re-read `recordsRef` current record, cap serverCursor at the record's latestSequence, `acknowledgeCursor` max-merge with `readLocalRef` AND `current.result.readThroughSequence`; monotone asserted |
| RX4 (regression) | Read-ack contiguity: the visible tail may span a gap the client has not fetched (seq 1–50 unloaded window with read cursor below it); acking the rendered latest claims unread sequences as read | Read unit/variant of S14: rendered tail `seqFrom=51..60`, cursor 0 → ack must hold (throughSequence only up to the contiguous frontier actually loaded) or fill the gap first — never claim 60 while 1–50 unloaded | `chat-thread-state.ts`, `chat-thread-ops.ts` | Ack target = contiguous frontier from `cursor+1` upward within rendered sequences; on a gap beyond the loaded frontier: hold cursor (no over-claim) and let catch-up load the gap; contract test pins the rule |

## 4. This round's also-in-scope work (OP06-11..15)

| # | Task | Where this round |
|---|---|---|
| OP06-10 | Bounded harness/evidence | Per-scenario caps: max requests captured (default 400), max body bytes per request (32 KiB), max console entries (200) with overflow → scenario fails with an explicit `CAPPED` summary; deferred-map/server/browser always closed in `finally`; the OLD oversized raw traces stay on disk untouched and are now indexed by SHA in this plan (§5) instead of being silently deleted |
| OP06-11 | Staff onboarding real-contract UX | Corrections under `app/staff/**` + fixture scenarios (S16+ onboarding): unconfigured login → truthful unavailability (no fake OAuth); anonymous→login; unlinked→link line; pending→recorded view; approved→already-staff dashboard route; rejected/suspended fixed copy (no auto-reapply in V1); inactive-legacy error stays generic ("ระบบไม่พร้อมใช้งาน" per design); no fake applications; DTO untouched |
| OP06-12 | Approval uncertain/access-loss paths | Existing already covers requestId/body/409/drawer; NEW corrections: revoked reviewer (401/403 on list/decision) clears the private list snapshot + drawer + drafts; pending-dialog dismissal during uncertain keeps the retained request; decision POST body immutable (already asserted) |
| OP06-13 | Incident recipient selection | Correctness regressions under `IncidentBatchReply.tsx`: selection caps at 100, per-person eligible toggles, late-arriving cases never auto-added to the CURRENT batch or the reviewed preview, REAL case/recipient counts on screen, eligibility tiers rendered from the contract, fixture-labelled |
| OP06-14 | Batch review/partial delivery UX | Under `IncidentBatchReply.tsx` + `presentation.ts` additions: review shows the preview message/recipient snapshot before confirm; expiry/409 forces fresh review; QUEUED is never labeled SENT; partial/UNKNOWN/DEAD statuses show per-recipient truth with server-permitted retry only (no self-minted batch/requestId); retry reuses stored requestId/body snapshots |
| OP06-15 | Mounted browser/a11y matrix | New mounted scenarios for CX1–CX3 + actor reset + concurrent writes (A pending, B usable) + current onboarding + incident bulk; viewports 1440×900/390×844/320×844, keyboard/focus/dialog checks, 200% Thai zoom, reduced motion where CSS applies; `FIXTURE` labels everywhere (never images-over-behavior) |

## 5. Bounded-evidence ledger (OP06-10)

Old oversized OC-INBOX-05 raw artifacts stay on disk (no deletion); they are now indexed:

| File | Bytes | SHA256 |
|---|---|---|
| `artifacts/red/S02-invalid-success-200.json` | 7,101,528 | `2813D99E1CDBF9867024AF4FDCA88D2D2D98AC0A505596C7C0CF34D7A1D8628C` |
| `artifacts/red-s01/summary.json` | 2,665,231 | `C56BFECE9C7710A2FE5EDC5A0C4D3742B55C8038A0240FABD7D8BE54F1E251CD` |
| `artifacts/red-s01/S01-cross-case-lifecycle-retry.json` | 2,324,695 | `4587AF0394B07658AFA35C4146ED54C3D600CE4D3FB5D8BB7A245BDCAF8E3596` |
| `artifacts/red/S01-cross-case-lifecycle-retry.json` | 1,824,137 | `15DB7327703FC9396566AF422C7C1AD7D0079A5E18E867B9DF22430F1CE85DBE` |

From this round on: the runner keeps per-scenario requests at the caps above and emits small representative transcripts + counts; overflow is surfaced as `CAPPED` in the summary instead of growing multi-MB JSON. No commit in this round adds traces of that size.

## 6. Mounted harness extensions (reuse, no new tooling)

- New scenarios S16–S18 appended to `tests/browser/oc-inbox/harness/scenarios.mjs`, driving the SAME fixture project (server.mjs compiles real sources; same synthetic adapters). S18 additionally runs the harness-fix probe (H1) so the shim defect is proven, then asserts the app's real defect on both response paths.
- S16: list-denial whole-actor resurrection; S17: read-ack cross-room closure incl. A→B→A reauthorization; S18: stale note cross-room surfacing (valid 200 + 5xx) + B-not-blocked assertion.
- Onboarding/Incident scenarios (S19+) mount `apply-client`/approvals and `IncidentBatchReply` with the server contracts mirrored by the fixture — no real LINE/OAuth/LINE/provider calls; fixture pages self-identify the word `FIXTURE`.
- Existing S01–S15 stay as-is (frozen evidence; no scenario rewrites of history) — S11 keeps its old transcript and gets a dated erratum pointing at S18.

## 7. New vitest suites this round

- `tests/opencode-operator-authority.test.ts`: workspace epoch semantics (record reveal gate, whole-actor vs ticket-scope resets, curve of stale responses writer gating), workspace requestId-guard clears (RX2), ackCursor contiguity cap (RX4) + monotone merge (RX3), list-URL guards already pinned stay green.
- Mounted runner covers the rest (S16–S19…). Focused suites run per commit; full gates at the end.

## 8. Gates (measured per commit, exact exit codes reported; no reuse of old numbers)

`pnpm typecheck` · `pnpm lint` · `pnpm exec vitest run --maxWorkers=1 --testTimeout=20000` · `git diff --check` · `node scripts/security/check-staged.mjs` per commit · mounted runner per scenario · frozen-evaluator SHA unchanged. `pnpm build` stays BLOCKED (worktree junction → Turbopack panic; documented ROOT_DEPENDENCY in OC-INBOX-04/05 reports — Root builds the final branch).

## 9. Status labels used in the report

`IMPLEMENTED` (code changed; helper/unit proof) · `COMPONENT_PASS` (production component under the fixture browser) · `FIXTURE_PASS` (fixture-only behavior) · `NOT_RUN` (real LINE/OAuth/hosted provider/Realtime/live OA) · `ROOT_DEPENDENCY` (build/backend acceptance). NOT_RUN and ROOT_DEPENDENCY are never presented as passes; V1-complete is never claimed.

## 10. Commit plan (local only)

1. `plan+RED` — this plan + harness serialization fix + S16–S18 + RED run at pinned HEAD (RED transcript committed before any app fix).
2. `authority/cache` — whole-actor epoch + resets (CX1), pagination/dup-param regressions if touched, RX3/RX4 cursor fixes, guard-clears (RX2 early), URL/list follow-ons.
3. `async/realtime` — per-room busy/notice + completion fences (CX3), ticketId-aware callback (CX2), RX1 revalidation, realtime lanes/both-route assertions.
4. `onboarding/incident` — OP06-11..14 corrections + mounted scenarios S19+ (approvals/onboarding already at S15) + incident scenarios.
5. `boundedproofs+report` — GREEN full scenario matrix at final HEAD + caps ledger + `docs/ui/OC_OPERATOR_06_COVERAGE.md`, `docs/reports/OPENCODE_OPERATOR_COMPLETION_REPORT.md`, dated errata in OC-INBOX-05 docs.

## 11. RED-first evidence (measured at pinned HEAD `90db3d3`, before any fix of this round — 2026-10-29 ICT)

Runs (harness fix + S16–S18 in place, NO app-source edit yet):
`label=red-op06e` (S16/S17/S18/S11) and `label=head-regression-op06` (full S01–S18). Artifacts: `tests/browser/oc-inbox/artifacts/{red-op06e,head-regression-op06}/` (small representative transcripts under the new caps — largest artifact 12 260 bytes; earlier probe labels `red-op06`..`red-op06d` are kept as the debugging transcript, each also under the caps).

| Scenario | Result at HEAD | Signature |
|---|---|---|
| S16 list-denial resurrection | FAIL 3/7 (aborts none; checks 3,4,5,7 FAIL) | While the fresh GET `/aaaa` is still deferred: `สังเคราะห์` messages 3 visible, notes panel present, `#chat-reply` = `PRIVATE_DRAFT_A`; and after recovery+fresh 200 the draft is still restored (whole-actor reset missing) — CX1 |
| S17 read-ack cross-room closure | FAIL 4/6 (checks 2,3 FAIL) | Resolving `read-a#1` with 403 while B is open closed B's pane (messages gone) and lost B's own draft `PRIVATE_DRAFT_B` — the callback had no ticketId — CX2 |
| S18 stale note cross-room (valid JSON, both paths) | FAIL 3/8 (checks 1,2,3,4,7 FAIL) | B's composer disabled while A's note hangs (global busy, no B POST, no B notice); A's valid 200-note answer (`note-a-1`) flipped B's notice; A's 5xx answer flipped B's notice — CX3 on BOTH paths |
| S11 re-run after harness fix (H1) | FAIL 0/1 | With object bodies serialized as real HTTP JSON, A's deferred valid note answer surfaced its success notice in B — the old S11 "PASS" (0/1 then abort) was produced by `[object Object]` and never exercised this path; dated erratum in the OC-INBOX-05 docs required |
| S01–S10, S12–S15 (frozen evidence) | OK 14/15 of full run | Unchanged behavior with the modified shim (caps + serialization) — no regressions introduced by the harness fix |

RED conclusion: the three counterexamples reproduce on the mounted production components exactly as reported; fixes now proceed RED-first per commit (commits 2–5 flip S16–S18 to OK without weakening S01–S15).

## 12. Explicit non-goals

- No backend/lib/types/API/DB/auth/media implementation; no package/lockfile/next.config edits; no `.env`/credential reads; no real LINE/OAuth/provider/Hermes calls; ports 3000/3012 untouched; no AI/copilot/knowledge-panel implementation (allowlist keeps them out).
- Contract changes remain PROPOSED-only where the pending root addendum item stands (same as OC-INBOX-05): fixture evidence that still requires server capability is labeled NOT_RUN/ROOT_DEPENDENCY, not implemented client-side.
- V1 completeness is decided by Root after Flow A–F; this round neither asserts nor denies it.
