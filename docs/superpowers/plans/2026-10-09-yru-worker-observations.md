# ADV-03B-2 execution

## LOCAL-RESILIENCE-01 continuation,10October

- [x] Root ownedPG RED before source change: child calls current application pool, obtains one connection/PID and releases it; another owned connection terminates only that idle PID with exact disposable database and unique application name. Current child must exit on unhandled pg error. A second fixture covers the dedicated session-pool factory after authoring.
- [x] Root `createDatabasePool(connectionString,options)` in `lib/database/pool.ts` centralizes the existing pg construction and fixed no-payload idle-error listener. Application singleton remains max1/30second idle, outbox uses same factory/max2 and unchanged transaction-pool rejection. No global exception handler, active operation retry, SQL/schema/lease/TLS change.
- [x] OwnedPG GREEN proves fresh PID/query after termination, process survival and exact fixed log/no client/password/config dump for both paths. Register suite in existing schema runner; run type/lint/full unit/fresh isolatedbuild and launch coordinator with signed webhook/four-worker check-ins. Record review provenance/limitations and latest URLs in existing board/checklist; no new report.

9October2026 root. Requirements CH015/016/060; [frozen design](../../architecture/WORKER_OBSERVATIONS_DESIGN.md). Depends on current metrics Settings/auth/private role patterns; independent of web search, source approval and live provider/OA settings. Root continues after the source-bound support confirmation checkpoint.

- [x] RED tests before implementation:3actualPG missing table;2Settings DTO/render RED. Scope and later GREEN are recorded in the [report](../../reports/WORKER_OBSERVATIONS_REPORT.md).
- [x] Root additive `supabase/migrations/20261009043755_private_worker_observations.sql`; one fixed private table only. Focused owned replay35/foundationRLS/3actualPG PASS; no normal/remote application yet.
- [x] Actual Luna max scoped helper/four entrypoints/tests;9unit/type/scopedlint PASS, PG authored initially unrun then root executed. Actual Luna high independently source-reviewed scoped and root integration, no P1/P2/no tests run.
- [x] Root extends metrics/contracts, Settings/UI/actualPG fixture and owned schema runner. Fresh SUPER_ADMIN before private reads, exact four/nonfuture/null observations; selected24cases PASS, no inferred healthy threshold.
- [x] Appropriate gates:276ownedPG/35replay/foundationRLS/advisors0ERROR0WARN/1941unit/type/full lint/build/actual compiled Settings1440/390/320 PASS. Docs updated; guarded exact additive local+DEVELOPMENT35activation/56RLS/least grants/unchanged knowledge rows PASS. Preserve AI-disabled configuration. Exact staging/security/commit/root push/SHA evidence is recorded after execution in the report.

Human production worker startup/configuration and real-time check-ins remain in final setup checklist; missing implementation is root work. No live/full FlowA–F or V1 pass from these component checks.
