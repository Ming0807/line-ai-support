# M5 AI Gateway implementation plan

> **For agentic workers:** Use bounded subagent-driven development and verification-before-completion. The user authorized continuous V1 implementation and deferred manual credentials to the final report. Begin implementation after the M4 automated acceptance gate.

**Goal:** A single OpenAI Responses adapter behind a provider/model registry, validated structured responses, deadline-limited fallback, private usage/error records and provider health.

**Architecture:** Root owns the registry, schema, gateway, controlled tool dispatcher and integration. A Luna MAX task owns the isolated HTTP adapter and its failure tests. AI network requests run outside business transactions. Student job orchestration and RAG evidence are added in M6; the M4 HUMAN fence remains authoritative.

**Tech stack:** Existing Node24/TypeScript/PostgreSQL17, Zod4, native fetch and Vitest/node:test. No provider SDK required.

## Constraints and decisions

- Follow master guide §§29–31. Preserve existing anonymous LINE, ticket service, RLS and delivery boundaries.
- Start with OPENAI only; provider/model selection comes from explicit configuration. There is no guessed default model or production fake provider. Missing keys leave the registry unconfigured; controlled adapters prove automated behavior and the final report identifies live evidence still pending.
- The credential-bearing provider record, model registry, usage and error tables are private, RLS-enabled and denied to browser roles. Dashboard access uses server-authorized safe DTOs.
- Only `https://api.openai.com/v1` is a permitted OPENAI base URL. No model output can choose a URL, credential, SQL, table or executable function.
- Credentials and raw request/response text never enter logs. Error records use fixed codes and optional HTTP status. Tokens are nullable when the provider supplies no count; cost is nullable without configured prices.
- Model priorities are deterministic; maximum three attempts and one hard overall deadline (45s maximum), with per-model timeouts. Fallback handles timeout,429,5xx,unavailable model/provider and invalid structured output. Cancellation stops further attempts.
- Strict JSON schema plus Zod validation apply to every successful response. Tool calls are returned as data; only registered, explicitly permitted tools with strict validated arguments can be executed by the backend.

## Frozen adapter interface

Root creates `lib/ai/types.ts` before delegation:

`AIMessage = {role:'system'|'user'|'assistant';content:string}`.

`AITool = {name:string;description:string;parameters:Record<string,unknown>}`.

`ProviderRequest = {modelId:string;baseUrl:string;apiKey:string;messages:AIMessage[];responseSchema:{name:string;schema:Record<string,unknown>};tools?:AITool[];signal:AbortSignal;maxOutputTokens?:number}`.

`ProviderResponse = {output:unknown|null;toolCalls:{id:string;name:string;arguments:unknown}[];inputTokens:number|null;outputTokens:number|null}`.

`AIProviderError` exposes only a fixed `code`, optional `httpStatus`, and `retryable`; its message is the code. Codes: TIMEOUT,CANCELLED,RATE_LIMITED,SERVER_ERROR,MODEL_UNAVAILABLE,AUTH_ERROR,INVALID_OUTPUT,INVALID_REQUEST,PROVIDER_UNAVAILABLE.

`AIProviderAdapter.generate(request):Promise<ProviderResponse>` and `healthCheck({modelId,baseUrl,apiKey,signal}):Promise<'HEALTHY'|'DEGRADED'|'RATE_LIMITED'|'OFFLINE'>`.

## Tasks and gates

1. **Root: registry/schema.** Write meaningful PG RED fixtures, CLI-generate additive private provider/model/usage/error tables with constraints, indexes, explicit effective grants and RLS. Implement deterministic enabled registry reads and redacted persistence. Dashboard is the required configuration path; optional future env bootstrap must preserve existing configuration.
2. **Luna MAX: OpenAI adapter.** Native POST `/responses`, `text.format` strict JSON schema and strict function tools; bounded response read, validate result/usage/tool arguments, refusal/incomplete handling, abort/error normalization. Safe GET model health check. Fake HTTP tests prove schema request, normal JSON, malformed output,429,5xx,404,401,abort and response size. Consult official OpenAI docs.
3. **Root: gateway/tools.** RED→GREEN normal output, invalid JSON, provider ordering, model capabilities, timeout/429/5xx/unavailable fallback, finite attempts/overall deadline, cancellation, usage/error/health records. Implement strict tool allowlist and context-bound executors; unknown tools fail before execution. No arbitrary SQL path.
   **User clarification:** Provider setup must be manageable from Dashboard in V1. Add Super Admin `/providers` and server-authorized provider/model create/update, optional key replacement with no key read-back, enabled/priority/timeouts/capabilities/prices and model health-check. Validate origin/body/active server role, audit configuration changes with names/IDs only, never credentials. `.env` bootstrap is optional, not a required configuration path. Root owns backend and freezes safe DTOs before delegating UI.
4. **Independent review:** Check credentials, URL/cancellation/deadline/fallback, structured validation, private grants and tool boundaries. Fix findings and rerun affected tests.
5. **Acceptance:** Local clean migration replay, meaningful PG registry/log/privacy tests, full unit/type/lint/build, controlled adapter gateway success/fallback. Guarded development schema sync, report `docs/reports/M5_AI_GATEWAY_REPORT.md`, commit/push and proceed M6. Actual provider/key/model and paid generation evidence stay explicitly deferred when credentials are absent.

## Official protocol reference

OpenAI [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) uses Responses `text.format` JSON schema; function tools use strict parameters. Root verified the official guide on 4 October 2026. This plan fixes architecture, not a model choice; configuration must name a model available to the user's API account.
