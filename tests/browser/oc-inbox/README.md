# OC-INBOX-04 browser fixture walkthrough (FIXTURE HARNESS — not a production route)

Purpose: dated transcript of the manual browser walkthrough performed against the worktree
fixture dev server. This directory is documentation-as-harness only: no Next.js route, no test
runner wiring, no production code. Reproduce it with the commands below; nothing here is
required by CI.

- Date of run: 2026-10-29 (~06:32 ICT; document timestamps 1793230323905 ms UTC).
- Branch: `codex/opencode-inbox-workflows`, worktree `D:/project-next/line-ai-yru-opencode-staff`.
- Fixture server: `pnpm exec next dev --webpack --port 3344` (Ready in 1756ms; cached pages
  bought by first-hit compile — document request 11420 ms includes compile).
- Browser harness viewport: fixed 785×548 CSS px @ DPR 1.5 (desktop-app Review pane;
  `window.resizeTo` had no effect). Viewport-specific QA beyond ~800 px width must be
  recorded as NOT_RUN (see limitations).

## Walkthrough transcript (fixture environment, no staff session, fixture has no API routes yet)

| # | Page (GET) | Observed | Evidence class |
|---|------------|----------|---------------|
| 1 | `/staff/apply` | HTTP 200 shell (`layout.css`, `staff/layout.css`, page chunks, fonts HTTP 200). Client page calls `GET /api/staff/onboarding` → **404** (route absent in this worktree AND in baseline; backend endpoint is a PROPOSED root item). UI settles into the honest unavailable state: heading `ไม่สามารถเปิดหน้าสมัครได้ในขณะนี้`, lead `บริการสมัครยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง`, button `ลองโหลดใหม่`, link `กลับหน้าเข้าสู่ระบบ`. | FIXTURE_PASS (honest failure state) |
| 2 | `ลองโหลดใหม่` click on `/staff/apply` | Refetch: `GET /api/staff/onboarding` 404 again (106 ms). State does not change, no fake success, notice stays visible. Console: only the two expected fetch 404 errors + HMR/Fast-Refresh infos. | FIXTURE_PASS |
| 3 | `/staff/application` | Loading text `กำลังโหลดสถานะล่าสุด…` → settles to honest error phase: heading `โหลดสถานะไม่สำเร็จ`, same unavailable lead + `ลองโหลดใหม่` + `กลับหน้าเข้าสู่ระบบ`. | FIXTURE_PASS |
| 4 | `ลองโหลดใหม่` click on `/staff/application` | Refetch 404, error phase persists, still no fake success. | FIXTURE_PASS |
| 5 | `/login` | Login form renders (`อีเมลบุคลากร`, `รหัสผ่าน`, `เข้าสู่ระบบ`). No console errors. | FIXTURE_PASS |
| 6 | `/inbox` (unauthenticated) | `GET /inbox → 307` (dev-server log), browser follows to `/login` (staff gate intact in fixture). | FIXTURE_PASS |
| 7 | a11y probe on `/staff/apply` (evaluate) | Focusable order = [brand link, หน้าเข้าสู่ระบบ, ลองโหลดใหม่, กลับหน้าเข้าสู่ระบบ]; 0 negative tabindices; `lang="th"`. Measured `hasAlertRegion:false, hasPoliteRegion:false` for this state (notice is re-rendered static text, not a live region) — recorded as-is; not covered by the OC-STAFF-03 acceptance list. | FIXTURE_PASS (probe) |

## Limitations — recorded as NOT_RUN, not defects

1. Full `apply → login → (auth) → dashboard` and real approval flows could not be exercised:
   the fixture has no staff onboarding backend (`app/api/staff/onboarding` 404 is the absence
   of the route in this baseline, not a UI regression). The 401→login-phase mapping of the
   onboarding controller was already proven by `tests/staff-onboarding-ui.test.ts` (61 staff
   suite cases) at component level (COMPONENT_PASS).
2. No OAuth / no real LINE interaction was attempted anywhere in the walkthrough.
3. Viewport matrix 1440×900 / 390×844 / 320 px could not be exercised programmatically
   (harness viewport is fixed at 785×548; no resize tool). At 785 px the listed pages render
   their stacked/mobile layouts (`staff-onboarding.css` media query at ≤760 px was NOT under
   test at this width; the recorded screenshots show the mid-size layout only). Mobile QA
   claims are NOT made from this evidence.
4. Inbox unified workspace and ticket-detail chat could not be walked interactively: same
   auth/absence-of-backend constraints (`/inbox` redirects; thread/image APIs absent in this
   baseline). They are covered by component-markup suites
   (`tests/opencode-inbox-*.test.ts(x)`) — COMPONENT_PASS, not FIXTURE_PASS.

## Static CSS audit hooks (checked 2026-10-29, see report for the full table)

- `app/(dashboard)/inbox/inbox.css` — desktop 3-pane grid L27–29; ≤1200px 2-pane L184–185;
  ≤760px single-pane + `.inbox-mobile-hidden{display:none!important}` L188/194/196 and
  `.inbox-back-mobile` desktop-hidden L159 / mobile-shown L198; bubble & attachment wrap via
  `overflow-wrap:anywhere` L100/L105–110; `@media (prefers-reduced-motion: reduce)` L209.
- `app/tickets.css` — global `min-width:0; overflow-wrap:anywhere` L2–3; `:focus-visible`
  outline L38; reduced-motion L363.
- `app/incidents.css` — no `transition`/`animation`/`scroll-behavior` rules at all (nothing to
  gate behind reduced-motion); `:focus-visible` L22.
- `app/staff-onboarding.css` — `:focus-visible` L150; reduced-motion L153.

## Reproduction

```powershell
# from worktree root; pick a free port; do not touch root runtime ports 3000/3012
pnpm exec next dev --webpack --port 3344
# then browse: /staff/apply, /staff/application, /login, /inbox (last one redirects)
```

Dev-server cross-log for the same run (paths, status codes):

```
GET /staff/apply 200            GET /api/staff/onboarding 404 (x7 across mounts/retries)
GET /staff/application 200      GET /login 200
GET /inbox 307                  (followed by GET /login 200)
```

End-of-run note: after the last page state had been captured, the fixture process exited with
`FATAL ERROR: Zone Allocation failed - process out of memory (ERR_MEMORY_ALLOCATION_FAILED)`
during an HMR rebuild (exit code 1). This happened after the walkthrough completed and is a
fixture host/process event, not a UI observation; every table row above was already settled
by then.

Console/network captures for the transcript were taken with the in-session browser harness
`browser.console`, `browser.network.list`, `browser.snapshot`, `browser.screenshot`
(screenshot file `screenshot.jpeg`, harness-local; the visual state it shows is transcribed
in the table above).

---

## Erratum (2026-11-15 ICT)

- Items 1 & 4 above recorded the OC-04 (2026-10-29) worktree observation before Root's backend routes were present in this branch. At Root, staff onboarding API routes (`app/api/staff/onboarding/route.ts`, `app/api/staff/applications/route.ts`, `app/api/staff/applications/[id]/decision/route.ts`, `app/api/staff/applications/[id]/suspend/route.ts`, `app/auth/line/route.ts`, `app/auth/callback/route.ts`) were implemented in `0968451349ed020171e7aa397e9e7271b8295011` (`2026-10-29`).
- For OC-06/OC-07 mounted runs, invoke `run-scenarios.mjs` with `OC_INBOX_ARTIFACTS_DIR` pointed outside the repository (e.g. `D:/codex-cache/yru-ui-qa/oc07`) so `tests/browser/oc-inbox/artifacts/**` stays uncommitted.
