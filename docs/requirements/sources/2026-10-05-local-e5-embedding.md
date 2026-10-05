Update the YRU AI Helpdesk architecture to use the existing local
`intfloat/multilingual-e5-small` model as the DEFAULT and PRIMARY
embedding model for the project.

IMPORTANT CONTEXT

I already installed and tested a local FastAPI embedding service.

Current model:
- Model: intfloat/multilingual-e5-small
- Runtime: CPU
- Embedding dimension: 384
- No GPU
- Machine: Intel i5 11th Gen, 16 GB RAM
- FastAPI health endpoint already returns status OK.
- Current local embedding API is expected to run at:
  http://127.0.0.1:8000

The model has already been downloaded into the default Hugging Face
cache on Windows.

DO NOT download the model again unless the existing cache is genuinely
missing or corrupted.

==================================================
GOAL 1 — MOVE THE EXISTING MODEL CACHE TO DRIVE D
==================================================

First inspect the actual current Hugging Face / SentenceTransformers
cache location.

Typical source may be similar to:

C:\Users\<user>\.cache\huggingface

but DO NOT assume the exact username/path.
Detect the real existing path first.

Move/copy the already-downloaded model/cache to a stable location on D:

D:\AI\Models\huggingface

Requirements:

1. Preserve the Hugging Face cache structure.
2. Do not delete the original cache until the model successfully loads
   from Drive D.
3. Do not redownload the model unnecessarily.
4. Verify that:
   `intfloat/multilingual-e5-small`
   loads successfully using only the D: cache.
5. Verify the embedding output dimension is exactly 384.
6. Verify `/health`.
7. Verify `/embed` with a Thai query.

Suggested test:

{
  "text": "การเทียบโอนรายวิชาต้องทำอย่างไร",
  "type": "query"
}

Expected:
- HTTP 200
- dimension = 384
- embedding array length = 384

After successful verification, tell me whether the old C: cache can
safely be removed. Do NOT remove it automatically.

==================================================
GOAL 2 — MAKE MODEL LOCATION CONFIGURABLE
==================================================

Do not hardcode a user-specific path in application source.

Add configuration such as:

EMBEDDING_MODEL=intfloat/multilingual-e5-small
EMBEDDING_DIMENSION=384
EMBEDDING_API_URL=http://127.0.0.1:8000
EMBEDDING_MODEL_CACHE_DIR=D:\AI\Models\huggingface

Use an appropriate service-specific `.env` or configuration mechanism.

If Hugging Face requires HF_HOME, SENTENCE_TRANSFORMERS_HOME,
cache_folder, or another compatible mechanism, configure it correctly.

Prefer the smallest reliable solution.

Secrets must not be committed.

==================================================
GOAL 3 — EMBEDDING SERVICE ARCHITECTURE
==================================================

Treat the local FastAPI embedding service as infrastructure.

Desired architecture:

Next.js Backend
        |
        | HTTP
        v
FastAPI Embedding Service
http://127.0.0.1:8000
        |
        v
intfloat/multilingual-e5-small
CPU / dimension 384
        |
        v
Supabase pgvector

Create or clean up the embedding service under a clear location such as:

services/embedding/

It should expose at minimum:

GET /health

POST /embed

Optional later:
POST /embed/batch

For E5 usage:

- user search/question:
  prefix with `query: `

- document chunks:
  prefix with `passage: `

Use normalized embeddings.

Do not add Ollama.

Do not require a GPU.

==================================================
GOAL 4 — MAKE THIS THE DEFAULT EMBEDDING MODEL
==================================================

The Admin Dashboard should NOT require the administrator to configure
or choose an embedding model for normal V1 operation.

`multilingual-e5-small` is the system default embedding model.

The embedding configuration should come from infrastructure/config,
not from the normal AI Provider UI.

The AI Provider / Model pages should primarily manage CHAT /
GENERATION / REASONING models.

Do not require users to create an Embedding model entry manually in
the dashboard.

If an existing UI currently has:

- usage type = Embedding
- embedding dimension
- embedding provider selection

change the V1 behavior so that normal admins do not need to configure
these fields.

Preferred behavior:

Knowledge / System status may display a read-only section:

Embedding Service
-----------------
Model: multilingual-e5-small
Dimension: 384
Mode: Local
Endpoint: Connected / Disconnected
Health: Healthy / Unavailable

Do NOT expose unnecessary local filesystem paths in the normal admin UI.

Do NOT delete architecture flexibility completely.
Keep an internal interface so another embedding provider/model can be
added in the future.

Example abstraction:

EmbeddingProvider
  embedQuery(text)
  embedPassages(texts)
  healthCheck()
  dimension

Implementation V1:
LocalE5EmbeddingProvider

But there is only one default implementation for now.

==================================================
GOAL 5 — CONNECT NEXT.JS TO THE EMBEDDING SERVICE
==================================================

Implement a small backend client, for example:

lib/knowledge/embedding-client.ts

or the appropriate existing architecture.

It should support:

embedQuery(text)

embedPassages(texts)

healthCheck()

Requirements:

- validate responses with Zod
- require dimension = 384
- support timeout
- useful errors
- never call the embedding service directly from the browser
- all calls go through the backend/server
- do not expose internal endpoint details unnecessarily

Do not integrate AI generation yet unless the current milestone already
requires it.

==================================================
GOAL 6 — PREPARE SUPABASE PGVECTOR FOR DIMENSION 384
==================================================

Inspect the existing knowledge_chunks schema/migrations.

The vector column used for this model must be compatible with:

vector(384)

Do NOT blindly edit an already-applied production migration.

This is currently development work.

Use the appropriate reviewed migration strategy.

Also ensure the vector search function/indexes use the same dimension.

Add tests that prevent accidentally inserting a vector with the wrong
dimension.

==================================================
GOAL 7 — PREPARE THE RAG FLOW
==================================================

Do NOT blindly import all YRU documents yet.

Prepare the code path:

Document
→ extraction
→ clean
→ chunk
→ add `passage: ` prefix
→ local embedding service
→ vector(384)
→ knowledge_chunks in Supabase

At question time:

Student question
→ add `query: ` prefix
→ local embedding service
→ query vector(384)
→ pgvector similarity search
→ retrieve relevant current YRU chunks
→ later send retrieved context to the chat/generation model

IMPORTANT:

The generation/chat model must NOT perform embedding itself.

The embedding model is responsible for semantic search.

The generation model receives only:
- user question
- retrieved context
- instructions/tools

==================================================
GOAL 8 — DEPLOYMENT-FRIENDLY DESIGN
==================================================

Local development:

EMBEDDING_API_URL=http://127.0.0.1:8000

Future deployment:

The same FastAPI service may run on:
- University server
- VPS
- Cloud Run
- another private server

The Next.js/RAG code must not care where it runs.

Deployment should only require changing:

EMBEDDING_API_URL

For an internet-accessible embedding service, leave room for:

EMBEDDING_API_KEY

or another server-to-server authentication method.

Do not implement public unauthenticated production access.

==================================================
TESTS
==================================================

At minimum verify:

1. Local model loads from Drive D without re-downloading.
2. /health returns:
   - model name
   - dimension 384
   - healthy state.
3. Thai query embedding returns 384 floats.
4. English query embedding returns 384 floats.
5. passage embedding returns 384 floats.
6. Next.js backend can call the service.
7. wrong dimension is rejected.
8. service unavailable produces controlled error.
9. existing LINE Student/Staff tests continue passing.
10. pnpm typecheck passes.
11. pnpm lint passes.
12. relevant test suite passes.

Do not claim success unless these are actually observed.

==================================================
DOCUMENTATION
==================================================

Create/update documentation explaining:

- why multilingual-e5-small was chosen
- model = intfloat/multilingual-e5-small
- dimension = 384
- local CPU deployment
- query/passsage prefixes
- local development URL
- Drive D cache location strategy
- future deployment strategy
- RAG data flow

Also update the architecture/status documentation so future Codex
sessions know that this is the selected V1 embedding strategy.

==================================================
DO NOT DO
==================================================

- Do not install Ollama.
- Do not download BGE-M3.
- Do not change to another embedding model.
- Do not download multilingual-e5-small again if existing weights work.
- Do not commit model weights to Git.
- Do not commit `.venv`.
- Do not put the model files inside the Next.js bundle.
- Do not expose the FastAPI embedding endpoint directly to browser code.
- Do not require admins to configure the embedding model in normal UI.
- Do not import all 187 YRU resources automatically.
- Do not start generation/RAG answering until the embedding foundation
  is verified.

At the end report:

1. Previous model cache location
2. New Drive D cache location
3. Whether the model loaded without downloading
4. Embedding service files changed
5. Next.js integration files changed
6. Database/migration changes
7. UI changes
8. Test results
9. Exact commands to start the embedding service
10. Any action still required from me