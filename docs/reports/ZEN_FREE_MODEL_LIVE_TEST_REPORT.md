# LIVE-ZEN-03 — actual Zen free-model generation probes

10 October 2026, 10:18–10:24 Asia/Bangkok. Root executed and self-reviewed the probes on `feat/yru-helpdesk-v1` at `aa90f09` with existing unrelated uncommitted work preserved. No independent agent review is claimed. Requirements: USR-FREE, USR-TEST, USR-QUOTA; provider access interpretation DEC-086 supersedes the blanket conclusion in DEC-085.

Status: **REQUESTED_NINE_MODEL_TEST_COMPLETE**. One model returned an actual answer; eight failed. This is not a live Helpdesk/LINE or whole-V1 acceptance.

## Method and scope

The latest human supplied a new Zen key and nine exact model IDs. Root used that key in memory, supplying it through stdin to ignored local probe scripts. No key, Authorization header, reply token or raw request/response body was logged or written to this report. Existing `.env`, provider/model registry and runtime settings were not changed. No database, queue, ticket, publication or LINE-send action was performed.

Before each plain generation request, the existing trusted price reader freshly checked zero input/output prices, catalog availability and CHAT format. All nine were admitted as FREE. Catalog availability and zero pricing are separate from successful inference access.

Root used the official `https://opencode.ai/zen/v1/chat/completions` endpoint, ordinary server headers and the same synthetic Thai instruction, `ตอบเพียงคำว่า ทดสอบสำเร็จ`. Plain requests used `stream:false`, `max_tokens:1024` and a 30-second bound. Only a model returning a nonempty answer received the strict-JSON follow-up through the existing ZEN adapter. No alternate-client impersonation or paid fallback was used. [Official endpoint/model documentation](https://opencode.ai/docs/zen/).

## Actual requested-model results

| Model | HTTP | Actual result |
| --- | --- | --- |
| `big-pickle` | 403 | `FreeTierError`; response explicitly restricts access to OpenCode |
| `exo-free` | 410 | `ModelDeprecated`; minimal follow-up confirms retirement |
| `ling-3.0-flash-fin-free` | 400 | `server_error`; minimal follow-up says upstream model unavailable |
| `ling-3.1-flash-free` | 403 | `FreeTierError`; OpenCode-only restriction |
| `mimo-v2.6-flash-free` | 403 | `FreeTierError`; OpenCode-only restriction |
| `nemotron-3-ultra-free` | 403 | `FreeTierError`; OpenCode-only restriction |
| `nemotron-3.5-lightning-free` | 403 | `FreeTierError`; OpenCode-only restriction |
| `space-bunny-free` | **200** | Nonempty Thai answer containing `ทดสอบสำเร็จ`, finish reason `stop`; strict JSON also **200 / SUCCESS** |
| `step-5-preview-free` | 403 | `FreeTierError`; OpenCode-only restriction |

Totals: **9/9 attempted, 1 actual plain-generation success, 6 access-restricted failures, 1 retired model, 1 unavailable upstream model; 0 not-attempted**. The successful response proves this key worked for that model/request at that time. None of the other responses proves that the key is invalid or quota is exhausted.

Minimal follow-up messages, projected without raw bodies:

- `exo-free`: `Model exo-free has been deprecated.`
- `ling-3.0-flash-fin-free`: `Upstream request failed: Model is unavailable.`

## Application-shaped follow-up for Space Bunny

Root used the existing generation gateway, registered adapter, fresh real price admission and actual production classifiers. The registry and encrypted key were ephemeral in-memory fixtures, not persisted settings. All conversation text and department inputs were synthetic; no private student conversation was sent.

- **Simple strict JSON: PASS**, HTTP 200, string `answer` accepted by the probe.
- **Production semantic routing: PASS**, HTTP 200 / SUCCESS, 2,526 ms attempt latency within its existing 8-second boundary. The synthetic library question versus an existing HUMAN Wi-Fi context produced validated `{decision:"NEW",candidateCode:null,confidence:0.99}`.
- **Production support intent: NOT_ACCEPTED**. The first invocation returned null without an attempt record. A second instrumented invocation confirmed fresh FREE admission in 1,557 ms, inference start, then cancellation at the unchanged 6-second classifier boundary (6,008 ms total; 4,441 ms inside inference). The gateway and adapter reported `CANCELLED`, with no HTTP response status and no persisted attempt. This does not prove a bad key, invalid output or upstream HTTP failure; it establishes that this application-shaped request did not produce accepted output within the existing deadline. No production timeout was changed.

Space Bunny is therefore a demonstrated direct-generation candidate, not yet a proven replacement for the complete Helpdesk pipeline. No current provider key/model was replaced, so these isolated probes do not repair the running LINE fallback by themselves. University knowledge approval and real OA testing remain separate gates.

## Executed evidence and limitations

Root executed `node --import tsx` for each of these ignored staging scripts with the key supplied through stdin; all three processes exited 0 after writing sanitized outcomes:

- `.superpowers/staging/zen-nine-model-probe.ts` → `zen-nine-model-results.json`: actual nine-model plain tests and one strict-JSON test.
- `.superpowers/staging/zen-nine-model-followup.ts` → `zen-nine-model-followup-results.json`: minimal 400/410 checks and production-shaped routing/support calls.
- `.superpowers/staging/zen-support-diagnostic.ts` → `zen-support-diagnostic-results.json`: deadline/price/inference event projection, with no credentials or raw model output.

These are live-provider observations for one key/request shape/time, not guarantees of future availability, quota, latency, schema compliance or answer quality. No model-quality benchmark, real LINE end-to-end pass, build/typecheck pass or full V1 completion is claimed by this diagnostic task. No production application code changed, so broad build/unit gates were not rerun for this report.

The earlier maintainer [free-tier restriction statement](https://github.com/anomalyco/opencode/issues/49621) and the observed Muse/six-model 403 results remain relevant, but cannot justify saying every Zen free model rejects direct generation: Space Bunny returned actual 200 responses in this run. DEC-086 records the narrowed conclusion.
