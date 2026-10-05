# YRU local E5 embedding implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Root owns integration, DB/auth/privacy and acceptance. Existing team authorization is retained; unavailable reviewers must not be claimed.

**Goal:** Make the already installed local CPU `intfloat/multilingual-e5-small` the verified default embedding infrastructure, without downloading weights or requiring admin model selection.

**Architecture:** Follow [embedding design](../../architecture/EMBEDDING_SERVICE_DESIGN.md) and [latest human source](../../requirements/sources/2026-10-05-local-e5-embedding.md). Next.js server calls a configurable private FastAPI service; normalized query/passage vectors use a fixed 384-dimension cohort in pgvector. Generation stays FREE_ONLY and remains behind existing knowledge/AI enablement gates.

**Tech Stack:** Existing Python service virtualenv, SentenceTransformers/Torch CPU, FastAPI/Uvicorn, Node 24/Next 16.3.8, Zod 4, PostgreSQL/pgvector, Vitest and real local HTTP/DB checks.

## Global constraints

- No redownload, original-cache deletion, Ollama, alternate model, GPU, weight/venv/env commit, browser embedding calls, automatic corpus import or premature live generation.
- Model `intfloat/multilingual-e5-small`; dimension `384`; pinned existing revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`; CPU; normalized; query/passage prefix; 512-token limit must not silently truncate.
- Preserve both OA webhooks and the current private import work. Network outside SQL transactions. Applied migrations immutable; legacy vector cohorts preserved.
- Machine-specific cache location is ignored service config; default endpoint loopback, remote service requires authenticated HTTPS.

## EMB-01 — Cache relocation and controlled service (root)

Requirements: human goals 1–3, 8; USR-EMB-LOCAL. Depends on cache/service inventory only.

Files: `services/embedding/app.py`, `services/embedding/test_app.py`, `services/embedding/requirements.txt`, `services/embedding/.env.example`, `services/embedding/README.md`, `.gitignore`. Ignored configuration: `services/embedding/.env`. Ignored original source backup/evidence under `.superpowers/staging/`.

Interface: `/health -> {status:"ok",model,revision,dimension:384}`; `/embed({text,type}) -> {dimension:384,embedding:number[]}`; `/embed/batch({texts,type:"passage"}) -> {dimension:384,embeddings:number[][]}`. Configuration validated before model loading; offline cached snapshot only. Non-loopback binding without key is a startup error.

- [x] Preserve the existing app source and inventory Python/venv, cache refs/snapshot/link targets; do not dump env values or tokens.
- [x] Copy the detected selected-model subtree into `D:\AI\Models\huggingface\hub`, without deleting source; compare all copied file hashes.
- [x] Add service tests for strict type/empty/oversized/token-limited requests, correct prefixes/normalization, wrong dimensions, authentication and fail-closed cache configuration. Run `services/embedding/.venv/Scripts/python.exe -m unittest discover -s services/embedding -p test_app.py`; observe RED before changes.
- [x] Implement offline load, lifespan health, CPU encode, bounded batch and safe failures; use installed packages rather than reinstalling/model download. Re-run service tests.
- [x] Prove a separate D-only offline load while blocking outbound sockets, then observe real `/health` and Thai/English/query/passage HTTP 200 with vector length/norm checks. Keep C: and record cleanup scope.

## EMB-02 — Backend provider and configured runtime (root)

Requirements: goals 4–5, 7–8. Depends on EMB-01 API contract, not on a generation API key.

Files: `lib/knowledge/embedding-client.ts`, `lib/knowledge/embedding-space.ts`, `lib/knowledge/configured.ts`, `lib/ai/configured.ts`, `.env.example`, `tests/local-embedding-client.test.ts`, `tests/local-embedding-configured.test.ts`, `scripts/qa/local-embedding.ts`.

Preparation files: `lib/knowledge/embedding-preparation.ts`, `tests/knowledge-embedding-preparation.test.ts`. `prepareEmbeddedKnowledgeChunks(pages,provider,options?) -> EmbeddedKnowledgeChunkDraft[]` preserves page/section/content, requires extraction review and validates normalized384 outputs under an overall deadline, without DB/publication.

Interface: `EmbeddingProvider {dimension;fingerprint;modelId;revision;embedQuery(text,options?);embedPassages(texts,options?);healthCheck(options?)}`; `createLocalE5EmbeddingProvider(options?)`; `embedLocalConfigured(input:EmbedInput):Promise<EmbedResult>` bridges existing producer contract. Fingerprint excludes endpoint/key and includes weight revision/prefix/normalization.

- [x] Test successful query/passages, no external registry/key requirement, wrong/nonfinite/zero/non-normalized/dimension outputs, controlled HTTP/unavailable/timeout/cancel/oversize/redirect failure, invalid remote config and safe health. Run `pnpm test --maxWorkers=1 tests/local-embedding-client.test.ts tests/local-embedding-configured.test.ts`; observe RED.
- [x] Implement validated server config, bounded response reads and total deadlines; switch the two configured runtime callers to local embeddings while keeping generation registry unchanged. Re-run GREEN.
- [x] Run `pnpm exec tsx scripts/qa/local-embedding.ts` against the actual local service; record Thai/English/passage, health and controlled unavailable without displaying full vectors/text/keys.

## EMB-03 — Additive 384-vector migration and retrieval (root)

Requirements: goal 6 and query half of goal 7. Depends on EMB-02 fixed fingerprint.

Files: new CLI-generated `supabase/migrations/*_local_e5_vector_space.sql`, `lib/knowledge/retrieval.ts`, `tests/database/local-e5-knowledge.integration.ts`, `scripts/database/test-local.ps1`. Preserve original `20261004125859_knowledge_rag.sql` bytes.

Interface: existing chunk writes retain `embedding`, dimensions and fingerprint; generated `embedding_e5 vector(384)` is populated only for fixed E5 cohort. Existing `searchKnowledge` uses E5 projection for its fingerprint and rejects dimension mismatch before SQL. No new public RPC or browser policies.

- [x] Add actual PostgreSQL tests for typed column, correct 384 insertion/search/current filtering, wrong-dimension rejection and retained legacy vectors. Run against local database and observe RED.
- [x] Generate/apply a new migration only to local development; do not alter applied history or bulk-reindex corpus. Add cohort dimension constraint/generated projection and select/cast in existing filtered retrieval.
- [x] Run new tests, existing knowledge/schema/RLS tests, full migration replay and advisors. Record local vs remote migration state explicitly; remote synchronization follows the existing reviewed development gate, not a production claim.

## EMB-04 — Generation-only normal UI and read-only embedding status (root)

Requirements: goal 4. Depends on EMB-02 health contract. Keep incumbent product minimal design, authorization, generation order/status/test/quota behavior.

Files: `app/(dashboard)/providers/page.tsx`, `app/(dashboard)/providers/provider-forms.tsx`, `app/providers.css`, `app/api/knowledge/embedding/health/route.ts`, `tests/local-embedding-health-route.test.ts`, `scripts/qa/local-embedding-browser.mjs`, `docs/ui/PROVIDER_SURFACE_BRIEF.md`.

Shared server status: `lib/knowledge/embedding-status.ts` performs active SUPER_ADMIN snapshot and final authorization, with health HTTP outside SQL. Backend DTO contains only model/dimension/mode/healthy/observation time/actual nullable HTTP status.

- [x] Test authenticated SUPER_ADMIN status access, ordinary/inactive staff denial and DTO without URL/path/key. Observe RED, implement a server-only sanitized route, re-run GREEN.
- [x] Remove normal purpose/dimension controls and embedding tab; generation form submits explicit GENERATION/null dimension. Preserve internal external-embedding code/rows and generation settings/up-down/test actions. Add status panel containing model/dimension/local/connection/health/observation time only.
- [x] Check actual desktop/mobile/keyboard UI against the active dev server with controlled fixture identity and safe screenshots; no new embedding model entry is needed. Re-test provider generation actions.

## EMB-05 — Foundation acceptance and updated continuation (root)

Requirements: test/documentation sections, no-premature-generation gate. Depends on EMB-01…04.

Files: `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/architecture/YRU_V1_DESIGN.md`, `docs/architecture/AI_PROVIDER_DESIGN.md`, `docs/requirements/V1_REQUIREMENTS_MATRIX.md`, `docs/requirements/sources/README.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/operations/LOCAL_SETUP.md`, `docs/operations/FINAL_SETUP_CHECKLIST.md`, `docs/reports/LOCAL_E5_EMBEDDING_REPORT.md`, `.superpowers/sdd/progress.md`.

- [x] Reconcile latest human source with historical provider embedding assumptions in current authority documents; preserve reports as dated history.
- [x] Run `pnpm typecheck`, `pnpm lint`, relevant/full single-worker tests including both LINE suites and optimized build; inspect results. Keep live generation disabled and document pending import/review/publication/business flows.
- [x] Record actual cache locations/offline evidence, changed files, DB/UI scope, commands, failures/review provenance, manual actions and old-cache cleanup decision. Review explicit staged files for credentials/weights/venv/originals before authorized commit/push; verify remote hash. Source checkpoint `ac487de96588acce77939d17152a1afaada77a87` pushed; remote `ls-remote` matched exactly.

## Resumption gate

EMB-01…04 component evidence plus EMB-05 regression evidence are prerequisites for live RAG embedding use. Import parsing can continue independently, but no document publication/indexing or generated answers are claimed from a healthy embedding endpoint. M7 preview/review/publication, M8 fixed datasets and M9/Flow A–F stay required.
