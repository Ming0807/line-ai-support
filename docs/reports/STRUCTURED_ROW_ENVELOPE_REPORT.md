# STR-01C-0 — unused authenticated private row evidence

7October2026. Root owns frozen contract/implementation/integration. Source checkpoint33fb2ab; CH012/018/041/050/060, DEC-049, [design](../architecture/STRUCTURED_ROW_ENVELOPE_DESIGN.md), [plan](../superpowers/plans/2026-10-07-yru-structured-row-envelope.md), [schema](../architecture/STRUCTURED_SCHEMA_DESIGN.md). This is an unused Node-only component; no SQL/runtime/schema/mode/query/publication readiness is enabled.

## Change and boundaries

`lib/knowledge/structured-row-envelope.ts` adds purpose-derived AES256-GCM with fresh nonce and AAD binding row/document/dataset/source/review identities, versions, revisions, hashes and coordinates. Strict context/descriptor-safe evidence validation recomputes current payload digest, field transformations and source coordinate consistency; decrypt authenticates before JSON parsing and returns detached deeply frozen data. Canonical bounded sr1 segments fit existing private encrypted-evidence storage limits. All errors have a fixed data-free code.

The component preserves private lexemes/constants/notes/location/URL and uses the existing canonical master-key argument. It makes no API request, accesses no environment/DB/files, accepts no request-configurable key, logs no content and changes no existing webhook/publication/receipt/query/worker behavior. Authentication protects supplied content/context under the key; actual retained-source/review approval/currentness/permissions/typed-row/effect proof still must be checked during future atomic publication and live retrieval. Arbitrary private HTML URLs are not certified safe for public disclosure.

## Tests, failures and provenance

Luna max `/root/structured_row_envelope_tests` authored only `tests/structured-row-envelope.test.ts`: eight cases including35 actual mapper fixture combinations (seven datasets×five formats), fresh nonces/canonical envelope, AAD context substitutions/coupled coordinates, key/tamper/truncation/base64 errors, cell/payload/source/constant mismatches, getter/proxy/cycle/size and frozen output. These are synthetic mapper/extraction fixtures, not35 real corpus documents.

Both author and root observed RED collection failure solely for missing implementation module (0 tests collected). After implementation7/8 passed: the mutation test attempted to mutate already-frozen mapper input. Root corrected only that test to clone the caller input, preserving the immutable mapper contract. Final8/8 PASS; no weakening of evidence checks. Test authorship is distinct from independent implementation review; no unavailable agent is credited.

Root actual gates after final source/test change:

| Gate | Result |
|---|---|
| focused envelope tests | PASS8/8,1file |
| `pnpm typecheck` | PASS exit0 |
| `pnpm lint` | PASS exit0, full repository |
| `pnpm exec vitest run --maxWorkers=1` | PASS exit0,1,629 tests/113 files |
| New PG/HTTP/browser/build/liveOA/provider/corpus checks | NOT RUN; no SQL/API/Next behavior changed |

Root self-review confirms bounded/canonical decode, purpose/domain separation and source-field revalidation. Independent Luna max `/root/structured_row_envelope_review` returned **no P1/P2 findings** after read-only source/test/design inspection; it ran no gates and is not credited for root's test commands. Actual test-author and independent-reviewer roles are distinct. Actual13-owned-path staged whitespace PASS; `check-staged.mjs` returned STAGED_CREDENTIAL_CHECK_PASSED exit0;11ownedMarkdown documents/318relative links resolve (Node check exit0). Implementation/handoff commit `bec40b2b1dcb486d58a43e4478be69ca5e0cb385` pushed to origin/feat/yru-helpdesk-v1; actual ls-remote matched and33fb2ab..HEAD whitespace PASS. This evidence-only follow-up changes no implementation/tests; its Git result is separately confirmed by tools.

## Remaining V1 work

Persist mapper-derived contexts/provenance in the same atomic transaction as typed rows and complete mode receipt, prove STRUCTURED/BOTH effects with source/review/family/document locks, safely install fixed schema/registry, enforce exact scoped/current/history query and final delivery rechecks. Combined UI review still has real mapping/ticket/advanced gaps per [actual Gemini Round5 review](GEMINI_UI_UX_ROUND5_REVIEW.md); full Flow A–F/live/production acceptance remains. This component adds no new human setup and is not V1 completion.
