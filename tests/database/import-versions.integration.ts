import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {saveImportReview} from '../../lib/imports/import-review';
import {getImportVersionResolution} from '../../lib/imports/version-resolver';
import {createImportSource} from '../../lib/imports/source';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {encryptStagingValue} from '../../lib/imports/staging-envelope';
const connectionString='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
async function fixture(work:(f:Awaited<ReturnType<typeof prepare>>)=>Promise<void>){
 const pool=new Pool({connectionString,max:6,application_name:`import-versions-${randomUUID()}`}),actor=randomUUID(),staff=randomUUID(),family=randomUUID();
 try{const f=await prepare(pool,actor,staff,family);await work(f);}
 finally{
  await pool.query('delete from public.document_relationships where source_document_id in(select id from public.documents where document_family_id=$1) or target_document_id in(select id from public.documents where document_family_id=$1)',[family]);
  await pool.query('delete from public.documents where document_family_id=$1',[family]);await pool.query('delete from public.document_families where id=$1',[family]);
  await pool.query('delete from private.knowledge_import_jobs where creator_id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
async function prepare(pool:Pool,actor:string,staff:string,family:string){
 for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Version fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
 const code='TEST_'+family.replaceAll('-','').toUpperCase(),config={pool,key:Buffer.alloc(32,93).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const};
 const original=createImportSource({bytes:Buffer.from(`<html><h1>Version fixture ${randomUUID()}</h1><p>ข้อความทดสอบส่วนตัว</p></html>`),filename:'versions.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(actor,original,config);await analyzeImportJob(actor,job.id,0,{...config,parse:async input=>parseHtmlSource(input)});
 const draft=unfinishedReviewDraft();Object.assign(draft.metadata,{familyCode:code,departmentCode:'REGISTRAR',documentType:'REGULATION',versionStream:'MAIN',academicYear:2569});Object.assign(draft.metadata.scope,{audience:'ALL',studentType:'ALL'});
 const input={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,draft},query={expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:1};
 return {pool,actor,staff,family,code,config,original,job,input,query};
}
type Fixture=Awaited<ReturnType<typeof prepare>>;
async function family(f:Fixture){await f.pool.query("insert into public.document_families(id,code,name,category) values($1,$2,'Reviewed family','Test')",[f.family,f.code]);}
async function document(f:Fixture,options:{current?:boolean;department?:string;year?:number;stream?:string;approved?:boolean}={}){
 const id=randomUUID(),approved=options.approved!==false;
 await f.pool.query(`insert into public.documents(id,document_family_id,department_id,title,document_type,version_name,version_stream,academic_year,audience,student_type,status,is_current,
 approval_status,approved_at,effective_from,extraction_reviewed,requires_review,checksum,revision,storage_path,source_url)
 values($1,$2,(select id from public.departments where code=$3),'Reviewed title','REGULATION','2569',$4,$5,'ALL','ALL',$6,$7,$8,case when $9 then clock_timestamp() else null end,'2026-01-01',$9,not $9,$10,3,'private/original','https://private.invalid')`,
 [id,f.family,options.department??'REGISTRAR',options.stream??'MAIN',options.year??2569,approved?'ACTIVE':'PENDING_REVIEW',options.current??false,approved?'APPROVED':'PENDING',approved,createHash('sha256').update(id).digest('hex')]);return id;
}
test('version lookup authorizes before input getters and private extraction work',()=>fixture(async f=>{
 const invalid=new Proxy({},{get(){throw new Error('INPUT_WAS_READ');}});
 for(const denied of [f.staff,randomUUID(),'bad'])await assert.rejects(getImportVersionResolution(denied,f.job.id,invalid,f.config),{code:'FORBIDDEN'});
 for(const role of ['SUPERVISOR','ADMIN']){
  await f.pool.query('update public.staff_profiles set role=$2 where id=$1',[f.staff,role]);
  await assert.rejects(getImportVersionResolution(f.staff,f.job.id,invalid,f.config),{code:'FORBIDDEN'});
 }
 await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);await assert.rejects(getImportVersionResolution(f.actor,f.job.id,invalid,f.config),{code:'FORBIDDEN'});
}));
test('lookup requires a saved review and exact three counters including extraction binding',()=>fixture(async f=>{
 await assert.rejects(getImportVersionResolution(f.actor,f.job.id,f.query,f.config),{code:'CONFLICT'});await saveImportReview(f.actor,f.job.id,f.input,f.config);
 for(const change of [{expectedJobRevision:2},{expectedExtractionRevision:2},{expectedReviewRevision:2}])await assert.rejects(getImportVersionResolution(f.actor,f.job.id,{...f.query,...change},f.config),{code:'CONFLICT'});
 await editImportExtraction(f.actor,f.job.id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'ข้อความใหม่'}]},f.config);
 await assert.rejects(getImportVersionResolution(f.actor,f.job.id,{...f.query,expectedJobRevision:2,expectedExtractionRevision:2},f.config),{code:'CONFLICT'});
}));
test('unfinished scope is explicit; reviewed custom family remains open and no writes occur',()=>fixture(async f=>{
 f.input.draft.metadata.scope.audience=null;await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const missing=await getImportVersionResolution(f.actor,f.job.id,f.query,f.config);assert.deepEqual(missing.missingMetadata,['audience']);assert.deepEqual(missing.availableActions,[]);
 f.input.draft.metadata.scope.audience='ALL';await saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1},f.config);
 const before=(await f.pool.query('select (select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c,(select count(*) from public.document_families) f')).rows[0];
 const result=await getImportVersionResolution(f.actor,f.job.id,{...f.query,expectedReviewRevision:2},f.config);assert.equal(result.family,null);assert.deepEqual(result.availableActions,['NEW_FAMILY']);assert.equal(result.reviewRevision,2);
 assert.deepEqual((await f.pool.query('select (select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c,(select count(*) from public.document_families) f')).rows[0],before);
 assert.equal((await f.pool.query('select revision from private.knowledge_import_jobs where id=$1',[f.job.id])).rows[0].revision,1);assert.equal((await f.pool.query('select count(*)::int n from private.knowledge_import_reviews where job_id=$1',[f.job.id])).rows[0].n,2);
 assert.deepEqual(Buffer.from((await readImportOriginal(f.actor,f.job.id,f.config)).bytes),Buffer.from(f.original.bytes));
}));
test('approved exact base offers all applicable actions and metadata-only DTO without private content',()=>fixture(async f=>{
 await family(f);const base=await document(f,{current:true});await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const result=await getImportVersionResolution(f.actor,f.job.id,f.query,f.config);assert.deepEqual(result.availableActions,['ADD_HISTORICAL']);assert.equal(result.currentStreamOccupied,true);assert.equal(result.family?.code,f.code);
 const row=result.candidates.find(r=>r.documentId===base)!;assert.deepEqual(row.targetActions,['REPLACE_CURRENT','AMEND_EXISTING','CANCELS']);assert.equal(row.revision,3);assert.equal(row.effectiveFrom,'2026-01-01');
 const serialized=JSON.stringify(result);for(const privateField of ['private/original','private.invalid','ข้อความทดสอบ','checksum','ciphertext','storage_path','source_url'])assert(!serialized.includes(privateField));
}));
test('different-department current document blocks ordinary addition but cannot become a target',()=>fixture(async f=>{
 await family(f);await document(f,{current:true,department:'IT'});await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const result=await getImportVersionResolution(f.actor,f.job.id,f.query,f.config);assert.equal(result.currentStreamOccupied,true);assert.deepEqual(result.availableActions,['ADD_HISTORICAL']);assert.equal(result.candidates[0].matchingScope,false);assert.deepEqual(result.candidates[0].targetActions,[]);
}));
test('relationship flags prevent amendment chains/cancellation-of-cancellation without hiding separate amendment cancellation',()=>fixture(async f=>{
 await family(f);const base=await document(f,{current:true}),amend=await document(f,{stream:'AMEND'}),cancel=await document(f,{stream:'CANCEL'}),pending=await document(f,{stream:'PENDING',approved:false});
 await f.pool.query("insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,'AMENDS'),($3,$1,'CANCELS')",[amend,base,cancel]);await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const result=await getImportVersionResolution(f.actor,f.job.id,f.query,f.config);assert.deepEqual(result.candidates.find(r=>r.documentId===amend)?.targetActions,['CANCELS']);assert.deepEqual(result.candidates.find(r=>r.documentId===cancel)?.targetActions,[]);assert.deepEqual(result.candidates.find(r=>r.documentId===pending)?.targetActions,[]);
}));
test('revoked actor, changed review, changed extraction or abort during preparation fails the final snapshot and holds no SQL transaction',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const noOpenTransaction=async()=>{assert.equal((await f.pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and xact_start is not null',[f.pool.options.application_name])).rows[0].n,1);};
 // The observer query itself is the sole active transaction on this application name.
 await getImportVersionResolution(f.actor,f.job.id,f.query,{...f.config,beforeRead:noOpenTransaction});
 await assert.rejects(getImportVersionResolution(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);}}),{code:'FORBIDDEN'});
 await f.pool.query('update public.staff_profiles set active=true where id=$1',[f.actor]);
 await assert.rejects(getImportVersionResolution(f.actor,f.job.id,f.query,{...f.config,beforeRead:async()=>{await saveImportReview(f.actor,f.job.id,{...f.input,expectedReviewRevision:1},f.config);}}),{code:'CONFLICT'});
 const abort=new AbortController();await assert.rejects(getImportVersionResolution(f.actor,f.job.id,{...f.query,expectedReviewRevision:2},{...f.config,signal:abort.signal,beforeRead:async()=>{abort.abort();}}),{code:'CONFLICT'});
 await assert.rejects(getImportVersionResolution(f.actor,f.job.id,{...f.query,expectedReviewRevision:2},{...f.config,beforeRead:async()=>{await editImportExtraction(f.actor,f.job.id,1,{reason:'แก้ข้อความ',pages:[{index:0,text:'ฉบับใหม่'}]},f.config);}}),{code:'CONFLICT'});
}));
test('over one hundred family versions fails closed without exposing a misleading truncated target list',()=>fixture(async f=>{
 await family(f);await f.pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,checksum)
 select $1,'Bounded candidate','test','TEST_'||n,encode(extensions.digest(n::text,'sha256'),'hex') from generate_series(1,102) n`,[f.family]);
 await f.pool.query(`update public.documents set version_stream='MAIN',is_current=true,status='ACTIVE',approval_status='APPROVED',approved_at=clock_timestamp(),effective_from='2026-01-01',extraction_reviewed=true,requires_review=false
 where id=(select id from public.documents where document_family_id=$1 order by id desc limit 1)`,[f.family]);await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const result=await getImportVersionResolution(f.actor,f.job.id,f.query,f.config);assert.equal(result.limitExceeded,true);assert.deepEqual(result.availableActions,[]);assert.deepEqual(result.candidates,[]);assert.equal(result.currentStreamOccupied,true);
}));
test('a committed review append during final job-lock wait cannot reuse the older statement snapshot',()=>fixture(async f=>{
 await saveImportReview(f.actor,f.job.id,f.input,f.config);
 const operationName=`version-lock-wait-${randomUUID()}`,operationPool=new Pool({connectionString,max:3,application_name:operationName});
 const blocker=await f.pool.connect();let resume:()=>void=()=>undefined,prepared:()=>void=()=>undefined;
 const gate=new Promise<void>(resolve=>{resume=resolve;}),ready=new Promise<void>(resolve=>{prepared=resolve;});
 const lookup=getImportVersionResolution(f.actor,f.job.id,f.query,{...f.config,pool:operationPool,beforeRead:async()=>{prepared();await gate;}});
 // Attach the observer immediately; the fixture still awaits its actual result below.
 const outcome=lookup.then(value=>({value,error:null}),error=>({value:null,error}));
 try{
  await ready;
  const serialized=JSON.stringify(f.input.draft),checksum=createHash('sha256').update(JSON.stringify(['yru:knowledge-review-receipt:v1',f.original.checksum,1,1])).digest('hex');
  const encrypted=encryptStagingValue(serialized,{jobId:f.job.id,checksum,revision:2,purpose:'REVIEW'},f.config.key);
  await blocker.query('begin');await blocker.query('select id from private.knowledge_import_jobs where id=$1 for update',[f.job.id]);
  await blocker.query('insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted) values($1,2,1,1,$2,$3,$4)',[f.job.id,f.actor,createHash('sha256').update(serialized).digest('hex'),encrypted]);
  resume();let waiting=false;
  for(let attempt=0;attempt<100;attempt++){
   waiting=(await f.pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like '%knowledge_import_jobs%') waiting",[operationName])).rows[0].waiting;
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(waiting,'ACTUAL_JOB_LOCK_WAIT_REQUIRED');await blocker.query('commit');
  const result=await outcome;assert.equal(result.error?.code,'CONFLICT');assert.equal(result.value,null);
 }finally{resume();await blocker.query('rollback');blocker.release();await outcome;await operationPool.end();}
}));
