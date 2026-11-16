# OC-INBOX-ATTACH-08 Plan — Staff Outbound File Attach, Confirm & Revoke UI

- **Task ID**: `OC-INBOX-ATTACH-08`
- **Date**: 2026-11-16 (ICT)
- **Worktree**: `D:/project-next/line-ai-yru-opencode-staff`
- **Branch**: `codex/opencode-inbox-attach` (created from Root commit `803d345`)
- **Linked Requirements & Decisions**: `CH023`, `CH028`, `CH054`, `CH055`, `CH056`; `CHAT-MEDIA-02E` ([DEC-198](../decisions/DECISION_LOG.md#dec-198)), `OC-OPERATOR-07` ([DEC-199](../decisions/DECISION_LOG.md#dec-199)), `CHAT-MEDIA-02F` ([DEC-201](../decisions/DECISION_LOG.md#dec-201)), `CHAT-MEDIA-02G` ([DEC-202](../decisions/DECISION_LOG.md#dec-202)), `CHAT-MEDIA-02H` (parallel Root thread DTO extension)

## 1. Pinned Baseline (Verified in Session)

| Item | Value |
|---|---|
| Base commit | `803d345` (`feat(chat): add flag-gated Student LIFF viewer with revocation (DEC-202)`) |
| Branch | `codex/opencode-inbox-attach` (`codex/opencode-inbox-workflows` untouched) |
| Frozen evaluator fixture SHA256 (`tests/fixtures/assistant-conversations.json`) | `E79ADE32E0960DF2E0399531D703E55955456CAF7AF432288EA919AE45E801F3` |
| Baseline checks at `803d345` | `pnpm typecheck` 0 errors · `pnpm lint` 0 errors (4 baseline warnings in `tests/browser/oc-inbox/harness/`) · 60/60 unit across 6 `opencode-*` suites · mounted `S01`–`S27` **27 OK / 0 FAIL** (`OC_INBOX_ARTIFACTS_DIR=D:/codex-cache/yru-ui-qa/oc08/baseline`) |

## 2. Explicit Scope & Allowlist

Allowed files only:
- `app/(dashboard)/tickets/[id]/chat-outbound-state.ts` (new)
- `app/(dashboard)/tickets/[id]/chat-thread-ops.ts`
- `app/(dashboard)/tickets/[id]/chat-thread.tsx`
- `app/(dashboard)/tickets/[id]/chat-thread-live.tsx`
- `app/(dashboard)/inbox/inbox.tsx`
- `app/tickets.css` (chat/composer/draft-card/dialog classes only; global palette unchanged)
- `tests/opencode-inbox-attach-state.test.ts` (new)
- `tests/opencode-inbox-attach-thread.test.tsx` (new)
- `tests/browser/oc-inbox/harness/server.mjs` (header + binary SHA-256 capture + `networkError` route support)
- `tests/browser/oc-inbox/harness/scenarios.mjs` (append `S28`–`S35`; `S01`–`S27` preserved)
- `docs/ui/OC_INBOX_ATTACH_08_PLAN.md`, `docs/ui/OC_INBOX_ATTACH_08_COVERAGE.md`, `docs/reports/OPENCODE_INBOX_ATTACH_08_REPORT.md`

Explicitly untouched (forbidden): `lib/**`, `types/**`, `app/api/**`, `app/liff/**`, `supabase/**`, `proxy.ts`, `.env*`, AI/copilot/knowledge panels, `app/(dashboard)/tickets/[id]/ticket-actions.tsx`, LINE/outbox/Storage, `tests/browser/oc-inbox/artifacts/**`, and Root repository `D:/project-next/line-ai-yru`.

## 3. Contracts & Invariants

1. **Thread DTO extensions (02H optional fields)**:
   - `InboxThreadResult.outboundFiles?: { enabled: boolean }` — when absent or `false`, hide attachment upload controls completely.
   - `ChatMessage.outboundAttachment?: { id: string; name: string; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; size: number; studentAccess: 'WAITING_DELIVERY' | 'AVAILABLE' | 'EXPIRED' | 'REVOKED' | 'NOT_DELIVERED'; canRevoke: boolean } | null`.
   - Status is read strictly from `outboundAttachment.studentAccess`; never inferred from `message.content` or parsed from LIFF URLs.
2. **Composer attachment control**:
   - Shown ONLY when `outboundFiles?.enabled === true`, `detail.permissions.reply === true`, `detail.ticket.mode === 'HUMAN'`, and inside the Student reply composer (`chat-reply-composer`), never inside the internal note composer (`chat-note-composer`).
   - Uses `<input type="file" accept="application/pdf,image/jpeg,image/png">` with Thai `<label>` and full keyboard accessibility.
   - Client validation before any HTTP call: exact 3 MIME types and `1 <= size <= 10_485_760` bytes (10 MiB).
3. **Upload private draft (02E)**:
   - `POST /api/chat/tickets/{ticketId}/outbound-attachments` with raw bytes body (`credentials: 'same-origin'`, `cache: 'no-store'`), headers `Content-Type`, `X-Yru-Request-Id` (UUID per selection; reused on retry of same attempt), `X-Yru-Ticket-Revision`, `X-Yru-File-Name` (`encodeURIComponent(file.name)`), `X-Yru-Content-SHA256` (lowercase hex from `crypto.subtle.digest('SHA-256', bytes)`). Never manually set `Content-Length`.
   - On `201 { attachmentId, status: 'READY' }`: render draft card showing file name, type, size, `"ยังไม่ได้ส่งถึงนักศึกษา"`, short reload-disappearance warning, `"ส่งให้นักศึกษา"`, and `"นำออก"` (removes UI card only, explains private draft stays in system). Zero auto-confirm.
4. **Human confirmation & send (02F)**:
   - Requires explicit human click on `"ส่งให้นักศึกษา"` -> native `<dialog>` showing `ticketNo`, file name, and recipient code -> click `"ยืนยันส่งให้นักศึกษา"`.
   - `POST /api/chat/tickets/{ticketId}/outbound-attachments/{attachmentId}/confirm` with strict JSON `{ requestId, revision, ticketNo }` (no extra keys). Same `requestId` reused on network/5xx retry.
   - On `409 CONFLICT` / `409 INVALID_ACTION`: never auto-retry with new revision; trigger thread refetch and require human re-review & confirmation click.
   - On `200 { attachmentId, messageId, status, revision }`: update ticket `revision` & `status` immediately, remove draft card, trigger refetch/Realtime, and NEVER synthesize a fake sent message.
5. **Revoke student access (02G)**:
   - Message card renders `outboundAttachment` name, type, size, Thai `studentAccess` label (`WAITING_DELIVERY` -> `รอส่งถึง LINE`, `AVAILABLE` -> `นักศึกษาเปิดได้`, `EXPIRED` -> `หมดเวลาเปิด (30 วัน)`, `REVOKED` -> `ถอนสิทธิ์แล้ว`, `NOT_DELIVERED` -> `ส่งไม่สำเร็จ`).
   - `"ถอนสิทธิ์เปิดไฟล์"` shown ONLY when `canRevoke === true` (including closed cases). Opens confirmation `<dialog>` explicitly stating the LINE message remains while the link stops working.
   - `POST /api/chat/tickets/{ticketId}/outbound-attachments/{attachmentId}/revoke` with `{}` -> on `200 { attachmentId, revoked: true }`, refetch thread instead of guessing status.
6. **Authority, per-room isolation & byte hygiene**:
   - All draft/requestId/upload/confirm/revoke states are stored per `(actorId, ticketId)` inside `useChatThreadOps` and fenced by `authorityEpoch`.
   - `401` immediately triggers whole-actor reset; `403`/`404` trigger room-scoped erasure.
   - In-flight Room A responses never surface in Room B.
   - File bytes / `File` handles are never stored after upload completes (`201`/definitive reject) or when switching rooms.
   - Raw server error strings are never rendered; all errors map strictly by HTTP status & known code whitelist to Thai copy.

## 4. Acceptance Matrix (RED First -> GREEN)

- **Unit (`tests/opencode-inbox-attach-state.test.ts`, `tests/opencode-inbox-attach-thread.test.tsx`)**:
  - Validation, SHA-256 hex, headers, confirm strict 3-key payload, DTO parsers, error-code Thai mapping (no raw error leak), `studentAccess` mapping, visibility predicate, SSR markup for composer/draft card/messages/revoke button.
- **Mounted Browser (`S28`–`S35` + full `S01`–`S27`)**:
  - `S28`: button hidden when `outboundFiles` missing/false, `permissions.reply: false`, `mode: 'AI'`, or inside internal note composer.
  - `S29`: upload 201 headers/SHA-256 exact match, draft card shown, zero auto-confirm, UI-only remove.
  - `S30`: invalid MIME, 0-byte, and >10 MiB rejected client-side before any HTTP request.
  - `S31`: network error retry reuses exact `requestId` for upload & confirm; selecting new file uses new `requestId`.
  - `S32`: confirm 409 CONFLICT triggers refetch, requires manual re-confirm, zero automatic second request.
  - `S33`: confirm 200 updates revision for next reply, clears draft card, zero fake message before refetch.
  - `S34`: revoke dialog copy, `POST .../revoke {}`, refetch updates status and removes button when `canRevoke: false`.
  - `S35`: Room A upload/confirm hanging -> switch to Room B: zero leak into B (and zero retained bytes), `401` during Room A in-flight resets whole actor immediately.
