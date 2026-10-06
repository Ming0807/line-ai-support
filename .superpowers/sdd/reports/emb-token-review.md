# EMB-TOK-01 scoped review

Date: 2026-10-06
Task: IMP-03B-2 / Task4C-1
Reviewed source checkpoint: `HEAD 611e631e16cda8cb58e2e082cc6f27a563a664be` plus the current working-tree implementation. The product changes were uncommitted during review.

## Finding

No concrete Task4C-1 issue found in the reviewed service, client, or focused tests.

The service counts the raw input after adding exactly one `passage: ` prefix. `prefixed_token_counts` calls the already loaded tokenizer with `truncation=False` and `add_special_tokens=True`; `encode` calls the same helper before invoking `model.encode`, so the count and inference paths share the tokenization boundary. Counts above 512 are returned by `/tokens/count` and rejected by `/embed` before encoding. The count handler never invokes `model.encode` and does not include input text or token IDs in its response.

`BatchRequest` and `check_text` enforce a 1–16 passage batch and the 6,000 UTF-8-byte text limit. `PrivateRequestMiddleware` caps POST bodies at 600,000 bytes before parsing, including streamed bodies without `Content-Length`, and applies `Cache-Control: no-store`. The endpoint uses the existing authentication dependency. Counting and embedding share a nonblocking lock and release it in `finally`; busy requests return the fixed 503 code. Validation and tokenizer errors use fixed responses without echoing input.

The client exposes counting through the local E5 capability, separate from the general `EmbeddingProvider` contract. It checks the fixed model/revision/dimension, positive integer counts, response bounds, and exact result cardinality. It reuses the existing request path, which rejects redirects, caps response reads, and enforces timeout and caller cancellation. The service loads only the configured pinned cache with offline flags and `local_files_only=True`; counting itself accesses the loaded tokenizer and has no model-loading or download path.

The middleware replays the bounded request body to FastAPI, and regression tests cover the existing `/health`, `/embed`, and `/embed/batch` behavior plus private validation responses. No SQL, publication, Provider UI, or unrelated embedding-adapter change was part of this review.

## Verification

- `services/embedding/.venv/Scripts/python.exe -m unittest discover -s services/embedding -p test_app.py` — **21 tests passed**. The run emitted the existing Starlette `httpx` test-client deprecation warning.
- `pnpm exec vitest run tests/local-embedding-client.test.ts` — **18 tests passed** (Node runtime from `C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`).

Root separately reported a D-cache offline model load with zero network attempts and a real HTTP check: a Thai passage of 1,204 tokens was counted and rejected by `/embed` with 422, while the returned smoke-test vectors had 384 dimensions and unit normalization. That real-model check was not rerun by this reviewer.

## Scope and limits

This review covered `services/embedding/app.py`, `services/embedding/test_app.py`, `lib/knowledge/embedding-client.ts`, and `tests/local-embedding-client.test.ts`, against the Task4C-1 plan and the exact passage-count section of the embedding design. The two focused suites use a fake model; this review did not run the full unit suite, build, database checks, or another real-model load. Task4C-2 located preparation, Task4C-3 location/citation persistence, publication effects, approved-corpus acceptance, and full M7/V1 acceptance remain separate work and are not claimed here.
