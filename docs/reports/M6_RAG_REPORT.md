# M6 RAG automated evidence — 4 October 2026

Document families, reviewed version scopes, chunks, embedding configuration, backend citations and the durable AI worker are implemented and the controlled automated flow passes. Provider/spec acceptance is reopened after the user's original Zen/OpenRouter/free-startup requirements were audited; see `AI_PROVIDER_SPEC_AUDIT.md`. The OPENAI-only implementation does not yet satisfy those requirements. This report is component evidence, not full M6 acceptance. Full V1 remains incomplete and feature progression is held for that correction.

## Implemented behavior

Verified Student text prepares an encrypted, ordered, idempotent AI job in the inbox transaction. The AI worker commits its context snapshot before classifier/embedding/answer HTTP, stores the encrypted result separately, and finalizes the message/outbox/job atomically. A retry of a saved result does not regenerate it. Lease expiry, finite retries, HUMAN takeover, session ownership and conversation revision are enforced by the backend. Only SENT AI replies enter subsequent assistant history.

Generation and embedding use the encrypted Dashboard provider/model registry. There is no environment-only model selection or guessed embedding dimension. Retrieval compares matching fingerprints and dimensions, filters approved official PUBLIC/current/effective/reviewed documents before similarity and authority, and supports intentional historical year/date requests. Citation URLs, titles, pages and sections come from exact retrieved IDs. Applicability must be stated by the student or directly resolved from prior USER text; classifier guesses and assistant-only claims are rejected.

Controlled backend tools implement knowledge search, active department lookup and confirmed ticket creation with atomic encrypted receipts. A consumed, owned opaque Student choice is required for the ticket effect. The fixed seven-dataset structured search contract fails explicitly until M8 installs its registry. Disabled departments after an issued choice produce a bounded stale-choice reply.

Dispatch revalidates evidence with sorted family/document advisory locks, held across bounded LINE HTTP without an open SQL transaction. M7 publication must acquire matching transaction locks before changing eligibility. This includes insertion of a new same-year historical version.

## Evidence

- Clean local replay of all 13 migrations and the effective-role foundation RLS/privacy fixture passed. Actual PostgreSQL integration: **81/81**, including ordering, leases, result reuse after rollback, ticket receipts, HUMAN races, historical ambiguity, delivery fencing and privacy.
- Unit tests: **426/426 across 30 files**. The producer has 43 cases, including behavioral RED→GREEN for the actual seeded `REGISTRAR` code, Thai scope aliases, invented applicability and explicit current academic years. Fresh TypeScript, ESLint and production build all exited 0 on this final source.
- Actual signed Next HTTP at local port 3001 through the configured worker/native OpenAI adapters with injected fake transport passed: current page 9/source citation; historical year 2567/page 67 after an opaque NEW choice; redelivery without duplicate jobs/messages; takeover during paused generation suppressing the result. Nine provider usage observations matched nine controlled HTTP calls. No open SQL transaction existed at provider or LINE boundaries. Final harness cleanup exited 0.
- The first HTTP run reached its flow assertions but exited 1 during cleanup due to a usage-log foreign key. Cleanup ordering was corrected, only its owned fixture was recovered, and the complete rerun exited 0. The failed run is not counted as a successful harness run.
- Signed durable ingress and the complete M4 ticket HTTP regression also exited 0. Earlier actual authenticated browser evidence for Dashboard generation/embedding configuration and all three staff roles remains applicable; this worker checkpoint changes no Dashboard UI.
- Local security/performance advisors reported no issues after the 13-migration replay. Actual source shortlist staging contains 15 pending documents, zero missing files, five external-source warnings and unresolved manual metadata review. No source was approved.

## Review and search-index decision

The independent scoped review identified applicability grounding and direct historical references. The producer corrections and regressions resolve both. Subsequent root review and actual-PG regressions additionally cover family locks, undelivered history, fixed ambiguity results and disabled departments. The reviewer reached its usage limit before re-reviewing the final tool implementation; these last corrections are root-verified, not described as a fresh independent verdict.

For the small V1 shortlist, retrieval uses exact cosine distance after metadata filtering, with the existing partial B-tree cohort index on fingerprint/dimensions/document and document eligibility indexes. An ANN index is deliberately not enabled: approximate post-filtering could omit eligible authoritative evidence, and no real embedding cohort has been selected. This is consistent with the pgvector [filter-index guidance](https://github.com/pgvector/pgvector#filtering). A future ANN deployment needs an explicitly configured cohort and measured recall; it is not claimed by this acceptance. Vector storage, cohort isolation and exact retrieval are implemented and tested.

## Remaining external gates

The AI opt-in flag remains disabled in development. Free Zen/OpenRouter adapters, FREE_ONLY runtime policy and a verified free embedding path are required before provider acceptance. Live free generation/embedding credentials, explicit model/dimensions, corpus review/approval and real OA answer/citation testing remain human configuration at the final setup step. Real187-resource corpus stays unpublished. M7 supplies upload/URL extraction, preview and explicit publication; M8 adds seven fixed datasets; M9 completes binding/incidents/analytics. No production readiness claim is made.

The additive queue/receipt schema synchronization already started before the user's stop and finished successfully on guarded DEVELOPMENT:13migrations,28applicationtables allRLS,9departments. Full effective-role privacy and all3real-subject rollback fixtures passed. A subsequent read-only audit confirms0providers/0models/0usage/0approved documents. No live AI was enabled or called.
