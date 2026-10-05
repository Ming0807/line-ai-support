# PRV backend correction — component evidence

4 October 2026, local worktree checkpoint. This is **partial PRV-01…04 evidence**, not M5/M6 or V1 acceptance. [Current board](../tasks/V1_TASK_BOARD.md), [provider design](../architecture/AI_PROVIDER_DESIGN.md), [execution plan](../superpowers/plans/2026-10-04-yru-provider-management-ux.md).

## Implemented

- Fresh fixed-host catalog pricing, FREE_ONLY default for both generation and embedding, unknown/nonzero/stale evidence blocked before key decryption. Metadata and inference share the request deadline; an ignoring reader cannot start inference after cancellation. Only actual inference attempts consume the three-attempt budget. Explicit registry ALLOW_PAID remains a later operator choice.
- Zen Chat/Responses protocol selection from catalog metadata, OpenRouter Chat and embeddings, fixed official hosts, JSON/tool/vector validation and actual upstream HTTP on these transports. Native OpenAI remains available for an explicit future paid choice. Startup tests made no live inference calls.
- CLI-created additive [policy migration](../../supabase/migrations/20261004161223_free_provider_policy.sql), applied **locally**: three official provider types, cost policy, slash model IDs and revision-scoped pricing observations. Private grants/RLS remain unchanged. No remote migration, corpus approval or record overwrite in this checkpoint.
- Atomic complete-scope Provider/Model reorders, disabled rows included, model purpose separated, optimistic revisions, deterministic locks, audit and concurrent-save conflict. Provider membership creation shares the registry lock. No network work in the order transaction.
- Public pricing refresh outside SQL, followed by active SuperAdmin/revision checks before persistence. Manual zero prices do not establish FREE. Saved-order preview uses shared ordering/capability helpers, last catalog observation and explicit limits; runtime rechecks pricing.
- Pure OpenRouter quota reader distinguishes key credits and account-shared daily requests, preserves units/windows, ignores deprecated rate_limit and leaves unsupported/absent evidence unknown. No quota storage/UI acceptance yet.

## Verification actually run

| Check | Result / scope |
|---|---|
| Pricing + FREE_ONLY RED | Price module initially absent; after reader implementation 15 pricing tests passed and all12 initial policy tests failed against the old gateway |
| First integrated focused run | 156/156 across six gateway/adapter files; later added timestamp/deadline/protocol/review cases |
| First whole unit suite | 542/542, 35 files; this preceded later review fixes/new provider schema/preview/quota tests |
| Whole typecheck/lint at that checkpoint | Both exit0; current combined UI/probe source still requires fresh verification |
| Latest registry/free/pricing focused check | 42/42, including Zen mixed-output rejection and direct metadata endpoint fixes |
| Provider schema/purpose focused check | 26/26 |
| Actual PostgreSQL registry/admin/store/policy | 7/7 in one run |
| Actual atomic order fixture | 1/1, includes full scope/duplicate/stale/concurrent/role/purpose checks |
| Actual pricing refresh fixture | 1/1, includes no idle business transaction at HTTP boundary and revision-change conflict |
| Credential-platform-switch regression | RED missing rejection, then GREEN; old key cannot be retained for a different provider. Explicit replacement clears old health; paid creation choice is audited |
| Preview limit regression | RED exposed fourth attempted position; latest5/5 GREEN caps positions1…3 and marks later rows ATTEMPT_LIMIT |
| Quota reader (Luna max) | 47/47 fake-HTTP tests, focused lint and typecheck reported by the agent |

Read-only public metadata fetches returned HTTP200: Models.dev 5,317,334 bytes (under the8MiB cap), Zen availability86 records, OpenRouter generation466 records and embedding33 records. These are catalog observations only; zero token-price counts do not prove account access, quality, dimensions or live inference. Primary sources: [Models.dev](https://models.dev/api.json), [Zen availability](https://opencode.ai/zen/v1/models), [OpenRouter generation catalog](https://openrouter.ai/api/v1/models), [embedding catalog](https://openrouter.ai/api/v1/embeddings/models).

## Team and review

Root owns contracts, policy/gateway integration, DB/auth, order/pricing APIs and acceptance. Luna max implemented Chat/embedding/quota; Luna high implemented the provider UI in parallel after the DTO freeze. Read-only reviews identified and drove regression fixes for Zen mixed results, the direct health endpoint, provider credential reuse on platform change, paid-choice audit and preview attempt limits. Reviewer reports preserve their own earlier source/time scope; root test rows above record subsequent fixes.

## Still held

Durable per-model success/error/action observations, selected-only free probes, quota persistence/refresh API, cooldown evidence, compatible-provider validated transport, final UI/browser checks, configured free signed RAG harness, full migration replay/PG/RLS/type/lint/build on the final sources, guarded DEV synchronization and reviewed commit/push remain required. No live-free account or real OA/corpus acceptance is claimed. M7 remains held behind PRV-05.
