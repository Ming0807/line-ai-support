# LIVE-FREE-04 — Gemini, OpenRouter and Groq live diagnostics

10October supplement **LIVE-KILO-06 / DEC-089**: [Kilo actual tests and saved fields](KILO_FREE_MODEL_LIVE_TEST_REPORT.md). Exact Auto Free `kilo-auto/free`, COMPATIBLE base `https://api.kilo.ai/api/gateway`; documented shared200free requests/hour/IP, observed cost0 on12requests. Auto/Liquid/Super each pass standalone Thai/JSON/tool-only; combined JSON/tool requests remain unaccepted. Root stored only Auto Free with encrypted key, both enabled flags false/FREE_ONLY/UNKNOWN in selected development; earlier LIVE-FREE-04 no-mutation scope below is unchanged. Native DNS/free-admission/exact request strategy/activation/OA remain team implementation.

10 October 2026; root execution/self-review on `feat/yru-helpdesk-v1` at `aa90f09`, with existing unrelated work preserved. USR-FREE/USR-TEST/USR-QUOTA; DEC-087. **COMPLETE for requested diagnostics/research only**. No independent review, runtime integration or V1 acceptance is claimed. Latest human instructions extend the original Google research with newly supplied OpenRouter and Groq keys and actual generation tests. All credential values remain absent from this report and saved probes/results.

## Actual Gemini generation

The latest human-supplied key was passed through stdin, used in memory and never written to `.env`, provider settings or this report. Only synthetic text was sent; no DB, queue, document-publication or LINE-send action occurred. Project billing tier and remaining quota are **NOT_OBSERVED**: published Free Tier plus HTTP200 does not prove this account was billed zero.

| Model/action | HTTP | Actual result | Elapsed |
| --- | --- | --- | --- |
| `gemini-flash-latest` metadata | 200 | Alias exists | 447 ms |
| `gemini-flash-latest` native plain | 200 | Actual answer; response modelVersion `gemini-3.8-flash` | 6,579 ms |
| `gemini-3.8-flash` native plain | 200 | Actual nonempty answer | 5,246 ms |
| `gemini-3.5-flash-lite` native plain | 200 | Actual nonempty answer | 1,726 ms |
| `gemini-flash-latest` compatible JSON | null | No response within30second request boundary; projection recorded UNCLASSIFIED | 30,003 ms |
| `gemini-3.5-flash-lite` native JSON | 200 | Parsed string answer, exact `ทดสอบสำเร็จ` | 1,303 ms |
| `gemini-3.5-flash-lite` compatible JSON | 200 | Same accepted JSON/Thai marker | 1,102 ms |

Plain generation used the human's `Explain how AI works in a few words`; JSON used one required string field. These are individual samples, not average latency, Thai support-quality or production classifier/LINE evidence. Retain the failed alias JSON observation.

Executed `node .superpowers/staging/gemini-live-probe.mjs` and `node .superpowers/staging/gemini-json-followup.mjs`, both exit0, with sanitized corresponding result JSON. Attempted `node --import tsx .superpowers/staging/gemini-compatible-followup.ts` exited1 during esbuild/Go heap-arena allocation at startup, before HTTP. Direct plain-JS follow-up isolated the API result; the **installed compatible adapter was not live-accepted**. No broad build/unit/typecheck claim is made for this diagnostics-only task.

## Gemini free models and Provider fields

Current official pricing lists Free Tier input/output for `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`; only3.8/3.5 and the alias were probed here. Prefer evaluating explicit3.5Flash-Lite first based on the limited observed text/JSON times. Latest aliases can change. [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [models/aliases](https://ai.google.dev/gemini-api/docs/models).

Google's RPM, input TPM and RPD apply at project scope; active model/tier/account limits must be read in AI Studio. No fixed Gemini allowance is invented. Account billing tier remains distinct from a model having a Free Tier. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [billing](https://ai.google.dev/gemini-api/docs/billing).

| Field | Protocol-compatible value |
| --- | --- |
| Provider name/type | `Google Gemini` / `อื่น ๆ · OpenAI compatible` (`COMPATIBLE`) |
| Base URL | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Key | Human-supplied Google key; never document its value |
| Model/purpose/policy | `gemini-3.5-flash-lite` / Generation / `FREE_ONLY` |

[Google compatibility](https://ai.google.dev/gemini-api/docs/openai) confirms this URL. **The current app still blocks Gemini under FREE_ONLY.** `provider-registry.ts` has no Google-specific adapter; `pricing.ts` verifies only Zen/OpenRouter and returns UNKNOWN for COMPATIBLE; `cost-policy.ts` rejects UNKNOWN. The Provider form already explains this. Manual zero prices cannot grant permission. Account-aware Google free-tier admission and exact production schema/tools/deadline checks are team implementation work, not merely human settings. No paid opt-in or runtime setting change was performed.

## OpenRouter actual generation and allowance

Actual public [catalog](https://openrouter.ai/api/v1/models) fetched HTTP200 at10:30:41 Bangkok; safe snapshot `.superpowers/staging/openrouter-free-catalog.json`. Nineteen entries have zero input/output prices and text in output modalities: **15 exact `:free` variants**, one zero-price Ling without that suffix, two Lyria music entries and `openrouter/free`. This does not mean19 suitable Helpdesk models. Exclude the safety-only variant; all14 conversational variants were actually tested with the latest human key. Refresh the zero-price catalog before inference, bound requests/rate/output/time, and use `provider.max_price` zero for prompt/completion plus `require_parameters:true`. No paid variant or fallback was selected.

| Model | Plain request | Strict JSON follow-up |
| --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b:free` | 200 accepted /1,984ms | 200 accepted /1,523ms |
| `apodex/apodex-1.1-mini:free` | 200 without accepted final answer /5,085ms | Not attempted after plain failure |
| `liquid/lfm-2.5-2.6b:free` | 200 accepted /768ms | 200 accepted /4,420ms |
| `dots-studio/dots-3-note-preview:free` | 200 accepted /2,794ms | 200 accepted /4,374ms |
| `google/gemma-4-26b-a4b-it:free` | 429 | Not advertised as schema-enforced |
| `nvidia/nemotron-3.5-lightning:free` | 200 accepted /2,337ms | Not advertised as schema-enforced |
| `thinkingmachines/inkling-small:free` | 403 | Not advertised as schema-enforced |
| `poolside/laguna-s-2.1:free` | 200 without accepted final answer /5,758ms | Not advertised as schema-enforced |
| `thinkingmachines/inkling:free` | 403 | Not advertised as schema-enforced |
| `poolside/laguna-xs-2.1:free` | 429 | Not advertised as schema-enforced |
| `cohere/north-mini-code:free` | 200 accepted /764ms | Not advertised as schema-enforced |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 200 accepted /3,925ms | Not advertised as schema-enforced |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 200 accepted /1,318ms | Not advertised as schema-enforced |
| `google/gemma-4-31b-it:free` | 429 | Not advertised as schema-enforced |

This is7accepted plain answers/14tests and3accepted strict JSON answers. HTTP200 alone did not pass two plain tests at the bounded1,024 output budget. A429 establishes rate/capacity rejection for that request, not exhausted account quota;403 establishes access rejection, not a bad key generally. Do not extrapolate individual failures to permanent model unavailability.

The three strict-JSON winners were also tested with strict `response_format` plus a synthetic function and `tool_choice:auto`: all returned200 but **no accepted requested tool call**. One additional Super diagnostic confirmed `finish_reason:stop`, zero tool calls and an `answer` content field; preserve that failed combined observation. Tool-only follow-up on all three returned200 with exactly validated `connectivity_probe(text:"hello")` arguments: Super1,249ms, Liquid1,247ms, Dots2,047ms. No function was executed. Separate JSON/tool capability is demonstrated; full production schemas/tool workflow are **NOT_ACCEPTED**. These small samples are not Thai support-quality or reliability rankings. [Nemotron](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b:free), [Liquid](https://openrouter.ai/liquid/lfm-2.5-2.6b:free), [Gemma schema distinction](https://openrouter.ai/google/gemma-4-26b-a4b-it:free).

Authenticated quota initially reported `isFreeTier:true`, used0/limit50/remaining50. The last observed result after follow-ups reports used16/limit50/remaining34. Counters were delayed across requests; these are timestamped observations, not an exact remaining guarantee or inferred request accounting. There were24 inference requests in this diagnostic scope:14plain +3JSON +3combined tools +1combined diagnostic +3tool-only. The primary script's20request bound applies to its17calls; follow-up scopes are explicit, not hidden retries.

Provider `OpenRouter` (`OPENROUTER`), Base URL `https://openrouter.ai/api/v1`, separate OpenRouter key, Generation/FREE_ONLY. Shortlist exact IDs `nvidia/nemotron-3-super-120b-a12b:free` first, `liquid/lfm-2.5-2.6b:free` as a compact alternative, `dots-studio/dots-3-note-preview:free` as optional preview. Context sizes are262,144/65,536/512,000 respectively. This ordering is an evaluation proposal, not activated settings or a measured quality ranking. Installed app free-price admission supports this provider, but selected production generation/tool/deadline acceptance remains required. Avoid treating `openrouter/free` as fixed-model acceptance.

Official default free-variant capacity: **20 requests/minute, 50/day** below the purchased-credit threshold; listed1,000/day requires at least$10 purchased credits, with a documented near-threshold rounding allowance. This is not a zero-purchase startup quota. Daily capacity is shared, not separately multiplied by model/key count. `/api/v1/key` reports `free_model_daily_requests` used/limit/remaining where applicable; upstream capacity/exempt accounts can differ. [Policy](https://openrouter.ai/docs/api_reference/limits), [official constants resolving its MDX table](https://raw.githubusercontent.com/OpenRouterTeam/docs/main/snippets/exports/constants.mdx). One LINE message can invoke routing, support-intent and answer generation, so50API calls are not50 fully answered student conversations.

## Groq actual generation, schema and tool-only tests

Authenticated `/models` returned200 and all three targets. The latest human key stayed in stdin/memory. All nine bounded requests returned200 and exact accepted output; synthetic function arguments were validated but never executed. These tests deliberately separate strict JSON from tools because current official [Structured Outputs](https://console.groq.com/docs/structured-outputs) documentation excludes tool use in the same structured-output request.

| Model | Thai marker | Strict JSON | Tool-only call |
| --- | --- | --- | --- |
| `openai/gpt-oss-20b` | 200 /558ms | 200 /584ms | 200 /546ms |
| `openai/gpt-oss-120b` | 200 /460ms | 200 /702ms | 200 /568ms |
| `qwen/qwen3.8-27b` | 200 /675ms | 200 /232ms | 200 /286ms |

Allowlisted response headers for this key actually reported1,000requests/day and8,000tokens/minute on all tested models. Last per-model remaining request observations were997; do not sum these into a guaranteed account-wide allowance. RPM/TPD were not observed in headers. The official [Free Plan summary](https://console.groq.com/docs/rate-limits) lists30RPM/1,000RPD/8,000TPM/200,000TPD for each; exact organization limits prevail. Billing tier is **NOT_OBSERVED**; matching free-plan headers and200 do not independently prove zero billing.

Dashboard-compatible fields: name `GroqCloud`, type `อื่น ๆ · OpenAI compatible` (`COMPATIBLE`), Base URL `https://api.groq.com/openai/v1`, supplied Groq key, Generation/FREE_ONLY, any exact model ID above. Prefer evaluating20B first for routine work,120B for harder answers and Qwen as an alternative; this is a tentative allocation, not established Thai quality. [Official compatible endpoint](https://console.groq.com/docs/openai). **Current application FREE_ONLY admission still blocks Groq as UNKNOWN**, and its compatible adapter always combines strict JSON with tools when tools are requested. This is team implementation work, not a request to enable paid mode or a claim that adding the key alone fixes LINE.

## Combined setup proposal, not activated settings

| Provider/type | Base URL | Selected diagnostic candidates | App acceptance |
| --- | --- | --- | --- |
| OpenCode Zen / `ZEN` | `https://opencode.ai/zen/v1` | `space-bunny-free`, protocol `CHAT` | Trusted free admission exists; support-intent deadline remains pending |
| OpenRouter / `OPENROUTER` | `https://openrouter.ai/api/v1` | Super120B `:free`, Liquid `:free`, optional Dots `:free` exact IDs above | Free admission exists; combined tool workflow pending |
| Google Gemini / `COMPATIBLE` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite`; explicit `gemini-3.8-flash` text-only observation | Free-tier admission UNKNOWN/blocked; exact app/tool acceptance pending |
| GroqCloud / `COMPATIBLE` | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` | Free-tier admission UNKNOWN/blocked; separate tool/schema strategy pending |

All are Generation/FREE_ONLY proposals with each provider's own human-supplied key; manual zero pricing is not admission authority. `supportsJson` can be considered tested for the selected strict-schema winners only at the synthetic schema scope. Tool-only success must not be presented as passing the installed combined tool/schema adapter or all Helpdesk tools. Do not globally activate every200 model or treat switches as acceptance.

Zen's separate [nine-model report](ZEN_FREE_MODEL_LIVE_TEST_REPORT.md) retains six restricted403, `exo-free`410 and `ling-3.0-flash-fin-free`400, with Space Bunny200 text/JSON/production semantic routing but an unchanged6second support-intent cancellation. Configured Muse403 remains the actual prior runtime failure. None of this diagnostic scope changed runtime provider settings, `.env` or LINE behavior.

## Other providers

| Provider | Candidate / compatible endpoint | Official free offering | Current integration |
| --- | --- | --- | --- |
| Cloudflare Workers AI | e.g. `@cf/google/gemma-4-26b-a4b-it`; `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` | 10,000Neurons/day, not requests; selected models require paid billing; free-plan exhaustion fails. | Needs account/token/free admission; current COMPATIBLE model-ID validator rejects `@cf/.../...`, not drop-in ready |
| Mistral | `mistral-small-latest`; `https://api.mistral.ai/v1` | Current docs describe Free mode without card, included monthly usage/account-specific limits; no universal allowance/access established here. | No key/live test; UNKNOWN free admission; lower-priority evaluation |
| Cerebras | Shared Inference Free Trial | $5credits expire after30days; no permanently renewing free tier. | Excluded from sustained-free startup shortlist |

Sources: [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [model restrictions](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/); [Mistral setup](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), [limits](https://docs.mistral.ai/admin/billing-usage/usage-limits); [Cerebras trial](https://inference-docs.cerebras.ai/support/rate-limits).

## Executed evidence and remaining integration

All plain-JS network scripts completed exit0. Ignored sanitized results: `gemini-live-results.json`, `gemini-json-followup-results.json`, `openrouter-live-results.json`, `openrouter-tools-results.json`, `openrouter-tools-diagnostic-results.json`, `openrouter-tool-only-results.json`, `groq-live-results.json`, all under `.superpowers/staging/`. Exit0 means the diagnostic finished, not every model test passed. Groq script syntax check passed; an initial no-stdin invocation failed its input guard before HTTP, then the actual supplied-key invocation completed. The attempted installed Google adapter's host-allocation failure above remains unresolved. No production source change or fresh broad typecheck/lint/build pass is claimed for this diagnostic scope.

Executed `node .superpowers/staging/verify-free-provider-evidence.mjs` exit0 at10:59Bangkok: saved response/count/capability/quota assertions PASS,21documentation/probe/result files scanned with0credential-pattern matches and no trailing whitespace. Safe result `free-provider-verification-results.json` preserves this scope. Probe syntax checks and `git diff --check` exit0; Git's LF→CRLF advisories are not whitespace failures. Later UI changes have their own acceptance, not this diagnostic verdict.

Only Zen/OpenRouter currently have installed trusted free admission. LIVE-FREE-05 remains **PLANNED application work**: provider/account-aware free eligibility for desired Google/Groq use, exact production tool/schema strategy and deadlines, selected-model tests, then explicit configuration and real Student OA verification. Preserve current UNKNOWN refusal until that design is reviewed; no manual-zero/ALLOW_PAID bypass. No key/model was activated or reordered.

Remaining acceptance: actual account tier/quota evidence; reviewed free-tier admission without manual-price bypass; exact production router/support/answer/tool/deadline behavior; authorized setting persistence and real OA tests. Preserve local E5/backend tool validation/privacy/FREE_ONLY. Provider-specific free data-use terms must be considered for existing minimized authorized evidence; all probes here were synthetic. No key/model was activated or reordered.
