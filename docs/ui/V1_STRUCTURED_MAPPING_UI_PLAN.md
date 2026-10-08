# V1-UI-IMPORT-03 — Structured mapping editor

Date: 8 October 2026
Owner: delegated structured mapping UI worker (requested Luna high/max; actual runtime model metadata is not exposed in this worker session)
Status: implemented in the assigned UI slice; focused checks pass; root integration remains pending

## Linked requirements and source of truth

- Task: `V1-UI-IMPORT-03`, assigned by the root task owner.
- Requirements: CH049 (Analyze/Preview API and explicit mapping), STR-01B-0 Mapping1 contract, STR-01B-1 private review-v3 mapping and server acknowledgment, plus the import review and publication requirements in the V1 matrix.
- Product source: `docs/requirements/sources/original-document-versioning.th.md` and its source index.
- Current behavior/design: `docs/architecture/STRUCTURED_MAPPING_DESIGN.md`, `STRUCTURED_REVIEW_DESIGN.md`, `STRUCTURED_PUBLICATION_PREPARATION_DESIGN.md`, `docs/operations/BACKEND_UI_CONTRACTS.md`, and the STR-01B execution plans. The accepted backend report remains the authority for route behavior.
- Visual direction: `DESIGN.md` and the user-selected Gemini443c227 visual authority, as summarized in the current design and decision log.

## Current gap and dependencies

The server already exposes `GET /api/knowledge/imports/[id]/structured`, `GET /api/knowledge/imports/[id]/preview`, and same-origin `POST /api/knowledge/imports/[id]/structured`. The panel must consume the exact response contracts, present every extracted source table, produce only Mapping1, and surface only a server-issued acknowledgment after strict response checks. Schema3 review saving and approval remain with the root-owned review form.

The current worktree is `codex/v1-dashboard-integration` at baseline `e0a9385`; unrelated dashboard integration edits are present and are outside this task's ownership. The read-only `node_modules` junction is used for installed Next.js guidance and checks; no dependency changes are in scope.

## Scope and file ownership

Owned files:

- `app/(dashboard)/knowledge/import/structured-mapping-panel.tsx`
- `app/(dashboard)/knowledge/import/structured-client-contract.ts`
- `app/structured-mapping.css`
- focused tests and any narrowly scoped test fixture under `tests/`
- this plan and `docs/reports/V1_STRUCTURED_MAPPING_UI_REPORT.md`

The component accepts `jobId`, `savedValue`, optional `suggestedDataset`, optional `disabled`, and `onChange({mapping, acknowledgment})`. It does not save review3 or approve publication. Root integrates it with the review form and owns mode changes, saving, and approval.

## Design and behavior

1. Fetch and strictly parse the current structured source binding and preview together. Abort previous requests and guard every completion with a monotonically increasing request epoch.
2. Show a guided three-step workspace for table decisions, field bindings, and a final review. Start tables in an explicit undecided state. A table becomes selected only when the operator chooses a dataset mapping; other tables require an explicit exclusion reason and human-authored note.
3. For each selected table, include all source rows as data by default. Operators can add any number of inclusive excluded ranges, including ranges between data rows; each exclusion requires a selected reason and a manually entered note. Derive data ranges as the exact complement. Never generate exclusion notes or silently drop rows.
4. Use all seven registry datasets, exact field kinds/nullability, the complete server transform vocabulary, actual zero-based extraction column indices, and format-aware CSV/XLSX/logical source labels. Field bindings belong to each selected source table. Require at least one nonnullable column binding in every mapped table; constants remain explicit and require a real note.
5. Validate local drafts in browser-safe code. POST only after the operator reaches the review step and explicitly requests a server preview. Parse the full snapshot strictly; compare the source/review tuple, mapping, source coordinates, expected row manifest, transformed values, plan digest, payload digests, and server acknowledgment digest. Never manufacture an acknowledgment client-side.
6. On restore, preserve the saved mapping, compare its source binding to the live source, and re-prepare it against the current server tuple. Keep it as an editable draft if stale, but clear any acknowledgment/plan that cannot be revalidated. Every mapping change, including a note edit, cancels in-flight preparation and clears the acknowledgment and plan.
7. Present server `publicationAvailable` exactly as returned. The panel does not claim that mapping preview is approval, publication, installed schema, or readiness.

Edits to field values, table notes, existing row exclusions, and the new row-exclusion draft clear the current plan and acknowledgment. Any in-flight request is aborted and its epoch invalidated. Saved mappings with a changed source binding remain editable only when the table/range inventory still validates; they are rebound to the current source and have their old acknowledgment cleared. Saved acknowledgments are rechecked through the server even when the review counter advanced.

## Acceptance checks

- Browser-safe contract module has no runtime import from server/lib modules and no Node `Buffer` or `node:crypto` dependency.
- Strict source/preview parsers reject extra/malformed envelopes, incorrect job IDs, invalid coordinates, and inconsistent extraction inventory.
- Partition tests cover multiple ranges and a middle exclusion, with no gaps, overlap, or generated notes; excluded tables require an explicit reason and note.
- For all seven datasets, client registry metadata matches the server registry and exposes every accepted transform/compatibility rule.
- Server-generated fixtures pass snapshot validation; stale tuples, changed source values/coordinates, missing/extra rows, digest mismatch, and acknowledgment mismatch fail closed.
- Request-gate tests prove that edits or job changes abort and ignore stale responses.
- `pnpm exec vitest run tests/structured-client-contract.test.ts`: 9 tests pass.
- Scoped ESLint on the panel, browser contract, fixture, and focused test passes with no warnings.
- `pnpm exec tsc --noEmit --pretty false` passes for the repository at the latest check snapshot.
- Full repository suite/build and integration with the review form remain root acceptance gates; no browser session was run for this slice.

## Out of scope

No edits to `review-form.tsx`, `approval-panel.tsx`, `import-form.tsx`, `lib/**`, `app/api/**`, Supabase, catalog/knowledge surfaces, global styles, or project-wide requirement/status docs. No real-source approval, publication claim, browser credit, or model review claim is produced by this slice.
