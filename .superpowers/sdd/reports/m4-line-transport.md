# M4 LINE transport implementation report

## Result

Added `deliverLine` in `lib/line/delivery.ts` and fake-fetch coverage in `tests/line-delivery.test.ts`. The implementation validates text messages and postback quick replies, sends through the fixed LINE Messaging API reply/push endpoints, rejects redirects, applies an abort timeout, and never reads response bodies or logs fetch errors, credentials, reply tokens, or message content. It returns only bounded status/error metadata and a validated request ID of at most 128 characters.

Reply mode is allowed only before its persisted deadline, with a reply token and no prior network attempt. An unused reply with no token, no deadline, an expired deadline, or a deadline more than 60 seconds away resolves to Push. Any prior Reply attempt, timeout, HTTP 408, or 5xx returns `UNKNOWN` without another request or Push fallback. A known Reply 429 returns `DEAD` with `REPLY_RATE_LIMITED`; the transport does not retry or switch channels after a Reply request. Push retries preserve the same recipient, serialized message body, and retry key, and are refused at or after 24 hours from the first attempt. Push 408/429/5xx/timeouts return `RETRY`; 409 returns `SENT`; other 4xx responses return `DEAD`.

`attempts` and `firstAttemptAt` describe prior network attempts. The caller must persist the upcoming attempt and effective mode before calling the network, as confirmed by the root agent. When the caller chooses an expired Reply row, it must persist the Push mode before dispatch; the transport also enforces the same switch for a pre-send Reply snapshot.

## RED/GREEN and verification

- RED: before `delivery.ts` existed, `pnpm exec vitest run tests/line-delivery.test.ts` failed at module resolution (`Cannot find module '../lib/line/delivery'`; 0 tests ran).
- GREEN: `pnpm exec vitest run tests/line-delivery.test.ts` — 21/21 passed.
- `pnpm exec eslint lib/line/delivery.ts tests/line-delivery.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` — exit 0.
- PowerShell trailing-whitespace scan of the M4 implementation, tests, and report — no trailing whitespace.

No live LINE request, environment or credential read, database access, outbox write, commit, or push was performed.

## Official LINE guidance checked

The current reply reference says reply tokens are single-use, normally valid for one minute, and should be used promptly because the time limit can change. The transport uses the caller’s persisted deadline and caps any remaining Reply window at 60 seconds; the application sets its more conservative 20-second deadline.

LINE’s retry guide says Push supports `X-Line-Retry-Key` on the first request, that the key is valid for 24 hours, retries must preserve recipient and body, and an already accepted retry returns 409. The root’s explicit contract additionally directs Push retries for 429, so this implementation follows that contract while keeping all other non-409 4xx responses terminal. LINE documents up to 13 quick-reply items and supports postback actions; the validator enforces those limits and action type.

References: [Reply and Push message API](https://developers.line.biz/en/reference/messaging-api/nojs/), [Retry failed API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), [Use quick replies](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/), and [Postback action reference](https://developers.line.biz/en/reference/messaging-api/nojs/).


