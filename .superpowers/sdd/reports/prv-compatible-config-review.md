# PRV-02C-CONFIG — independent read-only review

**Date:** 2026-10-05  
**Reviewer:** Luna max (`/root/prv_retry_evidence`)  
**Review scope:** compatible provider schema/admin save, DNS preflight, key and revision boundaries, FREE_ONLY gates, metadata probes, registry dispatch, and migrations `20261005084020_compatible_provider_endpoint.sql` / `20261005084933_compatible_endpoint_route_case.sql`. No source or test files were changed by this review.

## Finding — resolved at source; database proof pending

The original **P2** finding was that migration `20261005084020` used a case-sensitive `base_url !~ '/(models|embeddings|chat/completions)$'` check even though the path character class permits uppercase letters. This admitted route-like suffixes such as `/Models` that `parseCompatibleBaseUrl` lowercases and rejects. The API schema and runtime parser already rejected such values before DNS/HTTP, so this was a privileged-write configuration invariant mismatch rather than an SSRF or credential-sending bypass.

The additive migration `20261005084933_compatible_endpoint_route_case.sql` now adds a separate CHECK using case-insensitive `!~*`, leaving the applied migration 18 unchanged. `tests/database/provider-compatible.integration.ts` now asserts rejection of `/Models`, `/EMBEDDINGS`, and `/Chat/Completions`. The source-level mismatch is resolved. Root reports the correction is applied locally and that the pre-correction PostgreSQL test demonstrated the expected RED; root's fresh full PostgreSQL and migration-replay run remains pending. I did not execute or independently verify database state in this read-only follow-up.

## Reviewed controls with no additional finding

- `providerWrite` checks same-origin and authenticated staff before calling provider admin. `createProvider` performs active-SUPER_ADMIN authorization in a committed transaction before DNS, resolves outside SQL, then reauthorizes in the final transaction. `updateProvider` snapshots and checks the provider revision/key-replacement requirement before DNS, then reauthorizes, locks, and rechecks the revision before update/audit. Host/platform changes require a replacement key; endpoint/key changes increment provider network revision. Compatible schema parsing canonicalizes the URL before persistence.
- The endpoint parser rejects non-HTTPS URLs, credentials, query/fragment, IP literals, special-use suffixes, route URLs, and unsafe path forms. The shared transport re-resolves and classifies addresses per request, pins the HTTPS socket, preserves hostname TLS validation, disables redirects, bounds bodies, and enforces request deadlines. These are source-level observations; actual public DNS and TLS were not exercised by this review.
- Generic compatible pricing is UNKNOWN in `createPriceReader`. Runtime generation and embeddings call `authorizeModelCost` before key decryption; the compatible metadata-only probe also forces FREE_ONLY for generation/embedding tests and blocks UNKNOWN pricing before decrypt or transport. The dedicated configuration test uses an undecryptable key and asserts zero compatible sends for both purposes, including a paid-config/manual-zero fixture. Metadata checks are intentionally separate from inference, use only the fixed `models` route, and require exactly one matching model ID; selected probes do not use fallback.
- Registry dispatch is explicit for `COMPATIBLE`; official OpenAI, Zen and OpenRouter adapters remain fixed to their roots. Migrations 18 and 19 only define compatible endpoint CHECK constraints; neither changes RLS or grants. The existing provider/model registry tables keep RLS enabled, revoke browser roles, and grant service-role access, with SUPER_ADMIN authorization enforced in server transactions.

## Evidence and limits

Focused read-only unit command: `.\node_modules\.bin\vitest.cmd run tests/compatible-configuration.test.ts tests/compatible-endpoint.test.ts tests/compatible-network.test.ts tests/compatible-pinned-https.test.ts tests/compatible-chat-completions.test.ts tests/compatible-embeddings.test.ts tests/model-probe.test.ts tests/provider-registry.test.ts tests/ai-gateway.test.ts tests/embedding-gateway.test.ts tests/provider-free-schemas.test.ts` — **11 files, 253 tests passed at the previous review checkpoint**.

The actual PostgreSQL integration file `tests/database/provider-compatible.integration.ts`, migration replay/RLS checks, and browser persistence/UI checks were not run for this read-only review. Root owns those gates and reported they remain in progress. This is a bounded configuration-path review, not PRV-02C or PRV-05 acceptance.
