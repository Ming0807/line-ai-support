# M5 OpenAI Responses adapter report

## Result

Implemented `createOpenAIAdapter({fetchImpl?})` in `lib/ai/providers/openai.ts` against the frozen `AIProviderAdapter` interface. Generation uses `POST https://api.openai.com/v1/responses`, the caller signal, `redirect: 'error'`, and `store: false`. Only the exact OpenAI API v1 base is accepted, with one optional trailing slash. The request uses `text.format` with a strict JSON schema; declared function tools are sent as strict Responses function tools. The adapter returns calls as data and never executes them.

Before HTTP, the adapter checks exact request/config object shapes, model and schema names, API key shape, message bounds, JSON-safe schema/tool data, and strict-schema object rules. Model IDs accept up to 200 characters, matching the shared model schema. It rejects cycles, accessors, non-finite request numbers, oversized inputs, duplicate or invalid tool names, and object schemas that do not set `additionalProperties: false` and require every property. Strict output formatting and strict function parameters follow the [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [Function Calling guide](https://developers.openai.com/api/docs/guides/function-calling).

The response reader enforces a 256 KiB limit and cancels when the declared or streamed body exceeds it. Each pending read races the caller's abort signal; abort requests reader cancellation immediately and removes the listener when the read settles, even if a custom response body ignores the signal. It parses only completed Responses containing one object-shaped JSON text result or declared function calls. Refusals, incomplete responses/calls, multiple JSON outputs, malformed JSON/arguments, unrequested tools, duplicate call IDs, non-finite values, invalid usage, and ambiguous empty output produce fixed `INVALID_OUTPUT` errors. Gateway Zod schemas remain responsible for validating the returned object against the requested application schema, and the controlled tool registry remains responsible for validating arguments before execution.

Generation errors are normalized without reading non-2xx response bodies: 401/403 → `AUTH_ERROR`, 429 → `RATE_LIMITED`, 404 → `MODEL_UNAVAILABLE`, 5xx → `SERVER_ERROR`, other 4xx → `INVALID_REQUEST`, abort timeout/cancellation → `TIMEOUT`/`CANCELLED`, and network/read failure → `PROVIDER_UNAVAILABLE`. The model health check uses GET `/models/{encodedModelId}` with the same host, credential, redirect, and signal safeguards; it returns the frozen health enum and cancels response bodies. These endpoints and output shapes are documented in the [Responses API reference](https://platform.openai.com/docs/api-reference/responses/create) and [Retrieve model reference](https://developers.openai.com/api/reference/resources/models/methods/retrieve). Error categories follow the [official error guide](https://developers.openai.com/api/docs/guides/error-codes).

The adapter contains no logging, so API keys, message text, output, headers, raw provider errors, and response bodies do not enter logs. It uses native `fetch`; all exercised HTTP is mocked.

## RED→GREEN evidence

- The initial tracer failed because the adapter module did not exist; the Responses request/normalization test passed after the first implementation.
- An extra message field reached the fake fetch instead of failing locally; exact-key validation made the test pass without an HTTP call.
- A function schema with `additionalProperties: true` reached the fake fetch; strict-schema preflight now rejects it before HTTP.
- Health network failure propagated `PROVIDER_UNAVAILABLE`; it now resolves to `OFFLINE` while timeout and cancellation still propagate as fixed errors.
- A non-object JSON result was accepted, and a function call marked incomplete was returned; both cases now reject with `INVALID_OUTPUT`.
- Extra health configuration reached the fake fetch; exact health-config validation now rejects it locally.
- The 200-character model-ID case failed with `INVALID_REQUEST` under the old 128-character limit; the adapter now accepts the shared 200-character bound.
- The stalled-reader abort case remained pending past its 100 ms race before the fix; it now rejects as `CANCELLED` and requests reader cancellation promptly.

The focused RED run selected those two cases: 2 failed and 37 were skipped. The focused GREEN run passed both cases (2 passed, 37 skipped), and the full adapter test file passed all 39 tests.

## Verification

- `pnpm exec vitest run tests/openai-provider.test.ts --maxWorkers=1` — 1 file, 39 tests passed.
- `pnpm exec eslint lib/ai/providers/openai.ts tests/openai-provider.test.ts` — exit 0, no output or warnings.
- File-scoped strict TypeScript check for the adapter and test — passed:
  `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --lib "es2022,dom" --module ESNext --moduleResolution Bundler --types node lib/ai/providers/openai.ts tests/openai-provider.test.ts`.

No database, environment credentials, or live provider calls were used. A live OpenAI key, configured model availability, and paid generation remain unverified by design.

## Remaining integration boundary

The adapter confirms the response is valid object JSON and that function-call arguments are valid object JSON for a tool declared in the request. It does not duplicate the gateway’s application Zod parse or the tool registry’s argument-schema check. The gateway must continue to reject invalid structured output, and tool execution must continue to validate arguments against the registered tool schema before invoking any executor. Other schema keywords are passed through for OpenAI validation; provider-side schema rejection is surfaced as fixed `INVALID_REQUEST` without exposing the response body.
