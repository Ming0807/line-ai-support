# STR-01C-1 — source-derived publication preparation evidence

7 October 2026. Root baseline e78dd51228e171646d9ad3520ff4d7bb990fec6a; feat/yru-helpdesk-v1. Latest human asks root to continue backend and repair small UI defects directly while assigning a substantial OpenCode batch. CH012/018/041/050/060; [design](../architecture/STRUCTURED_PUBLICATION_PREPARATION_DESIGN.md), [plan](../superpowers/plans/2026-10-07-yru-structured-publication-preparation.md), DEC-050. Status COMPONENT_PASS, not atomic persistence or V1 completion.

## Implemented behavior

`prepareStructuredPublication` rebuilds actual Mapping1 from checked original bytes, located extraction, source-bound mapping and review tuple. It rejects supplied plans/rows/IDs/unknown request fields, checks storage-compatible revision counters, recomputes the same stable content acknowledgment used by review3, generates backend UUIDs and constructs every authenticated envelope context from that recomputed plan and checked document tuple. Each prepared row contains only id, typed payload/digest, checked context and encrypted evidence; private cell strings/notes/location/source URL remain encrypted. The full detached artifact is deeply frozen and limited to16MiB, including ciphertext/base64/metadata overhead, before any output escapes.

The prior acknowledgment body moved unchanged into `lib/imports/structured-acknowledgment.ts`, re-exported from the existing preparation module. Existing preview/review callers preserve their imports and digest algorithm. No new runtime approval caller, DB/schema/API/worker/query/LINE/provider behavior is enabled. Key is a backend argument; no environment/key settings, secret logs or network calls were added.

## Provenance and RED/GREEN

- Actual Luna max test author owns the initial eight cases in `tests/structured-publication-preparation.test.ts`; root independently ran RED and confirmed missing module, 0 collected assertions. This is a missing-module RED, not eight failing collected tests.
- Existing pure mapper fixtures had job3/extraction7; root identified that they violate the newly exercised storage counter invariant. The author added a local happy-fixture wrapper with job7/extraction7 in binding and mapping.source. Shared old fixtures remain unchanged; deliberate invalid0/1 and3/4 cases remain. No storage constraint was weakened.
- Root implemented contracts/code and observed8/8GREEN. Root then added one aggregate byte-bound regression: a valid mapper plan remains below16MiB but its encrypted row artifact exceeds the cap and returns the fixed failure without a partial artifact. Accepted small output is measured separately. This ninth regression verifies an implemented bound and is not attributed as the author's RED.
- Actual separate Luna max independent source reviewer found noP1/P2, including exact serialized byte accounting, source-derived contexts, detached freeze and unchanged acknowledgment semantics. Reviewer inspected tests and runtime caller search but executed no tests; all commands below are root-owned.

## Actual commands

| Gate | Result |
|---|---|
| Initial focused test | RED, import missing, 0 collected |
| Initial implementation focused | PASS8/8 |
| Final focused preparation/envelope/structured-route/review schema | PASS36/36,5files; includes9 preparation cases |
| Full pnpm exec vitest run --maxWorkers=1 | PASS1638/1638,114files |
| pnpm typecheck | PASS exit0 |
| pnpm lint | PASS exit0 |
| rg preparation runtime callers in app/lib/scripts | Only definition/type export; no runtime caller |

Owned15-file staged credential check and whitespace PASS;11 affected Markdown files/338 relative targets resolve. SQL/migration application, Postgres/HTTP/build/browser/parser corpus/OA/provider/live flows were NOT_RUN for this private Node assembly. External ticket repair has a separate actual1499-test/build record; those results are not borrowed as root backend or live evidence. Root unit/type/lint ran against the current working checkout including unrelated knowledge UI work; those files are not staged or accepted as this component's UI delivery.

## Remaining work and limits

35 dataset/format combinations are synthetic located mapper fixtures, not35 parsed university originals. Checked hashes/extraction and acknowledgment demonstrate consistency of caller-supplied saved inputs; this module cannot certify actual parser execution, human approval, canonical review receipt, staff permissions, source authority/currentness/applicability or a committed publication receipt. The trusted future service must load actual inputs, prepare outside SQL and execute final authorization/revision/source/family/target fences before atomic provenance+typed rows+mode effects/receipt. Registry stays installed:false and STRUCTURED/BOTH approval stays unavailable. Normal schema application, atomic mode proof, exact structured query/delivery and combined UI/FlowA–F remain required agent work. No new human setup is requested.

Unrelated root knowledge UI/corpus/output changes are excluded from commits. Root independently completed small external ticket repairs in local-only9437654, and the user can relay [12-package OC-UI-02](../agents/OPENCODE_OPERATOR_WORKFLOWS_PROMPT.md) for Activities/Logs while root owns backend integration.

## Git handoff

Root implementation **78d38cdf2d885026bc671de28f5d7934bebbd71c** is pushed to origin/feat/yru-helpdesk-v1; actual ls-remote confirms the same SHA. The first HTTPS push failed curl28 before remote update; a read-only check still showed e78dd51. A cached SSH probe was denied publickey, so root kept the existing HTTPS remote/account and retried after443 connectivity recovered. Retry and remote confirmation passed without account selection. No external UI branch was pushed or merged. The follow-up documentation commit records these already-observed results; no extra source/testing acceptance is implied.
