import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createCallLedger, readCallLedger, reserveInferenceCall} from '../scripts/qa/conv-eval-call-ledger';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}); });
function ledgerPath() { const dir = mkdtempSync(join(tmpdir(), 'conv-ledger-')); dirs.push(dir); return join(dir, 'ledger.json'); }

describe('evaluation inference call ledger', () => {
  it('counts calls per flow and refuses at the cap without exceeding it', () => {
    const path = ledgerPath();
    createCallLedger(path, 3);
    reserveInferenceCall(path, 'baseline');
    reserveInferenceCall(path, 'baseline');
    reserveInferenceCall(path, 'v2');
    expect(() => reserveInferenceCall(path, 'v2')).toThrow('EVALUATION_CALL_BUDGET_EXHAUSTED');
    expect(() => reserveInferenceCall(path, 'baseline')).toThrow('EVALUATION_CALL_BUDGET_EXHAUSTED');
    expect(readCallLedger(path)).toEqual({cap: 3, used: 3, refused: 2, byFlow: {baseline: 2, v2: 1}});
  });

  it('never replaces an existing round ledger', () => {
    const path = ledgerPath();
    createCallLedger(path, 180);
    expect(() => createCallLedger(path, 180)).toThrow();
    expect(readCallLedger(path).cap).toBe(180);
  });
});
