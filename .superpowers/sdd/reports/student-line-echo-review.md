# Student OA text echo review

## Verdicts

- **Spec: Pass.** The route verifies the raw body before parsing, validates the webhook envelope, replies only to valid text events with their reply token, ignores unsupported or malformed siblings, and acknowledges valid webhook envelopes with 200. The helper preserves the requested prefix and original text in order. Replies up to LINE's five-message limit are split into text messages no longer than 5,000 UTF-16 code units, without splitting surrogate pairs; the normal greeting stays in one message. Larger echoes are safely skipped with a fixed error code. The signature helper is unchanged.
- **Code quality: Pass; no remaining findings.** The prior P2 length-boundary finding is resolved by bounded splitting and a safe over-limit path. Added regression coverage exercises a maximum-length input, an emoji at a split boundary, and an echo that would exceed five messages. Failure logs continue to use fixed codes/statuses without logging credentials, reply tokens, exceptions, or LINE response bodies.

## E2E evidence and limits

The real LINE happy path is confirmed: a fresh `สวัสดี` reached server 10921, LINE's Reply API returned 200, the webhook returned 200 in 500 ms, and the user confirmed the exact reply `ได้รับข้อความแล้วครับ: สวัสดี`. The updated suite reports 16 route tests and 41 total tests passing. Controller verification after the fix confirmed typecheck and lint exit0 and production build exit0 in session47875. A fresh public-HTTPS smoke check returned signed-empty200, modified-body401, missing-signature401 and GET405; the live dev server compiled the route successfully. The actual LINE E2E covers the short single-message reply; message splitting and the five-message boundary are covered by mocked regression tests, not a real LINE send.
