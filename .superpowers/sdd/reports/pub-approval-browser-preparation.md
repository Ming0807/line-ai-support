# PUB-04 isolated approval browser QA preparation

Prepared 6 October 2026. Scope is limited to the approval QA runner and this report. The runner targets only http://localhost:3001 and a caller-supplied PostgreSQL URL whose host is loopback, port is 54422, and database name matches yru_publication_ui_qa_<12 lowercase hex>. It verifies current_database() after connecting and does not create, reset, or delete database state.

The runner reads the ignored development staff credential file in memory and never emits an email, password, account identifier, job/document/family identifier, database URL, key, original text, response body, or raw exception. Progress/result files contain static check names and safe status fields only. Failure files contain only a static stage and fixed error category. Retained screenshots use the synthetic fixture. The script leaves the synthetic source, job, publication receipt, document, chunks, and vectors in the isolated QA database.

The setup path uploads a unique synthetic HTML original without an official source URL, verifies that initial import analysis remains disabled until a real receipt-null response arrives, runs the real local extraction and located E5 plan, then saves a complete v2 INTERNAL/RAG review with the plan digest and five attestations. A remount with failed review and publication-status reads verifies the read-only gate and recovery controls. Approval success uses the real API, local E5 provider, application server, and isolated database. The only browser-route fixtures are failed review/publication-status reads, a cross-job receipt response, and fixed 503/422/409 approval failures. The 503 approval route is held briefly to inspect parent locking; an actual approval response is deliberately interrupted after the request reaches the real server, then the UI recovers through the real receipt GET.

Planned coverage includes 390 px and 1440 px layouts, keyboard confirmation, unchecked confirmation and disabled submit, cancellation without POST, dirty-draft reset/blocking, pending parent guards, draft preservation after fixed failures, review/source-status fail-closed behavior and retry, cross-job DTO rejection, actual approval and uncertain-response recovery, completed receipt, exact same-bound replay, original-byte retrieval, stored INTERNAL/E5 provenance, and anonymous plus both staff-account denial.

Screenshot batches are written beneath .superpowers/staging/import-preview/publication-browser/ as batch-1-before-approval-desktop.png, batch-1-before-approval-mobile.png, batch-2-completed-desktop.png, and batch-2-completed-mobile.png. Safe progress.json, result.json, or failure.json summaries use the same directory.

Preparation verification: Node syntax check and scoped ESLint passed. During the first execution, the runner reached analysis successfully but timed out locating the source textarea because its accessible name included nested helper text. The runner now uses the existing extraction-editor CSS classes for those controls. I also corrected a `page.waitForFunction` call that passed the expected value as a third argument, where Playwright expects options.

Run in PowerShell after supplying the root-provisioned environment values without printing them:

    $env:APP_BASE_URL = 'http://localhost:3001'
    $env:PUB_QA_DATABASE_URL = '<root-provided loopback database URL>'
    $env:PLAYWRIGHT_RUNTIME_PATH = 'C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
    node scripts/qa/knowledge-publication-browser.mjs

The runner intentionally retains the synthetic publication and originals as recovery evidence. This report and script do not claim standalone production acceptance.

## Actual isolated browser execution

Executed 6 October 2026 against the root-provisioned compiled application at `http://localhost:3001` and the loopback-only `yru_publication_ui_qa_<12hex>` database on port 54422. Environment values were read from the ignored runtime file in memory and were not printed. The first run stopped at `parsed_source_render`; after correcting the selectors and Playwright call above, the full runner returned `PASS`.

The passing run covered all ten named checks in `result.json`: owned-database/local-target verification; receipt-gated analysis; failed review/publication reads and recovery; wrong-job receipt rejection; unchecked confirmation, cancel, dirty reset, keyboard confirmation, and 390/1440 px layouts; held 503 parent locking and draft preservation for 503/422/409; real INTERNAL/E5 approval after an interrupted response and receipt recovery; exact replay, unchanged retained original bytes, and stored chunk/vector provenance; completed desktop/mobile layout; and anonymous plus both staff accounts denied approval/receipt access. The runner observed no direct browser call to the embedding provider.

Execution checks:

    node --check scripts/qa/knowledge-publication-browser.mjs       PASS
    pnpm exec eslint scripts/qa/knowledge-publication-browser.mjs   PASS
    node scripts/qa/knowledge-publication-browser.mjs               PASS (isolated local run)

The executed Node binary was the bundled workspace Node at `C:\Users\NOTEBOOK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`; Playwright loaded from `PLAYWRIGHT_RUNTIME_PATH`. The last command was launched in PowerShell with `APP_BASE_URL` and `PUB_QA_DATABASE_URL` sourced from the ignored runtime JSON, without printing the URL or credentials.

All four planned synthetic screenshots were written for root review: `batch-1-before-approval-desktop.png`, `batch-1-before-approval-mobile.png`, `batch-2-completed-desktop.png`, and `batch-2-completed-mobile.png` under `.superpowers/staging/import-preview/publication-browser/`. The passing result is isolated browser evidence for this scenario; it is not a claim of overall product acceptance.
