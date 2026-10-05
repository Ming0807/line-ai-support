# IMP-04A private import preview/edit UI report

Date: 2026-10-06
Task: `IMP-04A`
Requirements: CH046, CH047, CH048, CH049, CH061
Owner: delegated UI implementation agent; root owns navigation integration, API/DB/auth implementation and actual browser QA.

## Scope and behavior

Added the SUPER_ADMIN-only knowledge list and import workspace. The server pages call `requireStaff()` and reject other roles with `notFound()` before calling `listImportJobs`. The page accepts `/knowledge/import?id=<job UUID>`; the validated ID is opened from the client through the private preview API with `cache: 'no-store'`. A failed preview load does not create a selected receipt.

The UI stages PDF/DOCX/XLSX/CSV/HTML files or a university URL, supports optional upload provenance, shows the source receipt and authenticated original-download link, and requires an explicit Analyze action. The preview shows analysis proposals, unset effective date/authority, unresolved parser warnings, located page text and bounded table windows of 20 rows by 8 columns. Text and title corrections require a reason and save as a new revision. Warnings remain unresolved and the document is clearly marked unpublished; the page offers no metadata approval or publication controls.

All API reads are `no-store` and same-origin credentials are used for writes. API errors are reduced to known safe Thai messages. Duplicate requests are disabled while pending. Failed saves retain drafts. A stale `409` exposes an explicit reload action that rebases only fields whose draft differs from the previously loaded baseline. Untouched or reverted fields take the latest value, and drafts already equal to the latest value are cleared. When a drafted title, page, or cell changed concurrently, the UI shows the previous value, latest baseline, and draft side by side; the operator must choose the latest value or explicitly keep the draft before saving. Editing a kept draft clears its acknowledgement. A missing target can only be discarded. Changing the selected source, staging a new source, or rerunning analysis warns before discarding unsaved text.

The bounded table uses visually hidden cell labels. Their containing label is positioned relative so the hidden text does not extend the mobile document's scroll width beyond the viewport.

Owned files:

- `app/(dashboard)/knowledge/page.tsx`
- `app/(dashboard)/knowledge/import/page.tsx`
- `app/(dashboard)/knowledge/import/import-form.tsx`
- `app/knowledge.css`
- `.superpowers/sdd/reports/imp-preview-ui.md`

The client uses type-only imports for `ImportPreview`, `ImportJobView`, and `SourceLocation`; it imports no server runtime implementation. Responsive styling extends the existing restrained dashboard palette and control shapes.

## Validation and review provenance

Read the assigned Knowledge Import surface brief, the updated Task 5 plan, `DESIGN.md`, existing global/provider styles and dashboard pages, plus the installed Next 16.3.8 `page.md` and `dynamic-routes.md` guides. Applied the `frontend` and `impeccable` skills, including their Operate and craft-floor guidance. The context script did not discover the not-yet-created route as a brief target; the explicit brief was followed directly. The mechanical detector ran once and reported advisory-only out-of-palette colors/radii. Those findings were corrected in the CSS; the detector was not rerun under its once-per-session instruction.

Commands from `D:\project-next\line-ai-yru` using the configured Node/pnpm PATH:

- `pnpm exec eslint 'app/(dashboard)/knowledge/page.tsx' 'app/(dashboard)/knowledge/import/page.tsx' 'app/(dashboard)/knowledge/import/import-form.tsx'` — exit 0, no diagnostics.
- `pnpm exec tsc --noEmit` — exit 0, no diagnostics at the observed source checkpoint.
- `node C:\Users\NOTEBOOK\.agents\skills\impeccable\scripts\detect.mjs --json 'app/(dashboard)/knowledge/page.tsx' 'app/(dashboard)/knowledge/import/page.tsx' 'app/(dashboard)/knowledge/import/import-form.tsx' app/knowledge.css` — exit 1 with advisory findings; CSS colors/radii were changed to the documented token palette afterward.
- After the draft-rebase/conflict UI and mobile label containment changes, a scoped ESLint and typecheck rerun could not complete: Node failed allocating memory (`VirtualAlloc`/native V8 allocation) before reporting source diagnostics. Root observed host-wide virtual-memory pressure and owns the next build and browser verification; these final changes are not yet covered by a passing rerun.

The root-owned browser QA previously observed upload → analyze → page and cell edit/save/reload and authenticated original download; anonymous Storage download was denied. Root is rerunning the stale-conflict recovery and 390px mobile scroll-width checks after the final changes. No automated UI test was run in this delegated slice. No DB, environment, dependency, or Git mutation was made. No independent UI review is claimed; root retains integration and acceptance responsibility. Full M7, version approval, publication, corpus, and Flow A–F remain outside this component evidence.

## Root acceptance addendum — 6 October

The paragraph above records the delegated handoff, before root acceptance. Root corrected the conflict comparison to derive its displayed draft from current state; actual regression failed before the correction and passed afterward. Standard typecheck/lint/build subsequently exited0 on the final preview source. Actual browser QA passed14groups, including private upload/analyze/edit/reload, stale and foreign-origin guards, concurrent draft rebase/reconfirmation, byte-exact authenticated original, anonymous denial, two ordinary-role denials, desktop1440/mobile390 widths and unchanged publication counts. Default Turbopack dev3001 also compiled authenticated import/preview with200 after host memory recovered. Root viewed screenshots. This is root integration/QA, not an independent UI verdict. See `docs/reports/IMP_EXTRACTION_PREVIEW_REPORT.md` for full evidence and remaining scope.
