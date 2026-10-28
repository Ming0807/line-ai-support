# OC-STAFF-03 — OpenCode delivery report: LINE Staff onboarding UI + approval console

28 October 2026. User delivery branch `feat/oc-staff-onboarding`, **local-only** (no push, no merge, no rebase). Root checkpoint baseline `bad52c1` (`feat/yru-v1-final-polish`). Commit chain: RED tests `60b6d06` → implementation `47fbd4a` → this report commit (branch tip). Worktrees: authored in `C:/Users/NOTEBOOK/.codex/worktrees/opencode-staff-onboarding/line-ai-yru`; gates and build re-ran in `D:/project-next/line-ai-yru-oc-staff` (same branch, `node_modules` junction into the sibling D: main checkout — reason documented under Gates). Status: **FIXTURE_BEHAVIOR_PASS / LIVE_INTEGRATION_PENDING / GATES_PASS_WITH_9_PREEXISTING_FAILURES_REPORTED**.

## Scope delivered (files)

- `app/staff/layout.tsx` — public shell for `/staff/**` (no dashboard nav: visitors are not yet active Staff)
- `app/staff/apply/page.tsx`, `app/staff/apply/apply-client.tsx`, `app/staff/apply/onboarding-controller.ts` — apply flow (context gates → 3-field form → recorded view; uncertain/conflict contracts)
- `app/staff/application/page.tsx`, `app/staff/application/status-client.tsx`, `app/staff/application/status-controller.ts` — personal application status view
- `app/(dashboard)/staff-applications/page.tsx`, `app/(dashboard)/staff-applications/approvals-client.tsx`, `app/(dashboard)/staff-applications/applications-controller.ts` — reviewer console (tabs, server pagination, decision drawer)
- `app/login/line-login-entry.tsx` — reusable entry constants: `LINE_LOGIN_APPLICATION_URL = '/auth/line?next=/staff/apply'`, `LINE_LINK_EXISTING_URL = '/auth/line?mode=link&next=/staff/application'` (routes do not exist yet — root scope, surfaced honestly as unavailable-adjacent links)
- `app/staff-onboarding.css` — single class prefix `staff-onboard-` on all existing design tokens (dark rail / alabaster / coral), Thai labels, reduced-motion + focus-visible, ≤720px and ≤460px rules
- `tests/staff-onboarding-ui.test.ts`, `tests/staff-approval-ui.test.ts` — RED→GREEN specs
- `docs/reports/OPENCODE_STAFF_ONBOARDING_REPORT.md` — this file (only document created)

Forbidden-scope files were never modified: `lib/**`, `types/**`, `supabase/**`, `services/**`, `app/api/**`, `scripts/**`, `.env*`, package/lockfile, `next-env`, middleware/proxy, shell/nav, Inbox, TicketActions, Incident UI. The only `next.config.ts` edit was a build-worktree temporary (see Gates), reverted before commit and never committed.

## Contracts (root-defined; consumed, not invented)

- `GET /api/staff/onboarding` — 401 → login prompt path, `!response.ok` (503/404/…) → honest unavailable state; ready context shape `{authenticated, lineLinked, staffActive, application|null, departments[]}`.
- `POST /api/staff/applications` — body exactly `{applicantName, staffCode, departmentId, requestId}`; `requestId` is a client UUID generated once per attempt; `2xx` item → recorded view, `404/409` semantics → conflict (keeps draft, reloads server truth, drops the id), `401` → login re-entry, `4xx` with message → definitive error, network/5xx → uncertain **with the same requestId retained for the retry**; no automatic resubmission.
- `GET /api/staff/applications?status=…&page=…&pageSize=…` — list `{items, departments, pagination{page,pageSize,total,totalPages,hasNext,hasPrevious}}`; totals render untouched; the console never guesses totals client-side; stale responses are dropped by a serial guard (out-of-order loads never land).
- `POST /api/staff/applications/[id]/decision` — body `{decision:'APPROVE', departmentId, revision, requestId}` or `{decision:'REJECT', reason, revision, requestId}`; `POST /api/staff/applications/[id]/suspend` — body `{reason, revision, requestId}`; response item refreshes dialog/list. 409 keeps the reviewer's draft, resets the request id, reloads server truth (`refreshDialogApplication`) and requires a fresh manual decision — no auto-approve, no auto-retry. Governance: final department choice is reviewer-selected with no preselect; suspend requires both a reason and an explicit impact acknowledgement.

## RED → GREEN

- `60b6d06` — 2 files, 404 insertions. RED evidence (recorded at that commit, before implementation existed): focused run exit 1 with module-resolution failures (`Cannot find module … app/staff/apply/onboarding-controller`, `…applications-controller`), i.e. specs import the controller modules that did not exist yet.
- `47fbd4a` — typed controllers as pure node-testable reducers + async fetch functions with injected `fetchImpl` (mocks only in tests); GREEN: `pnpm exec vitest run tests/staff-onboarding-ui.test.ts tests/staff-approval-ui.test.ts` → **2 files, 42/42 pass** (vitest 5.0.3).
- Coverage the specs pin down (highlights): context-gate phase resolution for both public pages; near-field validation before any network call; submit body contract `{applicantName, staffCode, departmentId, requestId}` with `credentials:'same-origin'`; uncertain retains the same `requestId` for the retry, conflict keeps the draft and reloads the context, session reset clears everything; approval list serial guard (stale responses dropped), tab/page re-query with page reset and clamping, per-request-id double-submit guard; decision drawer validation (APPROVE requires a reviewer-chosen final department; REJECT requires reason; SUSPEND requires reason **and** impact checkbox) and decision request bodies `{decision, departmentId|reason, revision, requestId}` with exact URL building including encodeURIComponent of the id.

## Gates (D: build worktree `D:/project-next/line-ai-yru-oc-staff`)

- `pnpm exec tsc --noEmit` → `TSC_EXIT=0`.
- Focused vitest (above) → 42/42.
- Full `pnpm test` → Test Files **2 failed | 254 passed**, Tests **9 failed | 3484 passed | 1 skipped** — the same two files were then proven on a detached checkout of the base checkpoint `bad52c1` in the same worktree: `Test Files 2 failed (2), Tests 9 failed | 1 passed (10)` (`tests/assistant-conversation-context.test.ts` — 9 cases, `tests/assistant-owned-source.test.ts` — suite-level import failure, `AssistantConversationContextError: FROZEN_FIXTURE_HASH_MISMATCH` from `lib/ai/conversation-eval-context.ts`). **Identical at the base — pre-existing, out of this delegation's scope, root already owns the frozen fixture hash; left untouched.**
- Full `pnpm lint` (`eslint .`) → `LINT_FULL_EXIT=0`; changed-files eslint round → `LINT_EXIT=0`.
- `pnpm build` — first run panics with a Turbopack FATAL: `Symlink [project]/node_modules is invalid, it points out of the filesystem root` (the worktree's `node_modules` is a junction into the sibling main checkout). `next build --webpack` also fails (`Can't resolve './D:/project-next/…/next/dist/client/next.js'`). Environment-only workaround, documented step by step: for the D: build worktree only, temporarily set `turbopack.root = 'D:/project-next'` in `next.config.ts`, ran the build, then `git checkout -- next.config.ts` before doing anything else (`git status --short` clean). Final `pnpm build` → **`BUILD_EXIT=0`**; route table includes `○ /staff/apply`, `○ /staff/application` (static) and `ƒ /staff-applications` (dynamic). No bundler flag or config change is committed to the branch, and none bypassed the failure inside the branch tree.
- `git diff --check bad52c1..47fbd4a` → `DIFFCHECK_EXIT=0` (no whitespace errors).
- Credential scan over the changed paths at the implementation commit (`git grep -nE 'sk-[A-Za-z0-9]{20,}|AIza…|eyJhbGciOi|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|DATABASE_URL=|SERVICE_ROLE|SUPABASE_KEY|password=…'`) → exit 1, no matches.
- Debug surface scan over delivered app files (`git grep -nE "console\.(log|debug|info)|window\.alert"` at `47fbd4a`) → exit 1, no matches.
- CSS prefix audit: every selector line in `app/staff-onboarding.css` starts with `staff-onboard-` (0 exceptions).

## Browser evidence (FIXTURE-labelled; built app served via `next start` on localhost:4173, production build above)

Method stated honestly: the backend routes are root scope and do not exist in this branch, so page behaviour is exercised with a visible per-page `window.fetch` stub; every fixture, item, and capture below is FIXTURE data and nothing here claims a live backend pass. No token, secret, or OID was printed anywhere (verified also by the debug scan above).

1. `/staff/apply`, live network only — `GET /api/staff/onboarding` → real 404 (console shows only that 404) → honest unavailable state with recovery actions and back-to-login.
2. Same tab, fixture context — "ลองโหลดใหม่" re-runs the loader → the 3-field form renders from context (`departments` fixture only).
3. Empty submit — role=alert near-field errors on all three fields (`โปรดระบุชื่อจริงและนามสกุล`, `โปรดระบุรหัสบุคลากร`, `โปรดเลือกฝ่ายจากรายการที่ระบบให้เท่านั้น`); captured request list stayed empty (client-side validation precedes any network call). Screenshot `apply-form-errors.png`.
4. Filled submit — captured `POST /api/staff/applications` body exactly `{"applicantName":"สมหญิง ใจดี (FIXTURE)","staffCode":"YRU-0001","departmentId":"dept-1","requestId":"80e66f1e-597a-4934-8a79-b06a7fc75bdd"}` with `credentials:"same-origin"` as designed; fixture item response moves the UI into the recorded view: chip `อยู่ระหว่างพิจารณา`, Thaiized stamp `28 ตุลาคม 2569 เวลา 10:00`, next-step hint (`ไม่ต้องยื่นซ้ำ`), success notice `ส่งคำขอแล้ว รอการพิจารณาจากผู้ดูแลระบบ`. Screenshot `apply-form-success.png`.
5. `/staff/application` — real 404 → unavailable state; fixture with a PENDING application → status view: chip `อยู่ระหว่างพิจารณา`, guidance copy, definition rows `ฝ่ายที่ขอ: บริการวิชาการ`, `ส่งเมื่อ: 28 ตุลาคม 2569 เวลา 10:00`. Screenshot `application-status-pending.png`.
6. `/staff-applications` — real document load → **HTTP 307 → /login** (network log captured `GET /staff-applications → 307` then `GET /login → 200`). The server-side session gate correctly keeps anonymous users out of the console. Consequence stated plainly: the decision drawer could not be driven in a browser in this delivery because a session-bearing login session is root infrastructure. Drawer/concurrency behaviour instead rests on the unit suite (validation block before network, retain-on-conflict, serial guard, request-id semantics, revision passthrough). A session-bearing QA pass is listed as a root dependency below.

Screenshot sources are the in-app browser's machine-local captures under `C:/Users/NOTEBOOK/AppData/Local/Temp/opencode-browser-*/0/screenshot.png` (three files, one per labelled state; ephemeral temp storage, not committed — binary screenshots are outside this delegation's file scope). Additional limitation claimed honestly: the in-suite browser tooling exposes no device emulation, so the ≤720px/≤460px mobile behaviour rests on the committed CSS media rules plus contract tests rather than a captured 390px image.

## What remains for root (PROPOSED → root-owned)

1. `/api/staff/onboarding` (GET semantics 401/503 as contracted).
2. `/api/staff/applications` POST + GET list (`status`,`page`,`pageSize`), `/[id]/decision`, `/[id]/suspend`.
3. `/auth/line?next=/staff/apply` and `/auth/line?mode=link&next=/staff/application`.
4. SuperAdmin nav entry pointing at `/staff-applications`, and a live, session-bearing QA of the approval console (approve/suspend/conflict drawer paths) once sessions exist.
5. The 9 pre-existing red cases + 1 suite failure at `bad52c1` (frozen fixture hash) — root-owned work; unchanged here.
6. Final-setup checklist inclusion by root (nav/menu wiring, SuperAdmin flow labels).

## Working rules honored

- No push, no merge, no rebase, no reset, no clean; branch stays local for root inspection.
- Only created report file: `docs/reports/OPENCODE_STAFF_ONBOARDING_REPORT.md`.
- `requestId` rules: client UUID per attempt, reused verbatim after uncertain outcomes, dropped after definitive outcomes; mutations never auto-retry; no auto-approve anywhere; conflicts always reload server truth before another manual decision.
- No localStorage/token/secret logging; no invented endpoints; production routes absent → UI states degrade honestly (unavailable / login paths), never faked success.
- All exit codes above were observed directly in this work session; the RED phase evidence for `60b6d06` was captured in-session at that commit.

## Root review addendum — 29 October2026 (original delivery above retained)

- Standards (actual Luna high): native modal focus containment/return was missing; filtered409 refresh could retain a stale actionable revision.
- Spec (actual Luna max): cached applicant list/drawer survived permission denial; X/Escape could discard an uncertain mutation ID. Controller tests did not exercise those rendered interactions; browser evidence above remains fixture-only.
- Root independently reran42 original focused tests, then captured7 approval behavior RED cases and1 applicant payload RED case. Root fixes clear private snapshots on denial, retain immutable uncertain payload+revision+ID, block unsafe dismissal/replacement, make missing409 rows non-actionable and finished details read-only, and use native modal focus behavior. Root's current focused51Staff +16frozen-context/source tests PASS. Native modal browser/real identity acceptance remains pending.
- The9 baseline failures are LF→CRLF checkout conversion, proven with actual hashes. Immutable fixture content and expected hash remain unchanged; .gitattributes now pins bytes. Full current root WIP3555PASS/1malformed-PDF child timeoutFAIL is separate from this original worktree's reported run. Root owns follow-up; no full-green claim.
- Root owns DB/Auth/API/LINE/media integration. A later diagnostic agent could not start due account usage limit; that diagnosis was performed by root, not credited to a reviewer.
Root gate follow-up: isolated malformed-PDF suite3/3PASS and root full single-worker rerun3556/3556tests/261filesPASS; type/full lintPASS. Initial two-worker timeout above remains historical evidence. Exact nextdelegationbase d51e732 independently105focused/7filesPASS. These counts have different source scope; none establishes actual OAuth/LINE approval or browser acceptance.

29October final build: root main default pnpm build (Next16.3.8 Turbopack/originalconfig) EXIT0; fullroute generation includes Inbox, Staff apply/status/approval and chat APIs. Installed CLI confirms .next/dev isolation, no rootserver stop; pre-existing next-env restored byte-for-byte (SHA256 equality). Root working-source full3556unit/261files, type/full lint/buildPASS. Exact delegationd51e732 focused105PASS and worktree buildBLOCKED remain separate scope; no realOAuth/Realtime/LINE/model/FlowA-F acceptance or normalmigration48activation.
