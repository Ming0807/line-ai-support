# PUB-04 approval API review

Date: 2026-10-06

Scope: read-only review of `app/api/knowledge/approve/route.ts`, `app/api/knowledge/imports/[id]/publication/route.ts`, `lib/imports/publication-api.ts`, the `getImportPublication` addition in `lib/imports/import-publication.ts`, and `tests/import-publication-routes.test.ts`. Compared the routes with the PUB-04 freeze in `docs/superpowers/plans/2026-10-06-yru-import-publication.md` and the approval/receipt constraints in `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`.

Finding: no concrete blocker found in this scope.

The POST checks same-origin before session lookup, then authorizes an active `SUPER_ADMIN` before reading the body. It enforces JSON media type, bounds streamed input to 2,048 bytes, decodes UTF-8 strictly, and accepts only the strict confirmation schema; the route passes only the actor, validated request, and abort signal to the publication service. The existing API helpers return private no-store responses with `Vary: Cookie` and `nosniff`, and map policy, conflict, timeout, unavailable, authorization, and unexpected failures to fixed response codes. Unexpected errors are logged with a fixed event and code, without exception text.

The GET authenticates and performs active-admin authorization before resolving the path ID or querying private state. It rejects every nonempty query string, delegates to a receipt-only service read, and returns the same private response headers. `getImportPublication` reauthorizes, validates the UUID, checks the job before looking up its receipt, and does not load originals or invoke counting/embedding. The receipt projection contains only the saved binding and completion metadata.

Validation run by this reviewer:

- `pnpm exec vitest run tests/import-publication-routes.test.ts` — passed, 13 tests.
- `pnpm exec eslint --no-cache app/api/knowledge/approve/route.ts 'app/api/knowledge/imports/[id]/publication/route.ts' lib/imports/publication-api.ts tests/import-publication-routes.test.ts lib/imports/import-publication.ts` — passed.

No database suite or broader unit/build gate was run for this review. This is scoped API evidence, not PUB-04 integration or V1 acceptance.
