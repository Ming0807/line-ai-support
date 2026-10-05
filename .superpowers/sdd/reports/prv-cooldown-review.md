# PRV-04C cooldown and retry evidence review

Date: 2026-10-05  
Reviewer: `/root/prv_retry_evidence` (Luna max)  
Scope: fresh, read-only review of retry evidence parsing and transport; cooldown identity, persistence, and races; selected probes; runtime/preview/UI consistency; migrations and focused test coverage. No implementation files were edited.

## Verdict

I found no actionable defect remaining in the reviewed PRV-04C scope at this source checkpoint. This is a bounded cooldown/retry review, not a PRV-05 or full V1 acceptance.

The review initially found that Zen `CHAT`/`RESPONSES` protocol switches were missing from network identity, and then found that stale API-format pins could survive ordinary order revisions in the admin DTO. Both are corrected in the current source. Pricing refresh increments model configuration and network revisions when the Zen protocol changes and stamps the new pricing proof under the new revision. Model identity/purpose/dimension changes clear the pin; provider adapter/base changes clear child pins and advance provider network identity. Ordering retains the pin. Runtime and probe snapshots use the pin independent of pricing freshness, while FREE_ONLY inference requires a fresh catalog result to agree with it. The protocol integration test exercises format switch, order retention, DTO/preview agreement, old-hint rejection, model identity change, and provider platform changes.

## Reviewed behavior

- `readRetryEvidence` accepts bounded nonnegative integer seconds or strict IMF-fixdate, RFC 850, and asctime HTTP-date forms only for actual HTTP 429 and 5xx. It rejects malformed/duplicate-combined, past, oversized, fractional, overflow, non-finite, and over-24-hour hints. Zero wait preserves the receipt time. Unit fixtures cover fixed timestamps, leap/calendar validation, legacy dates, timezone/GMT behavior, and invalid values.
- Adapters carry normalized evidence for actual 429/5xx responses through gateway/probe errors. Auth and other non-retry outcomes do not receive cooldown evidence. Persistence stores only normalized source/receipt/retry timestamps; headers and upstream response bodies are not returned or logged. HTTP 429 does not create quota counters.
- Cooldown writes use captured provider/model network revisions, preserve the later active expiry under concurrent shorter/longer hints, and reject stale or already-expired hints without resetting `observedAt`. Provider key/endpoint and model identity changes invalidate prior cooldown identity; presentation, capability, and order revisions preserve it. Observation history remains in the existing private table.
- Runtime generation and embedding skip active matching cooldowns before catalog reads, key decryption, and inference. Selected model tests also honor cooldown and use one selected model with forced FREE_ONLY and no fallback. Metadata probes do not clear inference cooldown. Runtime/probe outbound HTTP occurs outside SQL transactions; persistence reauthorizes/locks and fences stale configuration before writing.
- Saved preview uses the same cooldown helper and returns the saved expiry. UI shows active remaining wait/expiry; when 429/5xx has no accepted Retry-After, it shows the actual HTTP result and unknown timing. It does not infer a remaining quota or reset from 429.
- Migration `20261005075412_provider_cooldown_identity.sql` adds identity/evidence columns to existing private tables. The additive `20261005080349_provider_retry_http_evidence.sql` closes the original SQL CHECK NULL hole with explicit non-null and exact status/error pairing. No new public object or HTTP-in-SQL behavior was found. Existing RLS/private grants remain applicable; direct SQL regression coverage rejects NULL HTTP evidence.

## Verification and provenance

Independently run from `D:\project-next\line-ai-yru`:

```powershell
.\node_modules\.bin\vitest.cmd run tests/retry-evidence.test.ts tests/provider-cooldown.test.ts tests/provider-preview.test.ts tests/provider-retry-transport.test.ts tests/model-probe.test.ts tests/ai-pricing.test.ts tests/provider-registry.test.ts
```

Result: **7 files passed, 126 tests passed**.

I inspected but did not run PostgreSQL tests while the root integration gate was active. Root reported `pnpm test:db` exited 0 through `scripts/database/test-local.ps1`, with 85 existing integration tests plus the cooldown and protocol identity tests (87 actual PostgreSQL tests total); the migration replay/RLS checks also passed. Root additionally reported 790/790 full unit tests, lint, typecheck, production build, seven browser scenario groups, and signed configured free-RAG fixtures passing with zero paid inference calls. Those full-gate results are parent-reported; this reviewer independently ran only the focused unit command above and did not run the database, build, or browser gates.

The compatible-provider transport and remaining integrated PRV-05/final V1 checks are outside this review verdict and remain pending per the task board.
