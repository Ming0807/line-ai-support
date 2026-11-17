import {readFileSync, writeFileSync} from 'node:fs';
import {z} from 'zod';

/**
 * Owner-approved inference budget for one comparison round (CONV-V2-00/06, DEC-195):
 * every provider inference request reserves one slot BEFORE it is sent; at the cap the
 * request is refused locally, so the round can never exceed the approved number of calls.
 * Evaluation cases run one process at a time, so a read-modify-write file is sufficient.
 */
const ledgerSchema = z.strictObject({
  cap: z.number().int().positive().max(1000),
  used: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
  byFlow: z.record(z.string().regex(/^[a-z0-9-]{1,20}$/u), z.number().int().nonnegative()),
});
export type CallLedger = z.infer<typeof ledgerSchema>;

export class InferenceBudgetExhausted extends Error {
  readonly code = 'EVALUATION_CALL_BUDGET_EXHAUSTED';
  constructor() { super('EVALUATION_CALL_BUDGET_EXHAUSTED'); }
}

export function createCallLedger(path: string, cap: number): CallLedger {
  const ledger = ledgerSchema.parse({cap, used: 0, refused: 0, byFlow: {}});
  writeFileSync(path, JSON.stringify(ledger, null, 2), {flag: 'wx'});
  return ledger;
}

export function readCallLedger(path: string): CallLedger {
  return ledgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Reserve one inference call for `flow`; throws without sending when the cap is reached. */
export function reserveInferenceCall(path: string, flow: string): CallLedger {
  const ledger = readCallLedger(path);
  if (ledger.used >= ledger.cap) {
    ledger.refused++;
    writeFileSync(path, JSON.stringify(ledger, null, 2));
    throw new InferenceBudgetExhausted();
  }
  const next = ledgerSchema.parse({...ledger, used: ledger.used + 1, byFlow: {...ledger.byFlow, [flow]: (ledger.byFlow[flow] ?? 0) + 1}});
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}
