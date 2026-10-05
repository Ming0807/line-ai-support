# Local E5 embedding foundation — 5 October 2026

Status: **Local automated/component acceptance PASS; full V1 and deployment remain incomplete.** This implements [human update](../requirements/sources/2026-10-05-local-e5-embedding.md), [EMB plan](../superpowers/plans/2026-10-05-yru-local-e5-embedding.md) and DEC-021/022. Root performed service/cache/backend/DB/UI/integration and self-review. No new independent Luna review is claimed: the PDF agent hit its usage limit; its unfinished Import verdict does not count as embedding review.

## Cache evidence

- Detected source: `C:\Users\NOTEBOOK\.cache\huggingface\hub\models--intfloat--multilingual-e5-small`; no HF_HOME/HF_HUB_CACHE/ST override was set in the inspecting shell. Existing `/health` on8000 reported E5/384.
- Destination root: `D:\AI\Models\huggingface`; preserved selected repository layout under `hub/models--intfloat--multilingual-e5-small` with refs/blobs/snapshots/.no_exist. Copied19files,493292868bytes; every file hash matched. No token/account file or unrelated model was copied.
- Selected existing snapshot `614241f622f53c4eeff9890bdc4f31cfecc418b3` loads from D: with offline flags/local-only/no-remote-code, while socket connect/connect_ex are blocked. Observed networkAttempts0, Thai query/English query/passage vector lengths384 and norms1.0. No model/package download was performed for this update.
- C: is preserved. **The selected model repository on C: may be removed manually after the verified D: service is in use.** This is not permission/evidence to delete the entire Hugging Face cache, other models, tokens or the user's Python environment. No automatic removal occurred.

## Changed runtime contracts/files

- `services/embedding/app.py`, `.env.example`, `run.py`, `verify_cache.py`, `test_app.py`, `requirements.txt`, `requirements-test.txt`, `README.md`: controlled lifespan CPU load, literal configurable service env, offline fixed snapshot, health, query/passage and bounded16-passage batch. Strict input/6000UTF8 bytes/512token rejection, normalized384 vectors, fixed errors, serialized encode and optional constant-time Bearer authentication. No-key service denies non-loopback callers; supported runner also blocks remote binding without a key.
- `lib/knowledge/embedding-space.ts`, `embedding-client.ts`, `embedding-preparation.ts`, `embedding-status.ts`: endpoint-independent fixed vector fingerprint, Zod model/revision/dimension/finite/nonzero/norm validation, 256KiB response cap, abort/timeout/controlled unavailable, reviewed location-preserving chunk drafts and active-admin status checks. Infrastructure HTTP is outside SQL.
- `lib/knowledge/configured.ts`, `lib/ai/configured.ts`: default embeddings call local E5 without requiring a dashboard embedding entry, generation key or external embedding registry. Existing chat registry/FREE_ONLY policy stays in place.
- New migration `20261005161817_local_e5_vector_space.sql`: generated `embedding_e5 vector(384)` only for canonical fingerprint, with384/normalized cohort constraint. Legacy generic vectors are preserved; no conversion/delete/reindex. `retrieval.ts` selects the E5 projection/typed query cast for that fingerprint and keeps current/effective/applicability/authority filters and legacy path. Existing scope index/exact cosine remains; no ANN/new browser grants/RPC.
- `/providers` forms/page/CSS: normal generation/reasoning model controls only; no Embedding tab/purpose/dimension input. Read-only E5/384/Local/health/time/status panel, no cache/path/endpoint/key. `/api/knowledge/embedding/health` denies unauthenticated/non-admin subjects and reauthorizes after HTTP; controlled errors expose no raw upstream data.
- Tests/scripts/config/docs: service/client/composition/health/preparation/DB/browser checks, `.env.example`, `.gitignore`, `.gitattributes`, ESLint generated-venv exclusion, task/design/requirements/decisions/setup docs. The local root/service `.env` were configured and remain ignored; other application credentials were preserved.

## Observed verification

| Gate | Observed result / scope |
|---|---|
| Service unit `python -m unittest discover -s services/embedding -p test_app.py` |11PASS; fake model tests, not live inference evidence |
| Offline `python services/embedding/verify_cache.py` |D-only snapshot, networkAttempts0,384x3,unit norms PASS |
| Real backend `pnpm exec tsx scripts/qa/local-embedding.ts` |health actualHTTP200; Thai/English/query/passage384 normalized; controlled real connection refusal; no generation/corpus import |
| Focused backend/status/preparation |21PASS included in full suite; model/revision/dimension/norm/response/deadline/error/authorization/default composition checks |
| PostgreSQL E5 + existing knowledge suites |11PASS; actual typed projection, insert/search/location/current eligibility/wrong-dimension rejection/legacy preservation/RLS |
| Full unit `pnpm test --maxWorkers=1` |1197/1197 across75files, including both Student/Staff LINE suites and retained Import parser work |
| Full `pnpm test:db` |112/112:85core+7provider+2E5+11staging+6Storage+1actualStorageHTTP, foundationRLS PASS |
| Isolated migration replay |22migrations and foundationRLS PASS; existing DB/auth data not reset/copied |
| Local security/performance advisors |0warning/error issues |
| `pnpm typecheck`, `pnpm lint` |PASS; lint excludes generated Python virtualenv dependencies, not application source |
| `pnpm build` |PASS; compiled embedding-health API, providers and both OA webhook routes. No model/venv/service Python paths in Next output tracing manifests |
| Actual authenticated browser |6checks PASS: read-only healthy384/no embedding configuration, backendAPI200, desktop1440/mobile390 no horizontal overflow, keyboardfocus, no browser request to8000; screenshots visually reviewed |

Guarded DEVELOPMENT synchronization: preflight/CLI dry-run identified only migrations20/21/22, then `scripts/database/apply-development.ts --apply` applied them and verified22migrations,33applicationtables/allRLS and9departments without replacing existing values. `verify-development.ts` passed actual anon/inactive/cross-department/browser/server-grant rollback fixtures; catalog check confirmed a generated `vector(384)` column. Local22 is also observed. No production migration was performed; DEV private Storage bucket/runtime policy verification remains a separate Import/deployment gate. This is combined working-tree evidence, not M7 preview/publication/full V1 acceptance.

## Failures corrected / limits

- Test-first RED:9service missing configuration/factory, backend module unavailable, configured registry dependency2failures, health route missing, E5 PostgreSQL column absent and preparation module missing. Runtime regressions reproduced no-key remote-client acceptance and raw tokenizer exception; corrected and11service tests pass. Response identity was added to inference as well as health;4positive composition/client/preparation cases went RED then GREEN.
- Corrected test fixture mistakes: pgvector `format_type` qualification depends on search_path; test now checks namespace and384 typmod. Vitest vector cases now pass a vector object instead of spreading array elements. No production acceptance constraint was weakened.
- Whole lint initially inspected third-party JS in the user's untracked `.venv`; generated dependency directories are now ignored. A pending PDF warning-map type error was repaired without changing parser behavior; that Import agent did not supply a final independent verdict.
- Existing pinned Starlette/TestClient emits an httpx deprecation warning; tests work and no unnecessary package upgrade was made. SentenceTransformers emits a dimension-method rename warning during load; observed API works. CPU latency is local evidence, not a throughput SLA. HTTP cancellation does not terminate a running CPU kernel.
- Extraction→chunk/vector draft preparation is available; authenticated M7 review/version/publication and real approved-corpus indexing remain required. Historical vectors are retained, not silently converted to E5. No187-resource import, paid call, new live generation, new real OA/Flow A–F or production deployment is claimed. `YRU_AI_ENABLED=false` observed.

## Start and human actions

From repo root in PowerShell (existing env/venv/cache already set up):

```powershell
& services/embedding/.venv/Scripts/python.exe services/embedding/run.py
pnpm dev
```

Embedding service is currently running hidden on127.0.0.1:8000; do not start a second instance on the same port. No dashboard Embedding model entry is required. Next.js default server URL is localhost8000; `/providers` displays observed health. At future deployment transfer weights/cache separately, configure URL and authenticated HTTPS/key/private networking, then run real host checks. Keep/release the old selected C: model cache manually at your preference; no deletion is necessary to continue. Other human-only generation/corpus/OA/deployment steps remain in [final checklist](../operations/FINAL_SETUP_CHECKLIST.md).
