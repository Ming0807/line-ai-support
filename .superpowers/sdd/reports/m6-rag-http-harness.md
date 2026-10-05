# M6 deterministic RAG HTTP harness

Added `scripts/qa/rag-flow-http.ts` as a local-only acceptance harness. It targets only `http://127.0.0.1:3001` and a fixed PostgreSQL connection at `127.0.0.1:54422`; it reads `ENCRYPTION_KEY`, `LINE_STUDENT_CHANNEL_SECRET`, and durable webhook mode without printing secret values. Preflight requires idle inbox/outbox/AI-job queues and zero preexisting provider/model rows before installing encrypted fixture credentials and explicit generation and 2-dimensional embedding models.

The harness signs student webhook requests, verifies a durable AI job exists before any provider call and that intake emitted no premature system response, then exercises the configured worker through `createConfiguredKnowledgeProducer(pool, key, { fetchImpl })`. This uses the production store, provider registries, generation and embedding gateways, retrieval transaction, and answer producer. Native OpenAI Responses and embeddings adapters receive an injected fake transport that accepts only `api.openai.com` and the two expected endpoints. LINE outbox delivery uses an injected fake transport restricted to `api.line.me`. The harness checks at fake HTTP boundaries that no harness DB transaction remains open. Current and historical reviewed controlled fixtures share one unique test family and embedding fingerprint; their content is stored only in the test database and is never used to approve or stage corpus sources.

Assertions cover backend-selected current citation/page, explicit historical retrieval after an opaque NEW context choice, signed redelivery idempotency, persisted provider usage observations, and a ticket takeover while the fake answer request is paused. The takeover must suppress the result and leave no AI outbox row. Cleanup is scoped to fixture-generated IDs, session, provider, family, documents/chunks, ticket, route choices, AI jobs, usage/error observations, inbox events, and outbox deliveries.

## Validation state

- The harness was deliberately **not run**; it is prepared for the root agent to run after starting the isolated server on port 3001.
- File-scoped ESLint passed for the harness.
- A standalone file-scoped `tsc` invocation was attempted, but TypeScript pulled the app import graph and could not resolve the project alias in `lib/auth/staff.ts` without the repository tsconfig. No full-project check was run here.
- No provider network calls, LINE OA sends, development database access, environment edits, commit, or push were performed.

## Subsequent root execution

Root ran the actual signed HTTP harness against the isolated production server. Current and historical citations, durable enqueue before provider HTTP, redelivery, takeover suppression and nine matching usage/controlled-provider calls passed. The first run exited1 during cleanup because usage rows referenced a conversation; root corrected cleanup order, recovered only the owned fixture, and reran the entire harness successfully with exit0 and complete cleanup. All HTTP transport remained injected; no paid call or real OA send was made. Full project unit/type/lint/build checks are recorded in the root M6 report.
