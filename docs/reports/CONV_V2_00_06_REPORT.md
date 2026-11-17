# CONV-V2-00 / CONV-V2-06 — real Gemini comparison, round r1

17 November 2026, Root (DEC-195, DEC-212). Owner approval for the model budget, 17 November 2026: "ฉันอนุมัติทั้งหมด งานไหนที่คุณทำแทนฉันได้เริ่มเลย" (at most 180 inference calls per comparison round).

**Status: BLOCKED — intermittent Gemini HTTP 503. Round r1 stopped after 3 inference calls and round r2 after 3 (6 of the approved 180 used).** No quality, latency or verdict result exists for either flow. The current flow stays the default, and `YRU_CONVERSATION_FLOW_V2` stays off.

## What ran

| Item | Value |
|---|---|
| Model | `gemini-3.5-flash-lite`, the only enabled generation model in hosted development (read-only registry read), COMPATIBLE adapter, FREE_ONLY, 25 s timeout |
| FREE_ONLY attestation | Valid until `2026-12-15T14:02:54Z` (renewed 15 November). Re-read before every inference request; not renewed or changed |
| Fixture | Frozen 30 cases, `tests/fixtures/assistant-conversations.json` SHA-256 `e79ade32…01f3`; same per-case context modes as main6 |
| Database | One disposable database per case, `scripts/database/run-owned-test.ts --seed --structured-name` (58 migrations), dropped after each case with cleanup PASS. No writes to the container `postgres` database or hosted development |
| Baseline flow | Production options of `scripts/ai-worker.ts`: `assistantEnabled:true`, V2 off. (main6 used candidate options `scopeFirst`/`scopedSinglePass`/`ragCoverage`, so its 29/30 is not this baseline) |
| Candidate flow | Same, plus `conversationFlowV2:true` |
| LINE | Controlled transport only; no real LINE request |

## Result of round r1 (baseline flow, fixture order)

| Case | Outcome | Inference calls | Notes |
|---|---|---|---|
| A01 "สวัสดีครับ" | Completed | 0 | Fixed greeting reply (DEC-206), no model call |
| A02 | Not started | 0 | The read-only hosted registry read failed twice with `ECONNRESET` before any provider request. Eligible for one rerun under the rule below; not rerun |
| A03 | Provider error | 1 | Decision call: HTTP **503** after 23.6 s → fixed failure text delivered |
| A04 | Provider error | 1 | HTTP **503** after 14.5 s → fixed failure text |
| A05 | Provider error | 1 | HTTP **503** after 16.7 s → fixed failure text |
| A06 | Stopped by Root | 0 | Process ended before its first provider request; its disposable database was dropped |
| A07–B10 | NOT_RUN | 0 | |
| V2 flow (30 cases) | NOT_RUN | 0 | |

**Exact counts:** ledger `r1` = 3 used of 180, 0 refused, all 3 in the baseline flow. All 3 were HTTP 503 (`SERVER_ERROR` in `ai_model_observations`), 3/3 calls failed. One extra smoke case (A01, ledger `smoke`, cap 1) made 0 calls. Total Gemini requests in this task: **3**.

The hosted registry shows successful calls for this model on 15–16 November (6 and 31 HTTP 200, no errors), so this looks like a provider-side outage or overload today, not a key or quota problem. There was no 429 and no 400/401/403. The harness does not keep the provider error body, so the cause is not confirmed.

Because 3 of 3 calls returned 503, Root stopped the round at the 3rd failure instead of spending the budget on fixed failure replies. Following the owner's rule, no case that reached the model was re-run. The harness now stops the round on the first provider 5xx, timeout or network error (`PROVIDER_ERROR_NO_RETRY`).

## Round r2 (17 November 2026, resumed at the parent session's request)

r2 had its own ledger with a cap of **177**, so r1 and r2 together stay within the one approved 180-call budget. Nothing from r1 was pooled into it. The baseline flow ran in fixture order.

| Case | Outcome | Inference calls | Notes |
|---|---|---|---|
| A01 | Not started | 0 | Hosted registry read `ECONNRESET` before any provider request |
| A02 | Completed | 1 | HTTP 200 in 7.1 s; correct 18×7 method; pipeline 7.4 s, end-to-end 10.0 s |
| A03 | Completed | 1 | HTTP 200 in 7.3 s; correct 800 − 15% = 680; pipeline 7.6 s, end-to-end 10.3 s |
| A04 | Provider error | 1 | HTTP **503** after 15.7 s → fixed failure text; the round stopped (`PROVIDER_ERROR_NO_RETRY`) |
| A05–B10, V2 | NOT_RUN | 0 | |

**Exact counts:** r2 ledger = 3 used of 177, 0 refused. Gemini requests across the whole task: **6** (r1 3, r2 3). 4 of the 6 were HTTP 503 and 2 were HTTP 200. Both read-only hosted-registry resets (r1 A02, r2 A01) happened before any provider request. All disposable databases were dropped, and local E5 was stopped again.

Gemini Flash Lite is failing intermittently today (503 after 15–24 s). Under the stop-at-first-provider-error rule, a full 30 × 2 round cannot finish while that continues. Before another round, the owner must choose one of these:

- **(a)** Wait and retry later under the same rule.
- **(b)** Count a provider 503 as part of the measurement. The turn gets the fixed failure reply that production would send, and is scored as restricted and not useful. There is still no retry. The round stops only on 429, 400/401/403 or an exhausted budget.

Option (b) changes the stop rule, not the rubric, and it affects both flows the same way.

## Harness added (CONV-V2-00 row: call/latency recording)

- `lib/ai/conversation-eval-metrics.ts` (tests: `tests/conversation-eval-metrics.test.ts`, 7). Records per-turn inference calls and gateway attempts, nearest-rank p50/p95 for pipeline, end-to-end and per-call latency, restricted-reply and re-ask rates (reviewer labels; an unreviewed turn counts as missing, not false), the CLARIFY-kind rate and error codes. `judgeConversationFlowV2` applies §7: 27/30, 18/20, 10/10, 0 invariants, p95 reduction, ≤2 calls per AI turn, restricted and re-ask rates no higher than baseline. It fails closed on unreviewed turns or wrong denominators.
- `scripts/qa/conv-eval-call-ledger.ts` (tests: `tests/conv-eval-call-ledger.test.ts`, 2). Reserves one approved slot before each provider request and refuses at the cap, so a round can never exceed 180 calls.
- `scripts/qa/conv-v2-owned-eval.ts`: one case, real model, owned database. Derived from the main6 evaluator, with production producer options, input-window polling (DEC-206), wire latency per call and DEC-209 hand-over witnesses (`AI_ESCALATED` outcome per turn). Pre-DEC-209 witnesses (proposal buttons, B08 choice) are recorded but do not stop a case. The invariants checked are wrong recipient, unauthorized ticket, HUMAN ticket changed and AI sent into a pre-existing HUMAN conversation. Invented official data stays a review label.
- `tests/database/conv-v2-real-eval.integration.ts`: an opt-in entry for `run-owned-test.ts` that is skipped without `YRU_CONV_V2_EVAL_ARGS`.
- `scripts/qa/conv-v2-compare.ts`: runs one flow over the 30 cases with 30 s spacing and the shared round ledger, and refuses to replace a finished run. `--cases` re-runs a case only if its earlier attempt made zero provider requests (the old artifact is archived).
- `scripts/qa/conv-v2-summary.ts`: combines artifacts with the Root review file and prints the §7 verdict.

Evidence: typecheck and eslint pass on the new files; 9/9 focused unit tests pass. The A01 smoke and r1 cases ran end to end on disposable databases with cleanup PASS. The full unit suite and build were not re-run for this harness-only change.

## Decisions for the next round (DEC-212)

1. The baseline is the production worker configuration, not main6's candidate configuration.
2. Frozen expectations for B04, B05, B06 and B08 predate DEC-209 (buttons and confirmation, a B08 choice prompt). Both flows share the routing and support producer, so the trajectory for these cases is judged against current behaviour (typed hand-over, Staff case opened by the AI with a receipt, no choice buttons). The legacy witnesses are reported next to it. Thresholds and rubric are unchanged.
3. The p95 reduction for "significantly lower" is fixed from the baseline before any V2 result is read, and recorded in the review file (`p95RuleFixedAt`).
4. Every new round gets a new label and its own ledger, and results are never pooled across rounds. r2 was capped at 177 so that the r1 and r2 spend stays within the approved 180. The next round is `r3` with `--cap=174`, unless the owner approves a new budget.

## To resume

When Gemini is healthy again (one HTTP 200 seen in the dashboard's per-model test, or in normal traffic):

```bash
pnpm exec tsx scripts/qa/conv-v2-compare.ts --round=r3 --flow=baseline --cap=174
```

Then run the same with `--flow=v2`, write `.superpowers/staging/conv-v2/r3-review.json` and run `scripts/qa/conv-v2-summary.ts --round=r3`. This needs Docker (`supabase_db_line-ai-yru`), local E5 on the configured port, and `DOTENV_CONFIG_PATH` pointing at the main `.env` when started from a worktree. The owner first chooses (a) or (b) from the r2 section.
