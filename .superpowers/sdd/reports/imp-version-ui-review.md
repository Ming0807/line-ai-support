# IMP-03B-1 version-choice UI review

Date: 6 October 2026
Reviewer: `/root/imp_versions_ui_review`
Scope: `app/(dashboard)/knowledge/import/version-panel.tsx`, the IMP-03B-1 changes in `app/(dashboard)/knowledge/import/review-form.tsx`, and the appended styles in `app/knowledge.css`. Base commit: `7ca60e2`; source reviewed was the shared working tree after the UI-owner fixes and root’s parent-status copy adjustment.

## Verdict

No open concrete source-level UI findings remain in this slice. The panel presents version choices as private review-draft inputs and clearly keeps candidate lookup separate from approval/publication. This is not an acceptance of publication, the database/API, mobile/browser behavior, M7, or V1.

## Re-review of findings

The source passes exposed four concrete problems, now corrected in the inspected source:

- Switching from a saved target action to another target-required action could leave the old target displayed even though it was absent from the new action’s options. `version-panel.tsx` now shows a blank selector while that new intent is pending and treats the selection as present only when the candidate permits the active action (`selectedCandidate`, lines 100–101; selector, lines 124–127). Save remains locked until an eligible target is selected or the action is cleared.
- A successful review reload/reset could discard the parent draft while retaining local intent and pending state in the child. `review-form.tsx` now increments `versionResetEpoch` only after successful load, save, or explicit start-current, and includes it in the child key (lines 139, 161, 181, 227). Failed reads do not reset the child, preserving the user’s local state for retry/recovery.
- Occupied-stream copy used to suggest replacing a document even when the resolver had no same-scope replacement target. The current message offers that instruction only when `REPLACE_CURRENT` is actually present in the eligible options; otherwise it directs the user to the choices shown and explains how to inspect another stream (`version-panel.tsx`, line 114).
- `NEW_FAMILY` could be the only available action while still offering no way to clear that choice and return to the catalog workflow. There is now one clear action whenever a saved or local action/target/relationship exists, including before lookup and after lookup failure. It clears `action`, `target`, `relationship`, `metadata.newFamily`, and target-pending state; the old warning-only clear button was removed, so the UI has no duplicate escape action (`version-panel.tsx`, line 111; `review-form.tsx`, lines 124–125).

The parent review summary now reports the unresolved local target-choice state while it is pending, rather than repeating a previous saved action (`review-form.tsx`, lines 225–226). The network-failure message also matches the behavior: it says the review draft remains and offers retry, without claiming that the previous candidate result remains displayed (`version-panel.tsx`, line 86).

## Contract and interaction checks

- The panel requests candidates only when a saved review exists, metadata still matches its saved baseline, and the form is not disabled. Its same-origin, `cache: 'no-store'` GET sends the expected job, extraction, and review counters; the response must match that exact tuple before it is shown. Abort, mounted, request-serial, and keyed-resource checks prevent obsolete responses from updating the visible review (`version-panel.tsx`, lines 55–57, 69–88).
- All five master actions are represented when allowed by the resolver. Whole-document `CANCELS` is an explicit target choice; after the target is selected the parent maps it to `ADD_ADDITIONAL` plus the `CANCELS` relationship and exact target ID/revision. No UUID entry field, candidate auto-selection, approve button, or publication call is present. Candidate observations are labeled non-authoritative and the UI says approval is a separate step.
- Target-required radio choices stay local until a candidate is explicitly selected. That intermediate state blocks draft save both in the button and handler, contributes to child activity pending, and propagates to the import parent. The parent summary exposes this lock. On a successful selection, the resulting draft shape matches `reviewDraftSchema`; switching to any other action and clearing a selection also clear `metadata.newFamily`, so stale strict-schema data is not sent (`review-form.tsx`, lines 118–125; `version-panel.tsx`, lines 118–132, 134; `review-form.tsx`, lines 102–104, 118–125, 163–165, 288–290).
- Missing `audience` or `studentType` is taken from the resolver’s explicit `missingMetadata` result and suppresses actions; null is not displayed or used as `ALL`. The over-limit result suppresses actions. Family-wide occupied-stream status is explained separately from exact-scope target eligibility; cross-scope candidates cannot appear as selectable targets. Candidate text includes reviewed scope/year/status context (`version-panel.tsx`, lines 111–127; `lib/imports/version-candidates.ts`).
- Existing review recovery remains connected: failed review GETs release settled pending state and retain the existing retry; review-save 409 keeps the local draft and exposes explicit reload/discard; counter mismatch routes through parent preview refresh; stale receipts retain their existing start-current flow. The new child reset epoch clears local target intent only after a successful refresh, so failed reloads preserve it.
- Controls use native fieldset/radio and labelled select semantics. The new CSS uses existing Knowledge tokens, keeps radio rows and selects at a 2.75rem minimum height, wraps long target labels, and stacks the panel heading/actions under 36rem. Global `:focus-visible` styling remains in force.

## Evidence and limits

Read `AGENTS.md`, `docs/PROJECT_INDEX.md`, the current task board and decision log, master guide §§39/40/46/47/50/64, source index and relevant original versioning sections, requirements matrix rows CH039/040/046/047/050/064 and USR-AMENDS, system/import design, the import surface brief, Task4B, the strict review schema, candidate builder, resolver, and route. Frontend, Impeccable Operate/audit, and review guidance informed the source checks. The Impeccable context script found no surface brief automatically; the repository brief was read directly.

The Impeccable static detector initially returned one advisory on `.knowledge-version-panel` using `.7rem`, outside the documented field/panel radii. Root changed it to `.8rem`, matching the DESIGN panel token; the detector was not rerun after that single CSS-value correction. The UI owner’s report records focused typecheck and scoped ESLint passing after the UI fixes; root reports full type/lint/build gates passed before this CSS-only token adjustment and is running the final build/browser flow now. I did not independently run tests, browser automation, screenshots, a build, or database checks. Actual 390px layout, keyboard flow, and browser timing remain unverified by this review. No claim is made for publication correctness, real-corpus approval, complete M7, or V1.

No product source, UI, database, test, or Git file was changed by this review; this report is its only written artifact.
