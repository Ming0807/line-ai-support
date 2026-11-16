# OC-OPERATOR-07 — Root review and squash merge (16 November 2026)

Scope: `codex/opencode-inbox-workflows` @ `17d4d50` (three commits after `851625a`: `4fbb867` RED, `338aac3` fix, `17d4d50` docs). Root merged only the source/tests/docs diff `d51e732..17d4d50` (43 files, artifacts excluded) into `feat/yru-v1-final-polish` as one squashed change, and added `tests/browser/oc-inbox/artifacts/` to `.gitignore`. The OC-07 range itself contains no artifact files. No artifact history was imported. Decision: [DEC-199](../decisions/DECISION_LOG.md).

## Item-by-item check (Root, against the [OC-07 prompt](../agents/OPENCODE_OPERATOR_FOLLOWUP_07_PROMPT.md))

| Item | Root finding |
| --- | --- |
| P2 sparse read-ack | `contiguousReadTarget` now treats a hole as covered only when one proven empty span covers it completely. `hasMore:false` proves `[1..oldest-1]`, a history response proves `(highest, beforeSequence)`, an empty `hasMore:false` history proves `[1..cursor-1]`, and the existing catch-up empties are kept. With `hasMore:true` and older history unloaded, nothing is acknowledged. The read effect also refuses any `throughSequence` that is not a loaded message sequence. |
| P3-1 401 | `handleThreadAccessDenial` calls `revokeActorAuthority` for 401 from thread GET, history, catch-up, read-ack, refresh event and lifecycle completion, and the Inbox owner immediately clears the list and selection. 403/404 remain room-scoped. |
| P3-2 stale read 403 | The read POST captures `authorityEpochRef` when sent and drops both the failure and the success if the epoch changed. |
| P3-3 S16 | Phase 5 adds Root's original repro (B selected when the list returns 403, GET A deferred). The original S16 phases are unchanged. |
| P3-4 S17/S18 | `waitForCommitBarrier` (timer, two animation frames, timer) runs before the DOM is sampled. S18 now also checks B's URL. The barrier is time-based, not a store-commit signal. |
| P3-5 erratum | Dated erratum added to the harness README and the OC-06 report; earlier text is kept. |

## Root-executed evidence

- Root probe with the merged functions (data 5/9/12, cursor 0, `hasMore:false`): spans `[{5,12}]`, empties `[{1,4}]`, `firstCatchUpBefore:null`, target **12** (OC-06 rule: 0). Hold cases: `hasMore:true` → 0; cursor 3 below a `hasMore:true` window → 3; cursor inside a span → span end.
- Mounted matrix on the merged tree, label `root-oc07-merge`, artifacts in `D:/codex-cache/yru-ui-qa/oc07/artifacts` (outside the repository): **27/27 OK** (S01–S24 plus new S25–S27), exit 0. Log SHA256 `88f56ce8…59fb745`.
- Causal RED: with only the three OC-07 source files reverted to `851625a`, S25 1/6, S26 0/5 and S27 1/4 fail. S16 (including the new phase 5), S17 and S18 pass on the old source too: they are regression pins, because OC-06 had already fixed those counterexamples. They are not new RED.
- Typecheck PASS, full lint PASS (0 errors, 4 warnings), default build PASS with `HERMES_RUNTIME_TRACE_CHECK_PASSED` (the known Hermes scan warning remains), `git diff --cached --check` PASS, staged credential scan PASS, frozen evaluator fixture SHA256 `e79ade32…e801f3` unchanged.
- Full unit (single worker, 20 s test timeout): 3844 passed / 2 failed in 297 files. The only failures are the two known `tests/auth-bootstrap.test.ts` cases, which fail the same way on clean HEAD because sandbox temp files inherit extra ACEs (environment, not a regression).

## Environment notes

- The first build attempt died in Turbopack with a native memory allocation failure (exit 3221226505) and passed on retry with about 4.5 GB free. This is not a code result.
- The first typecheck failed only in the generated, git-ignored `.next/dev/types/routes.d.ts` (two writes had interleaved on 15 November 22:53). Root moved that folder to `D:/codex-cache/yru-ui-qa/oc07/corrupt-next-dev-types/` instead of deleting it. The build regenerated the types, and typecheck then passed.

## Remaining limits

The fixture harness uses scripted adapters, not the real backend. There is no real LINE, OAuth, Realtime or authenticated Staff browser evidence, and no Flow A–F evidence. A ticket with more than 50 unread messages is acknowledged only after the Staff member loads the older history. This follows the "never acknowledge unloaded history" rule and is a known UX limit, not a defect.
