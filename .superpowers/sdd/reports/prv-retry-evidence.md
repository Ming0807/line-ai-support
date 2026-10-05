# PRV-04C Retry Evidence Helper Report

Date: 2026-10-05  
Owner: `/root/prv_retry_evidence` (delegated helper-only slice)  
Source checkpoint: shared working tree at the commands below

## Scope

Implemented `readRetryEvidence(httpStatus, headers, observedAtMs = Date.now())` and the exported `RetryEvidence` shape in `lib/ai/retry-evidence.ts`. The helper returns only normalized `RETRY_AFTER` evidence, anchored to the supplied observation time. It reads no network state, logs nothing, infers no quota counter, and does not return or persist raw headers.

It accepts bounded decimal seconds and strict IMF-fixdate, obsolete RFC850, and asctime dates only for HTTP 429 or 5xx. It validates calendar dates and weekday names, rejects malformed/duplicate/overlong values, invalid observation times, past dates, and delays beyond 24 hours. RFC850 two-digit years use the RFC 50-year future rule. Zero seconds resolves to the observation instant.

The parsing requirements were checked against [RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3) and [§5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7): Retry-After carries either `delay-seconds` (`1*DIGIT`) or HTTP-date; recipients accept all three HTTP-date formats, which are case-sensitive. The 24-hour wait and 128-character field bounds are the PRV-04C application policy.

## Files

- `lib/ai/retry-evidence.ts`
- `tests/retry-evidence.test.ts`
- `.superpowers/sdd/reports/prv-retry-evidence.md`

## Evidence

- RED: ran `node node_modules/vitest/vitest.mjs run tests/retry-evidence.test.ts` with the API stub; **12 acceptance assertions failed and 32 rejection cases passed**.
- GREEN: ran the same focused Vitest command after implementation; **1 test file and 44 tests passed**.
- Targeted lint: `node node_modules/eslint/bin/eslint.js lib/ai/retry-evidence.ts tests/retry-evidence.test.ts` completed with no findings.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit --pretty false` remains red on root-owned cooldown work: `tests/database/provider-cooldown.integration.ts:34,44` references missing `ModelView.cooldownUntil`, and `tests/provider-cooldown.test.ts:29` indexes an empty mock call tuple. It reported no type errors in this helper or its tests; these shared-contract files were left unchanged.

These commands used the bundled Node executable at `C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`.

## Remaining work and review provenance

This report covers only the pure parsing helper. Durable cooldown persistence, gateways, preview/probe integration, PostgreSQL tests, final PRV-04 acceptance, and full V1 acceptance remain with root. No independent code review was performed for this slice.
