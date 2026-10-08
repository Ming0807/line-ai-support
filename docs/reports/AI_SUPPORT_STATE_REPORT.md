# RAG-01B-2 — private support context and outcome storage

8October2026, root from accepted68bf470f268c7091841824ec9277d5246daa7c70. [Storage design](../architecture/AI_SUPPORT_STATE_DESIGN.md), [workflow](../architecture/AI_SUPPORT_WORKFLOW_DESIGN.md), [execution](../superpowers/plans/2026-10-08-yru-support-workflow.md), CH027/028/031/057 and FlowB/C. Root implementation and source self-review; requested Luna agents remain unavailable at usage limits, with no independent verdict claimed.

## Scope

Fixed migration34 adds three backend-only RLS tables: encrypted conversation support advice, immutable ticket-bound context and immutable user-confirmation outcomes. Exact composite owner/source/job/outbox/ticket foreign keys prevent cross-conversation links. Public/anon/authenticated cannot read or mutate them. Optional guidance/ticket keys retain explicitly tested NULL behavior. No per-document/year schema, personal-record database, data replacement or history deletion.

`loadSupportSnapshot` projects only bounded actual USER evidence and the current active public directory, under the existing conversation lock. Backend IDs and assistant assertions are excluded from provider input. Source/directory fingerprints, active owner/revision/mode/no-HUMAN and the latest routed USER message fence advice. Existing encrypted state must decrypt and match its source/owner/privacy/department/guidance mirrors before granting a sensitivity minimum or guidance flag.

`saveSupportState` revalidates the owned live AI lease, source/directory, literal proposal and current sensitivity inside finalization. A replay of the same proposal/job returns the same digest; changed source, ownership, privacy or proposal is rejected. Optional guidance requires a canonical reviewed result, matching public AI citations/text and exact owned AI outbox. Pending delivery is false; actual SENT delivery with a successful DONE job is true; clarification or altered canonical messages cannot grant guidance. Successful delivery creates no solved outcome.

The fixed outcome/ticket-context tables are infrastructure only. Production producer wiring, consumed solved/escalated confirmation, transitions, ticket copy/read authorization and observed Analytics remain B3. No public API, LINE webhook behavior, inference or automatic ticket mutation is introduced by B2.

## Verification ledger

- Initial owned RED: helper module absent. New corrupt/privacy mirror regression reproduced RED with the guard removed; restored guard rejects it. Additional department-column mismatch reproduced RED and is now bound inside the encrypted envelope/digest.
- First241-case owned run passed tests but failed the existing advisor gate because nine composite FKs lacked complete matching child indexes. Corrected composite indexes; did not weaken the advisor assertion.
- Canonical guidance integration initially failed before enqueue: committed structured-schema fixtures left synthetic active departments outside the public directory contract. A minimized owned schema121→single-guidance loop reproduced `GUIDANCE_DIRECTORY_CONTRACT`; retiring only those exact fixture department IDs after rollback made121+1 pass. Immutable fixture evidence is retained until the owned DB is dropped; normal application data is untouched.
- `pnpm typecheck` / `pnpm lint`:PASS after the final code and fixture correction.
- Final `pnpm exec tsx scripts/database/verify-structured-schema.ts` (pinned CLI2.119.0):243actualPG cases PASS across12serialized suites,34migration replay/foundationRLS PASS; advisorsERROR0/WARN0/INFO110 and no new unindexed FK. Normal structured tables remain7, auth data not copied, existing database not reset, owned disposable cleanupPASS. Final source contains7support-state and50structured-publication cases.
- Full `pnpm exec vitest run --maxWorkers=1`:148files/1918tests PASS,72.42seconds, no timeout or test relaxation. Fresh controlled `pnpm build`:PASS, Next16.3.8/one worker/compiled2.4seconds/TypeScript6.4seconds/all28static entries. No browser surface is changed; browser checks are not rerun.
- Exact16staged files:normalization changed0, `git diff --cached --check` and `node scripts/security/check-staged.mjs` PASS. Commit/root push SHA is recorded at the next bookkeeping checkpoint; external Gemini/OpenCode branches remain local-only.

## Activation and limitations

Migration34 is authored and replayed only in a newly owned disposable database; normal local and DEVELOPMENT remain33 migrations/52RLS application tables until the separate documented integration activation. No production application, approved university document, real LINE send, live free-model semantic quality or FlowB/C completion is claimed. B3 code is agent work; existing live corpus/OA/provider/production evidence remains in the final setup checklist. V1 is incomplete.
