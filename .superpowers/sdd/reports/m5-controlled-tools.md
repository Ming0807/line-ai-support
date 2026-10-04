# M5 controlled AI tool registry

Implemented a pure backend registry for the four fixed tool names. Registration rejects duplicate/unknown names, non-strict object schemas (including nested objects and open records/maps), schema fields that could override trusted context, and schemas that cannot become JSON Schema. Definitions are generated from Zod schemas, omit the draft marker, force `additionalProperties: false` recursively, and represent optional properties as required nullable fields for strict provider formats.

Execution checks the fixed name allowlist, the caller's permitted-name list, registration, strict parsed arguments, and a UUID/UUID/nonnegative-integer trusted context before calling a handler. All validation and handler failures use fixed error codes without embedding model arguments or backend exception text. No business handlers or external calls were added.

TDD evidence: the focused suite first failed because `lib/ai/tools.ts` did not exist; after implementation, all 9 tests passed. Verification passed:

```text
pnpm exec vitest run tests/ai-tools.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm exec eslint lib/ai/tools.ts tests/ai-tools.test.ts
pnpm exec tsc --noEmit
```

## Root integration verification

The original optional-null contract failed with INVALID_ARGUMENTS before normalization. The union-branch variant also failed before its fix. Root now confirms all 12 tool tests pass, including nested nullable preservation and rejection of extra keys/context overrides. Full 221 unit tests, TypeScript, lint and build pass; no business executors are claimed in M5.
