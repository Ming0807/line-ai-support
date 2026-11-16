# OPENCODE_INBOX_ATTACH_08 Report — Staff Outbound File Attachment UI

- **Task ID**: `OC-INBOX-ATTACH-08`
- **Date**: 2026-11-16 (ICT)
- **Worktree**: `D:/project-next/line-ai-yru-opencode-staff`
- **Branch**: `codex/opencode-inbox-attach` (created from Root commit `803d345`; `codex/opencode-inbox-workflows` untouched; Root repository `D:/project-next/line-ai-yru` untouched)
- **Related Tasks / Decisions**: `CH023`, `CH028`, `CH054`, `CH055`, `CH056`; `CHAT-MEDIA-02E` (`DEC-198`), `OC-OPERATOR-07` (`DEC-199`), `CHAT-MEDIA-02F` (`DEC-201`), `CHAT-MEDIA-02G` (`DEC-202`), `CHAT-MEDIA-02H` (parallel Root DTO contract)
- **Coverage Board**: [OC_INBOX_ATTACH_08_COVERAGE.md](../ui/OC_INBOX_ATTACH_08_COVERAGE.md)
- **Execution Plan**: [OC_INBOX_ATTACH_08_PLAN.md](../ui/OC_INBOX_ATTACH_08_PLAN.md)

## 1. Local Commit Chain

1. **`b980a82`** — `test(oc-08): add plan, harness binary/error capture, and RED attach tests`
   - Added execution plan, binary/header/WebCrypto SHA-256 + `networkError` capture in the Playwright fixture harness, unit RED suites (`tests/opencode-inbox-attach-state.test.ts`, `tests/opencode-inbox-attach-thread.test.tsx`), and mounted RED scenarios `S28`–`S35`.
2. **`8715ef3`** — `feat(oc-08): implement Staff outbound file attach, confirm, and revoke UI`
   - Implemented client pre-flight validation, WebCrypto SHA-256 digesting, raw binary upload (`02E`), draft card UX, manual modal confirmation + 409 re-review (`02F`), `studentAccess` status badges + modal revocation (`02G`), per-`(actorId, ticketId)` + `authorityEpoch` state isolation, byte/handle cleanup, scoped CSS, and GREEN tests/scenarios.
3. **Final Docs Commit** *(see `git log --oneline 803d345..HEAD`)* — `docs(oc-08): add OC_INBOX_ATTACH_08 coverage board and report`.

## 2. Files Changed (Strictly Within Allowlist)

Compared against base commit `803d345`:
- `app/(dashboard)/tickets/[id]/chat-outbound-state.ts` *(new)* — client file validation (`application/pdf`, `image/jpeg`, `image/png`, `1` B to `10,485,760` B / 10 MiB), `crypto.subtle.digest('SHA-256', bytes)` lowercase hex, `encodeURIComponent` file-name header & upload header builders, strict 3-key confirm payload builder `{ requestId, revision, ticketNo }`, optional `02H` structural types & runtime parsers, all 5 `studentAccess` Thai labels, zero-raw-leak Thai error mappers.
- `app/(dashboard)/tickets/[id]/chat-thread-ops.ts` — per-`(actorId, ticketId)` outbound upload/draft/confirm/revoke store, `authorityEpoch` and room lease fences, `401` immediate whole-actor reset, `403`/`404` room-scoped erasure, raw `ArrayBuffer`/`File` cleanup on completion/room switch/unmount, immediate `revision`/`status` sync on confirm `200` without synthesizing a fake sent message, and `409 CONFLICT` refetch requiring human re-click.
- `app/(dashboard)/tickets/[id]/chat-thread.tsx` — `<input type="file" accept="application/pdf,image/jpeg,image/png">` with Thai `<label>` strictly inside the Student reply composer (gated by `outboundFiles?.enabled === true && permissions.reply && mode === 'HUMAN'`; absent from internal notes), upload retry banner, private `READY` draft card, native `<dialog>` confirmation modal (closes on submit so concurrent Room B navigation is never blocked), message attachment cards read strictly from `message.outboundAttachment`, and `canRevoke`-gated revoke `<dialog>`.
- `app/(dashboard)/tickets/[id]/chat-thread-live.tsx` & `app/(dashboard)/inbox/inbox.tsx` — wired `outbound={ops.outbound}` into `<ChatThread>`.
- `app/tickets.css` — scoped CSS rules for outbound composer upload bar, private draft card, message attachment badges, and `<dialog>` confirmation modals (global palette untouched).
- `tests/opencode-inbox-attach-state.test.ts`, `tests/opencode-inbox-attach-thread.test.tsx` — unit and SSR component tests.
- `tests/browser/oc-inbox/harness/server.mjs`, `tests/browser/oc-inbox/harness/scenarios.mjs` — `FETCH_SHIM` header/binary/SHA-256/networkError hooks plus mounted scenarios `S28`–`S35` (`S01`–`S27` preserved).
- `docs/ui/OC_INBOX_ATTACH_08_PLAN.md`, `docs/ui/OC_INBOX_ATTACH_08_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_ATTACH_08_REPORT.md`.

Untouched forbidden paths verified: `lib/**`, `types/**`, `app/api/**`, `app/liff/**`, `supabase/**`, `proxy.ts`, `.env*`, AI/copilot/knowledge panels, `app/(dashboard)/tickets/[id]/ticket-actions.tsx`, `tests/browser/oc-inbox/artifacts/**` (all QA artifacts stored strictly outside repo at `D:/codex-cache/yru-ui-qa/oc08/<label>`), and Root repository `D:/project-next/line-ai-yru`. Frozen evaluator fixture `tests/fixtures/assistant-conversations.json` SHA256 remained unchanged (`E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3`).

## 3. Verification Summary (RED vs GREEN)

### 3.1 Baseline (`803d345`)
- `pnpm typecheck`: exit `0`
- `pnpm lint`: exit `0` (`4` pre-existing warnings in `tests/browser/oc-inbox/harness/`)
- `opencode-*` Vitest: `6` files, `60/60` passed
- Mounted browser matrix (`S01`–`S27`, `D:/codex-cache/yru-ui-qa/oc08/baseline`): **27 OK / 0 FAIL**

### 3.2 RED Proof (`b980a82`, before production implementation)
- New attach Vitest (`tests/opencode-inbox-attach-state.test.ts`, `tests/opencode-inbox-attach-thread.test.tsx`): **exit `1`** (both files failed as expected)
- Mounted browser matrix (`S01`–`S35`, `D:/codex-cache/yru-ui-qa/oc08/oc08-red`): **27 OK / 8 FAIL** (`S01`–`S27` OK; `S28` FAIL 5/6; `S29`–`S35` FAIL 0/0 timeouts)
  - `summary.json` SHA256: `18D4D58C6F932BAB98C870A0D03034D7356A32CFFD08F4AF93ADE40BCF660150`
  - `summary.md` SHA256: `F771CF48D701F699B8DB87CC9816F016C686492E365CBDC112338BFB381E9BBC`

### 3.3 GREEN Verification (`8715ef3`)
- `pnpm typecheck`: **exit `0`** (`0` errors)
- `pnpm lint`: **exit `0`** (`0` errors; `4` pre-existing warnings in `tests/browser/oc-inbox/harness/{run-scenarios,scenarios,server}.mjs`)
- Focused `opencode-*` Vitest: **8/8 files, 73/73 passed** (`tests/opencode-inbox-attach-state.test.ts` 10, `tests/opencode-inbox-attach-thread.test.tsx` 3, `tests/opencode-inbox-chat-thread.test.tsx` 6, `tests/opencode-inbox-actions.test.tsx` 1, `tests/opencode-inbox-state.test.ts` 17, `tests/opencode-inbox-hardening-state.test.ts` 14, `tests/opencode-operator-authority.test.ts` 15, `tests/opencode-inbox-read.test.ts` 7)
- Full Vitest (`pnpm exec vitest run --maxWorkers=1 --testTimeout=20000`): **exit `0`** — `300 passed | 1 skipped (301)` test files, `3900 passed | 3 skipped (3903)` tests (3 pre-existing skips in `tests/hermes-staff-runtime.test.ts` [1] and `tests/hermes-native-handler.test.ts` [2]; `tests/auth-bootstrap.test.ts` 6/6 passed)
- Mounted browser matrix (`S01`–`S35`, `D:/codex-cache/yru-ui-qa/oc08/oc08-c2`): **35 OK / 0 FAIL** (`FIXTURE_PASS`)
  - `S01`–`S27`: all OK (zero regression)
  - `S28-outbound-attach-visibility`: `6/6 OK`
  - `S29-outbound-upload-headers-draft-card`: `13/13 OK`
  - `S30-outbound-client-validation`: `4/4 OK`
  - `S31-outbound-network-retry-request-id`: `7/7 OK`
  - `S32-outbound-confirm-409-rereview`: `5/5 OK`
  - `S33-outbound-confirm-200-revision-no-fake`: `3/3 OK`
  - `S34-outbound-revoke-and-student-access`: `5/5 OK`
  - `S35-outbound-cross-room-isolation-and-401`: `7/7 OK`
  - `summary.json` SHA256: `D00D49C349A9C0379F65CBA986A00573D14206A7815B77546E1064F1102F9D4F`
  - `summary.md` SHA256: `9F364F4AF41F7B0FA7347527073146ADD8C056D8C701599E533D6D8DFD78786B`
- `pnpm build`: **exit `1`** (`TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`) — worktree `node_modules` junction restriction; Root executes `pnpm build` after branch integration.

## 4. Accepted Behavior Notes, Root Dependencies & Explicit Non-Claims

1. **Unconfirmed `READY` Drafts Across Full Page Reload (Accepted V1 Scope)**:
   - Because `CHAT-MEDIA-02E` (`DEC-198`) does not expose a pending-draft listing endpoint, unconfirmed `READY` draft cards live in the per-`(actorId, ticketId)` client store for the current tab session and disappear from the UI on full page reload. The UI displays a clear warning on the card (`ร่างนี้แสดงเฉพาะในแท็บนี้ หากโหลดหน้าใหม่ร่างที่ยังไม่ยืนยันจะหายไปจากหน้าจอ`), and clicking `"นำออก"` removes only the UI card while stating that the private draft stays stored in the system. No `PROPOSED` API is required for V1.
2. **Parallel Root Contract (`CHAT-MEDIA-02H` & `types/**`)**:
   - `types/inbox.ts` and `types/tickets.ts` were left untouched per scope rules; `chat-outbound-state.ts` defines structural optional extensions (`outboundFiles`, `outboundAttachment`) that remain backward-compatible with older server payloads until Root merges `02H` DTO fields and types.
3. **Explicit Non-Claims (`NOT_RUN`)**:
   - All mounted scenarios (`S01`–`S35`) ran in the synthetic Playwright fixture (`FIXTURE_PASS`), not against live Supabase/Next.js routes.
   - This report does **not** claim completion of V1 or live verification of LINE webhook/Messaging push, LIFF authentication/student viewer, Supabase Storage upload/signed URLs, Realtime delivery, or end-to-end Flows A–F.
