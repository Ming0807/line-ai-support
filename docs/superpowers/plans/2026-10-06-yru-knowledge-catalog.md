# PUB-06 — published family/current/history catalog

Parent accepted/pushed f2aea75;requirements CH046/064,existing IMP-04/master§46,original versioning. Read AGENTS/index/board/matrix/decisions and [root-frozen catalog design](../../architecture/KNOWLEDGE_CATALOG_DESIGN.md) before work. Latest continuous user authorization covers this existing scope;no new routine permission gate. Latest DEC-035 assigns UI to Gemini in its isolated worktree, local commits/no push. Root owns DB/auth/privacy/contracts/integration/acceptance. Earlier Luna high UI draft and Luna max DTO review are dated source evidence; unavailable agents are not current reviewers.

## CAT-01 root DTO/API/repository

Files `lib/knowledge/catalog-types.ts`,`lib/knowledge/catalog.ts`,`lib/knowledge/catalog-api.ts`,`app/api/knowledge/catalog/route.ts`,`app/api/knowledge/families/[id]/route.ts`,`app/api/knowledge/documents/[id]/route.ts`,`tests/knowledge-catalog-routes.test.ts`,`tests/database/knowledge-catalog.integration.ts`,`scripts/database/test-local.ps1`. No migration.

Implement exact schema/API/service boundaries in the design. Preauthorize before touching unknown input,UUID or query getters;use fixed parameterized SQL and existing active-admin transaction wrapper. Inventory/history is approved-only but retains lifecycle/scopes;storage mode/import time are receipt-backed or unknown. No external network/SQL transaction work,content/vectors/storage path/private bodies. One statement snapshot for page/count. Matching version preview max5with true count/history pagination. Authoritative totals/department options must come from database.

Meaningful initial route/module RED→GREEN;actualPG scoped fixtures demonstrate filtering/pagination/history/legacy/receipts/metadata/roles/abort and no mutations. Existing publication/relationships/retention tests remain. Root checks source/diff/results and reports actual scope.

## CAT-02 Gemini UI (pending)

Latest human assignment supersedes the original Luna UI assignment below. [Exact Gemini prompt](../../agents/GEMINI_UI_UX_PROMPT.md) owns all Dashboard presentation in isolated `codex/gemini-dashboard-ux`, starting at `da55470`. Root does not modify/stage the main checkout's pre-handoff UI draft. Consume the [backend contracts](../../operations/BACKEND_UI_CONTRACTS.md); report local commits for root review, no push. The existing draft alone is not compiled/UI acceptance.

Prerequisite:root strict DTO contracts available. Catalog presentation lives in `app/(dashboard)/knowledge/catalog-panel.tsx`,`app/(dashboard)/knowledge/page.tsx` and `app/knowledge.css`; the latest whole-Dashboard Gemini prompt governs broader presentation ownership. Root owns backend/API/contracts/auth/privacy/DB. Read frontend/impeccable and installed Next use-client/page guides;use incumbent tokens/product-minimal typography. No runtime fixture data or server-module runtime imports in browser. Earlier Luna report `.superpowers/sdd/reports/catalog-ui.md` is dated source evidence, not Gemini authorship or current acceptance.

Default named export `CatalogPanel()`,server page inserts it above existing intake section and retains existing admin authorization/job loader/import links. Fetch three exact private GET endpoints using browser-safe schemas;strict no-store and abort/serial cleanup. Follow design's family/search/filter/pages→inline history→inline document metadata/relationship regions. Explicit stored Current vs dates/visibility;unknown legacy mode/time stays unknown. Truthful counts,all lifecycle/history states,source metadata,department/scope/authority,last import and exact links. Safe URL handling,empty/loading/retry states,mobile/keyboard/focus;no mutation logic or published-source body.

Component tests only if meaningful existing seam;root actual browser acceptance supplies runtime evidence. Report files changed,commands/results,scope/remaining concerns,author provenance;do not self-claim independent review. Keep catalog selectors scoped and preserve original/review/approval guards while redesigning presentation under the latest Gemini assignment.

## CAT-03 root backend acceptance, then combined integration

Backend files/tests are root implemented. Scoped actual PG covers five catalog groups; compiled read-only API QA uses `scripts/qa/knowledge-backend-http.mjs`, real DEVELOPMENT Auth/private Storage and the retained owned isolated local database at localhost3011. No new DDL or source approval. Record exact results and failed attempts in the [backend report](../../reports/KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md). Root self-review is the current provenance because latest Luna review assignments failed due to usage/network errors.

After Gemini submits CAT-02 commits, root inspects the diff after the handoff snapshot, adjudicates/fixes findings and runs combined type/lint/unit/realPG/build and bounded localhost-only browser acceptance. An independent review may be claimed only when an available reviewer actually completes it. Two planned screenshot batches desktop1440/mobile390,empty/error/retry/search/history/detail/pagination/keyboard/roles and existing original/review/receipt guards. Capture true calls/results,do not substitute fake success. Backend HTTP acceptance does not close these frontend gates.

Update matrix/board/catalog+system/import design/decisions/report/setup/ledger. Explicit stage/security/link/diff checks,authorized noninteractive commit/push and matching remote receipt. Retain originals/data,reuse current checkout,do not stage unrelated corpus/output/.env. No production or real-source approval. Only after catalog acceptance start M8 implementation using source-grounded proposal and root-resolved seven-schema/mapping/version/provenance/query contracts;M9/fullFlows remain.
