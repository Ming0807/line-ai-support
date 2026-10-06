# IMP-03A private review UI review

Date: 6 October 2026
Reviewer: `m7_review_contract` (read-only UI review)
Scope: `docs/ui/KNOWLEDGE_IMPORT_SURFACE_BRIEF.md`, `app/(dashboard)/knowledge/import/review-form.tsx`, `app/(dashboard)/knowledge/import/import-form.tsx`, and `app/knowledge.css`. No UI/application file changes.

Follow-up review: the five findings below were from the first source pass. The author has since patched them; see “Follow-up verdict” for the current status. The only remaining observation is a minor duplicate confirmation in conflict recovery.

## Findings

### P1 — A failed initial GET disables its own retry and holds the parent busy

In `review-form.tsx`, `busy` is true while `!readyForKey` (line 91). On load failure, the response leaves `loadedKey` unset, so `readyForKey` remains false; the retry button is then disabled by `disabled={busy||parentPending}` (line 176). The child reports that same `busy` state to `import-form.tsx`, whose `onReviewStateChange` records `pending='review'` and disables parent mutations. A transient GET failure therefore traps the user in a loading/error state with no usable retry and locked source controls until a full page reload.

Make retry available after a settled failed load and do not report an idle failed load as pending. Keep conflicting mutations guarded while an actual request is active.

### P1 — Warning keys omitted by a valid saved draft disappear from the UI

The API contract allows omitted warning dispositions to remain unresolved. `draftFromState` clones a saved draft unchanged (lines 60–61), then the warning renderer returns `null` when it cannot find a disposition for a current warning (lines 225–226). Thus any valid saved draft that omits a key hides that warning instead of showing it as unresolved; this can hide blocking or sensitivity evidence from the reviewer.

Render each current server warning even when its key is absent from the saved payload, using an unresolved/null-reason view or reconciling the draft with current warning keys. Ensure selecting a disposition inserts the missing key. Do not silently drop old/stale receipt data; the explicit start-current flow may reset dispositions for the current warning set.

### P1 — Conflict reload can show current review data beside stale extraction content

`load()` validates response shape but does not compare returned `jobRevision` and `extractionRevision` to the props/current preview key before accepting the state (lines 111–114). After another actor edits/reanalyzes, PUT can correctly return 409. The “load latest” control then calls only review GET (lines 151–155); the parent `ImportForm.preview` is not refreshed. The new review state is marked ready under the old `currentKey`, while the surrounding extraction text, tables, and analysis still describe the older revision. The user can then start and save a review against the newer counters while viewing the older preview.

When GET counters differ from the parent preview, keep the review form conflicted/loading and ask the parent to reload its preview before accepting the draft; only mark ready after both surfaces refer to the same job and extraction revisions. A same-extraction review-revision conflict can reload review state without refreshing extraction content.

### P2 — A late save response can overwrite state for a newer selection

`load()` uses `requestSerial` and abort checks, but `save()` has no serial/current-key guard or abort signal (lines 134–149). If parent props change while a PUT is in flight, its late success handler writes the old response and captured `currentKey` into state. It can replace a newer GET result or leave `readyForKey` false with no new load scheduled. Parent pending/dirty guards reduce the ordinary path, but their state is delivered through an effect and do not fence the response itself.

Capture the operation key/serial at save start; before applying a response, confirm that the component still represents that same job/job revision/extraction revision and that no newer load superseded it. Do not let an old save's `finally` clear a newer load's pending state. The server-side save may still commit for the old job; only its obsolete UI response must be ignored or followed by an explicit reload.

### P2 — Warning reasons pass local validation but can be rejected by the strict API

The client checks only `item.reason?.trim()` before saving (lines 136–139), but `normalizeDraft` trims metadata fields and leaves warning reasons unchanged (lines 24–30). The server schema requires resolved warning reasons to already be trimmed. A reviewer can enter a valid-looking reason with leading/trailing whitespace, pass the client check, then receive `INVALID_REQUEST` from the API with no field-specific indication.

Trim warning reasons in the normalized outgoing draft or validate the same exact rule locally and mark the affected field. Keep the typed local text until the reviewer resolves the validation error.

## Contract elements that match

The client imports `ImportReviewState` and `ImportReviewDraft` as type-only imports, so it does not bundle server schema/crypto runtime. New drafts explicitly set all five attestations false and nullable metadata/date/authority fields to null; the form does not infer those values from analyzer proposals. It preserves all seven dataset codes and all three storage modes. It does not expose action/target UUID entry or an approval button, and labels draft state as private/unpublished. The explicit stale-start flow resets warning dispositions and attestations while preserving the saved action, target and metadata; 409 saves retain local draft and block further saves until explicit reload/discard. Labels, nested controls, visible focus rules, native keyboard-operable `details`, and narrow-screen single-column/reflow/scroll styles are present by static inspection.

## Verification boundary

No DB, full typecheck/build, focused lint, or browser tests were run in this follow-up; root is running the full gates and browser acceptance. Static review does not verify 390px behavior, screen-reader announcements, or parent/child mutation timing in a browser. This review covers the private draft UI only, not version conflict resolution, publication, or M7 completion.

## Follow-up verdict

The five earlier findings are resolved by the inspected source changes:

- Initial-load failure now clears `pending`; `activityPending` excludes a settled failure, so the retry button is enabled and the parent is no longer held busy (`review-form.tsx:98–100, 130, 197`).
- `draftFromState` reconciles every current warning key with the saved draft and supplies `UNRESOLVED`/null-reason entries where the saved receipt omitted a key (`review-form.tsx:61–65`).
- GET validates the returned job, job revision, and extraction revision against the parent preview before accepting review state. A mismatch preserves the local draft and asks the parent to reload its preview. The parent remount key includes job and extraction revisions, and reload goes through the parent’s discard confirmation (`review-form.tsx:124–128, 198`; `import-form.tsx:192–195, 391–392`).
- PUT responses and `finally` updates are fenced by mounted state, request serial, and resource key, preventing an obsolete response from replacing a newer selection or clearing its pending state (`review-form.tsx:156–170`).
- Outgoing warning reasons are trimmed by the same normalizer as metadata before API validation (`review-form.tsx:24–31`).

### Final source pass — no open concrete UI findings

The duplicate confirmation is resolved. `reloadLatest(true)` now proceeds directly to GET; the inline “ยืนยันโหลดและทิ้งร่าง” step is the sole confirmation before discarding local edits (`review-form.tsx:172–175, 203–205`). The nullable input setter also accepts `string | null` consistently with its caller (`review-form.tsx:53–55`), and the warning-reason setter normalizes `null` explicitly (`review-form.tsx:184–186`).

I found no remaining concrete defect within the reviewed private review UI scope by source inspection. The five earlier findings and the duplicate-confirmation issue are resolved. The author reports focused typecheck and scoped ESLint passed; I did not rerun them. Root’s full pipeline and browser acceptance remain in progress, so responsive behavior, accessibility announcements, and browser timing are not independently accepted here. This report does not assess publication/version integration or claim full M7 acceptance.
