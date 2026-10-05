# IMP-03A-WARNINGS — review warning references

Reviewed and implemented 6 October 2026. Scope is limited to pure, server-computed warning references; this is not review-draft persistence, a disposition policy, publication acceptance, or M7 acceptance.

`lib/imports/review-warnings.ts` exports the requested `ReviewWarning`, `buildReviewWarnings(preview)`, and `assertReviewWarningBindings(entries, dispositions)` APIs. `ImportPreview` and `SourceLocation` are type-only imports. Parser warning order, severity, count and cloned location evidence are preserved. Analysis flags are appended in source order only once, skipping codes already represented by parser warnings. Analysis source, sensitivity, academic-year and family ambiguity warnings are `BLOCKING`; other analysis flags, including `STRUCTURED_SCHEMA_UNAVAILABLE`, are `REVIEW` so the caller can apply its action-specific gate.

Each SHA-256 key binds a domain tag, job ID, exact extraction revision, warning source and source-array index, plus a deterministic serialization of the complete warning record. Parser disposition is included in that key material. Locations are serialized in discriminant-specific field order. Keys contain neither original checksum nor extracted text and are opaque references, never permissions. Binding validation rejects duplicate generated entries, duplicate supplied keys, malformed/unknown keys with `IMPORT_REVIEW_WARNING_INVALID`; an omitted disposition remains unresolved. Neither helper changes its inputs or grants approval.

Test-first evidence:

- The first focused run with a static import failed test collection (`Cannot find module '../lib/imports/review-warnings'`, 0 tests). I changed the test loader to assert API presence so the feature-missing RED ran as behavioral assertions: 5 tests failed because the helper module was absent.
- `pnpm exec vitest run tests/import-review-warnings.test.ts --maxWorkers=1` after implementation and the source-index regression: **6/6 passed**. Coverage includes stable opaque references, job/extraction/source-index binding, complete parser-record changes, location/order preservation, analysis de-duplication/severity, input immutability, and unknown/duplicate rejection.
- `pnpm exec eslint lib/imports/review-warnings.ts tests/import-review-warnings.test.ts`: **passed**.

No database, API, warning disposition, auth, publication, retrieval, board, or design behavior was changed. Whole-workspace typecheck/build were not run during root integration QA; those checks remain with root. Files owned in this slice are only `lib/imports/review-warnings.ts`, `tests/import-review-warnings.test.ts`, and this report.
