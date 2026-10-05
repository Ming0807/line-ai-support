import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {Pool} from 'pg';
import {localStorageConfig} from '../../scripts/storage/local-config';
import {createOriginalStorage,provisionOriginalStorage,ORIGINAL_BUCKET} from '../../lib/imports/original-storage';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {createImportSource} from '../../lib/imports/source';
test('actual local Storage keeps originals private for anon/authenticated while authorized backend recovers exact bytes',{timeout:120_000},async()=>{
 const config=localStorageConfig();assert.equal(config.url,'http://127.0.0.1:54421');
 const service=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const anon=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const browser=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:3}),email=`original-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
 let actor:string|undefined;const paths:string[]=[];
 try{
  await provisionOriginalStorage(config);
  const user=await service.auth.admin.createUser({email,password,email_confirm:true});assert(!user.error&&user.data.user,'LOCAL_AUTH_FIXTURE_CREATE_FAILED');actor=user.data.user.id;
  await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Original HTTP fixture',true)",[actor]);
  const session=await browser.auth.signInWithPassword({email,password});assert(!session.error&&session.data.session,'LOCAL_AUTH_FIXTURE_SIGNIN_FAILED');
  assert.equal((await pool.query("select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects'")).rows[0].n,0,'LOCAL_STORAGE_OBJECT_POLICIES_MUST_BE_EMPTY');
  const input=createImportSource({bytes:Buffer.from(`\ufeffหัวข้อ,ข้อความ\r\n${randomUUID()},ต้นฉบับที่ตรวจสิทธิ์\r\n`),filename:'original.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
  let requests=0;const storage=createOriginalStorage({...config,fetch:async(input,init)=>{requests++;return fetch(input,init);}}),options={pool,key:randomBytes(32).toString('base64'),storage};
  const before=(await pool.query('select count(*)::int n from public.documents')).rows[0].n;
  const created=await createImportJob(actor,input,options);
  const original=(await pool.query('select original_id,backend from private.knowledge_import_jobs where id=$1',[created.job.id])).rows[0];assert.equal(original.backend,'PRIVATE_STORAGE');
  const path=`${created.job.id}/${original.original_id}.yrue`;paths.push(path);
  const encrypted=await service.storage.from(ORIGINAL_BUCKET).download(path);assert(!encrypted.error&&encrypted.data,'SERVICE_DOWNLOAD_FAILED');
  const envelope=Buffer.from(await encrypted.data.arrayBuffer());assert.equal(envelope.length,input.bytes.length+33);assert(!envelope.includes(Buffer.from(input.bytes)));
  assert.deepEqual(Buffer.from((await readImportOriginal(actor,created.job.id,options)).bytes),Buffer.from(input.bytes));
  for(const client of [anon,browser]){
   const download=await client.storage.from(ORIGINAL_BUCKET).download(path);assert.equal(download.data,null,'BROWSER_OBJECT_DOWNLOAD_MUST_BE_DENIED');assert(download.error,'BROWSER_OBJECT_DOWNLOAD_MUST_FAIL');
   const listing=await client.storage.from(ORIGINAL_BUCKET).list(created.job.id);assert.equal(listing.data?.length??0,0,'BROWSER_OBJECT_LIST_MUST_BE_EMPTY');
   const deniedPath=`${created.job.id}/${randomUUID()}.yrue`;paths.push(deniedPath);
   const write=await client.storage.from(ORIGINAL_BUCKET).upload(deniedPath,envelope,{contentType:'application/octet-stream',upsert:false});assert(write.error,'BROWSER_OBJECT_UPLOAD_MUST_BE_DENIED');
  }
  const publicResponse=await fetch(`${config.url}/storage/v1/object/public/${ORIGINAL_BUCKET}/${path}`,{redirect:'error',signal:AbortSignal.timeout(10_000)});assert(!publicResponse.ok,'PUBLIC_OBJECT_ROUTE_MUST_BE_DENIED');await publicResponse.body?.cancel();
  const duplicate=await service.storage.from(ORIGINAL_BUCKET).upload(path,envelope,{contentType:'application/octet-stream',upsert:false});assert(duplicate.error,'IMMUTABLE_UPLOAD_MUST_REJECT_DUPLICATE');
  const unchanged=await service.storage.from(ORIGINAL_BUCKET).download(path);assert(!unchanged.error&&unchanged.data);assert.deepEqual(Buffer.from(await unchanged.data.arrayBuffer()),envelope);
  const count=requests;await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);
  await assert.rejects(readImportOriginal(actor,created.job.id,options),{code:'FORBIDDEN'});assert.equal(requests,count,'REVOKED_ACTOR_MUST_NOT_DOWNLOAD');
  assert.equal((await pool.query('select count(*)::int n from public.documents')).rows[0].n,before);
 }finally{
  // Explicit loopback-only fixture cleanup. Runtime import code has no delete operation.
  if(actor){
   const receipts=(await pool.query('select job_id,original_id from private.knowledge_original_uploads where creator_id=$1',[actor])).rows;
   for(const row of receipts)paths.push(`${row.job_id}/${row.original_id}.yrue`);
   if(paths.length){const removed=await service.storage.from(ORIGINAL_BUCKET).remove([...new Set(paths)]);assert(!removed.error,'LOCAL_STORAGE_FIXTURE_CLEANUP_FAILED');}
   await pool.query('delete from private.knowledge_original_uploads where creator_id=$1',[actor]);await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);
   await pool.query('delete from private.activities where actor_id=$1',[actor]);await pool.query('delete from public.staff_profiles where id=$1',[actor]);
   const removed=await service.auth.admin.deleteUser(actor);assert(!removed.error,'LOCAL_AUTH_FIXTURE_CLEANUP_FAILED');
  }
  await pool.end();
 }
});
