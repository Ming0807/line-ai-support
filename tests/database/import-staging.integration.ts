import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,createOfficialUrlImportJob,getImportJob,listImportJobs,markImportFailed,readImportOriginal} from '../../lib/imports/import-staging';
import {createImportSource} from '../../lib/imports/source';
const poolOptions={connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5};
function source(label=randomUUID()){
 return createImportSource({bytes:Buffer.from(`\ufeffหัวข้อ,ข้อความ\r\n${label},ข้อมูลต้นฉบับ\r\n`),filename:'original.csv',mimeType:'text/csv',sourceUrl:'https://library.yru.ac.th/guide',acquiredFrom:'UPLOAD',fetchedAt:null});
}
async function fixture(work:(pool:Pool,actor:string,staff:string,key:string)=>Promise<void>){
 const pool=new Pool({...poolOptions,application_name:`import-staging-${randomUUID()}`}),actor=randomUUID(),staff=randomUUID(),key=randomBytes(32).toString('base64');
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Import fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await work(pool,actor,staff,key);
 }finally{
  if((await pool.query("select to_regclass('private.knowledge_import_jobs') exists_table")).rows[0].exists_table)
   await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
test('private import staging has effective browser denial, server grants and RLS',async()=>{
 const pool=new Pool(poolOptions);
 try{
  const table=(await pool.query(`select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') browser_access,
   (select bool_and(has_table_privilege('service_role',c.oid,p)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) server_access
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='knowledge_import_jobs'`)).rows[0];
  assert(table,'PRIVATE_IMPORT_SCHEMA_REQUIRED');assert(table.relrowsecurity&&!table.anon_access&&!table.browser_access&&table.server_access);
  for(const role of ['anon','authenticated']){
   const client=await pool.connect();try{await client.query('begin');await client.query(`set local role ${role}`);
    await assert.rejects(client.query('select original_ciphertext from private.knowledge_import_jobs'),{code:'42501'});
   }finally{await client.query('rollback');client.release();}
  }
  const client=await pool.connect();try{await client.query('begin');await client.query('set local role service_role');await client.query('select id from private.knowledge_import_jobs limit 1');}
  finally{await client.query('rollback');client.release();}
 }finally{await pool.end();}
});
test('admin stages immutable encrypted bytes and metadata without publishing, and reads with safe audit',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),options={pool,key,originalBackend:'PRIVATE_DATABASE' as const},before=(await pool.query('select count(*)::int n from public.documents')).rows[0].n;
 const created=await createImportJob(actor,input,options);assert.equal(created.duplicate,false);assert.equal(created.job.status,'READY');assert.equal(created.job.revision,0);
 const stored=(await pool.query('select * from private.knowledge_import_jobs where id=$1',[created.job.id])).rows[0];
 assert(!stored.original_ciphertext.includes(Buffer.from(input.bytes)));assert(!stored.source_metadata_encrypted.includes(input.filename));
 assert.equal((await pool.query('select count(*)::int n from public.documents')).rows[0].n,before);
 const view=await getImportJob(actor,created.job.id,options);assert.equal(view.sourceUrl,input.sourceUrl);
 const serialized=JSON.stringify(view);for(const name of ['original_id','original_ciphertext','source_metadata_encrypted','storage_object','PRIVATE_DATABASE','envelope','checksum'])assert(!serialized.includes(name));
 assert((await listImportJobs(actor,options)).some(job=>job.id===view.id));
 const read=await readImportOriginal(actor,view.id,options);assert.deepEqual(Buffer.from(read.bytes),Buffer.from(input.bytes));
 const audits=(await pool.query("select metadata from private.activities where actor_id=$1 and action='KNOWLEDGE_ORIGINAL_READ'",[actor])).rows;
 assert.deepEqual(audits,[{metadata:{importJobId:view.id,byteLength:input.bytes.byteLength}}]);
}));
test('unauthorized, missing and inactive actors cannot create/list/inspect/read or alter imports',()=>fixture(async(pool,actor,staff,key)=>{
 const input=source(),options={pool,key,originalBackend:'PRIVATE_DATABASE' as const},created=await createImportJob(actor,input,options);
 for(const denied of [staff,randomUUID(),'not-an-id']){
  await assert.rejects(createImportJob(denied,{...input,checksum:'bad'}, {...options,key:'bad'}),{code:'FORBIDDEN'});
  await assert.rejects(listImportJobs(denied,options),{code:'FORBIDDEN'});
  await assert.rejects(getImportJob(denied,created.job.id,options),{code:'FORBIDDEN'});
  await assert.rejects(readImportOriginal(denied,created.job.id,options),{code:'FORBIDDEN'});
  await assert.rejects(markImportFailed(denied,created.job.id,0,'IMPORT_PARSE_INVALID',options),{code:'FORBIDDEN'});
 }
 await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);
 await assert.rejects(readImportOriginal(actor,created.job.id,options),{code:'FORBIDDEN'});
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=any($1::uuid[]) and action='KNOWLEDGE_ORIGINAL_READ'",[[actor,staff]])).rows[0].n,0);
}));
test('concurrent checksum duplicates return one immutable job without overwriting metadata or originals',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),options={pool,key,originalBackend:'PRIVATE_DATABASE' as const};
 const results=await Promise.all(Array.from({length:4},(_,index)=>createImportJob(actor,{...input,filename:`attempt-${index}.csv`},options)));
 assert.equal(new Set(results.map(result=>result.job.id)).size,1);assert.equal(results.filter(result=>!result.duplicate).length,1);
 const winner=results.find(result=>!result.duplicate)!;assert(results.every(result=>result.job.filename===winner.job.filename));
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_jobs where checksum=$1',[input.checksum])).rows[0].n,1);
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_STAGED'",[actor])).rows[0].n,1);
}));
test('failed imports retain byte-exact originals and stale failure edits have no effect',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),options={pool,key,originalBackend:'PRIVATE_DATABASE' as const},created=await createImportJob(actor,input,options);
 const before=(await pool.query('select original_ciphertext,checksum from private.knowledge_import_jobs where id=$1',[created.job.id])).rows[0];
 const failed=await markImportFailed(actor,created.job.id,0,'IMPORT_PARSE_INVALID',options);assert.equal(failed.status,'FAILED');assert.equal(failed.revision,1);
 const after=(await pool.query('select original_ciphertext,checksum from private.knowledge_import_jobs where id=$1',[created.job.id])).rows[0];assert.deepEqual(after,before);
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,created.job.id,options)).bytes),Buffer.from(input.bytes));
 await assert.rejects(markImportFailed(actor,created.job.id,0,'IMPORT_PARSE_TIMEOUT',options),{code:'CONFLICT'});
 assert.equal((await getImportJob(actor,created.job.id,options)).errorCode,'IMPORT_PARSE_INVALID');
 await assert.rejects(markImportFailed(actor,created.job.id,1,'private upstream body',options),{code:'INVALID_REQUEST'});
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_FAILED'",[actor])).rows[0].n,1);
}));
test('database rejects changes to original identity, checksum, encrypted bytes and source metadata',()=>fixture(async(pool,actor,_staff,key)=>{
 const created=await createImportJob(actor,source(),{pool,key,originalBackend:'PRIVATE_DATABASE' as const});
 for(const sql of ["checksum=repeat('0',64)","original_id=gen_random_uuid()","original_ciphertext=original_ciphertext||decode('00','hex')","source_metadata_encrypted=source_metadata_encrypted||'a'","format='PDF'","backend='PRIVATE_STORAGE'"])
  await assert.rejects(pool.query(`update private.knowledge_import_jobs set ${sql} where id=$1`,[created.job.id]),{code:'23514'});
}));
test('invalid sources and wrong decryption keys fail safely without partial import writes or read audits',()=>fixture(async(pool,actor,_staff,key)=>{
 const input=source(),options={pool,key,originalBackend:'PRIVATE_DATABASE' as const};
 await assert.rejects(createImportJob(actor,{...input,checksum:'0'.repeat(64)},options),{code:'INVALID_REQUEST'});
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_jobs where creator_id=$1',[actor])).rows[0].n,0);
 const created=await createImportJob(actor,input,options);
 await assert.rejects(readImportOriginal(actor,created.job.id,{pool,key:randomBytes(32).toString('base64')}),{code:'INTERNAL_ERROR'});
 await assert.rejects(getImportJob(actor,randomUUID(),options),{code:'NOT_FOUND'});
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_ORIGINAL_READ'",[actor])).rows[0].n,0);
}));
test('URL staging requires complete requested/final redirect provenance before any write',()=>fixture(async(pool,actor,_staff,key)=>{
 const input={...source(),sourceUrl:'https://library.yru.ac.th/final.csv',acquiredFrom:'URL' as const,fetchedAt:'2026-10-05T03:00:00.000Z'},options={pool,key,originalBackend:'PRIVATE_DATABASE' as const};
 await assert.rejects(createImportJob(actor,input,options),{code:'INVALID_REQUEST'});
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_jobs where creator_id=$1',[actor])).rows[0].n,0);
}));
test('URL staging keeps canonical requested/final redirect provenance encrypted and immutable',()=>fixture(async(pool,actor,_staff,key)=>{
 const input={...source(),sourceUrl:'https://library.yru.ac.th/final.csv',acquiredFrom:'URL' as const,fetchedAt:'2026-10-05T03:00:00.000Z'};
 const acquisition={requestedUrl:'https://yru.ac.th/initial',finalUrl:input.sourceUrl,redirectChain:['https://yru.ac.th/initial',input.sourceUrl]};
 const options={pool,key,originalBackend:'PRIVATE_DATABASE' as const,acquisition},created=await createImportJob(actor,input,options);
 assert.deepEqual((await getImportJob(actor,created.job.id,options)).acquisition,acquisition);
 const metadata=(await pool.query('select source_metadata_encrypted from private.knowledge_import_jobs where id=$1',[created.job.id])).rows[0].source_metadata_encrypted;
 assert(!metadata.includes(acquisition.requestedUrl));
 const changed={requestedUrl:input.sourceUrl,finalUrl:input.sourceUrl,redirectChain:[input.sourceUrl]};
 const duplicate=await createImportJob(actor,input,{pool,key,originalBackend:'PRIVATE_DATABASE' as const,acquisition:changed});assert(duplicate.duplicate);assert.deepEqual(duplicate.job.acquisition,acquisition);
 await assert.rejects(createImportJob(actor,input,{pool,key,originalBackend:'PRIVATE_DATABASE' as const,acquisition:{...acquisition,finalUrl:'https://library.yru.ac.th/wrong.csv'}}),{code:'INVALID_REQUEST'});
}));
test('official URL acquisition authorizes before DNS and performs network outside SQL before final reauthorization',()=>fixture(async(pool,actor,staff,key)=>{
 const bytes=source().bytes;let dnsCalls=0,requests=0;
 const acquisitionOptions={testOnly:{resolvePublicAddresses:async()=>{dnsCalls++;return [{address:'8.8.8.8',family:4 as const}];},transport:async()=>{
  requests++;assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[pool.options.application_name])).rows[0].n,0);
  return {status:200,location:null,contentType:'text/csv',contentDisposition:null,contentEncoding:'identity',body:(async function*(){yield bytes;})(),cancel:()=>undefined};
 }}};
 await assert.rejects(createOfficialUrlImportJob(staff,'https://yru.ac.th/guide.csv',{pool,key,originalBackend:'PRIVATE_DATABASE' as const},acquisitionOptions),{code:'FORBIDDEN'});assert.equal(dnsCalls,0);
 const created=await createOfficialUrlImportJob(actor,'https://yru.ac.th/guide.csv',{pool,key,originalBackend:'PRIVATE_DATABASE' as const},acquisitionOptions);
 assert.equal(requests,1);assert.equal(dnsCalls,1);assert.equal(created.job.acquiredFrom,'URL');assert.deepEqual(created.job.acquisition?.redirectChain,['https://yru.ac.th/guide.csv']);
}));
test('deactivated admin cannot save fetched original after an in-flight URL acquisition',()=>fixture(async(pool,actor,_staff,key)=>{
 const bytes=source().bytes;
 await assert.rejects(createOfficialUrlImportJob(actor,'https://yru.ac.th/guide.csv',{pool,key,originalBackend:'PRIVATE_DATABASE' as const},{testOnly:{
  resolvePublicAddresses:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>{
   await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);
   return {status:200,location:null,contentType:'text/csv',contentDisposition:null,contentEncoding:'identity',body:(async function*(){yield bytes;})(),cancel:()=>undefined};
  },
 }}),{code:'FORBIDDEN'});
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_jobs where creator_id=$1',[actor])).rows[0].n,0);
}));
