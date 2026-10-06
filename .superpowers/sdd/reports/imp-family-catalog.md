# IMP-03B-1-CATALOG — initial document family data

Date: 2026-10-06
Owner: `/root/m7_edit_draft` (Luna high)
Scope: `lib/imports/family-catalog.ts`, `tests/import-family-catalog.test.ts`

Implemented the pure `InitialDocumentFamily` data contract and `getInitialDocumentFamilies()` function. The catalog contains the 19 initial codes from master guide §64 in the documented order, with Thai display names and short grouping categories. It carries no authority, department, year, persistence, server, or I/O behavior. Each call returns cloned records, so consumer mutation does not affect later results. The type uses open strings; the catalog is initial reference data, not a family validator or closed allowlist.

## Verification

- RED: `pnpm exec vitest run tests/import-family-catalog.test.ts --maxWorkers=1` — exit 1; all 4 tests failed because the module/API was absent.
- GREEN: same command after implementation — exit 0; 1 file and 4 tests passed. Coverage checks exact code/order/count and uniqueness, code/name/category bounds, fresh-record mutation isolation, and the open custom-family shape.
- Scoped lint: `pnpm exec eslint lib/imports/family-catalog.ts tests/import-family-catalog.test.ts` — exit 0.

## Boundaries and review provenance

Only the catalog, its focused tests, and this report were changed. No database, seeder, API, UI, environment, or Git state was modified. The focused tests and scoped lint were run locally; no independent review or broader typecheck/build/browser evidence is claimed. Root-owned seeding, custom-family resolution, API integration, and overall M7 acceptance remain outside this slice.
