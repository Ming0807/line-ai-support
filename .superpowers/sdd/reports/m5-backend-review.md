# M5 AI gateway and provider backend review

## Scope

Read-only review of the M5 plan, the master guide's provider, gateway, privacy and access sections, gateway/store/provider-admin/API/DTO code, M5 migrations, and current gateway and provider tests. No environment, secret, live-provider, database, or global check was run by this reviewer.

## Findings and disposition

Three actionable configuration-snapshot defects were found during review and are fixed in the current source.

1. **An in-flight generation could replace health for newer configuration.** The gateway originally persisted only the outcome, so a request started with an old key/model could finish after a configuration edit and overwrite the current health state. The gateway now carries provider and model revisions with each attempt; the store locks the provider, reads the model revision after acquiring that lock, updates health only when both revisions still match, and still records usage/error rows with the source revisions. See `lib/ai/gateway.ts:68`, `lib/ai/store.ts:32`, `lib/ai/store.ts:35`, and `supabase/migrations/20261004120923_ai_observation_versions.sql:3`. The regression case starts at `tests/database/ai-registry.integration.ts:8`.

2. **Model edits could leave an old health result visible.** A successful check for model A remained `HEALTHY` after that model was edited to model B. Every model create/update now advances the provider configuration revision and clears `health_status` plus `last_health_check`; the integration case checks that editing the tested model returns the provider to `UNKNOWN` (`lib/ai/provider-admin.ts:79`, `lib/ai/provider-admin.ts:92`, `tests/database/provider-admin.integration.ts:53`).

3. **A health probe could commit against a stale model-set snapshot.** The old final health write checked provider and model revisions in one `UPDATE`. If it waited behind a model writer that held the provider lock but did not change the provider row, the subquery could use the statement's earlier snapshot. The final path now obtains the provider lock first and reads model state in a subsequent statement; model-list mutations also advance the provider revision, so an in-flight check for a previous preferred model conflicts rather than overwriting the new state (`lib/ai/provider-admin.ts:113`, `lib/ai/provider-admin.ts:115`, `lib/ai/provider-admin.ts:116`, `tests/database/provider-admin.integration.ts:61`, `tests/database/provider-admin.integration.ts:85`).

The current review found no remaining actionable backend findings in the assigned scope. This is a backend review result, not acceptance of the full M5 milestone.

## Verification context

The root agent reports that the database regressions demonstrated RED before the fixes and GREEN after them, with five M5 PostgreSQL cases and the global TypeScript check passing. I inspected the resulting source and test cases but did not run those checks myself. Live provider credentials, configured-model availability, and paid generation remain unverified.
