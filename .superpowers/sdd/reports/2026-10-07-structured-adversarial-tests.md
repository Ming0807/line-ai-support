# STR-01A-0 — independent structured payload adversarial tests

Date: 2026-10-07
Test author: delegated independent test agent (`/root/structured_adversarial_tests`)
Implementation owner: root. This report records test authorship and execution only; it is not a database, API, UI, or full V1 acceptance.

## Scope and sources

Added `tests/structured-payload-adversarial.test.ts` against the existing frozen exports in `lib/knowledge/structured-payload.ts`. The tests target hostile runtime selectors/getters, own required keys and explicit nullability across all seven datasets, backend-owned fields, exact decimal lexemes and limits, Gregorian date/timestamp boundaries, source text preservation and control characters, and HTTPS URL authority/userinfo/port/fragment/control/backslash cases.

The test contract was taken from `docs/architecture/STRUCTURED_DATA_DESIGN.md` and `docs/superpowers/plans/2026-10-07-yru-structured-payload-contract.md`, with project requirements checked in `AGENTS.md`, `docs/PROJECT_INDEX.md`, `docs/tasks/V1_TASK_BOARD.md`, `docs/decisions/DECISION_LOG.md`, `docs/requirements/V1_REQUIREMENTS_MATRIX.md`, `CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md`, and `docs/requirements/sources/README.md`. Existing happy-path coverage in `tests/structured-payload.test.ts` was not copied wholesale.

The adversarial decimal vectors retain the contract's credit scale: `1.001` is valid for credits and invalid for fees. The tests do not modify payload implementation, registry, design, UI, SQL, provider configuration, or environment files.

## Evidence

Commands run from `D:\project-next\line-ai-yru` with the configured Node/pnpm runtime on `PATH`:

```text
pnpm exec vitest run tests/structured-payload-adversarial.test.ts --maxWorkers=1
pnpm exec eslint tests/structured-payload-adversarial.test.ts
```

Vitest executed 14 tests: **11 passed, 3 failed**. ESLint completed with exit code 0 and no output. The failing assertions expose these behaviors in the current validator:

1. A required `academic_year` inherited from a prototype is read and accepted as source data. The design says listed source keys must be present in the payload; the test treats an inherited accessor as absent and requires it not be invoked.
2. A title containing 501 JavaScript UTF-16 code units (250 supplementary characters plus one ASCII character) is accepted. The frozen design explicitly sets string bounds in UTF-16 code units, so the validator needs to enforce that bound independently of Unicode code-point counting.
3. `https:///missing-authority` is accepted after the URL parser repairs the source lexeme to a hostname. The frozen design requires an HTTPS URL with a hostname and says to preserve, not rewrite, the source lexeme. Requiring a non-empty authority in the raw lexeme is an engineering interpretation of that contract; root should adjudicate whether to retain this rejection case.

The other 11 adversarial tests passed, including fixed errors for throwing own getters/proxy traps, unsupported selectors without payload access or coercion, required-versus-nullable behavior, numeric/non-finite/coercion rejection, decimal boundaries, date and UTC timestamp edge cases, control-character policy, valid HTTPS lexeme preservation and bounds, and backend-owned key rejection across the seven datasets.

No typecheck, full unit suite, build, database test, API test, or browser/UI test was run in this bounded task. The red assertions remain implementation work for root and are not evidence of overall STR-01A-0 completion.
