# DOC-OPS-IMPORT — Local setup guide correction

Date: 5 October 2026
Owner: root-assigned documentation task
Status: complete for owned documentation scope

## Scope and files

Updated only `docs/operations/LOCAL_SETUP.md` and added this report. Shared board, requirements matrix, index, progress ledger, designs, code, package files, database state and Git history were not changed.

## Before and after

The setup guide reflected the older provider state: OpenAI-only, a RED focused pricing test, and a blanket instruction not to enable AI because provider contracts were incomplete. Its M7 and setup guidance also did not describe the current partial import checkpoint.

The guide now records the accepted automated PRV checkpoint and its limits, states the `FREE_ONLY` Zen/OpenRouter policy and later university-controlled paid option, and explains that local AI remains disabled until real free model/dimension, quality, corpus and manual safety checks are supplied. Those manual items remain in the final setup checklist while authorized code work can continue. It records M7 as partial with the exact source/analyzer/CSV/location evidence and remaining parser, acquisition, storage, staging, review, publication and UI work. Commands and environment variable names were checked against `package.json`, `.env.example` variable names, and current repository scripts; no secret values or credential files were read.

## Sources consulted

- `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, `docs/requirements/sources/README.md`, and `docs/requirements/V1_REQUIREMENTS_MATRIX.md`.
- `docs/architecture/YRU_V1_DESIGN.md`, `docs/architecture/AI_PROVIDER_DESIGN.md`, `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`, `docs/agents/WORKING_PROTOCOL.md`, `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`, and `docs/superpowers/plans/2026-10-05-yru-provider-cooldown-compatible.md`.
- `docs/reports/PRV_COMPATIBLE_ACCEPTANCE_REPORT.md`, `docs/reports/IMP_SOURCE_ANALYSIS_COMPONENT_REPORT.md`, `docs/reports/M6_RAG_REPORT.md`, `docs/operations/FINAL_SETUP_CHECKLIST.md`, `README.md`, `package.json`, and `.env.example` variable names only.

## Validation and limits

- PowerShell regex scan of every Markdown link in `docs/operations/LOCAL_SETUP.md` against the filesystem: 10/10 passed.
- `node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"`: confirmed the documented package scripts.
- `rg -n "^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|SUPABASE_JWKS_URL|DATABASE_URL|DIRECT_URL|DATABASE_SSL_CA_PATH|ENCRYPTION_KEY|LINE_STUDENT_CHANNEL_SECRET|LINE_STUDENT_CHANNEL_ACCESS_TOKEN|LINE_STAFF_CHANNEL_SECRET|LINE_STAFF_CHANNEL_ACCESS_TOKEN|APP_BASE_URL|LINE_WEBHOOK_MODE|YRU_AI_ENABLED|YRU_DEPLOYMENT_ENV|DEV_SUPABASE_PROJECT_REF|AI_[A-Z0-9_]+|EMBEDDING_[A-Z0-9_]+)=" .env.example`: checked variable names only.
- `Test-Path scripts/knowledge/stage-shortlist.ts` and `rg -n "2\.119\.0|54421|54422|54420|supabase_db_line-ai-yru" scripts supabase/config.toml package.json`: confirmed referenced script/config values.
- `git diff --check -- docs/operations/LOCAL_SETUP.md`: passed.
- No application tests/build were run because this task changed documentation only. No M7 behavior, live provider/model quality, approved corpus, real OA flow or production readiness is claimed by this update.

## Follow-up — Import checkpoint, 5 October 2026

Continued the DOC-OPS-IMPORT documentation scope in `docs/operations/LOCAL_SETUP.md`, `docs/PROJECT_INDEX.md`, and `docs/tasks/V1_TASK_BOARD.md`; added [the acquisition/staging component report](../../../docs/reports/IMP_ACQUISITION_STAGING_COMPONENT_REPORT.md). The docs now distinguish the last confirmed combined 1,033-test checkpoint from the later public-query policy change, for which root reports 48 focused tests passing while independent URL-review follow-up and full-suite/type/lint/build reruns remain pending. They retain M7 as partial and call out private Storage, PDF/Office and supervised archive handling, import UI, review/publication, approved corpus and live OA as pending. The current URL policy is described as implemented and focused-tested, not fully accepted.

The earlier concurrent-build test timeout and the successful isolated/single-worker reruns are both recorded. DEVELOPMENT remains at 19 migrations while the local disposable replay reached 20. No application tests, build, database mutation, secret inspection or live service call was performed by this documentation follow-up.
