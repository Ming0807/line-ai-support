# IMP-03B-1 UI report

วันที่ 6 ตุลาคม 2026 · เจ้าของ: delegated Luna high · ขอบเขต: private reviewed version/action UI only

## Source and requirements

Implements the frozen version-resolution response for CH009/039/040/046/047/050/064 and USR-AMENDS. Followed `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, master guide §§39/40/46/47/50/64, source index and versioning source, requirements matrix, `docs/architecture/YRU_V1_DESIGN.md`, `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`, and Task4B in `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`. Installed Next 16 docs read: App Router Client Components and data fetching; this component uses client interaction and same-origin `fetch` with `cache: 'no-store'`.

Frontend and Impeccable Operate guidance informed this narrow addition to the existing minimal Thai dashboard. The supplied design baseline and review form remain the visual and workflow reference.

## Implementation

- Added `app/(dashboard)/knowledge/import/version-panel.tsx`. It queries only the saved review's exact job/extraction/review revision tuple, validates the response shape and tuple, and guards async results with abort, mounted, serial, and keyed-resource checks. Metadata edits remount/invalidate the panel; action-only edits retain the same saved metadata lookup.
- Shows explicit missing-field, occupied-current-stream and over-limit explanations; offers manual retry and safe Thai authorization/network/conflict messages. A 409 retains the draft and exposes the existing reload-preview path.
- Presents the available fixed actions as accessible radio choices and exact candidate targets in a labelled select. Candidate labels contain title, version, year, applicability scope, effective dates and status; UUIDs are not shown as editable content. Replacement/amendment/CANCELS intent remains local until a target is explicitly selected, blocking parent workflow while the choice is incomplete. On every new target-requiring intent, the picker starts blank even when the previously saved target is also eligible; the saved draft remains intact until the reviewer explicitly selects again. No candidate is auto-selected.
- `CANCELS` maps to `ADD_ADDITIONAL` plus a selected exact target and `CANCELS` relationship. Ordinary `ADD_ADDITIONAL` remains targetless. Changing to any non-NEW_FAMILY intent clears `metadata.newFamily` to satisfy the strict draft schema. A prior selection missing from the fresh candidate choices remains untouched and is shown with an explicit clear action.
- Integrated child pending state with `ReviewForm` and its parent pending/dirty callback. Lookup is unavailable until metadata is saved and unchanged against its baseline. The existing private draft save/reload/conflict state stays in place; this UI does not approve or publish.
- The version panel receives a reset epoch that advances only after a review GET is accepted, a save is accepted, or the reviewer deliberately starts a current draft. This clears local target intent after a successful discard while preserving it after failed GET/409 recovery. The epoch is separate from the action state, so it does not remount on each action change.
- Occupied-stream copy now depends on whether an eligible replacement is actually present. Pending-target and failure copy describes the current state without implying a stale result remains available.
- One clear-action control is available whenever a saved or local intent/target/relationship exists, including before lookup, after lookup failure, and during an incomplete target choice. It clears local target intent and selection-pending state together with draft action/target/relationship/new-family metadata.
- Appended component-scoped responsive styles to `app/knowledge.css`.

Changed files: `app/(dashboard)/knowledge/import/version-panel.tsx` (new), `app/(dashboard)/knowledge/import/review-form.tsx`, `app/knowledge.css`, this report.

## Evidence

- `npm run typecheck` — PASS (`tsc --noEmit`, exit 0).
- `npx eslint 'app/(dashboard)/knowledge/import/review-form.tsx' 'app/(dashboard)/knowledge/import/version-panel.tsx'` — PASS (exit 0, no findings).
- No tests or browser session were run by this component owner. Root owns resolver/API/actual PostgreSQL and full browser acceptance. Root-reported API/PG/database checks are not attributed here as UI acceptance evidence.

## Limits and review provenance

Root's actual browser run found the clear-action control was absent for a valid saved `NEW_FAMILY` selection and while lookup was unavailable; the single general clear control now covers those states. Root owns the browser rerun of that recovery path. This report establishes scoped UI/type/lint evidence only; it does not claim browser/mobile behavior, database/API acceptance, publication correctness, real-corpus approval, M7 acceptance or V1 completion. Independent UI review was not performed in this delegated slice; root owns integration and browser review.
