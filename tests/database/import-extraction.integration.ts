import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,getImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction,getImportPreview} from '../../lib/imports/import-extraction';
import {createImportSource} from '../../lib/imports/source';
import {parseHtmlSource as parseHtml} from '../../lib/imports/html-parser';
import {createMalformedPdfFixture} from '../fixtures/import-pdf';
const options={connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5};
async function fixture(work:(pool:Pool,actor:string,staff:string,key:string)=>Promise<void>){
 const pool=new Pool({...options,application_name:`import-extraction-${randomUUID()}`}),actor=randomUUID(),staff=randomUUID(),key=randomBytes(32).toString('base64');
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Extraction fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await work(pool,actor,staff,key);
 }finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
function source(){return createImportSource({bytes:Buffer.from(`<html><h1>คู่มือ WiFi ${randomUUID()}</h1><p>วิธีเชื่อมต่อเครือข่ายมหาวิทยาลัย</p></html>`),filename:'guide.html',mimeType:'text/html',sourceUrl:'https://nse.yru.ac.th/guide',acquiredFrom:'UPLOAD',fetchedAt:null});}
test('private immutable extraction revisions enforce RLS, browser denial and limited server privileges',async()=>{
 const pool=new Pool(options);
 try{
  const row=(await pool.query(`select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') browser_access,
   has_table_privilege('service_role',c.oid,'SELECT') server_read,has_table_privilege('service_role',c.oid,'INSERT') server_append,
   has_table_privilege('service_role',c.oid,'UPDATE,DELETE') server_modify
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='knowledge_import_revisions'`)).rows[0];
  assert(row,'EXTRACTION_SCHEMA_REQUIRED');assert(row.relrowsecurity&&!row.anon_access&&!row.browser_access&&row.server_read&&row.server_append&&!row.server_modify);
  for(const role of ['anon','authenticated']){const client=await pool.connect();try{await client.query('begin');await client.query(`set local role ${role}`);await assert.rejects(client.query('select extraction_encrypted from private.knowledge_import_revisions'),{code:'42501'});}finally{await client.query('rollback');client.release();}}
 }finally{await pool.end();}
});
test('analyze uses real supervised HTML parser outside transactions and persists encrypted located preview without publishing',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),config={pool,key,originalBackend:'PRIVATE_DATABASE' as const};
 const {job}=await createImportJob(actor,input,config),before=(await pool.query('select count(*)::int n from public.documents')).rows[0].n;
 const preview=await analyzeImportJob(actor,job.id,0,config);
 assert.equal(preview.job.revision,1);assert.equal(preview.extractionRevision,1);assert.equal(preview.kind,'PARSED');
 assert(preview.extraction.pages.some(page=>page.text.includes('วิธีเชื่อมต่อ')));assert(preview.extraction.locations.pages.every(location=>location.kind==='HTML'));
 assert.equal(preview.analysis.approved,false);assert.equal(preview.analysis.effectiveFrom,null);
 const row=(await pool.query('select * from private.knowledge_import_revisions where job_id=$1',[job.id])).rows[0];
 assert(!row.extraction_encrypted.includes('วิธีเชื่อมต่อ'));assert(!row.analysis_encrypted.includes('WIFI_GUIDE'));
 assert.equal((await pool.query('select count(*)::int n from public.documents')).rows[0].n,before);
 assert.deepEqual(await getImportPreview(actor,job.id,config),preview);
 const json=JSON.stringify(preview);for(const hidden of ['extraction_encrypted','analysis_encrypted','original_id','checksum','storage_object'])assert(!json.includes(hidden));
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,job.id,config)).bytes),Buffer.from(input.bytes));
}));
test('unauthorized actors are denied before parser, original access and preview disclosure',()=>fixture(async(pool,actor,staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);let calls=0;
 for(const denied of [staff,randomUUID(),'invalid']){
  await assert.rejects(analyzeImportJob(denied,job.id,0,{...config,parse:async input=>{calls++;return parseHtml(input);}}),{code:'FORBIDDEN'});
  await assert.rejects(getImportPreview(denied,job.id,config),{code:'FORBIDDEN'});
  await assert.rejects(editImportExtraction(denied,job.id,0,{},config),{code:'FORBIDDEN'});
 }
 assert.equal(calls,0);
}));
test('parser and analysis occur after committed snapshot and actor deactivation blocks final append',()=>fixture(async(pool,actor,_staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);
 await assert.rejects(analyzeImportJob(actor,job.id,0,{...config,parse:async input=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[pool.options.application_name])).rows[0].n,0);
  await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);return parseHtml(input);
 }}),{code:'FORBIDDEN'});
 assert.equal((await pool.query('select revision from private.knowledge_import_jobs where id=$1',[job.id])).rows[0].revision,0);
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_revisions where job_id=$1',[job.id])).rows[0].n,0);
}));
test('concurrent analyzed snapshots have one append winner and stale revision fails before reparse',()=>fixture(async(pool,actor,_staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);
 let entered=0,release:()=>void=()=>undefined;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const parse=async(input:ReturnType<typeof source>)=>{entered++;if(entered===2)release();await barrier;return parseHtml(input);};
 const results=await Promise.allSettled([analyzeImportJob(actor,job.id,0,{...config,parse}),analyzeImportJob(actor,job.id,0,{...config,parse})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const loser=results.find(result=>result.status==='rejected');assert(loser?.status==='rejected');assert.equal(loser.reason.code,'CONFLICT');
 await assert.rejects(analyzeImportJob(actor,job.id,0,{...config,parse}),{code:'CONFLICT'});assert.equal(entered,2);
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_revisions where job_id=$1',[job.id])).rows[0].n,1);
}));
test('edits append immutable encrypted history, retain locations and rerun sensitivity without changing original',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,input,config);
 const first=await analyzeImportJob(actor,job.id,0,config);
 const edited=await editImportExtraction(actor,job.id,1,{reason:'แก้ข้อความที่อ่านผิด',pages:[{index:0,text:'เบอร์ติดต่อส่วนบุคคล 0812345678'}]},config);
 assert.equal(edited.job.revision,2);assert.equal(edited.kind,'EDITED');assert.deepEqual(edited.extraction.locations,first.extraction.locations);assert(edited.analysis.sensitiveRisk);
 assert.equal(edited.edit?.reason,'แก้ข้อความที่อ่านผิด');assert(edited.extraction.pages[0].requiresReview);assert(edited.extraction.report.warnings.every(warning=>warning.disposition==='UNRESOLVED'));
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_revisions where job_id=$1',[job.id])).rows[0].n,2);
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,job.id,config)).bytes),Buffer.from(input.bytes));
 await assert.rejects(editImportExtraction(actor,job.id,1,{reason:'stale',pages:[{index:0,text:'old'}]},config),{code:'CONFLICT'});
 await assert.rejects(pool.query("update private.knowledge_import_revisions set kind='EDITED' where job_id=$1 and revision=1",[job.id]),{code:'23514'});
 const audit=(await pool.query("select metadata from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_EDITED'",[actor])).rows[0].metadata;
 assert.deepEqual(audit,{importJobId:job.id,revision:2});assert(!JSON.stringify(audit).includes('0812345678'));
}));
test('known parse failure retains original and prior preview/history; retry can analyze at current failed revision',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,input,config);
 await analyzeImportJob(actor,job.id,0,config);
 await assert.rejects(analyzeImportJob(actor,job.id,1,{...config,parse:async()=>{throw new Error('IMPORT_PARSE_INVALID');}}),{code:'INVALID_REQUEST'});
 const failed=await getImportJob(actor,job.id,config);assert.equal(failed.status,'FAILED');assert.equal(failed.revision,2);
 const receipt=(await pool.query("select metadata from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_FAILED'",[actor])).rows[0].metadata;
 assert.deepEqual(receipt,{importJobId:job.id,errorCode:'IMPORT_PARSE_INVALID',revision:2});
 const retained=await getImportPreview(actor,job.id,config);assert.equal(retained.extractionRevision,1);assert.equal(retained.job.revision,2);
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,job.id,config)).bytes),Buffer.from(input.bytes));
 const retried=await analyzeImportJob(actor,job.id,2,config);assert.equal(retried.job.status,'READY');assert.equal(retried.extractionRevision,3);
}));
test('failure after revision and job writes rolls back both and leaves no analysis audit',()=>fixture(async(pool,actor,_staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);
 const suffix=actor.replaceAll('-',''),name=`test_import_audit_${suffix}`;
 try{
  await pool.query(`create function private.${name}() returns trigger language plpgsql security invoker set search_path='' as $$ begin raise exception using errcode='23514',message='CONTROLLED_AUDIT_FAILURE'; end; $$`);
  await pool.query(`create trigger ${name} before insert on private.activities for each row when (new.actor_id='${actor}'::uuid and new.action='KNOWLEDGE_IMPORT_ANALYZED') execute function private.${name}()`);
  await assert.rejects(analyzeImportJob(actor,job.id,0,config),{code:'INTERNAL_ERROR'});
  assert.equal((await getImportJob(actor,job.id,config)).revision,0);
  assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_revisions where job_id=$1',[job.id])).rows[0].n,0);
  assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_ANALYZED'",[actor])).rows[0].n,0);
 }finally{
  await pool.query(`drop trigger if exists ${name} on private.activities`);await pool.query(`drop function if exists private.${name}()`);
 }
}));
test('parallel text edits produce one immutable winner and preserve exact prior ciphertext',()=>fixture(async(pool,actor,_staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);await analyzeImportJob(actor,job.id,0,config);
 const before=(await pool.query('select extraction_encrypted,analysis_encrypted from private.knowledge_import_revisions where job_id=$1 and revision=1',[job.id])).rows[0];
 const results=await Promise.allSettled(['one','two'].map(text=>editImportExtraction(actor,job.id,1,{reason:'Correct text',pages:[{index:0,text}]},config)));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const loser=results.find(result=>result.status==='rejected');assert(loser?.status==='rejected');assert.equal(loser.reason.code,'CONFLICT');
 assert.equal((await getImportJob(actor,job.id,config)).revision,2);
 assert.deepEqual((await pool.query('select extraction_encrypted,analysis_encrypted from private.knowledge_import_revisions where job_id=$1 and revision=1',[job.id])).rows[0],before);
}));
test('preview missing/corrupted revision returns fixed error and no extracted content',()=>fixture(async(pool,actor,_staff,key)=>{
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,source(),config);
 await assert.rejects(getImportPreview(actor,job.id,config),{code:'CONFLICT'});
 await analyzeImportJob(actor,job.id,0,config);
 await assert.rejects(getImportPreview(actor,job.id,{...config,key:randomBytes(32).toString('base64')}),{code:'INTERNAL_ERROR'});
}));
test('actual malformed PDF child records normalized failure and retains exact original',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=createImportSource({bytes:createMalformedPdfFixture(),filename:'malformed.pdf',mimeType:'application/pdf',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},{job}=await createImportJob(actor,input,config);
 await assert.rejects(analyzeImportJob(actor,job.id,0,config),{code:'INVALID_REQUEST'});
 assert.equal((await getImportJob(actor,job.id,config)).status,'FAILED');assert.equal((await getImportJob(actor,job.id,config)).errorCode,'IMPORT_PARSE_INVALID');
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,job.id,config)).bytes),Buffer.from(input.bytes));
}));
