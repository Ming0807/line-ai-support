import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
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
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(resolve(process.cwd()), root, 'WORKSPACE_ROOT_REQUIRED');
const args = process.argv.slice(2);
const seed = args.includes('--seed');
const testFile = args.find(arg => !arg.startsWith('--')) ?? '';
const relativeTest = relative(root, resolve(root, testFile)).replaceAll('\\', '/');
assert.match(relativeTest, /^tests\/database\/[a-z0-9-]+\.integration\.ts$/u, 'OWNED_TEST_FILE_REQUIRED');

const container = 'supabase_db_line-ai-yru';
const database = `yru_owned_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
assert.match(database, /^yru_owned_[a-f0-9]{12}$/u, 'DISPOSABLE_DATABASE_REQUIRED');

function command(args: string[], input?: string): string {
  return execFileSync('docker', ['exec', ...(input === undefined ? [] : ['-i']), container, ...args],
    {encoding: 'utf8', input, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe']});
}
function sql(target: string, role: string, input: string): string {
  return command(['psql', '-X', '-At', '-U', role, '-d', target, '-v', 'ON_ERROR_STOP=1'], input);
}

let created = false, stage = 'preflight';
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
  const run = spawnSync('pnpm', ['exec', 'tsx', '--conditions=react-server', '--test', '--test-concurrency=1', relativeTest],
    {cwd: root, env: {...process.env, YRU_OWNED_DATABASE: database}, stdio: 'inherit', shell: process.platform === 'win32'});
  if (run.status !== 0) process.exitCode = 1;
} catch (error) {
  // Disposable database only: the psql error line names the failing statement, never data.
  const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).split(/\r?\n/u).filter(line => /ERROR|DETAIL|HINT|CONTEXT/u.test(line)).slice(0, 6) : [];
  console.error(JSON.stringify({stage, status: 'FAIL', detail}));
  process.exitCode = 1;
} finally {
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
