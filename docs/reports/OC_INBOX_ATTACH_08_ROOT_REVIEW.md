# OC-INBOX-ATTACH-08 — Root review (not merged)

16 November 2026, Root. Branch `codex/opencode-inbox-attach` in `D:/project-next/line-ai-yru-opencode-staff`, commits `b980a82`, `8715ef3`, `bd1ac26`, `35c6c0a` on base `803d345` ([prompt](../agents/OPENCODE_INBOX_ATTACH_08_PROMPT.md), [OpenCode report](OPENCODE_INBOX_ATTACH_08_REPORT.md) on the branch).

## Checks Root ran itself

- Base and scope: `803d345` is an ancestor; clean worktree; all 13 changed files are inside the prompt allowlist (`chat-outbound-state.ts` matches `chat-*`); no `lib/**`, `types/**`, `app/api/**`, migration or `.env` change; no artifacts committed. `git diff --check` clean.
- Focused unit: 8 files, 73/73 (attach state 10, attach thread 3, existing OC suites 60).
- Mounted fixture matrix, label `root-review`, artifacts outside the repository (`D:/codex-cache/yru-ui-qa/oc08/root-review`): **35 OK / 0 FAIL** (S01–S27 unchanged, S28–S35 new). The worktree stayed clean afterwards.

## Code review against the prompt

- Upload: client type/size checks before any request; WebCrypto SHA-256; raw body with the five 02E headers; file-name header truncated to the server limits (360 characters, 1,080 encoded). Retry reuses the same `X-Yru-Request-Id`; a new file gets a new one; file bytes are dropped on completion, room switch or unmount.
- Confirm: only from a human click in a `<dialog>` that shows ticket number, anonymous code, file name, type/size and revision. Retry after a network error reuses the original `requestId`, `revision` and `ticketNo` (server replay). 409/INVALID_ACTION clears the attempt, keeps the READY draft and refetches; it never re-sends with a new revision. Success updates revision/status from the server result and waits for the real message; no fake message.
- Revoke: shown only when `outboundAttachment.canRevoke`; the dialog states that the LINE text stays but the link stops working; success refetches.
- Authority: every async result is checked against the authority epoch, actor, room key and request ID; 401 resets the whole actor, 403/404 erase the room; upload/confirm are blocked while another action on the same room is busy.
- Visibility: the attach control requires `outboundFiles.enabled === true`, reply permission, HUMAN mode and the reply composer (not notes). Root does not send `outboundFiles` yet, so after a merge the feature stays hidden until CHAT-MEDIA-02H lands.

## Findings

- No blocking issue.
- P3: the client counts the 360-character file-name limit in code points, the server in UTF-16 code units; a name with many emoji could be refused with a generic error. Low impact; can be aligned when 02H is built.
- Not run by Root: production build of the branch (worktree junction limit; Root builds after merge). FIXTURE evidence only: no real Storage, LINE, LIFF, Realtime or authenticated browser run.
