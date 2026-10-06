# Local E5 embedding infrastructure

Selected by the human update: `intfloat/multilingual-e5-small`, CPU, normalized 384-float vectors, pinned existing cached revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`. This service performs semantic embedding, while free chat/generation models receive the question and retrieved context. [Architecture](../../docs/architecture/EMBEDDING_SERVICE_DESIGN.md).

Run from the repository root in PowerShell using the existing virtualenv:

```powershell
# Only on a fresh setup, copy and edit the example; preserve an existing .env.
Copy-Item services/embedding/.env.example services/embedding/.env
# The local .env already points to the copied D: cache on this machine.
& services/embedding/.venv/Scripts/python.exe services/embedding/run.py
```

`run.py` validates `EMBEDDING_HOST` and requires `EMBEDDING_API_KEY` for non-loopback binding. Default `127.0.0.1:8000`. Set the same optional key in Next.js server config; remote deployment needs HTTPS/private networking. Do not expose an unauthenticated public service or call it from browser code. Change `EMBEDDING_API_URL` in Next.js to move this same vector space to a university host/VPS/container; URL/key changes do not invalidate the cohort fingerprint.

On this machine dependencies and the virtualenv already exist. `requirements.txt` records observed versions; do not reinstall/download model weights just to start the service. For a fresh host, create a Python 3.13 virtualenv and install pinned dependencies separately, transfer the model cache and configure its root before starting. Weights, `.venv`, cache, logs and `.env` are ignored and never bundled with Next.js.

Cache root is configured in service `.env` as `EMBEDDING_MODEL_CACHE_DIR`; `HF_HOME` points there, the hub/ST cache points to `root/hub`. Load only the local pinned snapshot with offline flags, `local_files_only=True`, CPU and no remote code. Missing/corrupt cache fails startup; there is no download or fallback to C:. Copy the cache structure, not just one weight file. Leave the old cache until offline load and live HTTP pass; never delete it automatically.

API (include server-to-server Bearer key when configured):

- `GET /health`: loaded model/revision, dimension 384, status `ok`; no paths.
- `POST /embed`: `{ "text": "การเทียบโอนรายวิชาต้องทำอย่างไร", "type": "query" }`.
- `POST /embed`: `{ "text": "Reviewed document chunk", "type": "passage" }`.
- `POST /embed/batch`: `{ "texts": ["First chunk", "Second chunk"], "type": "passage" }` (1–16).
- `POST /tokens/count`: same raw passage batch; fixed model/revision/384 and ordered `tokenCounts`, including counts above512 to let backend preparation split. Counts include the single service-added passage prefix and special tokens; no vectors/encoding/text echo. Uses the same authentication and non-queuing lock as inference.

Callers send raw text. The service adds `query: ` / `passage: ` exactly once per request and normalizes output, as specified in the [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md). Limit 6000 UTF-8 bytes/text and 512 tokenizer tokens including prefix/special tokens; oversized inputs are rejected, never silently truncated. CPU encode is serialized; concurrent busy inference returns controlled 503. A client timeout cancels waiting for HTTP, not an already executing CPU kernel. No claim of production throughput is made by a local successful request.

Verification:

All responses use `Cache-Control: no-store`. Validation diagnostics are fixed without source text. POST bodies are bounded before JSON parsing at600,000bytes, which permits valid16×6,000byte texts even when JSON escapes every character. Token counts are positive integers≤16,384; malformed tokenizer output fails with a fixed503. Counting is a preparation capability: it does not grant review, approval or publication.

```powershell
& services/embedding/.venv/Scripts/python.exe -m unittest discover -s services/embedding -p test_app.py
& services/embedding/.venv/Scripts/python.exe services/embedding/verify_cache.py
pnpm exec tsx scripts/qa/local-embedding.ts
```

The offline verifier blocks socket connects, loads the configured snapshot and checks Thai/English/query/passage lengths and norms without printing vectors. Unit tests inject a fake model; they are not offline-cache or real inference evidence. The existing Starlette/TestClient version emits a deprecation warning for `httpx`; it still runs, and no unnecessary package upgrade is included.
