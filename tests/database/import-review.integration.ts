import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,getImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {createImportSource} from '../../lib/imports/source';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {buildReviewWarnings} from '../../lib/imports/review-warnings';
import {unfinishedReviewDraft} from '../fixtures/import-review';
const connectionString='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
async function fixture(work:(pool:Pool,actor:string,staff:string,key:string)=>Promise<void>){
 const pool=new Pool({connectionString,max:6,application_name:`import-review-${randomUUID()}`}),actor=randomUUID(),staff=randomUUID(),key=Buffer.alloc(32,93).toString('base64');
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Review fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await work(pool,actor,staff,key);
 }finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
function source(){return createImportSource({bytes:Buffer.from(`<html><h1>คู่มือ ${randomUUID()}</h1><p>เนื้อหาเอกสารสำหรับตรวจทาน</p></html>`),filename:'review.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});}
async function ready(pool:Pool,actor:string,key:string){
 const config={pool,key,originalBackend:'PRIVATE_DATABASE' as const},original=source(),{job}=await createImportJob(actor,original,config);
 const preview=await analyzeImportJob(actor,job.id,0,{...config,parse:async input=>parseHtmlSource(input)});
 return {config,original,job:preview.job,preview,input:{expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,draft:unfinishedReviewDraft()}};
}
test('private review receipts have RLS, browser denial and append-only server privileges',async()=>{
 const pool=new Pool({connectionString});try{
  const row=(await pool.query(`select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') a,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') b,has_table_privilege('service_role',c.oid,'SELECT') s,
   has_table_privilege('service_role',c.oid,'INSERT') i,has_table_privilege('service_role',c.oid,'UPDATE,DELETE') m
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='knowledge_import_reviews'`)).rows[0];
  assert(row,'REVIEW_SCHEMA_REQUIRED');assert(row.relrowsecurity&&!row.a&&!row.b&&row.s&&row.i&&!row.m);
  for(const role of ['anon','authenticated']){const c=await pool.connect();try{await c.query('begin');await c.query(`set local role ${role}`);
   await assert.rejects(c.query('select * from private.knowledge_import_reviews'),{code:'42501'});
  }finally{await c.query('rollback');c.release();}}
 }finally{await pool.end();}
});
test('unfinished encrypted review roundtrip retains originals/extraction/job and publishes nothing',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key),before=(await pool.query('select (select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c')).rows[0];
 const empty=await getImportReview(actor,f.job.id,f.config);assert.equal(empty.reviewRevision,0);assert.equal(empty.saved,null);assert.equal(empty.stale,false);
 f.input.draft.metadata.title='ชื่อที่ตรวจทานแล้ว';const saved=await saveImportReview(actor,f.job.id,f.input,f.config);
 assert.equal(saved.reviewRevision,1);assert.equal(saved.jobRevision,1);assert.equal(saved.extractionRevision,1);assert.equal(saved.stale,false);assert.deepEqual(saved.saved?.draft,f.input.draft);
 assert.deepEqual(await getImportReview(actor,f.job.id,f.config),saved);assert.deepEqual(await getImportJob(actor,f.job.id,f.config),f.job);
 const row=(await pool.query('select * from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0];
 assert(!row.review_encrypted.includes('ชื่อที่ตรวจทาน'));assert.equal(row.payload_hash,createHash('sha256').update(JSON.stringify(saved.saved!.draft)).digest('hex'));
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_revisions where job_id=$1',[f.job.id])).rows[0].n,1);
 assert.deepEqual(Buffer.from((await readImportOriginal(actor,f.job.id,f.config)).bytes),Buffer.from(f.original.bytes));
 assert.deepEqual((await pool.query('select (select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c')).rows[0],before);
 for(const forbidden of ['review_encrypted','payload_hash','checksum','original_id'])assert(!JSON.stringify(saved).includes(forbidden));
 await assert.rejects(pool.query('update private.knowledge_import_reviews set payload_hash=payload_hash where job_id=$1',[f.job.id]),{code:'23514'});
}));
test('ordinary/inactive actors are denied before private preview or draft parsing',()=>fixture(async(pool,actor,staff,key)=>{
 const f=await ready(pool,actor,key);for(const denied of [staff,randomUUID(),'invalid']){
  await assert.rejects(getImportReview(denied,f.job.id,f.config),{code:'FORBIDDEN'});await assert.rejects(saveImportReview(denied,f.job.id,{approved:true},f.config),{code:'FORBIDDEN'});
 }
 await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);await assert.rejects(getImportReview(actor,f.job.id,f.config),{code:'FORBIDDEN'});
}));
test('requires extraction and rejects wrong job/extraction/review counters before preparation',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key),other=await createImportJob(actor,source(),f.config);let preparations=0;const config={...f.config,beforeCommit:async()=>{preparations++;}};
 await assert.rejects(getImportReview(actor,other.job.id,config),{code:'CONFLICT'});
 for(const change of [{expectedJobRevision:0},{expectedExtractionRevision:2},{expectedReviewRevision:1}])await assert.rejects(saveImportReview(actor,f.job.id,{...f.input,...change},config),{code:'CONFLICT'});
 assert.equal(preparations,0);await saveImportReview(actor,f.job.id,f.input,config);
 await assert.rejects(saveImportReview(actor,f.job.id,f.input,config),{code:'CONFLICT'});assert.equal(preparations,1);
}));
test('warning dispositions bind exact extraction evidence; false-positive remains only an unpublished draft',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key),warnings=buildReviewWarnings(f.preview);assert(warnings.length>0);
 const bad={...f.input,draft:{...f.input.draft,warningDispositions:[{warningKey:'f'.repeat(64),status:'FALSE_POSITIVE',reason:'ดูแล้ว'}]}};
 await assert.rejects(saveImportReview(actor,f.job.id,bad,f.config),{code:'INVALID_REQUEST'});
 f.input.draft.warningDispositions=[{warningKey:warnings[0].key,status:'FALSE_POSITIVE',reason:'ตรวจทานแหล่งที่มาแล้ว'}];
 const saved=await saveImportReview(actor,f.job.id,f.input,f.config);assert.deepEqual(saved.warnings,warnings);assert.equal(saved.saved?.draft.attestations.sensitivityReviewed,false);
 assert.equal((await getImportJob(actor,f.job.id,f.config)).status,'READY');
}));
test('concurrent review preparation is outside SQL and exact review CAS gives one winner',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key);let count=0;let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
 const names=[`review-barrier-a-${randomUUID()}`,`review-barrier-b-${randomUUID()}`],pools=names.map(application_name=>new Pool({connectionString,max:4,application_name}));
 const timeout=setTimeout(release,10_000);
 try{
  const result=await Promise.allSettled(pools.map((operationPool,index)=>saveImportReview(actor,f.job.id,f.input,{...f.config,pool:operationPool,beforeCommit:async()=>{
   // Observe this operation, not another review's legitimate short SQL work.
   const open=(await pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and xact_start is not null',[names[index]])).rows[0].n;assert.equal(open,0);
   count++;if(count===2)release();await gate;
  }})));
  assert.equal(count,2,'BOTH_PREPARATIONS_REQUIRED');assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const loser=result.find(x=>x.status==='rejected');assert(loser?.status==='rejected');assert.equal(loser.reason.code,'CONFLICT');
  assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].n,1);
 }finally{clearTimeout(timeout);release();await Promise.all(pools.map(p=>p.end()));}
}));
test('actor revocation during preparation denies final append without changing job/extraction',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key);await assert.rejects(saveImportReview(actor,f.job.id,f.input,{...f.config,beforeCommit:async()=>{await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);}}),{code:'FORBIDDEN'});
 assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].n,0);
 assert.equal((await pool.query('select revision from private.knowledge_import_jobs where id=$1',[f.job.id])).rows[0].revision,1);
}));
test('text edits retain stale review history and require new extraction binding and independent review counter',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key);const first=await saveImportReview(actor,f.job.id,f.input,f.config);
 const immutable=(await pool.query('select review_encrypted from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].review_encrypted;
 await editImportExtraction(actor,f.job.id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'ข้อความแก้ไข'}]},f.config);
 const stale=await getImportReview(actor,f.job.id,f.config);assert.equal(stale.stale,true);assert.equal(stale.jobRevision,2);assert.equal(stale.extractionRevision,2);assert.deepEqual(stale.saved,first.saved);
 await assert.rejects(saveImportReview(actor,f.job.id,{...f.input,expectedReviewRevision:1},f.config),{code:'CONFLICT'});
 const second=await saveImportReview(actor,f.job.id,{...f.input,expectedJobRevision:2,expectedExtractionRevision:2,expectedReviewRevision:1},f.config);
 assert.equal(second.stale,false);assert.equal(second.reviewRevision,2);assert.equal((await pool.query('select review_encrypted from private.knowledge_import_reviews where job_id=$1 and review_revision=1',[f.job.id])).rows[0].review_encrypted,immutable);
}));
test('job failure after extraction makes old receipt stale even if extraction counter is unchanged',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key);await saveImportReview(actor,f.job.id,f.input,f.config);
 await assert.rejects(analyzeImportJob(actor,f.job.id,1,{...f.config,parse:async()=>{throw new Error('IMPORT_PARSE_INVALID');}}),{code:'INVALID_REQUEST'});
 const stale=await getImportReview(actor,f.job.id,f.config);assert.equal(stale.stale,true);assert.equal(stale.jobRevision,2);assert.equal(stale.extractionRevision,1);
 const second=await saveImportReview(actor,f.job.id,{...f.input,expectedJobRevision:2,expectedReviewRevision:1},f.config);assert.equal(second.stale,false);assert.equal((await getImportJob(actor,f.job.id,f.config)).status,'FAILED');
}));
test('audit insert failure rolls back the new review receipt and exposes only fixed error',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key),name='qa_review_'+actor.replaceAll('-','');
 await pool.query(`create function private.${name}() returns trigger language plpgsql as $$begin if new.actor_id='${actor}'::uuid and new.action='KNOWLEDGE_IMPORT_REVIEW_SAVED' then raise exception 'private details';end if;return new;end;$$`);
 await pool.query(`create trigger ${name} before insert on private.activities for each row execute function private.${name}()`);
 try{await assert.rejects(saveImportReview(actor,f.job.id,f.input,f.config),{code:'INTERNAL_ERROR'});
  assert.equal((await pool.query('select count(*)::int n from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].n,0);
 }finally{await pool.query(`drop trigger ${name} on private.activities`);await pool.query(`drop function private.${name}()`);}
}));
test('ciphertext transplanted to a new extraction/review counter fails authentication and remains private',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key);await saveImportReview(actor,f.job.id,f.input,f.config);
 await editImportExtraction(actor,f.job.id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'อีกฉบับ'}]},f.config);
 await pool.query(`insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted)
  select job_id,2,2,2,actor_id,payload_hash,review_encrypted from private.knowledge_import_reviews where job_id=$1 and review_revision=1`,[f.job.id]);
 await assert.rejects(getImportReview(actor,f.job.id,f.config),{code:'INTERNAL_ERROR'});
}));
test('abort during preparation prevents append and does not consume review revision',()=>fixture(async(pool,actor,_staff,key)=>{
 const f=await ready(pool,actor,key),abort=new AbortController();
 await assert.rejects(saveImportReview(actor,f.job.id,f.input,{...f.config,signal:abort.signal,beforeCommit:async()=>{abort.abort();}}),{code:'CONFLICT'});
 assert.equal((await getImportReview(actor,f.job.id,f.config)).reviewRevision,0);
}));
