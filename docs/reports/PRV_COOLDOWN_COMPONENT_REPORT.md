# Provider cooldown — component evidence, 5 October 2026

Scope: PRV-04C and cooldown-aware PRV-03, linked to USR-STATUS/QUOTA/ORDER/TEST and CH014/015/029. This dated checkpoint supplements the [observations report](PRV_OBSERVATIONS_COMPONENT_REPORT.md); it does not accept PRV-05, M5/M6 or V1.

## Result

429/5xx Retry-After is normalized at receipt, bounded to 24 hours, persisted privately and attached to separate provider/model network identity revisions. Runtime generation/embedding, selected inference tests and preview skip matching active cooldowns before price lookup or key decryption. Provider/model ordering, display and capability edits retain cooldown; key, endpoint, model ID, purpose, dimensions and Zen protocol changes fence old hints. Observation history is retained. UI shows the actual expiry/countdown, or unknown timing when no valid hint exists. HTTP failure and quota remain separate evidence.

Zen CHAT/RESPONSES is an explicit protocol pin: pricing refresh records the pin and bumps ordinary/network revisions when its effective value changes. Reorder preserves the pin even when price proof becomes stale. Provider platform/endpoint and model identity changes clear incompatible pins; FREE_ONLY requires fresh catalog agreement before use.

## Files and review corrections

Root integrated the delegated retry helper into adapter errors, gateway/store/admin/probe/preview and Provider UI. Shared DTOs carry only normalized retry evidence. Additive CLI migrations `20261005075412_provider_cooldown_identity.sql` and `20261005080349_provider_retry_http_evidence.sql` preserve existing keys/rows and enforce coherent identity/time/status evidence. The second migration fixes the SQL CHECK NULL hole discovered in review; the applied first migration was not rewritten.

Behavioral regression coverage is in `tests/provider-cooldown.test.ts`, `tests/provider-retry-transport.test.ts`, `tests/database/provider-cooldown.integration.ts` and `tests/database/provider-protocol-identity.integration.ts`. The latter includes ZEN→OPENROUTER→ZEN platform switches. The browser harness adds an actual cooldown API/preview group. `scripts/database/replay-local.ts` creates and drops only its own fresh test database, with schema-only Auth bootstrap and no existing database reset.

## Fresh root verification

All commands below ran against this checkpoint on 5 October; root read their completion outputs.

| Command | Result |
|---|---|
| `pnpm test` | 790/790 unit tests, 44 files, exit 0; includes 90 compatible URL/address helper tests, which do not constitute compatible transport acceptance |
| `pnpm test:db` | Foundation effective-role/RLS SQL plus 85 existing integration tests and 2 cooldown/protocol integration tests; 87/87, exit 0 |
| `pnpm lint` and `pnpm typecheck` | Both exit 0 |
| `pnpm build` | Production build and TypeScript exit 0; both LINE routes and provider routes compile |
| `node scripts/qa/provider-management-browser.mjs` | 7 actual Chromium scenario groups PASS: order/save/reload/focus, purpose isolation, HTTP/quota/unknown price, cooldown/free probe/preview, desktop/mobile/zoom and two non-admin denials |
| `pnpm exec tsx scripts/qa/rag-flow-http.ts` | Signed local intake → durable worker → configured free transport fixture → citations/outbox PASS; 9 catalog + 9 inference calls, 9 observations, paid native calls 0; takeover/redelivery/history boundaries pass |
| `pnpm exec tsx scripts/database/replay-local.ts` | All 17 application migrations replayed in disposable database, foundation RLS PASS; Auth data copied false, existing database reset false |

The QA production server uses local PG on 54422 and loopback port 3001, real development Auth test accounts, AI disabled for ordinary webhook processing, fixture-only LINE/provider transport. These tests are neither live provider inference nor real OA delivery.

## Provenance and remaining work

[Luna max cooldown review](../../.superpowers/sdd/reports/prv-cooldown-review.md) completed a fresh source pass and 126 focused unit tests across 7 files, with no actionable PRV-04C defect. The review explicitly labels the root PG/build/browser evidence as parent-reported rather than independently executed. Root owns DB/auth/network integration and acceptance; no unavailable-agent verdict is claimed.

PRV-02C compatible HTTPS transport, protocol adapters and authenticated configuration UI are still pending. PRV-05 also needs final API/privacy/advisor checks, guarded additive DEVELOPMENT schema synchronization and reviewed push. Remote DEV remains at the earlier 13-migration checkpoint. Live free account/model quality, real OA flows, approved corpus/import, M7–M9 and Flow A–F remain pending in the [task board](../tasks/V1_TASK_BOARD.md) and [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md).
