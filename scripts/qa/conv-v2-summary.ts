import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {judgeConversationFlowV2, summarizeFlowTurns, type FlowEvalTurn} from '../../lib/ai/conversation-eval-metrics';

/**
 * Summarise one CONV-V2 comparison round: artifacts written by conv-v2-owned-eval plus the
 * root review file (.superpowers/staging/conv-v2/<round>-review.json). Prints per-flow metrics,
 * per-case scores and the §7 verdict with the p95 reduction fixed in the review file before
 * the candidate run was read.
 *   pnpm exec tsx scripts/qa/conv-v2-summary.ts --round=r1
 */
const round = z.string().regex(/^[a-z0-9]{1,12}$/u).parse(process.argv.find(arg => arg.startsWith('--round='))?.slice(8));
const dir = resolve('.superpowers/staging/conv-v2');
const caseReview = z.strictObject({
  trajectory: z.boolean(), useful: z.boolean().nullable(), authoritySafe: z.boolean(), ownershipSafe: z.boolean(), inventedOfficial: z.boolean(),
  turns: z.array(z.strictObject({restricted: z.boolean(), reAsk: z.boolean()})), rationale: z.string().min(1),
});
const review = z.strictObject({
  reviewer: z.string().min(1), reviewedAt: z.string(), p95ReductionRequired: z.number(), p95RuleFixedAt: z.string(),
  flows: z.record(z.enum(['baseline', 'v2']), z.record(z.string(), caseReview)),
}).parse(JSON.parse(readFileSync(resolve(dir, `${round}-review.json`), 'utf8')));
const scenarios = (JSON.parse(readFileSync('tests/fixtures/assistant-conversations.json', 'utf8')) as {scenarios: {id: string; cohort: string; turns: string[]}[]}).scenarios;

interface ArtifactTurn {turnIndex: number; aiJob: boolean; resultKind: string | null; pipelineMs: number | null; endToEndMs: number;
  calls: {elapsedMs: number; status: number | null; safeError: string | null}[]; attempts: unknown[]; invariants: Record<string, boolean>}
function flowSummary(flow: 'baseline' | 'v2') {
  const turns: FlowEvalTurn[] = [], perCase: Record<string, unknown>[] = [];
  let trajectory = 0, useful = 0, authority = 0, invariantViolations = 0, blockedCases = 0, missingTurns = 0;
  for (const scenario of scenarios) {
    const path = resolve(dir, `${round}-${flow}-${scenario.id.toLowerCase()}.json`);
    const artifact = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as {stopReason: string | null; records: {turns: ArtifactTurn[]}[]} : null;
    const observed = artifact?.records[0]?.turns ?? [];
    const label = review.flows[flow]?.[scenario.id];
    if (!artifact || artifact.stopReason) blockedCases++;
    missingTurns += scenario.turns.length - observed.length;
    for (const [index, turn] of observed.entries()) {
      turns.push({caseId: scenario.id, turnIndex: turn.turnIndex, resultKind: turn.resultKind, aiJob: turn.aiJob, pipelineMs: turn.pipelineMs, endToEndMs: turn.endToEndMs,
        calls: turn.calls.map(call => ({latencyMs: call.elapsedMs, httpStatus: call.status, errorCode: call.safeError})), attempts: turn.attempts.length,
        restricted: label?.turns[index]?.restricted ?? null, reAsk: label?.turns[index]?.reAsk ?? null});
      if (Object.values(turn.invariants).some(Boolean)) invariantViolations++;
    }
    if (label) {
      if (label.trajectory) trajectory++;
      if (scenario.cohort === 'ANSWERABLE' && label.useful) useful++;
      if (scenario.cohort === 'BOUNDARY_REQUIRED' && label.authoritySafe) authority++;
      if (label.inventedOfficial || !label.ownershipSafe) invariantViolations++;
    }
    perCase.push({caseId: scenario.id, stopReason: artifact?.stopReason ?? 'NOT_RUN', turns: observed.length,
      calls: observed.map(turn => turn.calls.length), pipelineMs: observed.map(turn => turn.pipelineMs), kinds: observed.map(turn => turn.resultKind),
      ...(label ? {trajectory: label.trajectory, useful: label.useful, authoritySafe: label.authoritySafe} : {review: 'MISSING'})});
  }
  return {summary: summarizeFlowTurns(turns), scores: {trajectory, trajectoryDenominator: 30, useful, usefulDenominator: 20, authority, authorityDenominator: 10, invariantViolations},
    blockedCases, missingTurns, perCase};
}
const baseline = flowSummary('baseline'), v2 = flowSummary('v2');
assert(Date.parse(review.p95RuleFixedAt) > 0, 'P95_RULE_TIMESTAMP_REQUIRED');
const verdict = judgeConversationFlowV2({baseline: baseline.summary, candidate: v2.summary, candidateScores: v2.scores, p95ReductionRequired: review.p95ReductionRequired});
const result = {round, reviewer: review.reviewer, p95ReductionRequired: review.p95ReductionRequired, p95RuleFixedAt: review.p95RuleFixedAt,
  ledger: JSON.parse(readFileSync(resolve(dir, `${round}-ledger.json`), 'utf8')), baseline, v2, verdict};
writeFileSync(resolve(dir, `${round}-summary.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({baseline: {...baseline.summary, scores: baseline.scores, blockedCases: baseline.blockedCases}, v2: {...v2.summary, scores: v2.scores, blockedCases: v2.blockedCases}, verdict}, null, 1));
