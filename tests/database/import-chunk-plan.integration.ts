import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {saveImportReview,getImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {createImportSource} from '../../lib/imports/source';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {PassageTokenCounter} from '../../lib/knowledge/embedding-client';
import {encryptStagingValue} from '../../lib/imports/staging-envelope';
async function fixture(work:(f:Awaited<ReturnType<typeof ready>>)=>Promise<void>){
 const actor=randomUUID(),staff=randomUUID(),pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5,application_name:'chunk-plan-'+actor});
 try{await work(await ready(pool,actor,staff));}
 finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
async function ready(pool:Pool,actor:string,staff:string){
 for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Chunk-plan fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
 let calls=0;
 const counter:PassageTokenCounter={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,countPassageTokens:async texts=>{calls++;return texts.map(()=>10);}};
 const config={pool,key:Buffer.alloc(32,94).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const,counter};
 const original=createImportSource({bytes:Buffer.from(`<html><h1>Chunk plan ${randomUUID()}</h1><p>ข้อมูลสำหรับทดสอบตรวจข้อความ</p><table><tr><td>หมวด</td><td>ข้อมูล</td></tr><tr><td>บริการ</td><td>ห้องสมุด</td></tr></table></html>`),filename:'chunk.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(actor,original,config);await analyzeImportJob(actor,job.id,0,{...config,parse:async input=>parseHtmlSource(input)});
 const input={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,draft:unfinishedReviewDraft()},query={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:1};
 return {pool,actor,staff,original,job,input,query,config,counter,calls:()=>calls};
}
test('chunk preview denies ordinary actors before query getters or any private count work',()=>fixture(async f=>{
 const invalid=new Proxy({},{get(){throw new Error('INPUT_WAS_READ');}});
 await assert.rejects(getImportChunkPlan(f.staff,f.job.id,invalid,f.config),{code:'FORBIDDEN'});assert.equal(f.calls(),0);
 await assert.rejects(getImportChunkPlan(f.actor,f.job.id,f.query,f.config),{code:'CONFLICT'});assert.equal(f.calls(),0);
}));
test('private located plan binds saved three-counter snapshot and preserves originals without publishing',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const before=(await f.pool.query('select (select count(*) from public.documents) documents,(select count(*) from public.knowledge_chunks) chunks')).rows[0];
 const result=await getImportChunkPlan(f.actor,f.job.id,f.query,f.config);assert.equal(result.reviewRevision,1);assert.equal(result.plan.binding.jobId,f.job.id);assert.equal(result.plan.binding.extractionRevision,1);assert.match(result.plan.digest,/^[a-f0-9]{64}$/);
 assert(result.plan.chunks.length>0);assert(result.plan.chunks.some(chunk=>chunk.coverage.kind==='TABLE'));assert(result.plan.chunks.every(chunk=>chunk.sourceLocations[0].kind==='HTML'&&chunk.passageTokenCount===10));assert(!JSON.stringify(result).includes('embedding":'));
 assert.deepEqual((await f.pool.query('select (select count(*) from public.documents) documents,(select count(*) from public.knowledge_chunks) chunks')).rows[0],before);assert.deepEqual(Buffer.from((await readImportOriginal(f.actor,f.job.id,f.config)).bytes),Buffer.from(f.original.bytes));
 for(const patch of [{expectedJobRevision:2},{expectedExtractionRevision:2},{expectedReviewRevision:2}])await assert.rejects(getImportChunkPlan(f.actor,f.job.id,{...f.query,...patch},f.config),{code:'CONFLICT'});
}));
test('v2 acknowledgment recomputes outside SQL, rejects false digests and retains immutable v1 history',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);const snapshot=await getImportChunkPlan(f.actor,f.job.id,f.query,f.config);
 const before=(await f.pool.query('select review_encrypted from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].review_encrypted;
 const draft={...f.input.draft,schemaVersion:2 as const,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:'located-e5-v1' as const}};
 await assert.rejects(saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1,draft:{...draft,chunkPlan:{...draft.chunkPlan,digest:'f'.repeat(64)}}},f.config),{code:'INVALID_REQUEST'});
 f.counter.countPassageTokens=async texts=>{
  const active=(await f.pool.query("select count(*)::int count from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and state='idle in transaction' and application_name=$1",['chunk-plan-'+f.actor])).rows[0].count;assert.equal(active,0);
  return texts.map(()=>10);
 };
 const saved=await saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1,draft},f.config);assert.equal(saved.reviewRevision,2);assert.deepEqual((await getImportReview(f.actor,f.job.id,f.config)).saved?.draft,draft);
 const history=await f.pool.query('select review_revision,review_encrypted from private.knowledge_import_reviews where job_id=$1 order by review_revision',[f.job.id]);assert.equal(history.rows.length,2);assert.equal(history.rows[0].review_encrypted,before);
}));
test('revocation or changed review/extraction after outside-SQL counting prevents returning obsolete plans',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 await assert.rejects(getImportChunkPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{await saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1},f.config);}}),{code:'CONFLICT'});
 const query={...f.query,expectedReviewRevision:2};
 await assert.rejects(getImportChunkPlan(f.actor,f.job.id,query,{...f.config,beforeRead:async()=>{await editImportExtraction(f.actor,f.job.id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'ฉบับใหม่'}]},f.config);}}),{code:'CONFLICT'});
}));
test('actor revoked or request aborted during preparation returns no private plan',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 await assert.rejects(getImportChunkPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);}}),{code:'FORBIDDEN'});
 await f.pool.query('update public.staff_profiles set active=true where id=$1',[f.actor]);const controller=new AbortController();
 await assert.rejects(getImportChunkPlan(f.actor,f.job.id,f.query,{...f.config,signal:controller.signal,beforeRead:async()=>{controller.abort();}}),{code:'CONFLICT'});
}));

test('review committed during the final job lock wait invalidates the previously counted plan',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const operationName='chunk-lock-'+randomUUID(),operationPool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:3,application_name:operationName});
 const blocker=await f.pool.connect();let resume:()=>void=()=>undefined,prepared:()=>void=()=>undefined;
 const gate=new Promise<void>(resolve=>{resume=resolve;}),ready=new Promise<void>(resolve=>{prepared=resolve;});
 const lookup=getImportChunkPlan(f.actor,f.job.id,f.query,{...f.config,pool:operationPool,beforeRead:async()=>{prepared();await gate;}});
 const outcome=lookup.then(value=>({value,error:null}),error=>({value:null,error}));
 try{
  await ready;const serialized=JSON.stringify(f.input.draft),checksum=createHash('sha256').update(JSON.stringify(['yru:knowledge-review-receipt:v1',f.original.checksum,1,1])).digest('hex');
  const encrypted=encryptStagingValue(serialized,{jobId:f.job.id,checksum,revision:2,purpose:'REVIEW'},f.config.key);
  await blocker.query('begin');await blocker.query('select id from private.knowledge_import_jobs where id=$1 for update',[f.job.id]);
  await blocker.query('insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted) values($1,2,1,1,$2,$3,$4)',[f.job.id,f.actor,createHash('sha256').update(serialized).digest('hex'),encrypted]);
  resume();let waiting=false;
  for(let attempt=0;attempt<100;attempt++){
   waiting=(await f.pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like '%knowledge_import_jobs%') waiting",[operationName])).rows[0].waiting;
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(waiting,'ACTUAL_JOB_LOCK_WAIT_REQUIRED');await blocker.query('commit');const result=await outcome;assert.equal(result.error?.code,'CONFLICT');assert.equal(result.value,null);
 }finally{resume();await blocker.query('rollback');blocker.release();await outcome;await operationPool.end();}
}));
