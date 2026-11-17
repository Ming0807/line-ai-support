# OC-INBOX-04/05 and OC-OPERATOR-06/07: superseded by the DEC-199 merge (17 November 2026)

Scope: the owner approved continuing the two OpenCode sets still marked **REVIEW CHANGES REQUESTED / NOT MERGED** on the task board (17 November 2026). The task was to port and fix them only if later work had not already replaced them. Base checked: `feat/yru-v1-final-polish` @ `f740777`. Result: **both sets are already merged with their blocking findings fixed. Nothing was ported.** Only the two stale task-board rows are corrected.

## Where the sets actually are

| Set | Commit(s) | Branch that holds them |
| --- | --- | --- |
| OC-INBOX-04 | `1b0a214..87257b5` on baseline `d51e732` | `codex/opencode-inbox-workflows` |
| OC-INBOX-05 (16-task hardening) | `fe0c29c..90db3d3` | same |
| OC-OPERATOR-06 | `b9019b9..851625a` | same (`git branch --contains 851625a` lists only this branch) |
| OC-OPERATOR-07 | `4fbb867..17d4d50` | same |

The brief also mentioned `codex/opencode-operator-workflows`. That branch holds a different, older set, OC-UI-02 Activities/Logs (`458c76f`, [OC-UI-02R review](OPENCODE_OPERATOR_WORKFLOWS_ROOT_REVIEW.md)). Root integrated it on 8 October in `c7b3686`. Every one of its `app/` files exists on HEAD, either unchanged or changed since by later Root work. It is not an open set.

## Evidence that the sets are superseded

1. `3e5f7b6` ("merge OC-OPERATOR-07 Inbox workflow fixes (DEC-199)") is an ancestor of `f740777`. Its message records a squash of `codex/opencode-inbox-workflows` `d51e732..17d4d50`. That range contains all four sets above, because each set was built on the previous one.
2. `git diff --name-only d51e732 17d4d50` gives 43 non-artifact files, and `git diff 17d4d50 3e5f7b6` on those 43 files is **empty**. The squash is byte-identical to the branch tip. The 329 artifact files were deliberately excluded and are gitignored (DEC-199).
3. Since `3e5f7b6`, six of those files changed, all additively for OC-INBOX-ATTACH-08 / CHAT-MEDIA-02H (`chat-thread-ops.ts`, `chat-thread.tsx`, `inbox.tsx`, `chat-thread-live.tsx`, harness `scenarios.mjs`/`server.mjs`). The guard code below is still present.

## Blocking findings: where each fix lives on HEAD

| Finding | Fix on HEAD | Mounted proof (this run) |
| --- | --- | --- |
| P1 OC-04: lifecycle retry can cross ticket endpoints | `ticket-action-workspace.ts`: write-once attempt keyed by (actorId, ticketId, action), and a retry re-posts the original endpoint, body, requestId and revision | S01 cross-case lifecycle retry 12/12 |
| P1 OC-04: denied reads retain private snapshots | `chat-thread-ops.ts` `eraseTicketOwner` on 401/403/404 for list, thread, history and catch-up; 401 also calls `revokeActorAuthority` | S03 1/1, S04 3/3, S16 13/13, S26 5/5 |
| OC-04 callback fences | `ThreadRequestFence` (`inbox/controller.ts`) plus `fence.accepts` guards | S06 1/1, S11 1/1, S18 10/10 |
| OC-04 uncertain success / stale detail authority / AI revision | strict DTO parsers in `chat-thread-state.ts`; `chat-thread-live.tsx` owns the detail authority | S02 4/4, S05 2/2, S10 3/3 |
| OC-04 pagination/query, mobile focus | URL recovery helpers; focus transfer | S07 3/3, S08 2/2, S09 6/6 |
| P2 OC-06: read-ack assumed per-ticket sequences starting at 1, but `message_seq` is global | `contiguousReadTarget` counts a gap only when a server response proves it empty; `throughSequence` must be a loaded sequence | S25 sparse sequences 6/6 (Root's 5/9/12 probe, see the [OC-07 merge review](OC_OPERATOR_07_ROOT_MERGE_REVIEW.md)) |
| P3 OC-06: 401 whole-actor reset, stale-epoch read 403 | `revokeActorAuthority`; `authorityEpochRef` captured on the read POST | S26 5/5, S27 4/4 |

## Commands run on `f740777` (17 November 2026, this session)

- `pnpm exec vitest run tests/opencode-inbox-*.test.ts(x) tests/opencode-operator-authority.test.ts tests/incident-batch-selection.test.ts tests/staff-onboarding-ui.test.ts`: **10 files, 108/108 PASS**.
- `node tests/browser/oc-inbox/harness/run-scenarios.mjs --label=oc-review-fixes-20261117`, with `OC_INBOX_ARTIFACTS_DIR` and `OC_INBOX_SCREENSHOT_DIR` set outside the repository (`D:/codex-cache/yru-ui-qa/oc-review-fixes-20261117`): **35 OK / 0 FAIL** (S01–S35), exit 0. The working tree stayed clean.
- `pnpm typecheck`: PASS. `pnpm lint`: PASS (0 errors, 4 existing harness warnings).
- Owned PostgreSQL suites: **not applicable**. The sets touch only `app/(dashboard)` client components, staff onboarding UI and tests. There are no `lib/`, `app/api/`, `supabase/` or DB changes, so no owned database was created.
- `pnpm build` was not rerun. It was last passed on the merged tree in DEC-199, and these sets have no source change since then.

## Not done, and why

- **No port and no new branch code.** Porting would reapply code that is already on the base. The original `codex/*` branches are unchanged.
- No live LINE, OAuth, Realtime or authenticated Staff browser evidence. The mounted matrix uses scripted same-contract adapters. Flow A–F remains open as listed on the task board.
- The accepted limit from DEC-199 stands: a ticket with more than 50 unread messages is acknowledged only after older history is loaded.

Review provenance: Root-side session (Claude Opus 5.5) acting on the owner's 17 November approval. No delegate or reviewer agent was used. Root reviews and merges this docs branch.
