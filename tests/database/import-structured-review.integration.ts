import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportStructuredPlan,getImportStructuredSource} from '../../lib/imports/import-structured-plan';
import {computeStructuredExtractionDigest} from '../../lib/imports/structured-mapper';
import {reviewDraftSchema} from '../../lib/imports/review-schema';
import {buildReviewWarnings} from '../../lib/imports/review-warnings';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {approveImport} from '../../lib/imports/import-publication';
import {encryptStagingValue} from '../../lib/imports/staging-envelope';

const connectionString='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
async function fixture(work:(f:Awaited<ReturnType<typeof ready>>)=>Promise<void>){
 const pool=new Pool({connectionString,max:6,application_name:'structured-review-'+randomUUID()}),actor=randomUUID(),staff=randomUUID();
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Structured fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await work(await ready(pool,actor,staff));
 }finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
async function ready(pool:Pool,actor:string,staff:string){
 const key=Buffer.alloc(32,61).toString('base64'),config={pool,key,originalBackend:'PRIVATE_DATABASE' as const};
 const original=createImportSource({bytes:Buffer.from('<html><h1>ระบบมหาวิทยาลัยสำหรับตรวจทาน</h1><p>ตัวอย่างทดสอบ ไม่ใช่เอกสารอนุมัติ</p><table><tr><th>code</th><th>name</th><th>url</th></tr><tr><td>0001</td><td>ระบบทะเบียน</td><td>https://example.org/registry</td></tr></table></html>'),filename:'systems.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(actor,original,config),preview=await analyzeImportJob(actor,job.id,0,{...config,parse:async source=>parseHtmlSource(source)});
 const mapping={version:1,registryVersion:'structured-v1',dataset:'university_systems',source:{jobId:job.id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,sourceChecksum:original.checksum,extractionDigest:computeStructuredExtractionDigest(original,preview.extraction)},
  tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:1}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Explicit synthetic header exclusion'}],fields:{
   code:{kind:'COLUMN',columnIndex:0,transform:'TEXT_V1',blank:'REJECT'},name:{kind:'COLUMN',columnIndex:1,transform:'TEXT_V1',blank:'REJECT'},
   description:{kind:'CONSTANT',value:null,note:'No description supplied'},url:{kind:'COLUMN',columnIndex:2,transform:'TEXT_V1',blank:'REJECT'},support_url:{kind:'CONSTANT',value:null,note:'No support URL supplied'},
  }}],excludedTables:[]};
 const base=unfinishedReviewDraft(),draft=reviewDraftSchema.parse({...base,schemaVersion:3,chunkPlan:null,metadata:{...base.metadata,storageMode:'STRUCTURED',datasetType:'university_systems'},structuredMapping:{mapping,acknowledgment:null},warningDispositions:buildReviewWarnings(preview).map(w=>({warningKey:w.key,status:'UNRESOLVED',reason:null}))});
 const query={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,mapping},input={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,draft};
 return {pool,actor,staff,key,config,original,job:preview.job,preview,mapping,query,input};
}
async function counts(f:Awaited<ReturnType<typeof ready>>){return (await f.pool.query(`select (select count(*) from public.documents) documents,(select count(*) from public.knowledge_chunks) chunks,
 (select count(*) from private.knowledge_import_reviews where job_id=$1) reviews,(select count(*) from private.knowledge_import_revisions where job_id=$1) extractions,
 (select revision from private.knowledge_import_jobs where id=$1) revision`,[f.job.id])).rows[0];}

test('authorized preview before review preserves actual cells/source and mutates no business data',()=>fixture(async f=>{
 const before=await counts(f),snapshot=await getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{
  const sessions=(await f.pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and xact_start is not null and pid<>pg_backend_pid()",[f.pool.options.application_name])).rows[0].n;assert.equal(sessions,0,'PREPARATION_MUST_BE_OUTSIDE_SQL');
 }});
 assert.equal(snapshot.reviewRevision,0);assert.equal(snapshot.nextReviewRevision,1);assert.equal(snapshot.publicationAvailable,false);
 const payload=snapshot.plan.rows[0].payload;assert('code' in payload);assert.equal(payload.code,'0001');assert.equal(snapshot.plan.rows[0].fields[0].kind,'CELL');
 assert.deepEqual(await counts(f),before);assert.deepEqual(Buffer.from((await readImportOriginal(f.actor,f.job.id,f.config)).bytes),Buffer.from(f.original.bytes));
}));
test('private source bootstrap enables exact Mapping1 without original download and rejects revision drift',()=>fixture(async f=>{
 const before=await counts(f),source=await getImportStructuredSource(f.actor,f.job.id,f.config),{reviewRevision,...mappingSource}=source;
 assert.equal(reviewRevision,0);assert.deepEqual(mappingSource,f.mapping.source);assert.deepEqual(await counts(f),before);
 await assert.rejects(getImportStructuredSource(f.staff,f.job.id,f.config),{code:'FORBIDDEN'});
 await assert.rejects(getImportStructuredSource(f.actor,f.job.id,{...f.config,beforeRead:async()=>{await saveImportReview(f.actor,f.job.id,f.input,f.config);}}),{code:'CONFLICT'});
}));
test('UUID case aliases return canonical source/job bindings that can prepare the same mapping',()=>fixture(async f=>{
 const alias=f.job.id.toUpperCase(),source=await getImportStructuredSource(f.actor,alias,f.config);assert.equal(source.jobId,f.job.id);
 const result=await getImportStructuredPlan(f.actor,alias,f.query,f.config);assert.equal(result.jobId,f.job.id);assert.equal(result.plan.binding.jobId,f.job.id);
}));
test('review3 encrypted immutable save/reload/re-save preserves stable acknowledgment and previous history',()=>fixture(async f=>{
 const snapshot=await getImportStructuredPlan(f.actor,f.job.id,f.query,f.config),draft=structuredClone(f.input.draft);assert.equal(draft.schemaVersion,3);if(draft.schemaVersion!==3||!draft.structuredMapping)throw new Error('FIXTURE');
 draft.structuredMapping.acknowledgment=snapshot.acknowledgment;
 const saved=await saveImportReview(f.actor,f.job.id,{...f.input,draft},f.config);assert.equal(saved.reviewRevision,1);assert.deepEqual(await getImportReview(f.actor,f.job.id,f.config),saved);
 const first=(await f.pool.query('select review_encrypted from private.knowledge_import_reviews where job_id=$1 and review_revision=1',[f.job.id])).rows[0].review_encrypted;assert(!first.includes('0001'));assert(!first.includes('ระบบทะเบียน'));
 const next=await getImportStructuredPlan(f.actor,f.job.id,{...f.query,expectedReviewRevision:1},f.config);assert.equal(next.nextReviewRevision,2);assert.deepEqual(next.acknowledgment,snapshot.acknowledgment);assert.notEqual(next.plan.digest,snapshot.plan.digest);
 await saveImportReview(f.actor,f.job.id,{...f.input,draft,expectedReviewRevision:1},f.config);
 assert.equal((await f.pool.query('select review_encrypted from private.knowledge_import_reviews where job_id=$1 and review_revision=1',[f.job.id])).rows[0].review_encrypted,first);
 await assert.rejects(f.pool.query('update private.knowledge_import_reviews set payload_hash=payload_hash where job_id=$1',[f.job.id]),{code:'23514'});
}));
test('wrong source or acknowledgment and changed mapping cannot append a review',()=>fixture(async f=>{
 const snapshot=await getImportStructuredPlan(f.actor,f.job.id,f.query,f.config),draft=structuredClone(f.input.draft);if(draft.schemaVersion!==3||!draft.structuredMapping)throw new Error('FIXTURE');
 draft.structuredMapping.acknowledgment={...snapshot.acknowledgment,contentDigest:'f'.repeat(64)};
 await assert.rejects(saveImportReview(f.actor,f.job.id,{...f.input,draft},f.config),{code:'INVALID_REQUEST'});
 draft.structuredMapping.acknowledgment=snapshot.acknowledgment;draft.structuredMapping.mapping.tables[0].fields.description={kind:'CONSTANT',value:'Changed',note:'Changed after preview'};
 await assert.rejects(saveImportReview(f.actor,f.job.id,{...f.input,draft},f.config),{code:'INVALID_REQUEST'});
 await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,{...f.query,mapping:{...f.mapping,source:{...f.mapping.source,sourceChecksum:'f'.repeat(64)}}},f.config),{code:'STRUCTURED_MAPPING_BINDING_MISMATCH'});
 assert.equal((await counts(f)).reviews,'0');
}));
test('legacy overwrite of review3 fails while explicit clear remains review3 and retains history',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 for(const draft of [unfinishedReviewDraft(),{...unfinishedReviewDraft(),schemaVersion:2,chunkPlan:null}])await assert.rejects(saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1,draft},f.config),{code:'CONFLICT'});
 const draft={...f.input.draft,structuredMapping:null};await saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1,draft},f.config);
 assert.equal((await counts(f)).reviews,'2');await assert.rejects(saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:2,draft:unfinishedReviewDraft()},f.config),{code:'CONFLICT'});
}));
test('ordinary/revoked/canceled actors and stale review/extraction receive no private artifact',()=>fixture(async f=>{
 await assert.rejects(getImportStructuredPlan(f.staff,'invalid',{bad:true},f.config),{code:'FORBIDDEN'});
 await assert.rejects(saveImportReview(f.staff,f.job.id,f.input,f.config),{code:'FORBIDDEN'});
 await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);}}),{code:'FORBIDDEN'});
 await f.pool.query('update public.staff_profiles set active=true where id=$1',[f.actor]);const controller=new AbortController();
 await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,signal:controller.signal,beforeRead:async()=>{controller.abort();}}),{code:'CONFLICT'});
 await saveImportReview(f.actor,f.job.id,f.input,f.config);await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,f.query,f.config),{code:'CONFLICT'});
 await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,{...f.query,expectedReviewRevision:1},{...f.config,beforeRead:async()=>{await editImportExtraction(f.actor,f.job.id,1,{reason:'New source text',pages:[{index:0,text:'Revised'}]},f.config);}}),{code:'CONFLICT'});
}));
test('concurrent review3 saves have one CAS winner and no preparation transaction',()=>fixture(async f=>{
 let prepared=0,release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
 const operations=[0,1].map(()=>new Pool({connectionString,max:3,application_name:'structured-save-'+randomUUID()}));
 try{
  const results=await Promise.allSettled(operations.map(pool=>saveImportReview(f.actor,f.job.id,f.input,{...f.config,pool,beforeCommit:async()=>{
   try{const open=(await f.pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and xact_start is not null',[pool.options.application_name])).rows[0].n;assert.equal(open,0);if(++prepared===2)release();await gate;}catch(error){release();throw error;}
  }})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected?.status==='rejected'?rejected.reason.code:null,'CONFLICT');assert.equal((await counts(f)).reviews,'1');
 }finally{release();for(const pool of operations)await pool.end();}
}));
test('status change after preparation blocks review3 append and private preview',()=>fixture(async f=>{
 const fail=async()=>{await f.pool.query("update private.knowledge_import_jobs set status='FAILED',error_code='IMPORT_PARSE_INVALID' where id=$1",[f.job.id]);};
 await assert.rejects(saveImportReview(f.actor,f.job.id,f.input,{...f.config,beforeCommit:fail}),{code:'CONFLICT'});assert.equal((await counts(f)).reviews,'0');
 await f.pool.query("update private.knowledge_import_jobs set status='READY',error_code=null where id=$1",[f.job.id]);
 await assert.rejects(getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:fail}),{code:'CONFLICT'});
}));
test('existing immutable checksum guard prevents original drift during preview/save preparation',()=>fixture(async f=>{
 const changed=createHash('sha256').update(randomUUID()).digest('hex'),attempt=async()=>{await assert.rejects(f.pool.query('update private.knowledge_import_jobs set checksum=$2 where id=$1',[f.job.id,changed]),{code:'23514'});};
 const preview=await getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,beforeRead:attempt});assert.equal(preview.plan.sourceChecksum,f.original.checksum);
 const saved=await saveImportReview(f.actor,f.job.id,f.input,{...f.config,beforeCommit:attempt});assert.equal(saved.reviewRevision,1);
 assert.equal((await f.pool.query('select checksum from private.knowledge_import_jobs where id=$1',[f.job.id])).rows[0].checksum,f.original.checksum);
}));
test('schema3 publication fails explicitly before embedding and leaves all business data private',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);const before=await counts(f);
 await assert.rejects(approveImport(f.actor,{id:f.job.id,expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:1,confirmPublication:true},f.config),{code:'PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE'});
 assert.deepEqual(await counts(f),before);
}));
test('a review committed during real final job-lock wait invalidates prepared preview',()=>fixture(async f=>{
 const operationName='structured-lock-'+randomUUID(),operationPool=new Pool({connectionString,max:3,application_name:operationName}),blocker=await f.pool.connect();
 let resume:()=>void=()=>undefined,prepared:()=>void=()=>undefined;const gate=new Promise<void>(r=>{resume=r;}),ready=new Promise<void>(r=>{prepared=r;});
 const lookup=getImportStructuredPlan(f.actor,f.job.id,f.query,{...f.config,pool:operationPool,beforeRead:async()=>{prepared();await gate;}}),outcome=lookup.then(value=>({value,error:null}),error=>({value:null,error}));
 try{
  await ready;const serialized=JSON.stringify(reviewDraftSchema.parse(f.input.draft)),checksum=createHash('sha256').update(JSON.stringify(['yru:knowledge-review-receipt:v1',f.original.checksum,1,1])).digest('hex'),encrypted=encryptStagingValue(serialized,{jobId:f.job.id,checksum,revision:1,purpose:'REVIEW'},f.key);
  await blocker.query('begin');await blocker.query('select id from private.knowledge_import_jobs where id=$1 for update',[f.job.id]);
  await blocker.query('insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted) values($1,1,1,1,$2,$3,$4)',[f.job.id,f.actor,createHash('sha256').update(serialized).digest('hex'),encrypted]);
  resume();let waiting=false;for(let attempt=0;attempt<100;attempt++){waiting=(await f.pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like '%knowledge_import_jobs%') waiting",[operationName])).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
  assert(waiting,'ACTUAL_LOCK_WAIT_REQUIRED');await blocker.query('commit');assert.equal((await outcome).error?.code,'CONFLICT');assert.equal((await outcome).value,null);
 }finally{resume();await blocker.query('rollback');blocker.release();await outcome;await operationPool.end();}
}));
