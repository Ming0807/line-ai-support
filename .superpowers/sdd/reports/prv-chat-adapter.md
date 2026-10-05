# PRV-02 Chat adapter report

Date: 2026-10-04  
Owner: `/root/docs_provider_review`  
Scope: `lib/ai/providers/chat-completions.ts` and `tests/chat-completions.test.ts` only, plus this report. No shared contracts, registry, gateway, database, UI, or runtime configuration was changed.

## Result

Implemented the chat-completions adapter for the canonical OpenRouter and OpenCode Zen API roots. Requests reject unsupported hosts, model identifiers, extra/protected-header fields, non-strict schemas, invalid tools, and the `RESPONSES` format before network access. Fetches use `redirect: 'error'`, abort propagation, 10-second inference and 5-second metadata bounds, a 512 KiB request cap, and a 256 KiB response cap.

OpenRouter requests default to `FREE_ONLY` and include backend-owned `provider.max_price.prompt = 0`, `provider.max_price.completion = 0`, and `require_parameters = true`. Only an explicit `ALLOW_PAID` request omits the zero price ceiling. Zen requests omit OpenRouter-specific routing fields. Neither path adds alternate model/plugin fallback fields. The adapter accepts only one non-streaming assistant choice, parses the complete structured JSON value, rejects refusals and unsupported finish reasons, checks tool names and IDs against safe syntax/allowlists, parses usage counters, and retains the actual upstream HTTP status on successful and application-level failures. HTTP errors map to normalized safe error codes without exposing upstream bodies or credentials. Health checks issue authenticated metadata GETs only and never perform inference.

The tests use injected fake `fetch` responses only. TDD first produced a red run because the adapter module did not yet exist. An additional red test demonstrated that a response combining structured output and tool calls was accepted as two competing actions; the adapter now rejects that ambiguous response. The final suite covers request bodies and cost mode, provider/model validation, schema and tool adversarial cases, protected headers, response parsing/refusals/finish reasons, HTTP and transport mapping, cancellation/timeout, body limits, and metadata health checks.

## Verification

- `pnpm exec vitest run tests/chat-completions.test.ts` — passed, 37 tests.
- `pnpm exec eslint lib/ai/providers/chat-completions.ts tests/chat-completions.test.ts` — passed.
- Isolated strict TypeScript check for the two owned files — passed:
  `pnpm exec tsc --noEmit --pretty false --target ES2017 --lib "dom,dom.iterable,esnext" --module esnext --moduleResolution bundler --strict --esModuleInterop --skipLibCheck lib/ai/providers/chat-completions.ts tests/chat-completions.test.ts`
- `pnpm typecheck` — still fails outside this slice at `tests/ai-free-policy.test.ts:89`: a mock returns `Promise<unknown>` where the newly landed pricing API requires `Promise<ModelPricing>`. No files in that failing test or pricing module were changed here.
- No real inference, provider account, secret, database, or network call was used.

## Contract note

OpenRouter has an adapter-level zero-price routing constraint. Zen's compatible chat endpoint has no OpenRouter `max_price` field, so `FREE_ONLY` for Zen depends on the caller admitting only models whose pricing evidence has already been verified by the registry/configuration layer. An unknown or unverified Zen model must not be offered to startup runtime selection as free.

## Source and guide scope

Followed repository `AGENTS.md`, project index, task board, requirements matrix, decision log, AI provider design, free-provider plan, master implementation guide, and the installed Next.js route-handler guide at `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. No route handler was changed by this adapter slice.
