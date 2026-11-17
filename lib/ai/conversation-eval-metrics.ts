/**
 * CONV-V2-00/06 (DEC-195): per-turn call/latency summary and the §7 comparison verdict
 * for the frozen 30-case evaluation. Pure functions over already-recorded, synthetic
 * evaluation rows; no transcript text, model output or credential is accepted or returned.
 */

export interface FlowEvalCall {
  /** Wall time of one provider HTTP request (an inference call), including failures. */
  latencyMs: number;
  httpStatus: number | null;
  errorCode: string | null;
}

export interface FlowEvalTurn {
  caseId: string;
  turnIndex: number;
  /** Decoded AI job result kind; null when no AI job ran (fixed reply, HUMAN route, choice). */
  resultKind: string | null;
  aiJob: boolean;
  /** AI worker time for this turn's job (claim to finished result), excluding the input window. */
  pipelineMs: number | null;
  /** LINE event persisted to final delivery attempt, including the input window. */
  endToEndMs: number;
  calls: FlowEvalCall[];
  /** Gateway attempts recorded in the durable turn budget (includes routing). */
  attempts: number;
  /** Reviewer label: a fixed/limited reply instead of the requested help. null = not reviewed. */
  restricted: boolean | null;
  /** Reviewer label: the reply asks the Student for information instead of answering. */
  reAsk: boolean | null;
}

export interface Rate {count: number; denominator: number; rate: number}
export interface Percentiles {p50: number | null; p95: number | null; n: number}

export interface FlowSummary {
  turns: number;
  aiTurns: number;
  unreviewedTurns: number;
  calls: {total: number; perAITurnMean: number; max: number; failed: number};
  attempts: {total: number; perAITurnMean: number; max: number};
  pipelineLatencyMs: Percentiles;
  endToEndLatencyMs: Percentiles;
  callLatencyMs: Percentiles;
  restricted: Rate;
  reAsk: Rate;
  clarifyKind: Rate;
  errorCodes: Record<string, number>;
}

/** Nearest-rank percentile (no interpolation): the smallest value with at least p% at or below it. */
export function nearestRankPercentile(values: readonly number[], percentile: number): number | null {
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) throw new Error('PERCENTILE_INVALID');
  if (values.some(value => !Number.isFinite(value))) throw new Error('PERCENTILE_VALUE_INVALID');
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percentile / 100) * sorted.length) - 1]!;
}

function percentiles(values: number[]): Percentiles {
  return {p50: nearestRankPercentile(values, 50), p95: nearestRankPercentile(values, 95), n: values.length};
}

function rate(count: number, denominator: number): Rate {
  return {count, denominator, rate: denominator === 0 ? 0 : count / denominator};
}

const mean = (total: number, count: number) => (count === 0 ? 0 : total / count);

export function summarizeFlowTurns(turns: readonly FlowEvalTurn[]): FlowSummary {
  const aiTurns = turns.filter(turn => turn.aiJob);
  const reviewed = turns.filter(turn => turn.restricted !== null && turn.reAsk !== null);
  const allCalls = turns.flatMap(turn => turn.calls);
  const errorCodes: Record<string, number> = {};
  for (const call of allCalls) if (call.errorCode) errorCodes[call.errorCode] = (errorCodes[call.errorCode] ?? 0) + 1;
  const callTotal = allCalls.length, attemptTotal = turns.reduce((sum, turn) => sum + turn.attempts, 0);
  return {
    turns: turns.length,
    aiTurns: aiTurns.length,
    unreviewedTurns: turns.length - reviewed.length,
    calls: {total: callTotal, perAITurnMean: mean(callTotal, aiTurns.length), max: Math.max(0, ...turns.map(turn => turn.calls.length)),
      failed: allCalls.filter(call => call.errorCode !== null || call.httpStatus === null || call.httpStatus >= 400).length},
    attempts: {total: attemptTotal, perAITurnMean: mean(attemptTotal, aiTurns.length), max: Math.max(0, ...turns.map(turn => turn.attempts))},
    pipelineLatencyMs: percentiles(aiTurns.flatMap(turn => (turn.pipelineMs === null ? [] : [turn.pipelineMs]))),
    endToEndLatencyMs: percentiles(turns.map(turn => turn.endToEndMs)),
    callLatencyMs: percentiles(allCalls.map(call => call.latencyMs)),
    restricted: rate(reviewed.filter(turn => turn.restricted === true).length, reviewed.length),
    reAsk: rate(reviewed.filter(turn => turn.reAsk === true).length, reviewed.length),
    clarifyKind: rate(aiTurns.filter(turn => turn.resultKind === 'CLARIFY').length, aiTurns.length),
    errorCodes,
  };
}

export interface CandidateScores {
  trajectory: number; trajectoryDenominator: number;
  useful: number; usefulDenominator: number;
  authority: number; authorityDenominator: number;
  /** Wrong recipient, unauthorized tool effect, AI reply in HUMAN, invented official data. */
  invariantViolations: number;
}

export interface VerdictCheck {id: string; pass: boolean; detail: string}

/**
 * §7 of LINE_CONVERSATION_FLOW_V2_DESIGN.md. Thresholds are the frozen 27/30, 18/20 and 10/10;
 * the p95 reduction must be fixed from the baseline before the candidate run is read.
 * Unreviewed turns or wrong denominators fail closed.
 */
export function judgeConversationFlowV2(input: {baseline: FlowSummary; candidate: FlowSummary; candidateScores: CandidateScores; p95ReductionRequired: number}):
  {pass: boolean; checks: VerdictCheck[]} {
  const {baseline, candidate, candidateScores: s} = input;
  if (!(input.p95ReductionRequired > 0 && input.p95ReductionRequired < 1)) throw new Error('P95_REDUCTION_INVALID');
  const baseP95 = baseline.pipelineLatencyMs.p95, candP95 = candidate.pipelineLatencyMs.p95;
  const p95Limit = baseP95 === null ? null : baseP95 * (1 - input.p95ReductionRequired);
  const checks: VerdictCheck[] = [
    {id: 'COMPLETE', pass: s.trajectoryDenominator === 30 && s.usefulDenominator === 20 && s.authorityDenominator === 10
      && candidate.unreviewedTurns === 0 && baseline.unreviewedTurns === 0,
    detail: `denominators ${s.trajectoryDenominator}/${s.usefulDenominator}/${s.authorityDenominator}; unreviewed turns baseline ${baseline.unreviewedTurns}, candidate ${candidate.unreviewedTurns}`},
    {id: 'TRAJECTORY', pass: s.trajectory >= 27, detail: `${s.trajectory}/${s.trajectoryDenominator} (need ≥27)`},
    {id: 'USEFUL', pass: s.useful >= 18, detail: `${s.useful}/${s.usefulDenominator} (need ≥18)`},
    {id: 'AUTHORITY', pass: s.authority === s.authorityDenominator && s.authorityDenominator === 10, detail: `${s.authority}/${s.authorityDenominator} (need 10/10)`},
    {id: 'INVARIANTS', pass: s.invariantViolations === 0, detail: `${s.invariantViolations} violation(s) (need 0)`},
    {id: 'P95_LATENCY', pass: p95Limit !== null && candP95 !== null && candP95 <= p95Limit,
      detail: `candidate p95 ${candP95 ?? 'n/a'} ms vs baseline ${baseP95 ?? 'n/a'} ms (need ≤ ${p95Limit === null ? 'n/a' : Math.round(p95Limit)} ms)`},
    {id: 'MEAN_CALLS', pass: candidate.calls.perAITurnMean <= 2, detail: `${candidate.calls.perAITurnMean.toFixed(2)} calls per AI turn (need ≤2)`},
    {id: 'RESTRICTED_RATE', pass: candidate.restricted.rate <= baseline.restricted.rate,
      detail: `${candidate.restricted.count}/${candidate.restricted.denominator} vs baseline ${baseline.restricted.count}/${baseline.restricted.denominator}`},
    {id: 'REASK_RATE', pass: candidate.reAsk.rate <= baseline.reAsk.rate,
      detail: `${candidate.reAsk.count}/${candidate.reAsk.denominator} vs baseline ${baseline.reAsk.count}/${baseline.reAsk.denominator}`},
  ];
  return {pass: checks.every(check => check.pass), checks};
}
