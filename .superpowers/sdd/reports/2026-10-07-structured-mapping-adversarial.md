# STR-01B-0 — independent structured-mapping adversarial tests

Date: 2026-10-07
Test author: delegated independent Luna max agent (`/root/structured_adversarial_tests`)
Implementation owner: root. Synthetic fixture owner: sibling delegated test agent. This records bounded test authorship and execution; it is not database, API, UI, or V1 acceptance.

## Scope and contract

Added `tests/structured-mapper-adversarial.test.ts` against the pure Mapping1 validation and preparation APIs in `lib/imports/structured-mapping-contract.ts` and `lib/imports/structured-mapper.ts`. The test uses the sibling-authored `tests/fixtures/structured-mapping.ts`; that fixture and implementation files were not modified by this author.

The frozen `docs/architecture/STRUCTURED_MAPPING_DESIGN.md` and `docs/superpowers/plans/2026-10-07-yru-structured-mapping.md` define the contract. DEC-040 governs format-specific table-shape handling: four extraction flags reject preparation globally; unresolved `TABLE_SHAPE_REVIEW` is retained for PDF, CSV, HTML, and XLSX, while DOCX table-shape ambiguity rejects preparation. Each selected table needs a source column for a nonnullable target. These are the root's recorded engineering resolutions, not claims quoted from original requirements.

Adversarial cases cover stale job/revision/checksum/extraction bindings; review-revision digest binding; exact table and row coverage, exclusions, overlap, duplicate tables, bounds, reordered selections, and stable source row order; unsafe flags, ragged rows, absent mapped columns, and nullable-only source binding; backend-owned keys; getter, proxy, prototype, symbol, hidden-key, cycle, and `toJSON` inputs; fixed errors and safe row coordinates without source-cell leakage; canonical digest ordering/domain separation and semantic changes; DTO byte/node/depth/row limits; and detached, deeply frozen output under caller mutation.

## Verification evidence

Commands ran from `D:\project-next\line-ai-yru` with the configured Node/pnpm runtime prepended to `PATH`:

```text
pnpm exec vitest run tests/structured-mapper-adversarial.test.ts --maxWorkers=1
pnpm exec eslint tests/structured-mapper-adversarial.test.ts
pnpm exec tsc --noEmit --pretty false
```

Final results: Vitest **11 passed, 0 failed** in the assigned file; scoped ESLint exited 0 with no output; TypeScript exited 0 with no output. The proxy adversary verifies the proxy trap remains untouched; the current implementation rejects it before reflection. The format-specific shape cases retain the unresolved warning and `requiresReview:true` for PDF/CSV/HTML/XLSX, and reject DOCX.

An earlier authoring run had four failed assertions caused by the test harness itself: it expected proxy reflection despite the proxy guard, changed an extraction cell without updating its validated report counters, used an invalid range as a valid digest mutation, and constructed an oversized array that the validator classifies as malformed DTO. Those cases were corrected to test the frozen contract directly. No remaining implementation RED was observed in the final focused run.

## Limits of this evidence

Inputs are synthetic, already-located extractions; this does not test parser fidelity against original files or prove source authenticity. These tests exercise deterministic private preparation only. No full unit suite, build, database, API, browser/UI, authorization, persistence, publication, mode-readiness, or Flow A–F acceptance was run by this test author. Passing here does not enable any registry entry or integration gate.
