# Gemini UI standards review — 2026-10-07

**Outcome:** Standards review found blocking UI truthfulness and accessibility issues; do not record a standards pass yet.

**Scope:** Read-only review of `da554709a2a555bd2b4da4300277ae322a1aa22c..443c22770975a39f5b7b43a57995f4fce081e287` in `C:\Users\NOTEBOOK\.codex\worktrees\gemini-dashboard-ux\line-ai-yru`; tree was clean. Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, project index, task board, decision log, working protocol, full Gemini prompt, UI plan, Gemini report, relevant subsystem docs, and installed Next 16.3.8 layout/navigation/client-component/error/loading guides. No tests/build/browser flows run.

## Findings

1. **[P1, hard — fabricated/mislabeled dashboard data]** `app/(dashboard)/dashboard/page.tsx:191-219,303-368`: The donut segments are fixed SVG lengths unrelated to the displayed ratios; with zero active tickets the legend reports 100% “ของฉัน” while the chart remains segmented. Weekly bars use hard-coded heights, and progress bars derive arbitrary widths from counts. The “โมเดล AI เปิดใช้งาน” card actually counts providers; non-SUPER_ADMIN users always see `0/1`. This violates `docs/agents/GEMINI_UI_UX_PROMPT.md:36` (real backend data; no invented analytics/percentages) and `PRODUCT.md`’s evidence-based status principle. Remove unsupported visualizations or compute them from matching, labeled data; use explicit unavailable/empty states.

2. **[P1, hard — mobile keyboard access incomplete]** `app/(dashboard)/nav-bar.tsx:88-104,127-152`: Escape closes the drawer, but opening it does not move focus, trap focus, mark the background inert/modal, or restore focus to the trigger. The underlying page remains keyboard-reachable. This misses the explicit drawer keyboard-trap requirement in `docs/ui/GEMINI_DASHBOARD_PLAN.md:65` and the keyboard/accessibility requirements in the prompt. Add dialog semantics and complete focus management.

3. **[P2, hard — failures presented as real zero/offline states]** `app/(dashboard)/dashboard/page.tsx:58-70,381-388`: Failed reads are swallowed and represented by empty arrays; embedding read failure (`null`) is labeled “ออฟไลน์”. `listImportJobs` returns the latest 50 jobs across statuses (`lib/imports/import-staging.ts:109-113`), yet the dashboard labels its full length as jobs “รอตรวจสอบ”. Preserve read failures as unavailable and count only jobs whose status requires review.

4. **[P2, hard — required whitespace check fails]** `git diff --check da55470..443c227` reports trailing whitespace in `dashboard/page.tsx:185`, `nav-bar.tsx:141-142`, and `docs/ui/GEMINI_DASHBOARD_PLAN.md:3-7`. Remove it and rerun the required check from the Gemini prompt.

**Evidence limits:** The committed tree contains no screenshot assets (`git ls-tree -r`); the report’s `screenshots/*.png` paths could not be inspected. Its typecheck/lint/test/build/browser claims were not rerun for this review, so they remain report claims rather than independently verified evidence. Static source inspection was used for findings above.
