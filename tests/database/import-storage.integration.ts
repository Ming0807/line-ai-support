import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,getImportJob,markImportFailed,readImportOriginal,type ImportStagingOptions} from '../../lib/imports/import-staging';
import {createImportSource} from '../../lib/imports/source';
import type {OriginalStorage} from '../../lib/imports/original-storage';
const connectionString='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
async function fixture(work:(pool:Pool,actor:string,staff:string,options:ImportStagingOptions,objects:Map<string,Uint8Array>)=>Promise<void>){
 const pool=new Pool({connectionString,max:5,application_name:`import-storage-${randomUUID()}`}),actor=randomUUID(),staff=randomUUID(),objects=new Map<string,Uint8Array>();
 const storage:OriginalStorage={async upload(jobId,_ref,envelope){objects.set(jobId,Uint8Array.from(envelope));},async download(jobId){const value=objects.get(jobId);assert(value);return Uint8Array.from(value);}};
 const options:ImportStagingOptions={pool,key:randomBytes(32).toString('base64'),originalBackend:'PRIVATE_STORAGE',storage};
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Storage fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
  await work(pool,actor,staff,options,objects);
 }finally{
  if((await pool.query("select to_regclass('private.knowledge_original_uploads') exists_table")).rows[0].exists_table)await pool.query('delete from private.knowledge_original_uploads where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
const source=()=>createImportSource({bytes:Buffer.from(`หัวข้อ,ข้อความ\r\n${randomUUID()},ต้นฉบับ\r\n`),filename:'private.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
test('Storage staging keeps encrypted remote originals, a linked immutable receipt and a safe DTO',()=>fixture(async(pool,actor,_staff,options,objects)=>{
 const input=source(),result=await createImportJob(actor,input,options);
 const row=(await pool.query('select * from private.knowledge_import_jobs where id=$1',[result.job.id])).rows[0];
 assert.equal(row.backend,'PRIVATE_STORAGE');assert.equal(row.original_ciphertext,null);assert.equal(objects.size,1);
 assert(!Buffer.from(objects.get(result.job.id)!).includes(Buffer.from(input.bytes)));
 const receipt=(await pool.query('select * from private.knowledge_original_uploads where job_id=$1',[result.job.id])).rows[0];
 assert.equal(receipt.status,'LINKED');assert.equal(receipt.linked_import_id,result.job.id);assert.equal(receipt.original_id,row.original_id);
 const dto=JSON.stringify(await getImportJob(actor,result.job.id,options));for(const forbidden of ['PRIVATE_STORAGE','original_id','checksum','storage_object','envelope'])assert(!dto.includes(forbidden));
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,result.job.id,options)).bytes),Buffer.from(input.bytes));
 await markImportFailed(actor,result.job.id,0,'IMPORT_PARSE_INVALID',options);
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,result.job.id,options)).bytes),Buffer.from(input.bytes));
 await assert.rejects(pool.query('update private.knowledge_original_uploads set original_id=gen_random_uuid() where job_id=$1',[result.job.id]),{code:'23514'});
}));
test('Storage upload/download run after authorization commits and reauthorize before returning originals',()=>fixture(async(pool,actor,staff,options,objects)=>{
 let uploads=0,downloads=0;
 const check=async()=>assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state like 'idle in transaction%'",[pool.options.application_name])).rows[0].n,0);
 options.storage={async upload(jobId,_ref,envelope){uploads++;await check();objects.set(jobId,Uint8Array.from(envelope));},async download(jobId){downloads++;await check();await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);return objects.get(jobId)!;}};
 await assert.rejects(createImportJob(staff,source(),options),{code:'FORBIDDEN'});assert.equal(uploads,0);
 const created=await createImportJob(actor,source(),options);assert.equal(uploads,1);
 await assert.rejects(readImportOriginal(actor,created.job.id,options),{code:'FORBIDDEN'});assert.equal(downloads,1);
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_ORIGINAL_READ'",[actor])).rows[0].n,0);
}));
test('an admin revoked during upload leaves a retained encrypted receipt and no published or staged job',()=>fixture(async(pool,actor,_staff,options,objects)=>{
 options.storage={async upload(jobId,_ref,envelope){objects.set(jobId,Uint8Array.from(envelope));await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);},async download(){throw new Error('UNEXPECTED');}};
 const before=(await pool.query('select count(*)::int n from public.documents')).rows[0].n;
 await assert.rejects(createImportJob(actor,source(),options),{code:'FORBIDDEN'});assert.equal(objects.size,1);
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_jobs where creator_id=$1',[actor])).rows[0].n,0);
 const receipt=(await pool.query('select status,linked_import_id from private.knowledge_original_uploads where creator_id=$1',[actor])).rows[0];
 assert.equal(receipt.status,'UPLOADED');assert.equal(receipt.linked_import_id,null);
 assert.equal((await pool.query('select count(*)::int n from public.documents')).rows[0].n,before);
}));
test('concurrent Storage uploads deduplicate one job and retain losing immutable originals',()=>fixture(async(pool,actor,_staff,options,objects)=>{
 const input=source();let waiting=0;let release:()=>void=()=>undefined;const barrier=new Promise<void>(resolve=>{release=resolve;});
 options.storage={async upload(jobId,_ref,envelope){objects.set(jobId,Uint8Array.from(envelope));waiting++;if(waiting===3)release();await barrier;},async download(jobId){return objects.get(jobId)!;}};
 const results=await Promise.all(Array.from({length:3},()=>createImportJob(actor,input,options)));
 assert.equal(new Set(results.map(value=>value.job.id)).size,1);assert.equal(results.filter(value=>!value.duplicate).length,1);assert.equal(objects.size,3);
 const receipts=(await pool.query('select status,linked_import_id from private.knowledge_original_uploads where creator_id=$1',[actor])).rows;
 assert.equal(receipts.filter(value=>value.status==='LINKED').length,1);assert.equal(receipts.filter(value=>value.status==='UPLOADED'&&value.linked_import_id===null).length,2);
 await createImportJob(actor,input,options);assert.equal(objects.size,3);
}));
test('Storage failures are normalized and retained, corrupted bytes cause no read audit',()=>fixture(async(pool,actor,_staff,options,objects)=>{
 const input=source();options.storage={async upload(){throw new Error('PRIVATE_UPSTREAM_FIXTURE');},async download(){throw new Error('UNEXPECTED');}};
 await assert.rejects(createImportJob(actor,input,options),{code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});
 assert.equal((await pool.query('select status from private.knowledge_original_uploads where creator_id=$1',[actor])).rows[0].status,'UNKNOWN');
 options.storage={async upload(jobId,_ref,envelope){objects.set(jobId,Uint8Array.from(envelope));},async download(jobId){const value=Uint8Array.from(objects.get(jobId)!);value[value.length-1]^=1;return value;}};
 const created=await createImportJob(actor,input,options);await assert.rejects(readImportOriginal(actor,created.job.id,options),{code:'INTERNAL_ERROR'});
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_ORIGINAL_READ'",[actor])).rows[0].n,0);
}));
test('original upload receipts deny browser roles and retain server-only RLS',async()=>{
 const pool=new Pool({connectionString});try{
  const row=(await pool.query("select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') a,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') b from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='knowledge_original_uploads'")).rows[0];
  assert(row,'ORIGINAL_UPLOAD_RECEIPTS_REQUIRED');assert(row.relrowsecurity&&!row.a&&!row.b);
 }finally{await pool.end();}
});
