# PUB-03 Caller and Delivery Review

Date: 6 October 2026
Reviewer: `/root/located_chunk_builder`, independent read-only review of the root-owned PUB-03 caller/delivery paths. I implemented the separate pure `rule-proof.ts` helper, so this review does not claim independence for that helper itself.
Scope: inspected the PUB-03 freeze, `lib/knowledge/citations.ts`, `answer-producer.ts`, `delivery-fence.ts`, `lib/ai/run-worker.ts`, `lib/ai/jobs.ts`, `lib/knowledge/configured.ts`, `lib/knowledge/retrieval.ts`, `lib/queue/run-outbox.ts`, and the requested focused tests. No product or test source was changed.

## Findings

No concrete caller/delivery blocker found in the reviewed source checkpoint.

- Fresh retrieval proofs cover the full evidence array sent to the model. `answer-producer.ts` validates every result row has a proof and unique chunk ID, passes every returned row's complete content into the answer payload, and uses bounded `promptFits` checks. Search, embedding, generation, and LINE HTTP happen outside business SQL. Search errors for ambiguous or incomplete context become fixed clarification responses.
- Finalization checks for proof on every saved model-context row, locks all represented families in sorted order and then all represented document IDs in sorted order, re-runs retrieval, and compares all old rule groups before separately checking cited chunk evidence. It converts proof/date/member/epoch drift to the safe source-changed clarification.
- Dispatch repeats the all-context proof check and cited-chunk comparison. Old serialized evidence remains parseable because `citationEvidenceSchema` and AI result serialization keep `ruleProof` optional, but proofless pending ANSWER results fail the delivery fence. The empty-citation shortcut corresponds to a source-changed clarification already written during finalization; it does not allow delivery of the stale ANSWER payload.
- Proofs are retained in the saved encrypted AI result and copied into internal citation metadata, while `answerMessages` omits proof counters and sends no source URLs/locations from model-controlled fields. Full passage content is not truncated; when the complete bounded prompt exceeds limits, the producer returns a controlled clarification.
- Locking is consistent with publication: finalization uses transaction advisory locks family-first then sorted documents; dispatch holds session advisory family/document locks in that order across HTTP. The outbox persists its attempt before HTTP and commits before calling LINE, so the session lock fences publication without holding an open SQL transaction over network I/O.

## Verification

- `pnpm exec vitest run tests/knowledge-citations.test.ts tests/knowledge-producer.test.ts` — 2 files, 62 tests passed.
- `pnpm exec eslint lib/knowledge/citations.ts lib/knowledge/answer-producer.ts lib/knowledge/delivery-fence.ts lib/ai/run-worker.ts lib/ai/jobs.ts lib/knowledge/retrieval.ts tests/knowledge-citations.test.ts tests/knowledge-producer.test.ts` — passed with no output.
- `pnpm exec tsx --test --test-concurrency=1 tests/database/ai-worker.integration.ts` — 14/14 passed, including generation and dispatch drift for family epoch, an uncited amendment/membership change, legacy proof omission, and evaluation-date change; also the publication-waits-for-LINE test.
- `pnpm exec tsx --test --test-concurrency=1 --test-name-pattern 'actual reviewed amendment publication waits for paused LINE dispatch' tests/database/import-publication.integration.ts` — 1/1 passed; amendment publication waited for LINE dispatch and advanced the proof epoch after send.
- An initial `pnpm exec vitest run tests/database/ai-worker.integration.ts` attempt selected no test files because the integration files use Node's test runner rather than Vitest. The `tsx --test` commands above are the repository's configured runner for these files.

## Non-blocking test coverage note

The producer unit test demonstrating no old eight-row slice uses 10 rows, not an explicit 12-row maximum fixture. The implementation accepts at most 12 and maps all returned rows; the 10-row test proves the prior truncation is gone. A 12-row assertion would make the bounded maximum explicit but is not a source blocker. Root owns further integration and acceptance; these checks do not certify full PUB-03, publication, corpus, or V1 acceptance.
