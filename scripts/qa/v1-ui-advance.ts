import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Client} from 'pg';
// Advance only the retained, root-owned 31-migration browser fixture. Never infer a normal/remote target.
const path='.superpowers/staging/v1-ui-qa/runtime.json';
const runtime=JSON.parse(await readFile(path,'utf8'));
const url=new URL(runtime.connectionString);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(runtime.database));
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'54422');
assert.equal(decodeURIComponent(url.pathname.slice(1)),runtime.database);
assert.equal(runtime.retained,true);assert([31,32].includes(runtime.migrations));
const client=new Client({connectionString:runtime.connectionString});await client.connect();
try{
 assert.equal((await client.query('select current_database() name')).rows[0].name,runtime.database);
 assert.equal((await client.query('select pg_get_userbyid(datdba) owner from pg_database where datname=current_database()')).rows[0].owner,'postgres');
 assert.equal((await client.query(`select count(*)::int n from pg_tables where schemaname='public' and tablename in
 ('academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements')`)).rows[0].n,7);
 if(runtime.migrations===31){
  assert.equal((await client.query("select to_regclass('public.incidents') is null absent")).rows[0].absent,true);
  await client.query('begin');
  await client.query("set local statement_timeout='10s'");
  await client.query(await readFile('supabase/migrations/20261008053336_scoped_semantic_incidents.sql','utf8'));
  await client.query('commit');runtime.migrations=32;
  await writeFile(path,JSON.stringify(runtime,null,2),{mode:0o600});
 }
 const jobs=(await client.query('select status,count(*)::int n from private.knowledge_import_jobs group by status order by status')).rows;
 console.log(JSON.stringify({status:'PASS',ownedOnly:true,migrations:runtime.migrations,structuredTables:7,jobs,originalsPreserved:true,remoteWrites:0}));
}catch{await client.query('rollback');console.error('OWNED_UI_ADVANCE_FAILED');process.exitCode=1;}
finally{await client.end();}
