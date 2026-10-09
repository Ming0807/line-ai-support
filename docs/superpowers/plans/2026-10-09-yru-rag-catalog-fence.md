# ADV-05C-3A — fence newly matching RAG chunks

9 October 2026, root; CH032/052/USR-WEB, master §32/original overview §27. Depends on accepted internal cascade/catalog lock and C2 connector/admission preparation. Continuous human implementation authorization applies. Root owns schema/auth/privacy/contracts/acceptance; requested Luna agents remain unavailable at their usage limit.

## Problem and selected contract

Before lower-authority web search, a completed internal RAG miss must stay true through finalization and dispatch. Current catalog guards cover documents/families/relationships/departments/seven typed tables/private structured sources, but omit `public.knowledge_chunks`. A new matching chunk could therefore bypass the shared catalog lock. The only current library chunk writer is Import publication and already takes the exclusive catalog before family/document locks. Direct service SQL remains possible and must honor the same boundary.

Use a new private SECURITY INVOKER/empty-search-path statement trigger for INSERT/UPDATE/DELETE/TRUNCATE on chunks. It tries the existing exclusive transaction advisory lock `knowledge-structured-selection-catalog:v1` and fails with40001/`STRUCTURED_SELECTION_RETRY` when a shared reader holds it. It never waits after a caller's possible row lock. Keep it lock-only: reusing the updated incident epoch trigger would introduce unrelated incident invalidation. Publication already holds the lock, so reentry is permitted. No source approval, schema-per-document behavior, retained-data deletion or new HTTP/SQL overlap is introduced.

## Files and acceptance

Execution9October: all five implementation/documentation checks below are satisfied. Actual4RED→5GREEN,326PG/20groups/38replay/RLS/advisors0ERROR0WARN/normal unchanged/cleanup, fresh typecheck/scoped lint and root source review PASS. Exact staged credential/whitespace and commit/push evidence follows at the Git checkpoint. Complete-miss/source/web/delivery/Staff/FlowA–F remain required. No unavailable independent review credited.

Git checkpoint: staged credential/whitespace PASS; committed/pushed `f66503cb9a2ce39398e18324eb309e54608c59f8`, exact remote branch SHA verified without an account picker. Root source scope only; unrelated untracked originals/proposals were preserved.

- [x] Root writes `tests/database/rag-catalog-fence.integration.ts` and observes actual owned PG RED before migration.
- [x] Root CLI-generates one additive migration with the private function, exact browser/service EXECUTE grants and one statement trigger; no normal/remote apply yet.
- [x] Actual PG verifies trigger events/timing/function security/grants, shared session and transaction reader conflicts, direct DML retry without writes, cooperating exclusive writer reentry and release. An actual eligible RAG source starts EMPTY; conflicting matching-chunk insertion cannot change it; after release the insertion succeeds and the real retriever returns its exact chunk.
- [x] Register the group in the owned verifier. Run37+new migration replay/foundation/RLS/advisors/normal unchanged/cleanup and relevant publication/delivery regressions with the existing bounded partitions. Compiler/lint/source review precede acceptance.
- [x] Update report/board/matrix/design/decision and exact staged/Git evidence. Keep complete miss proof/semantic NOT_APPLICABLE and Student/Staff web integration explicitly pending.

Anticipated files: this plan, `docs/architecture/RAG_CATALOG_FENCE_DESIGN.md`, a CLI-generated SQL migration, the owned PG test, `scripts/database/verify-structured-schema.ts`, `docs/reports/RAG_CATALOG_FENCE_REPORT.md` and shared status documents. Only root owns these files. The low-level lock test is not a source-authority, complete-miss-envelope, live-web or whole-V1 pass.
