# STR-01B-0 — private structured mapping preparation

7 October 2026. Parent `ff4c3b984df959d111dc57c8a60b547331b1d940`. **COMPONENT_PASS**, pure preparation only; STR-00/M8/full V1 remain incomplete. [Design](../architecture/STRUCTURED_MAPPING_DESIGN.md), [execution plan](../superpowers/plans/2026-10-07-yru-structured-mapping.md), DEC-039/040 and [current board](../tasks/V1_TASK_BOARD.md) define the scope. User authorized independent backend continuation while Gemini handled UI.

## Implemented scope and ownership

Root owns three new modules: `lib/imports/structured-mapping-contract.ts`, `structured-transforms.ts`, `structured-mapper.ts`, their three tests, contracts and final integration. Mapping1 strictly selects exact registry fields, explicit columns/constants, header/non-data exclusions and inclusive row ranges. Every extracted table and selected table row must have one disposition; no silent row drop. At least one nonnullable source column is required per selected table. No browser-supplied payload, SQL identifier or backend-owned lifecycle field is accepted.

Twelve named transforms preserve text and exact decimal scale and explicitly select decimal grouping, date order, Buddhist/Gregorian era or fixed `+07` offset/midnight. These grammars, bounds and time policies are documented engineering decisions, not missing facts inferred from the source. Source/checksum and located extraction are revalidated and copied; artifact binding checks supplied job/extraction revisions and source digest. A supplied reviewRevision is shape checked and hash bound; detecting a stale database review receipt still requires future authorized server reload/final locks.

Prepared rows retain exact extracted cell strings, labelled constants, per-field transforms and format-specific coordinates. XLSX coordinates identify worksheet grid positions, whose empty extraction value cannot distinguish an implicit hole from an explicit blank. CSV positions are logical records; PDF references retain detector-local ordinals plus page/table; DOCX/HTML use extracted logical positions. HTML parser-normalized strings are not original byte claims. The helper cannot prove that a caller actually parsed the original bytes or that the caller is authorized.

Mapping/extraction/payload/plan hashes have separate versioned domains. The result is detached, deeply frozen and always `requiresReview:true`. Limits cover DTO256KiB/20000nodes/depth16, snapshot32MiB/500000nodes/depth16, selected2000rows and complete artifact16MiB including its digest. Hostile JSON descriptors/proxies/cycles and unsafe extraction flags fail with fixed error codes; row failures include only table/row/allowlisted field. Formula/hidden/unsupported/encrypted flags and DOCX shape ambiguity block preparation; other table-shape warnings remain unresolved, never approved by this function.

Actual user-authorized Luna high authored [format fixtures/tests](../../.superpowers/sdd/reports/2026-10-07-structured-mapping-formats.md). Luna max authored [adversarial tests](../../.superpowers/sdd/reports/2026-10-07-structured-mapping-adversarial.md); a separate Luna max [source/design/implementation audit](../../.superpowers/sdd/reports/2026-10-07-structured-mapping-audit.md) independently reran the final three root files:14PASS. All-seven/all-five tests use explicitly synthetic located metadata, not execution of all original format parsers. Root tests additionally run the actual small CSV parser and an actual2000-record CSV for the byte-boundary regression.

## Actual verification and corrected failures

| Check | Result |
|---|---|
| DTO/transforms, then mapper before implementation | Missing-module RED suites read, then implemented |
| Proxy trap regression | Root contract6tests:1RED/5PASS; native `node:util types.isProxy` rejection fixed callbacks before reflection |
| Complete artifact byte regression | Root mapper4tests:1RED/3PASS before fix; returned JSON now accepts exactly16MiB and rejects +1 byte |
| Final focused five files |64tests PASS, exit0 |
| Whole unit suite |`pnpm exec vitest run --maxWorkers=1`:1561tests/105files PASS,58.28s,exit0 |
| Final typecheck |`pnpm run typecheck` exit0 |
| Final lint |`pnpm run lint` exit0; scoped new-module/test ESLint also passed |
| Independent scoped review |Final root3files14tests PASS; reviewed whole-artifact bound and review-binding wording, both findings closed |
| Final links/diff/staged credentials |27control/evidence files304local links PASS; staged credential/diff checks rerun before commit. Initial staged diff found Markdown two-space breaks in three agent reports; root removed them without changing findings |

Earlier typecheck runs exposed literal default-parameter inference and two test assertions on a dataset-union payload; root/owners corrected types and structural assertions. The adversarial author's four initial failures were test-harness expectations (proxy-trap expectation, stale report counts, invalid digest mutation and malformed-array classification), corrected to the frozen contract; those are not implementation RED evidence. No requirement, limit or timeout was reduced to make checks pass. The source auditor's warning/coordinate/sparse-blank concerns were resolved explicitly in DEC-040 and both plans, with current review-state integration kept open.

No new SQL migration, database/advisor check, build, HTTP/browser, provider or LINE run is claimed. The modules have no runtime consumers; all registry entries remain installed:false and existing v1/v2/RAG routes/publication are untouched. Prior196actualPG/default build/HTTP evidence belongs to the dated [catalog backend report](KNOWLEDGE_CATALOG_ASSISTANCE_BACKEND_REPORT.md), not today's reruns. Main UI WIP, corpus, environment, account credentials and Gemini's worktree were not edited or staged for this component.

## Remaining gates and human steps

Saved review-v3/receipt acknowledgment, authorized structured preview, fixed seven SQL tables/private provenance grants/retention, lifecycle projections, atomic STRUCTURED/BOTH rollback/replay/history, exact query/contradiction/citation/finalization/delivery proof and combined UI acceptance remain STR-00/01/02 work. No structured mode is enabled. Gemini's later reported `443c227` is a separate pending review, not acceptance of this backend component or whole V1.

No new user configuration, upload, key, model download or source approval is required. [Final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md) preserves deferred real corpus/live/production checks. Backend/schema/integration work remains the agents' responsibility.

Root committed this23-file component as `c1160b9966975bd05fc77c213e9509236a646748`; authorized noninteractive push tofeat/yru-helpdesk-v1 exited0 and remote full SHA matched. This did not push Gemini's branch. Later prompt/review documentation records the new human steering separately.
