# M6 answer producer

Added `createKnowledgeProducer()` as the bounded orchestration layer between the worker snapshot, scope classifier, embedding adapter, backend retrieval, and grounded answer generation. It sends only the question, bounded conversation history, and retrieved evidence to provider callbacks; worker ownership identifiers stay out of prompts. Scope and answer generation use their strict schemas with no tools. Evidence is labeled untrusted in the answer prompt, and `buildCitedAnswer()` rejects citations outside the backend result before an `ANSWER` can be returned.

The producer bounds classification and embedding at 15 seconds each, backend search at 8 seconds, and answer generation at 20 seconds. Each callback is raced against its stage deadline and caller cancellation, so a callback that ignores abort cannot keep the producer open. Provider, embedding, retrieval, schema, and citation failures become fixed Thai clarification or handoff text; caller cancellation remains terminal. Search ambiguity and underspecified historical questions ask for an as-of date.

Scope grounding does not rely only on classifier instructions. Historical years and dates must match an explicit request, or one unambiguous direct reference to a year/date in prior USER text. Cohort years and curriculum/program code years are treated as applicability rather than historical time. Model-supplied audience, student type, program, curriculum, cohort, semester, and department values must be supported by the current question or a direct reference resolved from prior USER text; assistant history cannot establish scope. Unresolved scope is clarified before embedding or search.

## TDD and validation

- Initial RED: the focused Vitest run failed to load `../lib/knowledge/answer-producer` before the implementation existed.
- Scope/history RED: after adding regressions for invented non-temporal scope fields, current cohort years, direct historical references, and assistant-only scope claims, Vitest reported **10 failed and 17 passed**. The failures showed invented scope advancing, cohort years being confused with historical years, and direct user-history references not being grounded correctly.
- GREEN: `tests/knowledge-producer.test.ts` passed all **29 tests** after the fixes.
- Final focused regression run: `vitest run tests/knowledge-producer.test.ts tests/knowledge-eligibility.test.ts tests/knowledge-citations.test.ts --maxWorkers=1` passed **3 files and 56 tests**.
- File-scoped ESLint passed for `lib/knowledge/answer-producer.ts` and `tests/knowledge-producer.test.ts`.
- Scoped strict TypeScript check passed with a temporary project config limited to the producer and its tests; that temporary config was removed.

No provider credentials, live API, database, payment, or full-project checks were used. No commit or push was made.

Root subsequently added Thai canonical applicability aliases and explicit-current-year regressions. The seeded REGISTRAR case failed before its alias was implemented and then passed; the final producer suite has43 passing cases. The classifier prompt now matches the deterministic current-year rule. Full426-unit and81-PG runs plus the configured-worker signedHTTP harness are recorded separately in `docs/reports/M6_RAG_REPORT.md`; these are root execution results rather than the original delegated run.
