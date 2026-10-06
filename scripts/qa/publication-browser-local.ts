import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {Client} from 'pg';
import {databaseConnection} from '../../lib/database/connection';
import {assertDevelopmentTarget} from '../../lib/database/development-target';

// Read existing DEVELOPMENT identities; all publication writes use this owned local database.
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
 supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,'tqgbodenouvcwepoxwbu');
const ids=credentials.accounts.map((account:{id:string})=>account.id);
assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);assert(ids.every((id:string)=>/^[a-f0-9-]{36}$/.test(id)));
const remote=new Client(databaseConnection(process.env.DIRECT_URL!));
await remote.connect();
let profiles;
try{
 profiles=(await remote.query(`select s.id,s.role,s.display_name,s.active,s.can_view_sensitive,s.can_view_restricted,d.code department_code
  from public.staff_profiles s left join public.departments d on d.id=s.department_id where s.id=any($1::uuid[])`,[ids])).rows;
 assert.equal(profiles.length,3);assert(profiles.every(profile=>profile.active));
 assert.equal(profiles.filter(profile=>profile.role==='SUPER_ADMIN').length,1);
 assert.equal(profiles.filter(profile=>profile.role==='STAFF').length,2);
}finally{await remote.end();}
const database='yru_publication_ui_qa_'+randomUUID().replaceAll('-','').slice(0,12);
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(database));
const container='supabase_db_line-ai-yru';
const command=(args:string[],input?:string)=>execFileSync('docker',['exec',...(input===undefined?[]:['-i']),container,...args],
 {encoding:'utf8',input,windowsHide:true,timeout:60_000,maxBuffer:16*1024*1024});
const sql=(target:string,role:string,input:string)=>command(['psql','-X','-At','-U',role,'-d',target,'-v','ON_ERROR_STOP=1'],input);
assert.equal(sql('postgres','supabase_admin',`select count(*) from pg_database where datname='${database}'`).trim(),'0');
const authSchema=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=auth','--no-owner','--no-privileges']);
assert(authSchema.includes('CREATE SCHEMA auth'));
sql('postgres','supabase_admin',`create database ${database} owner postgres;`);
sql(database,'supabase_admin',authSchema);
sql(database,'supabase_admin',`create schema extensions;create extension vector with schema extensions;
 grant usage on schema auth,extensions to postgres,anon,authenticated,service_role;grant references on auth.users to postgres;`);
const migrations=(await readdir('supabase/migrations')).filter(file=>/^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
for(const file of migrations)sql(database,'postgres',`begin;set local statement_timeout='10s';\n${await readFile('supabase/migrations/'+file,'utf8')}\ncommit;`);
sql(database,'postgres',await readFile('supabase/seed.sql','utf8'));
for(const id of ids)sql(database,'supabase_admin',`insert into auth.users(id) values('${id}');`);
const connectionString=`postgresql://postgres:postgres@127.0.0.1:54422/${database}`;
const local=new Client(databaseConnection(connectionString));await local.connect();
try{
 for(const profile of profiles)await local.query(`insert into public.staff_profiles(id,department_id,role,display_name,active,can_view_sensitive,can_view_restricted)
  values($1,(select id from public.departments where code=$2),$3,$4,true,$5,$6)`,
 [profile.id,profile.department_code,profile.role,profile.display_name,profile.can_view_sensitive,profile.can_view_restricted]);
 assert.equal((await local.query('select count(*)::int n from public.documents')).rows[0].n,0);
}finally{await local.end();}
const directory='.superpowers/staging/import-preview/publication-browser';await mkdir(directory,{recursive:true});
await writeFile(directory+'/runtime.json',JSON.stringify({database,connectionString,baseUrl:'http://localhost:3001',migrations:migrations.length,retained:true},null,2),{mode:0o600});
console.log(JSON.stringify({status:'PREPARED',isolatedLocalDatabase:true,profiles:profiles.length,migrations:migrations.length,remoteWrites:0,originalsWillBeRetained:true}));
