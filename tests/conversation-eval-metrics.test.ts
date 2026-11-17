import {describe, expect, it} from 'vitest';
import {
  judgeConversationFlowV2,
  nearestRankPercentile,
  summarizeFlowTurns,
  type FlowEvalTurn,
} from '../lib/ai/conversation-eval-metrics';

function turn(overrides: Partial<FlowEvalTurn> = {}): FlowEvalTurn {
  return {
    caseId: 'A01', turnIndex: 0, resultKind: 'CONVERSATION', aiJob: true,
    pipelineMs: 1000, endToEndMs: 4000,
    calls: [{latencyMs: 900, httpStatus: 200, errorCode: null}],
    attempts: 1, restricted: false, reAsk: false,
    ...overrides,
  };
}

describe('nearestRankPercentile', () => {
  it('uses the nearest-rank definition and ignores no values', () => {
    expect(nearestRankPercentile([], 50)).toBeNull();
    expect(nearestRankPercentile([7], 95)).toBe(7);
    expect(nearestRankPercentile([5, 1, 3, 2, 4], 50)).toBe(3);
    const twenty = Array.from({length: 20}, (_, index) => index + 1);
    expect(nearestRankPercentile(twenty, 95)).toBe(19);
    expect(nearestRankPercentile(twenty, 100)).toBe(20);
  });

  it('rejects an invalid percentile or non-finite values', () => {
    expect(() => nearestRankPercentile([1], 0)).toThrow('PERCENTILE_INVALID');
    expect(() => nearestRankPercentile([1, Number.NaN], 50)).toThrow('PERCENTILE_VALUE_INVALID');
  });
});

describe('summarizeFlowTurns', () => {
  it('counts calls and attempts per turn and keeps the full denominator', () => {
    const summary = summarizeFlowTurns([
      turn({calls: [{latencyMs: 1000, httpStatus: 200, errorCode: null}, {latencyMs: 3000, httpStatus: 200, errorCode: null}], attempts: 2, pipelineMs: 4200}),
      turn({caseId: 'A02', calls: [], attempts: 0, aiJob: false, pipelineMs: null, resultKind: null, endToEndMs: 900}),
      turn({caseId: 'A03', calls: [{latencyMs: 500, httpStatus: 429, errorCode: 'RATE_LIMITED'}], attempts: 1, restricted: true, reAsk: true, resultKind: 'CLARIFY'}),
    ]);
    expect(summary.turns).toBe(3);
    expect(summary.aiTurns).toBe(2);
    expect(summary.calls).toEqual({total: 3, perAITurnMean: 1.5, max: 2, failed: 1});
    expect(summary.attempts).toEqual({total: 3, perAITurnMean: 1.5, max: 2});
    expect(summary.pipelineLatencyMs).toEqual({p50: 1000, p95: 4200, n: 2});
    expect(summary.callLatencyMs).toEqual({p50: 1000, p95: 3000, n: 3});
    expect(summary.endToEndLatencyMs.n).toBe(3);
    expect(summary.restricted).toEqual({count: 1, denominator: 3, rate: 1 / 3});
    expect(summary.reAsk).toEqual({count: 1, denominator: 3, rate: 1 / 3});
    expect(summary.clarifyKind).toEqual({count: 1, denominator: 2, rate: 0.5});
    expect(summary.errorCodes).toEqual({RATE_LIMITED: 1});
  });

  it('treats an unreviewed restricted/re-ask label as missing, never as false', () => {
    const summary = summarizeFlowTurns([turn({restricted: null, reAsk: null}), turn()]);
    expect(summary.restricted).toEqual({count: 0, denominator: 1, rate: 0});
    expect(summary.unreviewedTurns).toBe(1);
  });
});

describe('judgeConversationFlowV2 (§7 criteria)', () => {
  const baseline = summarizeFlowTurns([
    turn({pipelineMs: 10_000, calls: [{latencyMs: 1, httpStatus: 200, errorCode: null}, {latencyMs: 1, httpStatus: 200, errorCode: null}, {latencyMs: 1, httpStatus: 200, errorCode: null}], attempts: 3}),
    turn({pipelineMs: 20_000, restricted: true}),
  ]);
  const scores = {trajectory: 28, trajectoryDenominator: 30, useful: 19, usefulDenominator: 20, authority: 10, authorityDenominator: 10, invariantViolations: 0};

  it('passes only when every criterion holds', () => {
    const candidate = summarizeFlowTurns([turn({pipelineMs: 5_000}), turn({pipelineMs: 8_000, restricted: true})]);
    const verdict = judgeConversationFlowV2({baseline, candidate, candidateScores: scores, p95ReductionRequired: 0.2});
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.every(check => check.pass)).toBe(true);
  });

  it('fails on quality, invariants, latency, calls, restricted and re-ask regressions', () => {
    const slower = summarizeFlowTurns([
      turn({pipelineMs: 19_000, calls: [{latencyMs: 1, httpStatus: 200, errorCode: null}, {latencyMs: 1, httpStatus: 200, errorCode: null}, {latencyMs: 1, httpStatus: 200, errorCode: null}], attempts: 3}),
      turn({pipelineMs: 19_000, restricted: true, reAsk: true, calls: Array.from({length: 3}, () => ({latencyMs: 1, httpStatus: 200, errorCode: null}))}),
      turn({pipelineMs: 1_000, restricted: true}),
    ]);
    const verdict = judgeConversationFlowV2({baseline, candidate: slower,
      candidateScores: {...scores, trajectory: 26, useful: 17, authority: 9, invariantViolations: 1}, p95ReductionRequired: 0.2});
    expect(verdict.pass).toBe(false);
    const failed = verdict.checks.filter(check => !check.pass).map(check => check.id).sort();
    expect(failed).toEqual(['AUTHORITY', 'INVARIANTS', 'MEAN_CALLS', 'P95_LATENCY', 'REASK_RATE', 'RESTRICTED_RATE', 'TRAJECTORY', 'USEFUL']);
  });

  it('fails closed when turns are unreviewed or denominators are not the frozen 30/20/10', () => {
    const candidate = summarizeFlowTurns([turn({pipelineMs: 1_000, restricted: null})]);
    const verdict = judgeConversationFlowV2({baseline, candidate,
      candidateScores: {...scores, trajectoryDenominator: 29}, p95ReductionRequired: 0.2});
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find(check => check.id === 'COMPLETE')?.pass).toBe(false);
  });
});
