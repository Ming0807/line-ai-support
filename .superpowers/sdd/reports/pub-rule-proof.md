# PUB-03 Rule Proof Helper Report

Date: 6 October 2026
Owner: `/root/located_chunk_builder` (delegated pure-helper task)
Scope: `lib/knowledge/rule-proof.ts`, `tests/knowledge-rule-proof.test.ts`, and this report only.

## Implemented

Added a strict six-field `ruleProofSchema` and `buildRuleProof(input)` for exact snapshots containing the five non-digest proof fields plus `members` and `effects`. The helper validates lowercase canonical UUID text, a 1–120 character version stream, real calendar dates via `isValidKnowledgeDate`, canonical nonnegative Postgres BIGINT decimal family revisions, and nonnegative safe-integer document revisions. Snapshot and proof objects reject extra fields. Members are bounded to 1–200; effects to 0–400.

The digest is lowercase SHA-256 over UTF-8 `JSON.stringify` of the fixed-order identity/date/revision object plus member rows sorted by document ID and effect rows sorted by source ID, target ID, relation type, then revision. Returned proofs are new scalar objects; building preserves the caller's arrays and rows.

Following root's frozen clarification, invalid snapshots reject duplicate members, duplicate `(sourceDocumentId,targetDocumentId,relationType)` effects, self-directed effects, an active cancellation targeting the returned base, and an AMENDS/CANCELS pair for the same source and target. Effects are not required to have endpoints in the returned member list. The helper does not infer authorization or family/stream/year eligibility; those remain retrieval/database responsibilities.

`ruleProofsEqual` validates both complete proof objects before comparing them. `ruleContextsStillMatch` requires a valid proof on every previous and fresh evidence row, rejects conflicting proofs within one family/base/stream group, and requires every previous group proof to match the fresh group; fresh extra groups are allowed. Proofless legacy rows fail closed.

## Verification

- RED: `pnpm exec vitest run tests/knowledge-rule-proof.test.ts` — failed before implementation because `../lib/knowledge/rule-proof` did not exist.
- GREEN: `pnpm exec vitest run tests/knowledge-rule-proof.test.ts` — 1 file, 9 tests passed.
- `pnpm exec eslint lib/knowledge/rule-proof.ts tests/knowledge-rule-proof.test.ts` — passed with no output.
- `pnpm exec tsc --noEmit --pretty false` — passed. An initial check caught a BigInt literal incompatible with the project's ES2017 target; the maximum bound now uses `BigInt(string)` and the repeat check passed.

No database fixtures, network calls, SQL, migrations, retrieval/citation callers, worker/delivery paths, or product UI were changed or exercised. Root-owned actual-PG race, retrieval-group, serialized-result, and LINE delivery-fence acceptance remains necessary before PUB-03 integration can be considered accepted. This report records helper evidence only; it is not a publication or V1 acceptance claim.
