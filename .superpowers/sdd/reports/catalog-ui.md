# CAT-02 catalog UI report

**Date:** 2026-10-06  
**Owner:** Codex delegated implementation (Luna high)  
**Scope:** `app/(dashboard)/knowledge/catalog-panel.tsx`, `app/(dashboard)/knowledge/page.tsx`, append-only `.knowledge-catalog-*` rules in `app/knowledge.css`.

Added a read-only catalog above the existing import-job list while retaining the server-rendered SUPER_ADMIN check, breadcrumb, job list, and import links. The panel uses the frozen browser-safe schemas for all three private GET envelopes, exact query keys, `no-store` same-origin requests, abort/serial guards, and cross-response identity/page checks. Search drafts apply only on submit. Family history, document metadata, and recorded relationships appear in labelled inline regions with truthful counts and bounded pagination. It shows stored lifecycle/current/visibility/effectiveness separately, labels null mode/time as unknown, and links only HTTPS source URLs without credentials. It includes loading, retry, filtered-empty, and no-approved-version states, keyboard focus on opened regions, and responsive wrapping. It performs no mutation and fetches no source body.

**Checks run:**

- `pnpm exec eslint 'app/(dashboard)/knowledge/catalog-panel.tsx' 'app/(dashboard)/knowledge/page.tsx'` — passed.
- Impeccable detector for the three scoped targets — passed with no findings.
- `pnpm exec tsc --noEmit` — blocked by CAT route modules not yet present (`catalog`, `families/[id]`, `documents/[id]`) and a `Request` assertion error at `tests/knowledge-catalog-routes.test.ts:14`; no diagnostics referenced the assigned panel or page.

No component/browser/API runtime test was run. Root owns the route implementation and will run compiled browser acceptance after integration. This report is implementation evidence, not an independent review or catalog acceptance.
