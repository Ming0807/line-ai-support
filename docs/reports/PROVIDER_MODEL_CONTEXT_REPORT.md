# Provider-owned model setup evidence

10 October 2026; UI-PROVIDER-CONTEXT-01 / DEC-088; CH014 and USR-UX/ORDER/STATUS/QUOTA/TEST/FREE. Source baseline `aa90f09`; task changes are local and uncommitted. Current status: **COMPONENT_PASS / REAL_ACCOUNT_WORKFLOW_PENDING**. Root final checks and browser recovery are recorded below; no whole-V1 or live OA pass.

## Delivered scope and provenance

The human selected adding models from each provider card. Create/edit forms identify the owner by name, connection format and safe hostname; submissions still use the same provider UUID in the existing nested route. Creating a provider retains its returned UUID, waits for that provider in refreshed props, then opens/focuses its model form once. Essential model fields precede a disclosure for existing advanced fields. Only the submitting form is disabled; accepted model saves name both model and provider. Stable component identities retain other drafts; incoming revision scopes invalidate stale reorder intent.

Actual owners: Luna high authored the design audit and separately authored SSR regression tests; Luna max implemented the UI and separately performed read-only contract/source review; root owns frozen design/plan, contracts/integration, verification and reporting. No unavailable-agent review is claimed. The [design](../superpowers/specs/2026-10-10-provider-model-context-design.md), [plan](../superpowers/plans/2026-10-10-provider-model-context.md) and [design audit](../ui/PROVIDER_MODEL_CONTEXT_DESIGN_AUDIT.md) record the alternatives and authority.

Changed production files: `app/(dashboard)/providers/provider-forms.tsx`, `app/providers.css`. Added test: `tests/provider-model-context.test.tsx`. No backend, DB, auth, webhook, provider-key/runtime activation or local E5 changes belong to this UI task. Unrelated dirty incident/corpus work is preserved.

## Executed checks

- Actual initial SSR RED: 1 passed / 2 failed before production edits. The test asserts two distinct provider UUIDs with repeated model API IDs/display names, explicit form context, no owner selector or model credential fields, and truthful empty states. Initial post-implementation 3/3 GREEN preceded a final revision-state refactor; root subsequently reran the current focused set.
- Root first `pnpm typecheck` failed on a new test predicate returning `boolean | undefined`. Its author corrected it to an explicit boolean; root rerun exited0. This failure was not ignored.
- Root `pnpm exec eslint 'app/(dashboard)/providers/provider-forms.tsx' tests/provider-model-context.test.tsx` exited0.
- Root focused Vitest command across context, registry, purpose, preview, free schemas, cooldown, quota, model-test availability and free-policy: 9 files / 125 tests PASS, exit0, 11:19 Bangkok.
- Root first fresh isolated Next16.3.8 production build exited0 at11:21 Bangkok. It copies the full current `app/lib/types` snapshot including unrelated current files, uses a node_modules junction and explicit Turbopack root in copied config, and leaves the active development `.next` untouched. Environment is passed only in child memory, with no copied credential file. This first build predates the reviewer-requested recovery correction; final-source checks are recorded below when executed.
- Initial parallel PowerShell read attempts encountered host memory/allocation failures. Root switched to serialized checks and preserved the existing local coordinator/services. These startup errors are not behavioral RED evidence.

## Real-component browser checks

Root compiled the actual production `ProviderForms` with an injected router and loopback synthetic API at3012. The page visibly labels all data as a fixture and has no DB, external-provider inference or LINE access. Only dummy credential text is used and discarded. Sanitized request evidence records route/field names/UUID/revision, never credential values. This is component/browser evidence, not real-account persistence or OA acceptance.

First desktop1440×900 batch actually confirmed:

1. Provider-scoped add disclosure focuses its named heading, repeats connection format/hostname, and exposes only essential fields until advanced disclosure is opened.
2. Delayed model save disables that form while another provider's open draft stays editable. Success resets only the accepted new-model draft, names its owner/model and retains the sibling draft after refresh.
3. Synthetic409 preserves the entered model values, owner and error notice.
4. Provider creation disables its fields, then opens/focuses the add-model form for the actual returned UUID `9173f744-8a1f-49a8-89fe-f8658969a7e0`. An unrelated revision refresh neither clears drafts nor refocuses that heading. No horizontal page overflow was observed at1440.
5. Unsaved provider reorder changes card order without losing an open edit draft. A new revision discards stale order intent/restores saved server order while retaining that edit draft.

The separate Luna max reviewer identified P2: a substantive concurrent edit preserved a stale draft but supplied no recovery, so repeated retries sent the original revision forever. Root reproduced two model PATCH requests carrying revision0 against current1 and observed repeated409 with the same local draft. Sanitized RED evidence is `.superpowers/staging/provider-context-qa/conflict-red-requests.json`. The correction retains the overwrite fence and adds an explicit per-form action to replace that draft with current fields/revision. Same-setting revision bumps may advance; a changed draft is never silently rebased. Final source recovery was exercised in the browser: concurrent model and provider changes each returned409 and retained their separate drafts; affected submits remained fenced until the explicit per-form reset. Resetting one form did not replace the other draft. Subsequent PATCH requests used revision1 and succeeded. A harmless same-setting revision bump retained its draft and submitted revision3 successfully. The independent Luna max reviewer closed P2 after inspecting the correction; browser execution belongs to root.

## Final-source verification and visual check

- Root final recovery-source typecheck and changed-file ESLint both exited0. The same9-file focused Vitest set passed125/125 at11:28 Bangkok. No full-unit-suite claim is made by this task.
- Fresh isolated full-current-source Next16.3.8 build exited0 at11:45:37 Bangkok **after the final mobile CSS correction**. This snapshot includes the current unrelated incident files; only copied Turbopack root differs. Source hashes are retained in `.superpowers/staging/provider-context-build-result.json`; active dev output was not reused.
- Root saved duplicate new model IDs/display names to two different provider UUID routes in the actual-component fixture and observed each correct owner card/success. No providerId body field or cross-owner draft reset occurred.
- Initial390px inspection showed no page overflow but a narrow222px input because reorder controls occupied a column. Root made one mobile CSS correction placing those controls below the card, then confirmed390×844 inputs282.94px and320×844 inputs212.94px, with page scrollWidth375/305 respectively. Final desktop1440×900 was inspected and captured. No further polish loop was run.
- Screenshot evidence: [desktop](../../.superpowers/staging/provider-context-qa/desktop.jpg), [390px](../../.superpowers/staging/provider-context-qa/mobile390.jpg), [320px](../../.superpowers/staging/provider-context-qa/mobile320.jpg). All show visibly labelled synthetic data and production components, not real-account settings.
- Impeccable context was run once. Detector ran once on the production TSX/CSS and exited1 with visible advisory existing color/radius findings; tool output was truncated, so this is **not a detector PASS** or a claim that all diagnostics were enumerated. The later mobile change adds only layout rules. Keep the human-approved palette; no unrequested systemwide token rewrite.
- Fixture reorder save, owner disappearance and a full authenticated create/edit workflow were not executed in this browser batch. Existing order/backend checks and the exact tested fixture interactions must not be enlarged into those passes. Kilo's later real admin-service persistence is separate evidence, not a browser form-submit pass.

## Acceptance boundary

This task improves model ownership and form interactions. It does not establish free billing eligibility, quota headroom, model quality, production combined tool/schema behavior or an end-to-end LINE reply. [Actual provider diagnostics](FREE_PROVIDER_SELECTION_REPORT.md) and LIVE-FREE-05 retain those separate application/configuration/OA gates. Whole V1 and incident batch sending remain open on the current task board.

Root final handoff evidence at11:54:42 verifies25task files with0credential-pattern/trailing-whitespace matches, final production file hashes equal the successful11:45 build and Kilo's separately recorded inactive registration. `git diff --check` exits0; only LF/CRLF advisories remain. At final readback root logged into the actual Local app, observed the saved Kilo candidate disabled/UNKNOWN and opened its add-model form: named owner/compatible format/host appeared and focus moved to that form heading. [Actual-account read screenshot](../../.superpowers/staging/provider-context-qa/kilo-dashboard.png) supplements the earlier labelled fixture screenshots; no actual-account create/edit form submission is claimed. Local services were restarted after a refused connection and current tunnel/setup evidence is in the Kilo report/final checklist.
