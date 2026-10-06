# IMP-03A private review draft UI report

Date: 2026-10-06
Task: `IMP-03A` review draft UI slice
Owner: delegated `m7_edit_draft` (Luna high)
Requirements: CH046, CH047, CH048, CH061, CH062
Boundary: root owns schema/service/API/DB, migration, authorization integration and actual browser acceptance.

## Implemented scope

Added an inline private review form to the existing import preview. The client imports `ImportReviewState` and `ImportReviewDraft` as types only; it does not import schema validators, server crypto, SQL, or Node runtime code. It reads `GET /api/knowledge/imports/{id}/review` and saves complete-shaped drafts with `PUT` and the current job, extraction, and independent review revisions. Requests are no-store and same-origin.

The form covers nullable title/family/department/type/version/year/scope/date/authority/provenance/visibility/storage/dataset fields, all seven fixed dataset choices and all three storage modes. A new draft starts with null metadata and all five attestations false. Warning dispositions start unresolved; selecting corrected or false-positive requires a reason. Choices do not hide warnings, grant approval, or publish. The five version actions and target remain display-only in this slice: previously saved values are preserved and shown as pending resolver work, with target identifiers kept out of the UI. No approval, SQL, or document-ID control was added.

Saved receipts show their independent review revision and save time while remaining labelled private and unpublished. Current warnings are always rendered: if a saved receipt omitted a current key, the UI completes it as unresolved with no reason; it does not alter the saved receipt or infer trust. If the receipt binds an older extraction, it remains visible and cannot be saved against the new extraction. “เริ่มตรวจฉบับปัจจุบัน” explicitly starts a new local draft, carries forward saved metadata/action/target, resets all five attestations, and binds unresolved dispositions to the current warning keys; the next save uses the latest independent review counter.

Dirty and pending state flow to the parent import form. Existing source/job/analyze guards now include unsaved review metadata; text-edit saves explicitly confirm when they would make a dirty review stale. Parent operations disable review changes, and review reads/saves disable conflicting source/edit operations. A review `409` leaves the local draft intact and locks further saves until the operator explicitly reloads/discards. Reload confirms before discarding local changes. Preview refreshes trigger a new read; each GET and PUT must return the exact job, job revision, and extraction revision currently shown by the parent. If counters differ, the local draft is retained and locked, and the operator is sent through the parent's confirmed preview reload so text and review counters refresh together. Abort controllers, resource-key checks, and request serial checks prevent obsolete GET/PUT results from replacing a newer selection. Failed initial reads release the parent pending guard and leave an enabled retry. Outgoing warning reasons are trimmed to the API's strict schema while failed saves leave typed local values intact. Labels, details/summary keyboard controls, focus styling, safe Thai errors, pending feedback, and narrow-screen form stacking use the existing Knowledge UI tokens.

## Owned files

- `app/(dashboard)/knowledge/import/review-form.tsx`
- `app/(dashboard)/knowledge/import/import-form.tsx`
- `app/knowledge.css`
- `.superpowers/sdd/reports/imp-review-ui.md`

## Validation and provenance

Required source read: project index, task board, decision log, requirements matrix, import surface brief (including the 6 October review continuation), Task 4A frozen DTO, import review schema/service/warning contract, `DESIGN.md`, the installed Next.js 16.3.8 Server/Client Components and Forms guides, and the frontend/Impeccable Operate/craft-floor guidance. The Impeccable context script ran once for this UI skill session; it did not discover the explicitly named route brief, so the required brief was read directly. The mechanical detector had already been run once earlier in this same UI skill session; it was not repeated.

`pnpm exec eslint 'app/(dashboard)/knowledge/import/review-form.tsx' 'app/(dashboard)/knowledge/import/import-form.tsx'` — exit 0, no diagnostics.
`pnpm typecheck` — exit 0 (`tsc --noEmit`).

During implementation, scoped lint first flagged an effect-state pattern and a ref access; both were corrected. Root review identified the failed-read retry guard, omitted current-warning entries, exact preview/review counter binding, late PUT responses, warning-reason whitespace, and a nullable warning-reason callback type error; the final source handles each. The inline conflict reload now uses its single explicit confirmation without prompting a second time. Scoped lint and typecheck were rerun after these corrections.

Build and actual browser validation remain with root integration. No test, API, database, environment, dependency, or Git mutation was made. Root owns checks for real route persistence, initial false attestations, saved metadata, review/extraction stale behavior, competing review `409`, all-role denial, mobile/keyboard flow and unpublished status. This report does not claim those browser checks or M7/publication acceptance.
