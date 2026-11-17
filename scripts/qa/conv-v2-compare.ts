import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {createCallLedger, readCallLedger} from './conv-eval-call-ledger';

/**
 * CONV-V2-00/06 comparison round (DEC-195). Runs the frozen 30 cases in fixture order for one flow,
 * each case on its own disposable database through scripts/database/run-owned-test.ts. One round
 * shares one owner-approved ledger (default 180 inference calls for both flows). No case is retried.
 * Stops the round at an actual 429, a 400/401/403 or an exhausted budget.
 *
 *   pnpm exec tsx scripts/qa/conv-v2-compare.ts --round=r1 --flow=baseline [--cap=180]
 *   pnpm exec tsx scripts/qa/conv-v2-compare.ts --round=r1 --flow=v2
 *
 * Needs the local Supabase container, local E5 and DOTENV_CONFIG_PATH (or ./.env) for the read-only registry.
 */
const argument = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const round = z.string().regex(/^[a-z0-9]{1,12}$/u).parse(argument('round'));
const flow = z.enum(['baseline', 'v2']).parse(argument('flow'));
const cap = z.coerce.number().int().min(1).max(180).parse(argument('cap') ?? '180');
const only = argument('cases')?.split(',');
const fixturePath = 'tests/fixtures/assistant-conversations.json';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(sha(fixturePath), 'e79ade32e0960df2e0399531d703e55955456caf7af432288ea919ae45e801f3', 'FROZEN_CONVERSATION_FIXTURE_CHANGED');
const scenarios = (JSON.parse(readFileSync(fixturePath, 'utf8')) as {scenarios: {id: string; turns: string[]}[]}).scenarios;
assert.equal(scenarios.length, 30, 'ORIGINAL_30_REQUIRED');
// Same per-case context modes as the main6 original-30 measurement (24 October 2026).
const official = ['A10', 'A11', 'A12', 'A13', 'A16', 'A18', 'B01'], rag = ['A14', 'A15'];
const owned = ['A17', 'B02', 'B03', 'B04', 'B05', 'B06', 'B08', 'B09', 'B10'];
const modeFor = (id: string) => official.includes(id) ? '--official-context' : rag.includes(id) ? '--rag-context' : owned.includes(id) ? '--owned-workflow-context' : null;
const dir = resolve('.superpowers/staging/conv-v2');
mkdirSync(dir, {recursive: true});
const ledgerPath = resolve(dir, `${round}-ledger.json`);
if (!existsSync(ledgerPath)) createCallLedger(ledgerPath, cap);
assert.equal(readCallLedger(ledgerPath).cap, cap, 'ROUND_CAP_IS_FIXED');
const runsPath = resolve(dir, `${round}-${flow}-runs.json`);
assert(!existsSync(runsPath) || only, 'NO_REPLACEMENT_RUN');
const sourceHashes = Object.fromEntries(['lib/ai/turn-flow-v2.ts', 'lib/knowledge/configured.ts', 'lib/ai/assistant-orchestrator.ts', 'lib/ai/assistant-decision.ts',
  'lib/knowledge/answer-producer.ts', 'lib/ai/run-worker.ts', 'lib/ai/gateway.ts', 'scripts/qa/conv-v2-owned-eval.ts', fixturePath].map(path => [path, sha(path)]));
const records: unknown[] = [];
let stopReason: string | null = null;
const save = () => writeFileSync(runsPath, JSON.stringify({round, flow, at: new Date().toISOString(), sourceHashes, ledger: readCallLedger(ledgerPath), stopReason, records}, null, 2));
for (const scenario of scenarios.filter(item => !only || only.includes(item.id))) {
  assert(Object.entries(sourceHashes).every(([path, hash]) => sha(path) === hash), 'SOURCE_CHANGED_DURING_ROUND');
  const started = Date.now(), tag = `${round}-${flow}-${scenario.id.toLowerCase()}`, mode = modeFor(scenario.id);
  const args = [`--cases=${scenario.id}`, `--flow=${flow}`, `--output-tag=${tag}`, ...(mode ? [mode] : [])];
  const run = spawnSync('pnpm', ['exec', 'tsx', 'scripts/database/run-owned-test.ts', '--seed', '--structured-name', 'tests/database/conv-v2-real-eval.integration.ts'],
    {env: {...process.env, YRU_CONV_V2_EVAL_ARGS: JSON.stringify(args), YRU_CONV_EVAL_LEDGER: ledgerPath}, encoding: 'utf8', windowsHide: true,
      timeout: 900_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32'});
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  writeFileSync(resolve(dir, `${tag}.log`), output);
  const artifactPath = resolve(dir, `${tag}.json`);
  const artifact = existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, 'utf8')) as {stopReason: string | null; records: {turns: unknown[]}[]} : null;
  const cleanup = output.includes('"stage":"owned_database_cleanup","status":"PASS"');
  const record = {caseId: scenario.id, mode, exit: run.status, cleanup, artifact: artifact ? tag : null, stopReason: artifact?.stopReason ?? (artifact ? null : 'ARTIFACT_MISSING'),
    turns: artifact?.records[0]?.turns.length ?? 0, ms: Date.now() - started, ledgerUsed: readCallLedger(ledgerPath).used};
  records.push(record);
  console.log(JSON.stringify(record));
  if (!cleanup) stopReason = 'DISPOSABLE_CLEANUP_NOT_PROVEN';
  if (record.stopReason && ['ACTUAL_429_NO_RETRY', 'PROTOCOL_AUTH_NO_RETRY', 'APPROVED_CALL_BUDGET_EXHAUSTED', 'EVALUATION_CALL_BUDGET_EXHAUSTED'].includes(record.stopReason)) stopReason = record.stopReason;
  save();
  if (stopReason) break;
  // Naturally sequential, no burst against the Free account (same 30 s spacing as main6).
  const remain = 30_000 - (Date.now() - started);
  if (remain > 0) await new Promise(done => setTimeout(done, remain));
}
save();
if (stopReason) process.exitCode = 1;
