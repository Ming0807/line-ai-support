# ADV-01 authenticated Staff OA binding

Root,8October2026; c7b3686 plus explicit ADV-01 changes. Original overview§46–48/master§54, [design](../architecture/STAFF_LINE_BINDING_DESIGN.md), [plan](../superpowers/plans/2026-10-08-yru-staff-line-binding.md). Root implementation/self-review; requested Luna unavailable, no independent verdict claimed.

Active staff create a10-minute one-use command in Settings, send it to Staff OA and observe completion. Lost-response retries recover the same encrypted token; a new request supersedes the old command. Exact canonical256-bit setup commands run inside the verified Staff lease transaction. Current account/expiry/consumption/ownership are rechecked. Inactive identities reserve their current owner until that owner explicitly replaces the binding; no automatic cross-account transfer. Student/HMAC/ordinary Staff paths remain unchanged.

Active-self GET/DELETE `/api/staff/line-binding` and challengePOST use private no-store headers, same-origin bounded strict JSON. All active staff get self Settings; admin health remains SUPER_ADMIN-only. No technical identity/hash/raw error in DTOs, no token/identity audit metadata. Unlink waits on the established Staff delivery fence, invalidates challenges/action tokens and suppresses later delivery. No LINE HTTP in SQL or invented Staff SYSTEM reply.

## Evidence

- Pure/API RED: missing modules; Settings RED: old404; owned SQL RED: missing service. First implemented SQL7/8 failed on a guessed fixture column `webhook_event_id`, corrected to actual `event_id`. Full unit regression exposed superseded admin-only Settings expectations; updated explicit self/no-admin-read assertions, preserving Usage protection.
- Full Vitest1883/1883 in141files; typecheck/full lint zero warnings/controlled production build PASS. Focused new contract/API/Settings10 cases included.
- Owned33-migration replay/foundationRLS/214 actual PostgreSQL PASS, including8 binding groups: issuer recovery/supersession/expiry/inactive accounts/replay/concurrent ownership/encryption/grants/immutable fields/actual advisory-lock waiting/action invalidation/outbox suppression/lease-completion rollback. Advisors2.119.0 ERROR0/WARN0/INFO104; cleanup PASS, no auth data copied/reset.
- Normal local Staff outbox6/worker1 regression PASS with mocked sender. A nonexistent staff-command filename contributed no tests and is not credited.
- Compiled `scripts/qa/v1-binding-browser.mjs`:8 checks PASS. Real login/self Settings; lost successful POST/idempotent recovery; clipboard; supersession; HMAC-signed Staff HTTP→claimed lease→binding→UI; duplicate; unlink. Viewports1440/390/320 have no overflow/page errors; root inspected320px. Private artifacts ignored. Synthetic LINE events, no real LINE delivery.
- Guarded DEVELOPMENT dryrun/apply/verify33migrations/52applicationtables/allRLS/9departments; local only33 applied. Owned browser32→33 preserves originals. No production selection/official source approval.

Real Staff OA binding/scoped notification/accept/open Dashboard remains deferred in the [setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). V1 still requires staff AI drafts/bounded web tools, incident context/outcomes and FlowA–F/corpus/free-provider/production acceptance.

References checked: [PostgreSQL17 locking](https://www.postgresql.org/docs/17/explicit-locking.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Acceptance comes from the actual commands above.
