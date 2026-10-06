# PUB-04 private approval panel report

6 October 2026 — delegated Luna high UI component checkpoint. Scope is limited to `app/(dashboard)/knowledge/import/approval-panel.tsx`, append-only `.knowledge-approval-*` rules in `app/knowledge.css`, and this report. The panel is prepared for root-owned parent wiring; this report does not claim an integrated approval flow.

The panel reads the private publication receipt on job/revision binding changes and on explicit retry. It accepts only the exact receipt envelope and receipt field set, verifies the route job ID, UUIDs, bounded counters, storage/action/relationship enums, SHA-256 digest and canonical ISO timestamp, and ignores aborted or superseded responses. A transient or malformed read fails closed and does not clear a previously confirmed receipt. If a later successful read returns `null` after this job already had a confirmed receipt, it preserves the known receipt and reports the inconsistency instead of clearing completion. A confirmed receipt shows the effective action (including `CANCELS`), storage mode, document ID, timestamp and immutable job/extraction/review counters.

For a not-yet-completed job, the panel enables confirmation only for a saved, current v2 draft bound to the displayed counters, with the `located-e5-v1` chunk-plan acknowledgment, all five attestations, no unsaved changes or parent/child pending work, a successful receipt read and `RAG` storage. Other saved storage modes remain blocked with an unavailable-mapper explanation. The inline confirmation starts unchecked, opens as a labelled region and moves keyboard focus to its heading. It shows saved title, family, version, action, exact target ID/revision, plain-text source URL, department, audience, student type, semester, program, curriculum, cohort, academic year, publication/effective dates, visibility and the matched plan digest. The POST contains only the frozen job ID, three counters and `confirmPublication: true` fields. Parent pending is raised synchronously at POST start and cleared through the pending lifecycle. Policy/conflict/time-out/unavailable/network failures leave the draft alone; uncertain outcomes offer receipt recheck and same-binding retry without asserting that publication did not happen. The completion copy accurately describes the stored approval result and does not claim public visibility.

The component uses type-only imports for `ImportReviewState`, `ImportReviewDraft` and `ImportPublicationReceipt`; it does not import server modules or add parent, database or test changes. Request lifecycle uses abort signals and serial/job binding checks. Focused browser acceptance remains root-owned and was intentionally not attempted before the parent integration exists.

## Verification

- `pnpm exec eslint 'app/(dashboard)/knowledge/import/approval-panel.tsx'` — passed with no warnings.
- `pnpm exec tsc --noEmit --pretty false` — passed after root added the two API routes that were absent during the earlier shared-workspace check.
- `node C:\Users\NOTEBOOK\.agents\skills\impeccable\scripts\detect.mjs --json 'app/(dashboard)/knowledge/import/approval-panel.tsx' app/knowledge.css` — passed with no findings.
- No browser/API integration or publication acceptance was performed by this agent; root owns browser gates after parent integration.

## Root preflight review — import/review integration (read-only)

6 October 2026. Reviewed the current `import-form.tsx` / `review-form.tsx` receipt and pending integration only; no source changes or browser/database checks were made.

- **[P2] Resolved by root in the current source.** `resolveEditConflict` now returns early when `pending !== null || sourceMutationLocked` (`app/(dashboard)/knowledge/import/import-form.tsx:290-292`), and both “use latest” and “keep draft” buttons include the same lock in their disabled expressions (`:399-402`). This closes the local-state/UI-lock bypass; no persistence path was implicated. This is source-only verification, not browser acceptance.

The separate receipt lookup is keyed to the active selected job and refresh counter, aborts stale requests, validates the shared strict DTO, and treats a null receipt after a locally confirmed publication as an inconsistency while keeping mutation locks active. `ReviewForm` reports stable `activityPending`/receipt state through its memoized parent callback; the parent maps its own `review` pending marker separately from source operations. No concrete callback loop or response-crossing-selection defect was found in these paths.
