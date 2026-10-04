# M6 Provider Model Purpose Configuration

## Scope

Add explicit generation and embedding purposes to provider models. Generation remains the default for clients that omit both new properties. Embedding configurations require dimensions from 1 through 4096 and cannot enable generation capabilities. The dashboard exposes purpose and dimensions and clears incompatible values when changing purpose.

## Test-first validation

`tests/provider-model-purpose.test.ts` was added before production changes and run with the focused Vitest command using one worker. RED was confirmed: 2 tests failed because legacy model payloads do not return the requested defaults and embedding payloads are rejected as unknown properties. The other 8 invalid configuration cases already rejected through the old schema. After the root-owned local database migration, the schema, persistence mapping, and dashboard form were implemented. Focused validation now passes: 14 schema cases with one Vitest worker and targeted ESLint on the assigned implementation, test, and browser runner files.

Root reports that additive migration `20261004125859_knowledge_rag.sql` applied locally and its schema constraint checks passed 3/3. No remote migration was applied by this task.

## Reviewed model limit correction

The schema now uses the shared `isEmbeddingDimensionAllowed` policy. Added regression cases for the native OpenAI model limits: `text-embedding-ada-002` must use 1536 dimensions, `text-embedding-3-small` allows at most 1536, and `text-embedding-3-large` allows at most 3072. Their accepted maxima pass; out-of-limit cases failed before the schema integration and pass afterward. Unknown explicit model IDs retain the documented 1–4096 allowance. The dashboard still requires a user-entered dimension and supplies no suggestion or default.

Focused Vitest passes 20/20 with one worker; targeted ESLint on the schema and test passes. Browser/DB QA remains pending the root-owned production build and local run.

## Browser validation

`scripts/qa/provider-embedding-browser.mjs` exercises the embedding UI and safe API DTO using local fixtures and the three real staff accounts. It clears its own local provider/model/audit/auth mirror fixtures and avoids provider HTTP/health calls. The script passes `node --check` and remains unexecuted pending the root-owned local production server run.
