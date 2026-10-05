# Provider prerequisite — 5 October 2026

Status: **AUTOMATED_ACCEPTANCE / MANUAL_PENDING** for PRV-01…05. This checkpoint accepts the provider prerequisite for continued Import implementation; it does not claim M6 business-intent coverage, live AI quality, actual LINE Flow A–F or complete V1.

## Result and scope

Zen/OpenRouter generation and OpenRouter embedding use fresh trusted free pricing before credential decryption/inference, bounded deterministic fallback, explicit dimensions and pinned Zen CHAT/Responses identity. Provider and Model up/down controls persist atomically with revisions, separate purposes, keyboard focus and an eligibility preview. Selected metadata/inference probes record actual upstream HTTP separately from application outcomes; quota observations retain account/key scope, units, windows, timestamps and UNKNOWN where no counter exists. Matching Retry-After cooldown survives reorder/display changes and retires after endpoint/key/model/protocol identity changes.

The new COMPATIBLE instance is configured through the same minimal Dashboard: custom HTTPS Base URL, encrypted key, models/capabilities/order and FREE_ONLY default. Installed protocols are Chat Completions with strict JSON/tools and embeddings. Save commits active SUPER_ADMIN preflight before public DNS, then reauthorizes and checks revision before persistence. Each request resolves again, rejects private/reserved/mixed addresses, pins its HTTPS socket, verifies the original hostname certificate, disables redirects and bounds bytes/deadlines. Generic pricing remains UNKNOWN; manual zero/free-looking names do not permit startup inference. Explicit ALLOW_PAID is persisted/audited for later university use; no paid inference was tested.

## Files and review

Configuration: `types/providers.ts`, provider admin/API/registry/probe/gateways, Provider page/forms and two additive CLI migrations. Protocol/network: compatible endpoint/public addresses/network/pinned HTTPS and both compatible adapters. Behavioral/PG/browser/TLS fixtures accompany these files. Cooldown and earlier observation files are covered by their linked reports.

- Luna max `/root/prv_compatible_review`: helper reserved-host correction and network/TLS review; 141 focused tests plus 8 actual local TLS scenarios. Its P3 changing-envelope finding was reproduced and fixed with an immutable own-data snapshot rejecting accessors/Proxies. See [network review](../../.superpowers/sdd/reports/prv-compatible-network-review.md).
- Luna max `/root/prv_retry_evidence`: protocol implementation (69 new tests, 163 scoped regressions) and independent configuration read-only review (253 focused tests). Configuration P2 uppercase route suffix mismatch was reproduced in actual PG and corrected by new migration `20261005084933`, preserving applied `20261005084020`. Reviewer verified source correction; root verified actual PG/replay. See [protocol report](../../.superpowers/sdd/reports/prv-compatible-protocol.md) and [configuration review](../../.superpowers/sdd/reports/prv-compatible-config-review.md).
- Root owns DB/auth/integration/acceptance and protocol integration self-review. An author does not independently review their own protocol implementation. No unavailable agent verdict is claimed.

## Fresh root evidence

| Command / evidence | Result |
|---|---|
| `pnpm test` | 919/919 tests, 49 files, exit 0 |
| `pnpm test:db` | 92/92 actual PG tests (85 + 7), foundation effective-role/RLS privacy PASS |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | all exit 0 on final source; both webhook routes compile |
| `pnpm exec tsx scripts/database/replay-local.ts` | 19 migrations + foundation RLS PASS in disposable DB; no copied auth data or reset of existing DB |
| `pnpm dlx supabase db advisors --local --type all --level warn --fail-on error --output-format json` | no warning/error issues, exit 0; info-level findings outside this check |
| `node scripts/qa/provider-management-browser.mjs` | 8 actual Chromium groups PASS, production build on loopback3001, real development Auth subjects with local role fixtures |
| `pnpm exec tsx scripts/qa/rag-flow-http.ts` with durable mode | signed Student intake → durable worker → configured verified-free fixture → grounded backend citations/outbox PASS; redelivery/history/HUMAN suppression; 9 catalog + 9 inference fixture calls, paid native calls 0 |
| `pnpm exec tsx scripts/qa/compatible-tls.ts` | real trusted TLS/Host/SNI, wrong-host/untrusted/redirect/body/header/abort cases PASS; 8 local scenarios; zero live provider calls |
| guarded `apply-development.ts` dry-run then `--apply` | DEVELOPMENT project guard verified; six pending additive migrations applied; 19 total, 31 RLS tables, 9 departments |
| `verify-development.ts`, `verify-real-staff.ts` | effective browser/server grants, anonymous/inactive/cross-department/restricted denials and 3 real subjects PASS; rollback fixtures removed |

Browser groups cover free Zen default/create, Provider/Model save/reload/purpose/focus, tabs/preview, true HTTP429 and shared near-quota fixtures, durable cooldown blocked probe/preview, COMPATIBLE save/reload/key replacement/UNKNOWN blocked probe, desktop/mobile/zoom and two ordinary staff role denials. Compatible creation uses public DNS for `api.openai.com` with a fixture key; it does not call that provider's HTTP API. Observations/quota/free catalog fixtures are not live vendor evidence.

Failures corrected: test STAFF fixture initially lacked its required department; a pricing fixture lacked complete observation revisions; neither constraint was weakened. The transient build during agent envelope edits failed TypeScript, then the final fresh build passed. Uppercase DB route test failed before the additive correction and passes afterward.

## Remaining work and next milestone

Actual free account access, Thai answer/embedding quality, selected live model/dimensions, real corpus review and final real OA ticket/AI flows remain MANUAL_PENDING in the [setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). M6 RAG-01 business/tool coverage and M7–M9/Flow A–F remain required. Import may now implement its authenticated staging/parser/review/publication contracts with controlled free fixtures; this acceptance does not auto-approve any of the 15 shortlisted sources.

Provider snapshot commit/push is recorded in the execution ledger after staged credential scanning and remote-hash verification. Future edits need their own relevant checks.
