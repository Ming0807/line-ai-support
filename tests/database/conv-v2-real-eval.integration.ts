import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

// CONV-V2-00/06 (DEC-195): opt-in real-model evaluation of ONE frozen case on this disposable database.
// Calls the configured Gemini FREE_ONLY model, so it runs only when the comparison runner sets
// YRU_CONV_V2_EVAL_ARGS and an owner-approved call ledger; a normal owned-test run skips it.
//   pnpm exec tsx scripts/qa/conv-v2-compare.ts   (drives scripts/database/run-owned-test.ts --seed --structured-name)
const raw = process.env.YRU_CONV_V2_EVAL_ARGS;
const database = process.env.YRU_STRUCTURED_SCHEMA_DATABASE;

test('CONV-V2 real-model frozen case on the owned disposable database', {skip: raw ? false : 'opt-in: needs YRU_CONV_V2_EVAL_ARGS and an approved call ledger'}, () => {
  assert.match(database ?? '', /^yru_structured_schema_[a-f0-9]{12}$/u, 'OWNED_STRUCTURED_DATABASE_REQUIRED');
  assert(process.env.YRU_CONV_EVAL_LEDGER, 'APPROVED_CALL_LEDGER_REQUIRED');
  const args = JSON.parse(raw!) as unknown;
  assert(Array.isArray(args) && args.every(arg => typeof arg === 'string' && /^--[a-z-]+(=[A-Za-z0-9,-]+)?$/u.test(arg)), 'EVALUATION_ARGUMENTS_INVALID');
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/qa/conv-v2-owned-eval.ts', '--synthetic', ...args],
    {env: process.env, encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024});
  process.stdout.write(run.stdout ?? '');
  process.stderr.write((run.stderr ?? '').split(/\r?\n/u).filter(line => line.startsWith('{')).join('\n'));
  assert.equal(run.status, 0, 'CONV_V2_CASE_BLOCKED_OR_FAILED');
});
