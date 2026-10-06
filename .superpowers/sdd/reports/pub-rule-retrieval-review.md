# PUB-03 retrieval and rule-proof review

Reviewed 6 October 2026. This independent read-only review covers PUB-03 family relationship retrieval and proof construction. I changed no product, test, schema, plan, or board files; this report is the only file I own.

## Scope and disposition

I reread the current PUB-03 freeze in `docs/superpowers/plans/2026-10-06-yru-import-publication.md`, project instructions/index/board/decisions, the applicable master and original-versioning requirements, and `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`. Source review covered `lib/knowledge/retrieval.ts`, `lib/knowledge/rule-proof.ts`, `supabase/migrations/20261006061806_knowledge_family_rule_revision.sql`, and their focused proof and relationship tests. I also inspected the family revision increment in `lib/imports/import-publication.ts` as a dependency check.

**Final disposition: no unresolved blocker found in the reviewed retrieval/proof slice.** PUB-04 approval API/UI, the complete downstream citation/worker/delivery acceptance, M8 structured publication, real university corpus approval, and full V1 are outside this review and remain separate gates.

## Findings and fixes verified

- **Group ranking used only the base’s department and freshness.** The earlier retrieval query ranked a base-plus-amendment group using the base row’s department relevance and approval time. That could place a global base with a newer exact-department amendment below a competing exact-department base. Root added a PostgreSQL regression for that comparison; root reports it failed before and passed after the fix. The final query aggregates maximum member department relevance and approval time for group ranking (`retrieval.ts:105–120, 134–149`). My final relationship run includes that case and passes.
- **Evaluation date could vary inside one query.** The earlier use of volatile `clock_timestamp()` could cross Bangkok midnight between row evaluations. The final query materializes one `request_date` using `statement_timestamp()` and reuses it for base eligibility, instrument eligibility, and proof output (`retrieval.ts:42–45, 54–63, 92, 139`). This is source-verified; I did not simulate a query across midnight.
- **Visible indirect relationship chains could be silently omitted.** Direct-only joins previously risked returning a base and direct amendment while ignoring a visible eligible amendment-of-amendment or cancellation-of-cancellation. The final `unsupported_effects` CTE returns controlled `KNOWLEDGE_CONTEXT_INCOMPLETE` for those eligible legacy edges, without traversing them; ineligible/private sources do not poison the public result (`retrieval.ts:96–113, 151–156`). The final relationship suite includes these cases and passes.
- **Aggregate ordering was not explicit.** The prior outer group aggregate relied on CTE order. The final query uses explicit `ORDER BY` inside member/effect/chunk/group JSON aggregates and assigns a deterministic group order before JavaScript applies its bounded selection (`retrieval.ts:139–152`). This closes the ordering concern at source level.

## Contract evidence

The retrieval SQL resolves bases separately from instruments and matches direct effects to the same family, stream, and academic-year cohort, while enforcing each instrument’s status, authority/publication, review, visibility, date, department and applicability filters (`retrieval.ts:64–95`). It returns the base plus every eligible direct amendment, removes only an amendment canceled by an eligible effect, and removes a whole base group only for an eligible cancellation of that base (`:96–133`). Year-only historical requests with relationship effects ask for an exact-date clarification rather than inventing a calendar boundary. Unknown narrower applicability is also clarified before returning a potentially incomplete base group.

A group is relevant only if at least one of its usable chunks meets the requested threshold. The output reserves a best chunk per required member even when that member scores below threshold; if a relevant group has a missing usable member or cannot fit as a complete group, it returns `KNOWLEDGE_CONTEXT_INCOMPLETE` instead of a partial group (`retrieval.ts:116–120, 153–171`). Request limits are bounded to 12. The proof digest contains only the family/base/stream/revision/date plus sorted member/effect identifiers and revisions; it includes no document text, source URL, token material, or vectors (`rule-proof.ts:57–110`). Strict parsing, canonical lower-case IDs/revision encodings, uniqueness and bounds are covered by the proof tests. Legacy rows without proofs fail context comparison rather than receiving today’s epoch (`rule-proof.ts:119–149`).

The new migration is additive: `rule_revision BIGINT NOT NULL DEFAULT 0 CHECK (rule_revision >= 0)` (`20261006061806_knowledge_family_rule_revision.sql`). Publication increments the revision inside its locked transaction, including new/historical additions; publication integration assertions verify first publication/retry and subsequent family changes (`import-publication.ts:122`, `tests/database/import-publication.integration.ts:60–64,103–110`). The PUB-03 freeze still assigns callers, saved proof propagation, and full worker/delivery fence acceptance to root.

## Verification performed

Commands run against the final reread source from `D:\project-next\line-ai-yru`:

- `& 'C:\Users\NOTEBOOK\AppData\Roaming\npm\pnpm.cmd' exec vitest run tests/knowledge-rule-proof.test.ts` — **1 file, 9 tests passed**.
- `& 'C:\Users\NOTEBOOK\AppData\Roaming\npm\pnpm.cmd' exec eslint --no-cache lib/knowledge/retrieval.ts lib/knowledge/rule-proof.ts tests/knowledge-rule-proof.test.ts tests/database/knowledge-relationships.integration.ts` — **passed, exit 0**.
- `& 'C:\Users\NOTEBOOK\AppData\Roaming\npm\pnpm.cmd' exec tsx --test --test-concurrency=1 tests/database/knowledge-relationships.integration.ts` — **10 tests passed, 0 failed** against the configured local PostgreSQL database, with fixture work rolled back.

Root separately reports its combined relationship/AI-worker focused run passed 24/24 and that the actual paused-LINE dispatch/publication barrier verified the family revision change without an open sender transaction. I did not run that broader caller suite or barrier in this review. I did not run full unit/PG suites, build, replay, DEV migration, or browser acceptance.
