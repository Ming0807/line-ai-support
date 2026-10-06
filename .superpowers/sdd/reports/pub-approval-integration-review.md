# PUB-04 approval UI integration review

Date: 2026-10-06

Scope: read-only review of `app/(dashboard)/knowledge/import/review-form.tsx`, `app/(dashboard)/knowledge/import/import-form.tsx`, and `app/(dashboard)/knowledge/import/approval-panel.tsx` against the PUB-04 integration contract. No browser, database, or test command was run for this review.

Finding — P2, unresolved at time of review: receipt lookup failure can release the parent extraction/edit gates for a job whose publication status is unknown. `ApprovalPanel` treats only `readState === 'loading'` or `publishing` as pending (`approval-panel.tsx:109`); an error response therefore reports pending=false (`:116`). `ReviewForm` propagates that as `activityPending` and reports `publicationReceipt?.jobId ?? null` (`review-form.tsx:110,168`). The parent replaces its single `publishedJobId` with this nullable value and clears `pending` when review activity settles (`import-form.tsx:138-142`); `publicationComplete` is then false unless that selected job ID remains locally known (`:174-175`). Analyze is gated only by `pending` and `publicationComplete` (`:225-227,355`), and text edits use the same parent completion state (`:403,417,426,429`).

Concrete scenario: after a published job is reselected/remounted, its local receipt state is empty. If the receipt GET fails or returns malformed data, the approval panel correctly blocks approval, but it releases the parent pending state. The selected job can then be reanalyzed or edited without a confirmed “no receipt” result. If the review GET fails first, `ApprovalPanel` does not mount at all; once the review-load failure clears activity pending, the same parent controls are available without any receipt read. This violates the parent-level completion guard because the receipt is the authoritative publication state.

Other reviewed flows appear sound in source: changes to the job/review binding invalidate the confirmation key; POST and receipt GET use serial/abort guards; a known receipt is preserved if a later same-job GET returns null; and pending/completion callbacks reach the parent. These observations do not substitute for browser evidence.

Root confirmed the P2 and is adding an independent selected-job receipt preflight with a fail-closed unknown/error state and exact DTO validation. This report records the finding before that change; final resolution remains pending a source re-review. No browser or database result is claimed.

## Final source re-review

Date: 2026-10-06. I re-read the current `import-form.tsx`, `review-form.tsx`, `approval-panel.tsx`, and shared `publication-response.ts`. The earlier P2 is resolved in source:

- The parent derives `receiptJobId` from the selected job and treats the state as `loading` unless it has a result for that exact job and refresh generation (`import-form.tsx:178-182`). A parent-owned GET runs independently of preview/review loading, is `no-store` and same-origin, and aborts/ignores stale responses (`:183-198`).
- The parent accepts only the exact shared receipt envelope bound to the selected route job (`publication-response.ts`, `isReceiptEnvelope`). Malformed/error responses stay fail-closed. A null response cannot erase a completion already known in this mount; a completed receipt sets the job-level completion lock (`import-form.tsx:189-196`).
- Unknown or failed reads keep `sourceMutationLocked` true and are also passed to `ReviewForm` through `parentPending`, so a failed review GET cannot release the parent guard (`import-form.tsx:182,421-422`). Analyze, save, conflict resolution, page/cell/title edits, and edit-reason controls all honor the source lock (`:249,261,291,307,333,399-402,429,443,452,455`).
- The child approval panel retains its own strict receipt read and fail-closed approval gate, so it cannot bypass the independent parent preflight.

I found no remaining blocker in this scoped source review. I did not run browser or database checks; root owns those integration gates, and this report makes no browser claim.
