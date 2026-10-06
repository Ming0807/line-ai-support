# M8 — fixed structured data execution gates

6 October 2026 planning source `6abbb108815cc0e3496c5b49baf222981d3664a2`, updated7October against91be145. **Pure preparation component accepted; schema/mutation/integration held** while remaining STR-00 and Gemini CAT-02/UX-01B/C complete. No schema, mapper or structured search acceptance is claimed. Root owns contracts/DB/auth/privacy/publication/integration. Actual Luna max source/static audit and independent adversarial authorship are recorded in the [STR-01A-0 report](../../reports/STRUCTURED_PAYLOAD_CONTRACT_REPORT.md); no unavailable review is implied.

Read [current board](../../tasks/V1_TASK_BOARD.md), [matrix](../../requirements/V1_REQUIREMENTS_MATRIX.md), [decisions](../../decisions/DECISION_LOG.md), [master](../../../CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md) §§12/18/37–42/49/50/60–62, [original versioning](../../requirements/sources/original-document-versioning.th.md), [system](../../architecture/YRU_V1_DESIGN.md), [import design](../../architecture/KNOWLEDGE_IMPORT_DESIGN.md) and [local embedding design](../../architecture/EMBEDDING_SERVICE_DESIGN.md). The earlier actual Luna max [M8 proposal](../../../.superpowers/sdd/reports/structured-m8-contract-proposal.md) is source-grounded planning input, not a frozen schema decision.

## Verified starting point

- Master§12 names **seven** datasets: `academic_calendar_events`, `tuition_fees`, `transfer_courses`, `university_services`, `university_systems`, `service_forms`, `announcements`. Master§41's six-entry example omits systems; DEC-027 retains all seven. Keep names and source-listed columns visible in the design.
- Local PostgreSQL read against `supabase_db_line-ai-yru`, database `postgres`, confirmed **0/7** exact public tables installed. Migration source agrees. This is local development evidence, not a remote schema check.
- `lib/ai/backend-tools.ts` already allows all seven dataset names but its optional `structuredSearch` implementation is absent. The current tool accepts a free-text query; it is insufficient evidence of an exact fee/date/code query implementation.
- `lib/imports/publication-contract.ts` currently validates reviewed RAG only; `review-schema.ts` retains strict encrypted v1/v2 drafts. Current RAG publication/receipts/proof/delivery fences and E5 CPU384 are accepted components. Their availability must remain unchanged while structured modes are added.
- CAT-01/UX-01A backend passed1466unit/196PG/7compiledHTTP/type/lint/build. Combined Gemini catalog/easy-import usability remains pending. M8 contract planning can proceed; mutation implementation follows that integration gate.
- STR-01A-0 pure exception under DEC-037: [seven-payload design](../../architecture/STRUCTURED_DATA_DESIGN.md), [bounded plan](2026-10-07-yru-structured-payload-contract.md), [component evidence](../../reports/STRUCTURED_PAYLOAD_CONTRACT_REPORT.md).1497unit/100files,31focused/type; no runtime import, all metadata installed:false. DEC-038 resolves generic vector effects explicitly by mode. Remaining mapping-v3/digest/provenance permissions/lifecycle/typed query/row evidence contracts are still STR-00 gates.

## STR-00 — root design and explicit decisions

New file `docs/architecture/STRUCTURED_DATA_DESIGN.md`; update decision log, this plan and task board. Dependencies: required sources above and existing publication/proof/citation contracts. Do this before a migration or strict mapper implementation. Missing implementation details are root engineering decisions, not invented claims about the specification; resolve and record them within continuous user authorization.

Specify each of the seven tables' exact types, nullability, required fields, lengths, decimal bounds, date/timezone conversion rules, indexes and lifecycle. Define backend-owned IDs/document/department/current flags separately from explicit reviewed source values. Preserve monetary/credit lexemes and exact decimals; do not use floating-point rounding or silently infer currency, year era or time zone. Imported services/forms must retain an exact source document despite nullable source examples. Resolve systems' missing `document_id` via an explicitly documented additive link/provenance design rather than overwriting a code across years.

Freeze row/cell provenance, original parser coordinates, canonical mapping/payload digest and review-schema evolution that preserves immutable v1/v2 RAG history. Specify explicit header/range/field/transform review, empty/null/formula/merged/sparse handling and all7schema readiness. Define RAG/STRUCTURED/BOTH preparation/persistence and whether structured-only mode has text vectors. Define exact query/filter union, PUBLIC-only student access, history/as-of rules and complete amendment/cancellation effects or visible ambiguity. Metadata/current/authority/applicability filtering must precede ranking. No arbitrary SQL/table names, per-year tables, automatic DDL, old-history deletion or silent mode fallback.

Acceptance: a source-to-decision table for all7datasets and every gap above; exact proposed schema/DTO/query/receipt contracts, files, invariants and negative checks. Root self-review provenance must be explicit; independent review only when actually received. No additional human setup question is required merely to choose engineering details.

## STR-01A — fixed schema and registry

Dependencies for schema/storage: remaining frozen STR-00 and combined catalog/import integration. Root files: one additive timestamped migration under `supabase/migrations/` covering all7tables and reviewed provenance/receipt support; accepted pure `lib/knowledge/structured-payload.ts`/`structured-registry.ts` remain inert; a future server-only `structured-storage-registry.ts` resolves constant SQL identifiers separately. Add actual-PG tests. HTTP/model inputs are data only. Department/sensitivity/source ownership follows the owning approved document, never a caller-provided principal. STR-01A-0 pure component is already accepted and does not require mutation readiness.

Acceptance: valid/invalid/extra/missing payloads for each dataset, exact numeric/date bounds, trusted source/department links, immutable historical rows and provenance, anon/browser writes denied, real department/sensitivity access checks, unknown dataset rejected. Replay all migrations in an owned isolated database; examine RLS/grants/indexes/advisors before guarded DEVELOPMENT synchronization. Schema changes are for the fixed design, never per document/year.

## STR-01B — reviewed deterministic mapping

Dependencies: STR-01A, accepted extraction/location/review contracts. Root new files `lib/imports/structured-mapping-contract.ts`, `structured-mapper.ts`; existing `review-schema.ts`/`import-review.ts` plus mapping tests. Separate pure preparation from persistence. Browser sees safe contracts/preview, never static SQL or server originals. Named mapping suggestions may reduce manual work, but uncertainty and a deliberate saved mapping acknowledgment remain visible; source text and approved conversions stay distinguishable.

Acceptance: all7datasets and PDF/DOCX/XLSX/CSV/URL table fixtures; exact source cells/lexemes, original row ordinals including noncontiguous PDF fragments, explicit header/transform selection, formula/sparse/merged/blank/overflow rejection, deterministic digests, wrong job/extraction/review/schema binding rejection. No filesystem/network/model/embedding/clock inside the pure mapper. No browser-submitted normalized row is authoritative.

## STR-02A — atomic mode publication

Dependencies: STR-01A/B and existing PUB-03 source/family/target/delivery fences. Root existing `lib/imports/publication-contract.ts`, `import-publication.ts`, `publication-api.ts`, pure `publication-response.ts`; new `structured-repository.ts`, persistence tests and receipt support from the fixed migration. Recompute validated mappings outside SQL, then persist document/version/text rows or chunks/structured rows/provenance/activity/receipt/completion under one checked lock/transaction boundary. Preserve current RAG replay compatibility. Embeddings/network remain outside SQL.

Acceptance: each of RAG/STRUCTURED/BOTH, all supported version actions and all7datasets; same-binding replay and concurrent approval; stale source/mapping/dataset/target/family revisions; forced rollback after every persistence stage leaves no partial effects; old versions/originals retained; BOTH rows/chunks cite the same approved document. Unsupported/incomplete structured mode fails explicitly without downgrade. Normalized E5 vectors only when the frozen mode contract requires them; no paid generation or model download.

## STR-02B — exact search, evidence and delivery

Dependencies: STR-02A, frozen typed query/provenance/effect rules. Root new `lib/knowledge/structured-search.ts`, existing `lib/ai/backend-tools.ts`, `lib/knowledge/citations.ts`, `rule-proof.ts` and AI result/finalization/delivery evidence callers located before modification. No tool may turn model text into SQL. Current anonymous student context proves conversation/session ownership, not a staff role; return only eligible reviewed PUBLIC knowledge until a separate staff contract is accepted.

Acceptance: exact dates/fees/course codes across all7datasets; invalid selectors/arbitrary SQL denied; scope/current/history/as-of/authority/date eligibility before ranking; complete AMENDS/CANCELS or truthful clarification; preserved row/cell/source/version proof; changed mapping/row/document/family suppresses stale delivery. Unknown/uninstalled schema remains unavailable. Never answer from HUMAN ticket routing or a caller-fabricated staff identity.

## STR-02C — preview integration and M8 acceptance

Dependencies: above backend contracts and coordinated UI ownership after Gemini review. Root owns API validation/integration; presentation owner is assigned explicitly before editing shared UI. Expose named table/field choices, exact values/provenance, missing blockers, saved acknowledgment and recoverable revision errors. Keep upload simple and preserve original/review/publication locks; do not replace uncertainty with fabricated success or confidence.

Acceptance: real three-role compiled HTTP and desktop/mobile/keyboard preview/approve/history checks in retained isolated synthetic QA; unknown schema chooses only explicitly reviewed RAG; all7installed mapper routes visible; no real university source automatically approved. Run final unit/type/lint/build/actualPG/RLS/replay/advisor/security gates on integrated source, update matrix/design/board/report/setup. Flow F needs a later reviewed real source; full Flow A–F, M9, live free/OA/corpus and production remain separately accounted for.

Current status: STR-00 **PARTIAL**, pure STR-01A-0 **COMPONENT_PASS**, remaining STR-01/02 **MUTATION/INTEGRATION_HELD for complete contracts and combined UI integration**. This plan adds no deployment/DDL authorization beyond the already requested V1 scope and no claim that structured modes work today. Root can continue independent pure/design work within explicit task scopes while Gemini presentation is pending.
