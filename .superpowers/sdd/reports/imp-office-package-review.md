# IMP-02C Office package review — 5 October 2026

**Reviewer:** Luna max, read-only IMP-02C-REVIEW
**Scope:** `lib/imports/office-package.ts`, `tests/import-office-package.test.ts`, with `safe-archive.ts` and the XML boundary treated as dependencies.

## Result

The package reader selects the main part from the root `officeDocument` relationship and its exact DOCX/XLSX content type, validates overrides/defaults and internal relationship targets against actual package entries, supports Transitional and Strict relationship namespaces, and parses every XML-typed part through the inert XML boundary. Path traversal, dangling targets, duplicate relationship IDs/owners, invalid modes, untyped/unsupported parts, macro content types and active relationship types are rejected. External relationships are retained only as `external: true` with `target: null`; the original URL is not returned or fetched. Errors are normalized to `IMPORT_PARSE_INVALID`.

Two concrete gaps were reproduced during review and are fixed in the current source. First, changing `[Content_Types].xml` so `.rels` used `application/xml` was accepted; the reader now requires the canonical OPC relationships media type for `.rels` parts and rejects that media type on non-`.rels` parts. Second, an `oleObject` relationship targeting an otherwise inert XML part was accepted; the reader now rejects the active relationship-type set, and the regression fixture uses an XML target so rejection does not depend on a suspicious filename or payload suffix. Corresponding tests are present in `tests/import-office-package.test.ts`.

## Verification

- `pnpm exec vitest run tests/import-safe-xml.test.ts tests/import-office-package.test.ts --maxWorkers=1`: **2 files, 41 tests passed**, including both package regression cases.
- Scoped ESLint across the XML, package, and XLSX sources and tests passed with no warnings.
- The two findings above were observed as behavioral acceptance before the corrections, then confirmed rejected by the new tests in the current implementation.

## Limits

This accepts the generic OPC boundary only; it does not accept DOCX/XLSX extraction or their semantic feature coverage. Package parsing is synchronous between archive awaits. Abort is checked between package stages, not during one `parseSafeXml` call. A bounded parser child/termination and deployment resource supervision remain separate gates. Archive correctness is a dependency and was separately reviewed; this report is not a fresh archive acceptance. Full staging, review/publication, routes, and browser behavior remain outside scope.
