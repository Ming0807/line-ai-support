# STR-01C-2 — isolated atomic publication evidence

8 October 2026. Root baseline `796f405187879b0c33e31a06da084c4f376e69b8`, branch `feat/yru-helpdesk-v1`. CH012/018/041/050/060; master §§12/38/50; DEC-051. [Design](../architecture/STRUCTURED_ATOMIC_PUBLICATION_DESIGN.md), [execution](../superpowers/plans/2026-10-08-yru-structured-atomic-publication.md). Status **BACKEND_COMPONENT_PASS in the owned disposable database**. Normal installation, exact-query readiness and combined V1 acceptance remain pending.

## Implemented behavior and source scope

The actual `approveImport` service loads retained originals, extraction and saved review3, validates metadata/all five attestations/warnings/quality, rebuilds Mapping1 and acknowledgment, and prepares backend row IDs and encrypted evidence outside SQL. STRUCTURED performs no tokenizer or embedding work. BOTH additionally rebuilds the reviewed chunk plan and prepares normalized 384-dimensional E5 vectors outside the transaction. Integration tests use a controlled E5 adapter, not a live provider or CPU service claim.

Finalization preserves job → family-code → family → sorted-document locks and final active administrator/source/review/target checks. Document, relationships, immutable receipt, private mode proof/provenance, typed rows, optional chunks, family epoch, activity and COMPLETED commit together. Failure rolls back replacements as well as new effects. Concurrent and sequential identical approvals replay one receipt. ADD_HISTORICAL uses a narrow receipt-bound exception; immutable old data is retained.

Owned implementation is `lib/imports/import-publication.ts`, `publication-contract.ts`, new `structured-publication-persistence.ts`, a preparation comment, additive migration, policy/PG tests and the disposable verification runner. Seven SQL writers use constant table names and parameter values. The internal verification option checks the exact owned database name, actual database/owner and proof schema; no HTTP input or environment switch enables it. Registry remains installed:false. Legacy v2 RAG remains supported; v3 RAG is still unavailable in this slice.

Migration `20261007170309_structured_atomic_publication_effects.sql` was generated with installed Supabase CLI2.115.0; its 7October UTC filename corresponds to the 8October Bangkok work. Private immutable mode proof binds receipt, source/review/plan/ack, exact row manifests and canonical chunks. Deferred checks reject missing/extra rows, wrong typed payloads/keys/provenance and missing/extra/mismatched chunks at actual COMMIT. NULL JSON values are explicitly rejected. SQL does not decrypt evidence, authenticate parser execution, recompute application canonical hashes or prove inference; trusted preparation and future row decoders own those checks.

## RED/GREEN and review provenance

- Initial eight policy cases were collected RED against the missing validator. Root implemented and ran them GREEN.
- Actual Luna max test author supplied the initial22 PG cases and seven subsequent adversarial COMMIT cases. Root owns contract/SQL/service/runner, execution and final test-seam corrections. Fixture counter, repeated-value and civil-date failures were corrected without relaxing runtime invariants.
- Actual separate Luna max source review identified a NULL payload-digest bypass. Root reproduced successful COMMIT with invalid proof, added strict JSON string checks/`IS DISTINCT FROM`, and verified rejection at COMMIT. The final source-only review returned no remaining P1/P2; it ran no PG or full tests.
- The extra-row test initially hit an immediate duplicate-coordinate23505 constraint and did not prove deferred completeness. Root changed it to three distinct prepared rows with a two-row manifest; it now reaches actual COMMIT and fails the intended23514 check.
- New fixtures initially contaminated an old schema suite's global count assertion. The runner executes the unchanged121-case schema suite before retaining publication fixtures. No old assertion was weakened.

## Actual verification

| Gate | Observed result |
|---|---|
| `pnpm exec tsx scripts/database/verify-structured-schema.ts` with installed CLI path | PASS, owned PG17.11 disposable database |
| Migration replay / foundation RLS | PASS30 migrations / foundation denial checks |
| Existing structured schema PG | PASS121/121 |
| Actual service and adversarial COMMIT PG | PASS29/29, including all seven datasets, HTML/CSV, BOTH, replay, replacement/history, five failure seams and stale/revoked authorization |
| Existing RAG publication compatibility PG | PASS15/15; total165 actual PG cases |
| Advisors | baseline ERROR0/WARN0/INFO111; current ERROR0/WARN0/INFO98; intentional private RLS/unused-index INFO, no added unindexed FK |
| Normal database / owned cleanup | seven structured tables0 before/after; disposable database and exact temporary RAG fixture removed |
| Focused policy/preparation/envelope/legacy tests | PASS54/54 |
| Final `pnpm exec vitest run --maxWorkers=1` | PASS1646/1646,115 files,53.15s on final code |
| `pnpm typecheck` / `pnpm lint` | PASS / PASS, no lint warnings |
| Controlled `pnpm build` | PASS, TypeScript and static generation16/16; all dynamic routes compiled |

Parallel heavy gates and the default seven-worker build failed under Windows allocation pressure. A one-worker build with384MiB heap compiled but TypeScript exhausted that heap. The final sequential build used invocation-only `CIRCLE_NODE_TOTAL=2` (installed Next policy selects one worker), `RAYON_NUM_THREADS=2`, and `NODE_OPTIONS=--max-old-space-size=768`; it passed. No product configuration or tests were weakened. Failed runs are not passing evidence. Unit reruns use one Vitest worker/384MiB heap. Root commands inspect the current checkout, which contains unrelated knowledge UI work; those files are excluded from this delivery.

## Remaining acceptance

Normal/remote schema installation, registry readiness, proof-aware exact SQL retrieval/current/applicability filtering, authenticated row decoding and delivery, v3 RAG compatibility, combined UI integration, approved university corpus, live free generation/CPU embedding/OA and Flow A–F remain agent work or deferred live acceptance. No new human configuration is required for this isolated component. [Accumulated final setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). Component tests do not complete M8 or V1.

Final staged credential/diff/link gates passed. Root commit `e0a93856943c7a92cbc2e6b105439ada4b2c83b7` was pushed noninteractively to `origin/feat/yru-helpdesk-v1`; `ls-remote` verified that exact SHA. Unrelated knowledge UI, downloaded originals, output and external branches were excluded. No external UI push/merge. Subsequent selector/delivery locks: [STR-02B-1](STRUCTURED_SEARCH_DELIVERY_REPORT.md).
