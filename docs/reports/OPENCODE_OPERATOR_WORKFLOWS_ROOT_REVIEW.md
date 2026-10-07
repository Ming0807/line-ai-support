# OC-UI-02R — root acceptance review and repairs

8 October 2026. User delivery: `codex/opencode-operator-workflows`, baseline `9437654` → `03cd090df23095b7eac170e995cd556a836dd7e5`. Worktree `C:/Users/NOTEBOOK/.codex/worktrees/gemini-dashboard-ux/line-ai-yru`. CH015/016/060, USR-UX/DASHBOARD; [12-package assignment](../agents/OPENCODE_OPERATOR_WORKFLOWS_PROMPT.md). Root repair commit **`458c76f077d720615301c5f1c688a7798f83dbee`**, external working tree clean, local-only. Status **FIXTURE_BEHAVIOR_PASS / LIVE_INTEGRATION_PENDING**.

Actual source and runtime review found six P2 defects despite the original38 tests passing:

1. Rejected error messages and unavailable details could expose arbitrary backend text.
2. Pagination accepted malformed or contradictory totals/pages/flags.
3. Shift+Tab could escape the initial dialog container.
4. Clear links dropped the selected pageSize.
5. Inherited names such as `constructor` passed action/severity membership checks.
6. `Date.parse` accepted date-only/no-timezone and invalid civil-date inputs.

Root repaired these directly, as requested: fixed safe error copy, own-key allowlists, strict timezone/civil timestamps, bounded exact pagination arithmetic/request/row-count checks, query-preserving clear helpers wired to actual forms/empty renderers, and first-control dialog focus/shared Tab decisions. Approved Gemini home/sidebar, visual styling, backend and dependencies remain unchanged. Both production adapters honestly remain unavailable until accepted read endpoints exist; no guessed endpoint or synthetic production data was added.

Root authored24 real counterexample regression cases: initial22/24 RED → final24/24 GREEN; original38 plus repairs62/62 PASS. Final root-observed external gates: TypeScript PASS, full ESLint PASS without warnings, full Vitest **1561/1561 in103 files**, controlled full production build PASS with static generation15/15, staged15-file credential check PASS, staged and committed `9437654..HEAD` whitespace PASS. Default seven-worker build compiled/typechecked but failed under host memory pressure; the passing sequential invocation used installed Next's `CIRCLE_NODE_TOTAL=2`, `RAYON_NUM_THREADS=2`, and384MiB Node heap. No Next configuration or test change bypassed that failure.

Actual Luna max read-only reviewer independently ran original38 tests/direct counterexamples, then returned no P1/P2 in the final repair diff and independently passed24 repair tests. Root owns the repairs/full gates; no full-suite, database or browser execution is attributed to the reviewer. External `docs/ui/OPENCODE_OPERATOR_ROOT_REPAIR_PLAN.md` and `docs/reports/OPENCODE_OPERATOR_ROOT_REPAIR_REPORT.md` are committed in the worktree above; they are not root-repository files.

SSR and pure focus-decision tests do not establish actual DOM focus restoration, keyboard, viewport or zoom behavior. Browser QA, live Activities/Logs endpoints and combined root integration remain pending. OpenCode model/provider/reasoning identity is unverified; different tasks and test counts do not establish a global Gemini/OpenCode quality/speed ranking. No external push, merge or rebase was performed. Root atomic-publication work continued independently, with [separate evidence](STRUCTURED_ATOMIC_PUBLICATION_REPORT.md).
