# Structured publication preparation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Root executes contracts/implementation; authorized Luna max owns only the focused test file.

**Goal:** Assemble source-derived checked typed rows and authenticated private provenance for the future atomic structured publisher.

**Architecture:** Rebuild the existing Mapping1 plan from retained source/extraction; verify the saved content acknowledgment; generate backend IDs and encrypt evidence with the exact document/review/source tuple. Preserve review3 acknowledgment through a pure helper re-export. No database or runtime publication caller.

**Tech Stack:** Installed Node 24, TypeScript, Zod 4, node:crypto, Vitest.

## Global constraints

- Task STR-01C-1; CH012/018/041/050/060; [frozen design](../../architecture/STRUCTURED_PUBLICATION_PREPARATION_DESIGN.md), DEC-050.
- Seven existing datasets, Mapping1 and schema bounds, local E5 unchanged; installed:false and STRUCTURED/BOTH publication unavailable.
- No source values/keys in errors/logs; no network/LINE/SQL/auth/API/UI changes, no schema application or fabricated live evidence.
- Preserve unrelated knowledge UI/corpus files and external OpenCode local-only branch.

## Task 1 — RED contract and source preparation cases

**Files:** Create `tests/structured-publication-preparation.test.ts` (Luna max); fixtures reuse `tests/fixtures/structured-mapping.ts` without modifying it.

**Consumes:** `structuredMappingFixture(dataset,format)`, `buildStructuredMappingPlan`, existing `computeStructuredAcknowledgment` re-export; `decryptStructuredRowEvidence`.

**Produces:** Regression cases against `prepareStructuredPublication` in `lib/imports/structured-publication-preparation.ts`.

- [x] Write failing tests using actual mapper fixtures and deterministic test-only keys, never environment credentials. Initial happy-case call:

```ts
const fixture=structuredMappingFixture('tuition_fees','CSV');
const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,fixture.binding,fixture.mapping);
const result=prepareStructuredPublication(fixture.source,fixture.extraction,fixture.binding,fixture.mapping,
 {documentId:'123e4567-e89b-42d3-a456-426614174002',documentRevision:0,
  acknowledgment:computeStructuredAcknowledgment(plan)},Buffer.alloc(32,0x43).toString('base64'));
expect(result.rowCount).toBe(1);
expect(decryptStructuredRowEvidence(result.rows[0]!.evidenceEncrypted,result.rows[0]!.context,
 Buffer.alloc(32,0x43).toString('base64')).payload).toEqual(fixture.expectedPayload);
```

- [x] Cover all acceptance cases in the frozen design; do not accept serialized browser plans or expose raw evidence. Test errors exactly `STRUCTURED_PUBLICATION_PREPARATION_INVALID`.
- [x] Run `pnpm exec vitest run tests/structured-publication-preparation.test.ts --maxWorkers=1`; record missing-module RED separately from collected assertions. Root independently reads the result before implementation.

## Task 2 — assembly and compatibility

**Files:** Create `lib/imports/structured-acknowledgment.ts`, `lib/imports/structured-publication-preparation.ts`; modify `lib/imports/structured-preparation.ts` only to re-export the unchanged acknowledgment function.

**Interfaces:** Exact six-argument function in the design. Request is strict unknown input; output contains rowCount/rows/private metadata/requiresFinalFence and no raw mapping/location/notes. `PreparedStructuredPublication = ReturnType<typeof prepareStructuredPublication>` may be exported for a future trusted caller.

- [x] Move the existing acknowledgment body unchanged into the pure helper; retain existing public export.
- [x] Validate request using `copyStructuredJson(request,16*1024,256)` before strict Zod parsing. Reject storage-incompatible binding before assembly.
- [x] Rebuild plan; recompute acknowledgment and require both contentDigest and mapperVersion. Generate IDs internally; construct context from the verified plan and checked document tuple; encrypt each row with existing envelope function.
- [x] Count complete UTF8 serialized bytes including artifact metadata/punctuation and each row, enforce <=16MiB, and deep-freeze detached output. Catch all failures and emit only the fixed error.
- [x] Run focused tests until GREEN without weakening source/ack/storage constraints. Add root regression for a gap found during integration.

## Task 3 — evidence and handoff

**Files:** Dated `docs/reports/STRUCTURED_PUBLICATION_PREPARATION_REPORT.md`; update board/index/matrix/decision/schema design/setup boundary.

- [x] Run focused envelope/publication/ack review regressions, full `pnpm test -- --maxWorkers=1`, `pnpm typecheck`, `pnpm lint`; inspect actual exits. No SQL/HTTP/build/live acceptance claim.
- [x] Obtain actual independent Luna max source verdict if available; record test author vs reviewer vs root execution distinctly.
- [x] Update requirements and current task states with component limitations; resolve affected Markdown links.
- [ ] Stage exact owned paths, run `node scripts/security/check-staged.mjs` and `git diff --cached --check`, commit root changes and push authorized root branch noninteractively; verify remote SHA. External UI branch stays local-only.
