# STR-01C-0 implementation plan

Goal: bounded server-only authenticated evidence component without enabling structured publication or changing schema. Architecture: preserve validated payload/mapper transformations, bind every immutable storage identity to purpose-derived AES-GCM context, authenticate before JSON parse, and return frozen evidence. Tech: installed Node crypto/Zod/Vitest/TypeScript.

Sources: [frozen design](../../architecture/STRUCTURED_ROW_ENVELOPE_DESIGN.md), master§12/CH012/018/041/050/060, [working protocol](../../agents/WORKING_PROTOCOL.md). Root owns contracts/implementation/integration; a Luna high/max delegate may author one test file only and is credited only if actual work returns.

Owned files: `lib/knowledge/structured-row-envelope.ts`, `tests/structured-row-envelope.test.ts`, this plan/design, `docs/reports/STRUCTURED_ROW_ENVELOPE_REPORT.md`; authoritative schema design/index/board/matrix/decision/setup links. Preserve unrelated catalog WIP/downloads and Gemini worktree. No SQL/API/Next.js/auth/worker/installed-flag change.

- [x] Actual Luna max authored8test cases; author/root observed missing-module RED before implementation (0tests collected), recorded without claiming behavioral execution.
- [x] Root implemented strict bounded validation/source-cell replay/dedicatedHKDF/AAD/canonical authenticated envelope/fixed errors.
- [x] Actual35 mapper combinations, context/crypto/source/shape/immutability cases PASS8/8. Root corrected mutation test to clone already-frozen mapper input; production checks unchanged.
- [x] Full1,629unit/113files/type/full lint PASS. No new PG/build/browser/live acceptance is implied.
- [x] Root self-review plus actual separate Luna max read-only review returned noP1/P2;8focused/1629unit/type/full lint recorded, remaining atomic/live gates explicit. Authoritative design/status/setup updated.
- [x]13ownedpaths staged/security/whitespace PASS;11Markdown/318links valid. Commit `bec40b2b1dcb486d58a43e4478be69ca5e0cb385` pushed and actual remote SHA matched. Unrelated WIP/Gemini branch preserved; evidence-only follow-up records this result.

Parallel current task GEM-REV-06 reviews actual Gemini Round5 and prepares a bounded OpenCode pilot, without modifying Gemini UI. Reported type/helper passes are distinct from combined/backend acceptance.
