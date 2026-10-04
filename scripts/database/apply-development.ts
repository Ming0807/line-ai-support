import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { databaseConnection } from '../../lib/database/connection';
import { assertDevelopmentTarget } from '../../lib/database/development-target';
import { applicationTables } from '../../lib/database/migration-manifest';

// Explicitly selected by the human for development, not inferred from credentials.
const expectedRef = 'tqgbodenouvcwepoxwbu';
assertDevelopmentTarget({ environment: process.env.YRU_DEPLOYMENT_ENV,
  projectRef: process.env.DEV_SUPABASE_PROJECT_REF, supabaseUrl: process.env.SUPABASE_URL,
  directUrl: process.env.DIRECT_URL }, expectedRef);
const connection = process.env.DIRECT_URL!;
const files = readdirSync('supabase/migrations').filter(file => /^\d{14}_.+\.sql$/.test(file)).sort();
const versions = files.map(file => file.slice(0,14));
const expectedTables = new Set(files.flatMap(file => applicationTables(readFileSync(resolve('supabase/migrations',file),'utf8'))));
const secrets = Object.entries(process.env).filter(([key,value]) => value && /KEY|TOKEN|SECRET|DATABASE_URL|DIRECT_URL/.test(key))
  .map(([,value]) => value!);
secrets.push(decodeURIComponent(new URL(connection).password));
function safeOutput(value:string) {
  for (const secret of secrets.sort((a,b)=>b.length-a.length)) value=value.split(secret).join('[REDACTED]');
  return value.replace(/postgres(?:ql)?:\/\/\S+/gi,'[REDACTED_DATABASE_URL]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED_JWT]');
}

async function inspect() {
  const client=new Client(databaseConnection(connection));
  try {
    await client.connect();
    await client.query('begin read only');
    const tables=await client.query("select schemaname||'.'||tablename as name, rowsecurity from pg_tables where schemaname in ('public','private') order by 1");
    const exists=await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null as exists");
    const history=exists.rows[0].exists ? await client.query('select version from supabase_migrations.schema_migrations order by version') : {rows:[]};
    const applied:string[]=history.rows.map(row=>row.version);
    if(applied.some(version=>!versions.includes(version))) throw new Error('UNEXPECTED_MIGRATION_HISTORY');
    if(tables.rows.some(row=>!expectedTables.has(row.name))) throw new Error('UNEXPECTED_APPLICATION_TABLE');
    if(tables.rows.length && !applied.length) throw new Error('UNTRACKED_APPLICATION_SCHEMA');
    await client.query('rollback');
    return {tables:tables.rows,applied,pending:versions.filter(version=>!applied.includes(version))};
  } finally { await client.end(); }
}

async function cli(dryRun:boolean) {
  const url=new URL(connection);
  for(const key of ['pgbouncer','ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat']) url.searchParams.delete(key);
  url.searchParams.set('sslmode','verify-full');
  if(process.env.DATABASE_SSL_CA_PATH) url.searchParams.set('sslrootcert',resolve(process.env.DATABASE_SSL_CA_PATH).replaceAll('\\','/'));
  const pnpm=process.env.PNPM_CLI_PATH ?? resolve(process.env.APPDATA ?? '', 'npm/node_modules/pnpm/bin/pnpm.cjs');
  const args=[pnpm,'dlx','supabase@2.119.0','db','push','--db-url',url.toString(),'--skip-vault','--yes',...(dryRun?['--dry-run']:[])];
  await new Promise<void>((accept,reject)=>{
    const child=spawn(process.execPath,args,{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',chunk=>{output+=chunk.toString();});
    child.stderr.on('data',chunk=>{output+=chunk.toString();});
    child.once('error',()=>reject(new Error('MIGRATION_CLI_START_FAILED')));
    child.once('close',code=>{
      console.log(safeOutput(output).trim());
      if(code===0) accept(); else reject(new Error('MIGRATION_CLI_FAILED'));
    });
  });
}

try {
  const before=await inspect();
  console.log(JSON.stringify({stage:'development_preflight',applied:before.applied,pending:before.pending,tableCount:before.tables.length}));
  await cli(true);
  if(process.argv.includes('--apply')) {
    await cli(false);
    const after=await inspect();
    if(after.pending.length || after.tables.length!==expectedTables.size || after.tables.some(row=>!row.rowsecurity)) {
      throw new Error('DEVELOPMENT_SCHEMA_VERIFICATION_FAILED');
    }
    const client=new Client(databaseConnection(connection));
    try {
      await client.connect();
      // Insert initial departments only; preserve any pre-existing remote values.
      const seed=readFileSync('supabase/seed.sql','utf8').replace(/on conflict\(code\) do update[\s\S]*;\s*$/i,'on conflict(code) do nothing;');
      await client.query(seed);
      const departments=await client.query('select count(*)::int as count from public.departments');
      console.log(JSON.stringify({stage:'development_verified',migrationCount:after.applied.length,tableCount:after.tables.length,allRls:true,departmentCount:departments.rows[0].count}));
    } finally { await client.end(); }
  }
} catch(error) {
  const message=error instanceof Error?error.message:'';
  console.error(JSON.stringify({stage:'development_failed',code:/^[A-Z_]+$/.test(message)?message:'DATABASE_OR_CLI_ERROR'}));
  process.exitCode=1;
}
