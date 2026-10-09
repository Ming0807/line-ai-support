# ADV-02B-2B — authenticated incident context at worker and read boundaries

9 October 2026, root, from `bdfdc4adb95a774611d13a057678cf6ca05fde6b`. Requirements CH013/052/055–057, master §§55–56; [design](../architecture/INCIDENT_CONTEXT_DESIGN.md), [execution](../superpowers/plans/2026-10-09-yru-incident-context.md). **COMPONENT_PASS / MANUAL_PENDING**. Controlled source-backed incident flows pass; real university corpus, live E5/operator/OA and final combined Flow A–F remain separate acceptance.

The incident worker now resolves exact SYSTEM/LOCATION claims from the immutable, owned support copy against current approved structured sources. It seals a private proof binding ticket revision, owner, department, sensitivity floor, complete source results and catalog/day. Both known and valid unknown values need current authenticated evidence. Corrupt, unavailable or incomplete evidence records BLOCKED and retries without replacing the last vector or extending an incident. Similar-issue reads suppress stale proofs and queue bounded work. Historic incident membership remains intact.

E5 stays outside SQL. Final catalog, incident, conversation, sorted ticket and lease locks protect the atomic proof/vector/detection write. Similar reads lock the complete selected ticket set, reload source evidence and recompute scope before returning the existing safe DTO. Private quotes, source proofs and canonical system/location keys are absent from public DTOs and logs.

## Implemented files and ownership

- Actual requested Luna high authored `lib/incidents/context-proof.ts` and `tests/incident-context-proof.test.ts` against root's frozen contract. Root reviewed and integrated them.
- Root owns `context-state.ts`, decoder sensitivity retention, `worker.ts`, `reads.ts`, worker entrypoint key configuration, development grant verification, actual PG tests and activation. Migration36 was already committed at the infrastructure checkpoint; its history was not rewritten.
- Tests extend `tests/database/incidents.integration.ts` and `import-structured-publication.integration.ts`. `tests/database/foundation.sql` now compares full-directory/SUPER_ADMIN visibility to the server baseline captured inside its rollback-only fixture, rather than assuming an empty retained database.

## Observed checks

| Check | Result and scope |
|---|---|
| Focused pure context/source/proof | 3 files / 19 cases PASS; overlaps full unit evidence |
| Final typecheck | `pnpm typecheck`, exit0 |
| Final full unit | `pnpm test --maxWorkers=1`, 154 files / 1,977 cases PASS; includes the separately accepted C2-Q preparation |
| Final full lint | `pnpm lint`, exit0, no errors/warnings |
| Final production build | `pnpm build`, Next16.3.8/Turbopack compile, TypeScript and 28 static-generation entries PASS; one build worker through process environment only |
| Full owned PG | Source-derived `verify-structured-schema.ts` diagnostic runner, 17 groups / 306 actual PG cases PASS, 36 migration replay / foundation RLS / 7 structured tables PASS |
| Advisors, full owned PG | Pinned CLI2.119.0: baseline111INFO → current109INFO; 0ERROR / 0WARN, no added unindexed FK. INFO contains expected private tables without browser policies and unused indexes |
| Guarded local + selected DEVELOPMENT | Only migration36 pending in both dry runs, then applied. Both36 versions / 58 RLS tables; exact service nonidentity column grants and browser denials PASS |
| Retention snapshot | Before/after private row-count/digest comparison of documents/import evidence/support state/copies/outcomes/incidents/memberships/vectors/receipts unchanged. No document approval |
| Normal local regression | `node --import tsx --test --test-concurrency=1` on the eight existing AI-job/worker/tools/student-ticket/ticket-security/read/staff-outbox/takeover files:53/53 PASS |
| After foundation fixture correction | Actual local and DEVELOPMENT grant/RLS verification exit0; fresh owned36 replay/foundation/13 incident cases/normal unchanged/exact cleanup PASS. Advisors NOT_RUN in this focused invocation |

The full PG runner's temporary diagnostic copy adds private synthetic failure capture while retaining the same groups, SQL assertions, bounds, advisors and cleanup. Activation uses a source-derived direct invocation of the same pinned CLI, keeping the original target guard, dry run, verified TLS, redaction and preserved seed values; the local verifier changes only its connection target. No environment values or temporary diagnostics are committed.

## Failures and corrections

- Independent Luna max found late support-copy races for anchor and candidate. Actual PG RED reproduced them. Sorted final `FOR UPDATE` ticket locks now conflict with the immutable copy's FK `KEY SHARE`; final combined reload/requery protects reads as well as writes.
- Actual PG RED showed UUID-ordered proof budgeting could exclude the anchor. The same8MiB budget now allocates anchor first. Redacted candidates cannot authorize extension. Lease and DB Bangkok day are checked after dependent work; crossing either rolls back.
- The concurrent-cohort fixture timed out because its own sequential preparation could process a future cohort before the intended five baseline proofs. Root now builds/asserts those five real worker proofs before exposing the two concurrent vectors/jobs. The final barrier still exercises two real workers and preserves the six-member/no-dissimilar-bridge assertions; focused13 and full306 pass. A bounded15-second test timeout exposes future harness stalls.
- Local activation initially failed the historical foundation assumptions of9 departments/7 SUPER_ADMIN tickets. Retained development data was not removed. Transaction-local server baseline counts preserve full-population visibility checks; existing department/sensitivity/inactive/anonymous denials remain. Other scoped-role fixture counts still assume no additional visible rows in those exact synthetic scopes; both actual target verifications passed.
- An earlier full run returned an uncaptured Support `INVALID_REQUEST`. A diagnostic controlled2-case run and the final full run passed; no cause or production fix is claimed. An interrupted partial run and resource failures are not passes.
- Windows temporarily exhausted commit capacity. Gates ran serially with a process-only768MiB Node heap after memory became available. No pagefile/global setting, production timeout, SQL assertion or unrelated process was changed.

## Review provenance and remaining acceptance

Actual Luna max independently reviewed the context implementation, identified the late-copy/budget findings, and source-reviewed the final concurrency fixture correction and foundation baseline correction with no remaining concrete P1/P2 in those scopes. That reviewer did not execute the full PG/build/activation gates. Root owns those executions and integration. Earlier unavailable reviews are not credited.

No UI/DTO change required new browser checks; previous compiled UI evidence remains separately dated. Deterministic384-dimensional fixtures verify behavior, not live E5 semantic quality. Real approved sources, current configured worker/OA behavior and full combined Flow A–F remain MANUAL_PENDING/final acceptance. Official/general web is still required root implementation; V1 is incomplete. No new human key, model download or manual migration is required for this checkpoint.
