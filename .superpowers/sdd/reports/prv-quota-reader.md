# PRV-04A OpenRouter quota reader report

**Scope:** `lib/ai/provider-quota.ts` and `tests/provider-quota.test.ts`. This is a bounded quota metadata reader, not live account acceptance; no real key or inference request was used.

The reader supports only `OPENROUTER`, validates its canonical API base and key before network access, and calls only `GET https://openrouter.ai/api/v1/key` with one `Authorization: Bearer` header. Zen, native OpenAI, and unknown adapters return unsupported with no HTTP request. Redirects are rejected. One 10-second deadline covers fetch and streamed body reading even if an injected fetch or body reader ignores abort; bodies are capped at 64 KiB. Error bodies are canceled without parsing, and returned DTOs contain only normalized status/error and allowlisted counters, never the key, label, identity fields, or raw provider text.

The parser follows the [current-key response schema](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) and [OpenRouter limits guide](https://openrouter.ai/docs/api_reference/limits): `limit`/`limit_remaining` describe a `PROVIDER_KEY` credit cap in USD; `free_model_daily_requests` is an `ACCOUNT` shared daily request counter. No model-specific count is inferred. The legacy `rate_limit` response object is documented as deprecated and is ignored. Missing counters stay absent or partial/null and therefore state as UNKNOWN; malformed or inconsistent known fields produce safe `INVALID_OUTPUT` with the actual HTTP status. HTTP errors preserve actual status and map only to fixed error codes; transport failures have `httpStatus:null`.

The current limits guide says free-model daily values reflect the account tier and may not be enforced for exempt accounts/endpoints or BYOK requests. Consumers should label this as the reported account free-model daily counter, not a general provider or per-model quota. Key `limit_reset` values establish the window (`daily`, `monthly`, `null` meaning no reset); they do not provide an exact reset timestamp in this response, so `resetAt` remains null. Weekly values remain `window: UNKNOWN` because the frozen counter contract has no weekly enum.

`quotaState` uses an explicit app policy: a counter observed at least five minutes ago is stale and UNKNOWN; malformed or future observation times, invalid unit/currency/scope/window combinations, and reset timestamps at or before `now` are UNKNOWN. This five-minute freshness window is an app choice, not an OpenRouter guarantee. With valid positive limit and remaining values, zero remaining is EXHAUSTED; otherwise at most 10% remaining is the app’s NEAR_LIMIT warning and higher values are AVAILABLE. No ratio is calculated for null, zero-limit, unknown-window, or inconsistent counters.

Verification:

- **RED:** the focused Vitest command initially failed because `lib/ai/provider-quota.ts` did not exist.
- **GREEN:** `pnpm exec vitest run tests/provider-quota.test.ts --maxWorkers=1` — 47 tests passed, covering supported/unsupported adapters, key/account scopes, no deprecated-limit inference, HTTP/error normalization, transport/abort/deadline/body bounds, malformed values, stale counters, and quota states.
- `pnpm exec eslint lib/ai/provider-quota.ts tests/provider-quota.test.ts` — passed without diagnostics.
- `pnpm exec tsc --noEmit --pretty false` — passed at the final type-aware check.

The implementation does not read model quota, infer quota from app usage, interpret raw 402/429 response bodies, or claim that the account free-model counter gates every OpenRouter endpoint. Persistence, caching, route authorization, and Dashboard presentation remain separate PRV-04 work.
