import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {readFile, readdir} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Runs one PostgreSQL integration test file against a fresh disposable database that replays
 * every application migration (same bootstrap as replay-local.ts), then drops it.
 * The test reads the database name from YRU_OWNED_DATABASE. No existing database is changed.
 *
 *   pnpm exec tsx scripts/database/run-owned-test.ts tests/database/section-expansion.integration.ts
 *
 * Pass --seed to apply supabase/seed.sql (reference departments) after the migrations.
 * Pass --structured-name for older tests that read YRU_STRUCTURED_SCHEMA_DATABASE: the disposable
 * database is then named yru_structured_schema_<hex> and both variables point to it.
 * Pass --http-server to run one of the loopback HTTP QA harnesses (scripts/qa/{durable-line,ticket-flow,rag-flow}-http.ts):
 * a `next dev` server is started on 127.0.0.1:3001 with DATABASE_URL pointing at the same disposable database,
 * the harness runs as a plain script, then the server is stopped and the database dropped. Stop `pnpm local:*` first:
 * both use the project's .next directory.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(resolve(process.cwd()), root, 'WORKSPACE_ROOT_REQUIRED');
const args = process.argv.slice(2);
const seed = args.includes('--seed');
const structuredName = args.includes('--structured-name');
const httpServer = args.includes('--http-server');
const testFile = args.find(arg => !arg.startsWith('--')) ?? '';
const relativeTest = relative(root, resolve(root, testFile)).replaceAll('\\', '/');
if (httpServer) {
  assert(!structuredName, 'HTTP_SERVER_USES_OWNED_NAME');
  assert.match(relativeTest, /^scripts\/qa\/(?:durable-line|ticket-flow|rag-flow)-http\.ts$/u, 'OWNED_HTTP_QA_FILE_REQUIRED');
} else {
  assert.match(relativeTest, /^tests\/database\/[a-z0-9-]+\.integration\.ts$/u, 'OWNED_TEST_FILE_REQUIRED');
}

const container = 'supabase_db_line-ai-yru';
const database = `${structuredName ? 'yru_structured_schema_' : 'yru_owned_'}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
assert.match(database, /^yru_(?:owned|structured_schema)_[a-f0-9]{12}$/u, 'DISPOSABLE_DATABASE_REQUIRED');

function command(args: string[], input?: string): string {
  return execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), container, ...args],
    {encoding: 'utf8', input, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe']});
}
function sql(target: string, role: string, input: string): string {
  return command(['psql', '-X', '-At', '-U', role, '-d', target, '-v', 'ON_ERROR_STOP=1'], input);
}

const HTTP_PORT = 3001, HTTP_BASE = `http://127.0.0.1:${HTTP_PORT}`;
function portOpen(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = createConnection({host: '127.0.0.1', port});
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
  });
}
async function startHttpServer(ownedUrl: string): Promise<{server: ChildProcess; log: string}> {
  assert(!await portOpen(HTTP_PORT), 'OWNED_HTTP_PORT_3001_IN_USE');
  // Server output stays in a temp file (never printed): request logs are not evidence and may name fixtures.
  const log = resolve(tmpdir(), `yru-owned-http-${database}.log`), out = createWriteStream(log);
  // Same settings as scripts/qa/local-http-server.mjs, but every database URL is the disposable one.
  const server = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--port', String(HTTP_PORT), '--hostname', '127.0.0.1'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, DATABASE_URL: ownedUrl, DIRECT_URL: ownedUrl, APP_BASE_URL: HTTP_BASE, LINE_WEBHOOK_MODE: 'durable', YRU_AI_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1'},
  });
  server.stdout?.pipe(out); server.stderr?.pipe(out);
  let exited = false; server.once('exit', () => { exited = true; });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assert(!exited, 'OWNED_HTTP_SERVER_EXITED');
    try {
      // Any HTTP status means the server is up and the webhook route compiled; the GET has no effect.
      await fetch(`${HTTP_BASE}/api/line/student/webhook`, {signal: AbortSignal.timeout(60_000)});
      return {server, log};
    } catch { await new Promise(done => setTimeout(done, 1_000)); }
  }
  throw new Error('OWNED_HTTP_SERVER_START_TIMEOUT');
}
function stopHttpServer(server: ChildProcess | undefined): void {
  if (!server?.pid || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  else server.kill('SIGTERM');
}

let created = false, stage = 'preflight', http: {server: ChildProcess; log: string} | undefined;
try {
  assert.equal(sql('postgres', 'supabase_admin', `select count(*) from pg_database where datname='${database}';`).trim(), '0', 'DATABASE_MUST_NOT_EXIST');
  const auth = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--schema=auth', '--no-owner', '--no-privileges']);
  assert(auth.includes('CREATE SCHEMA auth'), 'AUTH_SCHEMA_BOOTSTRAP_REQUIRED');
  stage = 'create';
  sql('postgres', 'supabase_admin', `create database ${database} owner postgres;`);
  created = true;
  stage = 'bootstrap';
  sql(database, 'supabase_admin', auth);
  sql(database, 'supabase_admin', `create schema extensions; create extension vector with schema extensions;
  grant usage on schema auth,extensions to postgres,anon,authenticated,service_role; grant references on auth.users,auth.identities to postgres;
  -- Disposable database only: fixtures create their own Auth users for Staff profiles.
  grant select,insert,update,delete on auth.users,auth.identities to postgres;`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations'))).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  assert(migrations.length > 0, 'APPLICATION_MIGRATIONS_REQUIRED');
  for (const name of migrations) {
    stage = `migration:${name}`;
    sql(database, 'postgres', `begin;set local statement_timeout='10s';\n${await readFile(resolve(root, 'supabase/migrations', name), 'utf8')}\ncommit;`);
  }
  if (seed) {
    stage = 'seed';
    sql(database, 'postgres', `begin;set local statement_timeout='10s';
${await readFile(resolve(root, 'supabase/seed.sql'), 'utf8')}
commit;`);
  }
  stage = 'test';
  console.log(JSON.stringify({stage: 'owned_database_ready', migrations: migrations.length, seeded: seed, test: relativeTest}));
  if (httpServer) {
    stage = 'http_server';
    http = await startHttpServer(`postgresql://postgres:postgres@127.0.0.1:54422/${database}`);
    console.log(JSON.stringify({stage: 'owned_http_server_ready', base: HTTP_BASE}));
    stage = 'test';
  }
  const run = httpServer
    ? spawnSync('pnpm', ['exec', 'tsx', '--conditions=react-server', relativeTest],
      {cwd: root, env: {...process.env, YRU_OWNED_DATABASE: database, LINE_WEBHOOK_MODE: 'durable', LINE_TEST_BASE_URL: HTTP_BASE}, stdio: 'inherit', shell: process.platform === 'win32'})
    : spawnSync('pnpm', ['exec', 'tsx', '--conditions=react-server', '--test', '--test-concurrency=1', relativeTest],
      {cwd: root, env: {...process.env, YRU_OWNED_DATABASE: database, ...(structuredName ? {YRU_STRUCTURED_SCHEMA_DATABASE: database} : {})}, stdio: 'inherit', shell: process.platform === 'win32'});
  if (run.status !== 0) process.exitCode = 1;
} catch (error) {
  // Disposable database only: the psql error line names the failing statement, never data.
  const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).split(/\r?\n/u).filter(line => /ERROR|DETAIL|HINT|CONTEXT/u.test(line)).slice(0, 6) : [];
  console.error(JSON.stringify({stage, status: 'FAIL', detail}));
  process.exitCode = 1;
} finally {
  if (http) {
    stopHttpServer(http.server);
    console.log(JSON.stringify({stage: 'owned_http_server_stopped', log: http.log}));
  }
  if (created) {
    try {
      assert.equal(sql('postgres', 'supabase_admin', `select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='${database}';`).trim(), 'postgres', 'DISPOSABLE_DATABASE_OWNER_CHANGED');
      sql('postgres', 'supabase_admin', `drop database ${database} with (force);`);
      assert.equal(sql('postgres', 'supabase_admin', `select count(*) from pg_database where datname='${database}';`).trim(), '0', 'DISPOSABLE_DATABASE_NOT_DROPPED');
      console.log(JSON.stringify({stage: 'owned_database_cleanup', status: 'PASS'}));
    } catch {
      console.error('OWNED_DATABASE_CLEANUP_FAILED');
      process.exitCode = 1;
    }
  }
}
