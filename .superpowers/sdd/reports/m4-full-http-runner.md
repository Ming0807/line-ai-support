# M4 full signed HTTP runner

Added `scripts/qa/ticket-flow-http.ts` as a local-only end-to-end fixture. It accepts only `http://127.0.0.1:3001`, requires durable webhook mode and local encryption/channel secrets, and connects directly to the fixed local Postgres listener on port 54422. Signed Student and Staff webhook events pass through the actual HTTP routes and inbox worker. The outbox worker receives an injected fake fetch, so no LINE/provider request is sent.

The runner drives contact and REGISTRATION choices, creates and notifies a HUMAN ticket, accepts it through a signed Staff postback, exercises a Staff reply and identical action replay, verifies the retry key and body across fake 503 then 409 responses, routes a Student CONTINUE reply to the same ticket, then sends `ห้องสมุดปิดกี่โมง`, explicitly chooses NEW_TOPIC, and checks that the original HUMAN ticket remains unchanged before resolving and closing it. It refuses to start when either durable queue has pending or processing work. Fixture rows are tracked and removed in `finally`, including inbox/outbox attempts, route/action tokens, receipts, activities, ticket history, messages, conversations, ticket/session identity, test Staff identity/profile/auth user, and a newly-created REGISTRATION department.

Run only after the isolated local Next server and root's queue/database preflight are ready:

```powershell
pnpm exec tsx scripts/qa/ticket-flow-http.ts
```

Static checks passed: `pnpm exec eslint scripts/qa/ticket-flow-http.ts` and `pnpm exec tsc --noEmit`. Per task instruction, the runner has not been executed; database cleanup and runtime flow remain for the root's approved run. Staff reply uses `applyTicketAction` directly with the local fixture Staff subject, while ingress and Staff acceptance use signed HTTP. This does not cover browser-session authentication for dashboard replies; the separate browser/API runner covers that boundary.
