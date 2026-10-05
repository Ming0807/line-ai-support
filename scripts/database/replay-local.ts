import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(resolve(process.cwd()),root,'WORKSPACE_ROOT_REQUIRED');
const container='supabase_db_line-ai-yru',database=`yru_v1_replay_${randomUUID().replaceAll('-','').slice(0,12)}`;
assert(/^yru_v1_replay_[a-f0-9]{12}$/.test(database),'DISPOSABLE_DATABASE_REQUIRED');
function command(args:string[],input?:string):string {
 return execFileSync('docker',['exec',...(input===undefined?[]:['-i']),container,...args],
  {encoding:'utf8',input,windowsHide:true,maxBuffer:16*1024*1024,timeout:60_000,stdio:['pipe','pipe','pipe']});
}
function sql(target:string,role:string,input:string):string {
 return command(['psql','-X','-At','-U',role,'-d',target,'-v','ON_ERROR_STOP=1'],input);
}
let created=false,stage='preflight';
try{
 assert.equal(sql('postgres','supabase_admin',`select count(*) from pg_database where datname='${database}';`).trim(),'0','DATABASE_MUST_NOT_EXIST');
 const auth=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=auth','--no-owner','--no-privileges']);
 assert(auth.includes('CREATE SCHEMA auth'),'AUTH_SCHEMA_BOOTSTRAP_REQUIRED');
 stage='create';sql('postgres','supabase_admin',`create database ${database} owner postgres;`);created=true;
 stage='bootstrap';sql(database,'supabase_admin',auth);
 sql(database,'supabase_admin',`create schema extensions; create extension vector with schema extensions;
  grant usage on schema auth,extensions to postgres,anon,authenticated,service_role; grant references on auth.users to postgres;`);
 const migrations=(await readdir(resolve(root,'supabase/migrations'))).filter(name=>/^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
 assert(migrations.length>0,'APPLICATION_MIGRATIONS_REQUIRED');
 for(const name of migrations){
  stage=`migration:${name}`;
  sql(database,'postgres',`begin;set local statement_timeout='10s';\n${await readFile(resolve(root,'supabase/migrations',name),'utf8')}\ncommit;`);
 }
 stage='foundation_RLS';sql(database,'supabase_admin',await readFile(resolve(root,'tests/database/foundation.sql'),'utf8'));
 console.log(JSON.stringify({stage:'application_migration_replay',migrations:migrations.length,foundationRLS:'PASS',status:'PASS',authDataCopied:false,existingDatabaseReset:false}));
}catch{
 console.error(JSON.stringify({stage,status:'FAIL'}));process.exitCode=1;
}finally{
 if(created){
  try{
   assert.equal(sql('postgres','supabase_admin',`select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='${database}';`).trim(),'postgres','DISPOSABLE_DATABASE_OWNER_CHANGED');
   sql('postgres','supabase_admin',`drop database ${database};`);
  }catch{console.error('DISPOSABLE_REPLAY_CLEANUP_FAILED');process.exitCode=1;}
 }
}
