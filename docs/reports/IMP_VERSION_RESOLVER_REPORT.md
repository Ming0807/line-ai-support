# IMP-03B-1 — reviewed version choices and initial families

Date6October2026. Status **COMPONENT_ACCEPTANCE_PASS**. Source parent `7ca60e292458533781cf7b8f12b4546acfcfcae9`; this report accompanies the version-choice changes after that accepted/pushed review-draft checkpoint. Requirements CH009/039/040/046/047/050/064, USR-AMENDS; [master](../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md) §§39/40/46/47/50/64, [import design](../architecture/KNOWLEDGE_IMPORT_DESIGN.md), [Task4B](../superpowers/plans/2026-10-04-yru-knowledge-import.md), [decisions](../decisions/DECISION_LOG.md).

## Implemented scope

Root owns the metadata-only resolver, strict private GET route, final authorization/three-counter fences, fixed catalog data seeder and integration acceptance. Luna high implemented the pure19-family catalog and a fresh Luna high implemented the minimal version-choice UI. Separate Luna max backend and UI reviews record actual source scope; no unavailable or whole-V1 review is claimed.

The resolver reads only the saved encrypted private review; clients supply exact job/extraction/review counters, never family/scope metadata or SQL. Active SUPER_ADMIN preflight precedes input parsing/private extraction work, decryption occurs outside SQL, and a short final transaction reauthorizes and checks fresh counters while holding the job SHARE lock. One MVCC query reads family metadata, up to101 document metadata candidates, relationship flags and complete-family stream occupancy. More than100 versions fails closed with no target/action list; current-stream occupancy remains accurate even beyond that bound. No document body, original reference, storage path, source URL, checksum or ciphertext is returned.

Unfinished audience/student type stay missing, never implicitly ALL. Exact department/type/non-year scope filters targets; replacement requires the same current stream but may cross academic years. Amendments require a same-year current base and cannot chain. Whole-document CANCELS is a separate ADD_ADDITIONAL relationship against an explicitly selected same-year/scope approved target, including an amendment separately from its base; cancellation-of-cancellation is unavailable. Ordinary ADD_ADDITIONAL requires a free family-wide current stream; AMENDS/CANCELS instruments are planned ACTIVE/is_current=false relationship documents that preserve the base's current flag. These choices remain observations and private draft data; final approval must recheck under family/document/delivery locks.

The UI offers all five master actions plus the explicit cancellation relationship, readable target metadata and exact target revision. It searches saved metadata only, invalidates results after metadata edits, preserves local drafts on failure/conflict, checks exact response counters, and protects parent actions during lookup or an unfinished target selection. Target-required intent stays local until an explicit target is selected; switching intent blanks the target picker. Choosing another action or clearing removes newFamily metadata as required by the strict draft schema. No automatic intent, target, attestation, approval or publication occurs.

The fixed19-code catalog stays open to explicitly reviewed custom families. The guarded DEVELOPMENT seeder inserts data with ON CONFLICT DO NOTHING, preserving existing IDs, names, categories, storage defaults and timestamps. Root actual dry-run found0existing, apply inserted19, repeat apply inserted0 and subsequent dry-run found19existing. It creates no yearly schema, documents or chunks; production was not targeted. Local schema remains24migrations, unchanged from the accepted parent.

## Verification evidence

| Check | Actual result |
|---|---|
| Pure candidate module |12RED→12GREEN; missing/null scope, exact target kinds/scopes/year/stream, cross-department occupancy, bounded limit and open custom family |
| Strict route / catalog |6route+4catalog checks PASS; root corrected an invalid UUID test fixture without weakening route validation |
| Actual Postgres resolver / seed |9resolver+1rollback-seed checks PASS; scoped backend reviewer independently reran10/10 |
| Full local DB runner |145checks+foundation RLS fixture PASS, including unchanged Student/Staff/worker/delivery paths and the new resolver/seeder tests |
| Full unit suite |1257/84files PASS on final isolated run; focused backend reviewer independently reran22/3files |
| Type / lint / build |Root full ESLint/typecheck/standard Next build PASS; final source rebuild includes both LINE routes and the new versions route |
| Browser / visual |Root actual compiled-app 17groups PASS; desktop1440/mobile390/keyboard/no direct8000; accepted extraction/review21-group regression recorded separately |
| Advisors / staged credentials / links |CLI2.119.0 local advisors0ERROR/0WARN/86INFO (27intentional RLS-without-policy,12unindexed FK,47unused index); staged scan/links verified before commit |

Failures and corrections are preserved: the first service placeholder gave8expected REDs after correcting a lowercase synthetic family-code fixture. Independent backend review identified a READ COMMITTED lock-wait race; root reproduced an actual valid encrypted review append during an observed job-lock wait, saw the obsolete review accepted RED, then split lock acquisition from fresh counter reads and verified conflict GREEN. A102-row fixture similarly demonstrated inaccurate occupancy outside the bounded slice RED before full-family EXISTS corrected it GREEN. Root source review found a cross-intent picker showing the previous target while awaiting an explicit new selection; the author corrected the placeholder/eligibility behavior, source corrections include explicit successful-reset epochs, eligible occupancy copy and pending status. Actual browser found a valid NEW_FAMILY choice had no clear control; the author added one general clear action outside the result condition, and the corrected compiled-app journey passed. Initial QA also had an ambiguous partial department label matching a hidden attestation checkbox; an exact field locator corrected that test without weakening product behavior. Subsequent QA corrected the same ambiguity for the stream label and awaited the parent render after clearing a selection. Its final authorization assertion initially referenced a nonexistent DEPARTMENT_ADMIN fixture: the actual roles are STAFF, SUPERVISOR, ADMIN and SUPER_ADMIN. The corrected browser checks anonymous denial and two real STAFF departments; root actual PG additionally checks SUPERVISOR and ADMIN denial before input getters. No runtime role or permission was invented to satisfy that test.

An initial full unit run under concurrent database load passed1256/1257 with the PDF overflow test reaching its unchanged20second timeout. The isolated PDF file passed7/7, and the complete subsequent isolated suite passed1257/1257 in43seconds. Parser deadlines/test expectations and application guards were not widened. Initial run failures are not hidden by the final PASS.

## Actual browser scope

- unfinished_saved_scope_is_explicit_and_never_auto_selected
- explicit_custom_new_family_selection_and_incomplete_draft_save
- fixed_catalog_and_ordinary_additional_without_publication
- all_five_actions_exact_readable_targets_and_separate_amendment_cancellation
- confirmed_discard_resets_child_intent_and_releases_parent_without_changing_saved_target
- actual_stale_target_revision_locks_save_then_explicit_clear_and_reselection_recovers
- cross_department_occupancy_does_not_promise_ineligible_replacement
- unsaved_metadata_invalidates_results_and_requery_recovers
- safe_lookup_failure_retains_draft_and_retry
- lookup_pending_locks_parent_analysis_and_metadata
- wrong_snapshot_dto_never_enables_actions
- actual_competing_saved_review_409_retains_local_draft
- saved_target_reload_and_desktop_layout
- mobile_390_no_horizontal_overflow
- keyboard_and_no_browser_embedding_calls
- anonymous_and_staff_from_two_departments_denied
- draft_choices_create_no_published_documents_or_chunks

The browser uses real DEVELOPMENT-backed admin sessions and only synthetic INTERNAL metadata fixtures for existing versions. Exact owned synthetic documents/relationships/family are removed on exit; uploaded encrypted originals and their extraction/review history remain retained. Prior failed browser originals also remain retained, never approved. The final source-level UI reviewer reports no open concrete findings after corrections and did not independently run browser/build/DB. Root owns these actual browser/visual gates. Screenshots/results are private ignored artifacts. No original/token/password/private artifact is Git content.

## Remaining acceptance

This slice does not complete M7 or V1. Actual approval/idempotent publication receipts, family/delivery locks, all five action effects, AMENDS/CANCELS applicability retrieval and obsolete queued-answer invalidation, E5 token-bounded located chunks and persisted source locations→citations remain IMP-03B follow-up. M8's seven fixed structured datasets and atomic BOTH publication, M9, approved real corpus and full Flow A–F remain required. Human live/provider/OA/corpus/deployment evidence stays in the [final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md); absence of live evidence is not a pass.
