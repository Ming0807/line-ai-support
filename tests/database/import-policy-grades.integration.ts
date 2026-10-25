import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob,getImportPreview,editImportExtraction} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {resolveImportReviewVersions} from '../../lib/imports/version-resolver';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {approveImport,getImportPublication} from '../../lib/imports/import-publication';
import type {ImportReviewDraft} from '../../lib/imports/review-schema';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>,privateOriginal=false){
 const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4}),actor=randomUUID(),staff=randomUUID();
 try{assert.equal((await pool.query('select current_database() name')).rows[0].name,database);await work(await setup(pool,actor,staff,privateOriginal));}
 finally{
  try{
   await pool.query('delete from private.knowledge_original_uploads where creator_id=$1',[actor]);
   await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);
   await pool.query('delete from public.knowledge_chunks where document_id in (select id from public.documents where approved_by=$1)',[actor]);
   await pool.query('delete from public.documents where approved_by=$1',[actor]);
   await pool.query('delete from public.document_families where code=$1',['GRADE_POLICY_'+actor.replaceAll('-','').toUpperCase()]);
   await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
   await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
   await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);
  }finally{await pool.end();}
 }
}
async function setup(pool:Pool,actor:string,staff:string,privateOriginal:boolean){
 for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
  await pool.query('insert into auth.users(id) values($1)',[id]);
  await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Policy review fixture',true,(select id from public.departments where code='IT'))",[id,role]);
 }
 let encodes=0;
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  countPassageTokens:async texts=>texts.map(()=>25),embedPassages:async texts=>{encodes++;return texts.map(()=>[1,...Array(383).fill(0)]);},
  embedQuery:async()=>{throw Error('NO_QUERY_IN_PUBLICATION');},healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const originals=new Map<string,Uint8Array>();let downloads=0;
 const options={pool,key:Buffer.alloc(32,93).toString('base64'),originalBackend:privateOriginal?'PRIVATE_STORAGE' as const:'PRIVATE_DATABASE' as const,provider,counter:provider,
  ...(privateOriginal?{storage:{upload:async(id:string,_ref:unknown,envelope:Uint8Array)=>{originals.set(id,Uint8Array.from(envelope));},
   download:async(id:string)=>{downloads++;assert(originals.has(id));return Uint8Array.from(originals.get(id)!);}}}:{})};
 async function ready(extra='',sensitivityStatus:'FALSE_POSITIVE'|'CORRECTED'='FALSE_POSITIVE'){
  const url=`https://www.yru.ac.th/policy-fixture/${randomUUID()}`;
  const source=createImportSource({bytes:new TextEncoder().encode(`<html><h1>ระเบียบสังเคราะห์เพื่อทดสอบเท่านั้น</h1><p>หลักเกณฑ์ผลการเรียนเป็นข้อความทั่วไป ไม่ใช่ผลของนักศึกษารายบุคคล</p>${extra}</html>`),filename:'policy.html',mimeType:'text/html',sourceUrl:url,acquiredFrom:'UPLOAD',fetchedAt:null});
  const {job}=await createImportJob(actor,source,options);await analyzeImportJob(actor,job.id,0,options);
  const preview=await getImportPreview(actor,job.id,options),state=await getImportReview(actor,job.id,options),base=unfinishedReviewDraft();
  const draft:ImportReviewDraft={...base,schemaVersion:2,metadata:{...base.metadata,title:'Synthetic policy fixture',familyCode:'GRADE_POLICY_'+actor.replaceAll('-','').toUpperCase(),
   newFamily:{name:'Synthetic policy review',category:'TEST_ONLY'},departmentCode:'IT',documentType:'REGULATION',versionName:'fixture',versionStream:'ALL',
   scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:60,sourceUrl:url,sourcePageUrl:url,visibility:'PUBLIC',storageMode:'RAG'},
   action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},
   warningDispositions:state.warnings.map(w=>({warningKey:w.key,status:w.code==='SENSITIVE_DATA_REVIEW_REQUIRED'?sensitivityStatus:'CORRECTED',
    reason:'Root test reviewer checked every synthetic source block: generic policy wording only; no personal record. This is not a real YRU regulation.'})),chunkPlan:null};
  let saved=await saveImportReview(actor,job.id,{expectedJobRevision:state.jobRevision,expectedExtractionRevision:state.extractionRevision,expectedReviewRevision:state.reviewRevision,draft},options);
  const plan=await getImportChunkPlan(actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},options);
  const planned:ImportReviewDraft={...draft,chunkPlan:{digest:plan.plan.digest,chunkerVersion:plan.plan.chunkerVersion}};
  saved=await saveImportReview(actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,draft:planned},options);
  return {preview,saved,draft:planned,source,request:{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true as const}};
 }
 const documentCount=async()=>(await pool.query('select count(*)::int n from public.documents where approved_by=$1',[actor])).rows[0].n;
 return {pool,actor,staff,options,ready,documentCount,encodes:()=>encodes,downloads:()=>downloads};
}

test('reviewed generic grade-policy publication keeps detector/review evidence and replays its immutable receipt',()=>fixture(async f=>{
 const r=await f.ready();assert.deepEqual(r.preview.analysis.sensitiveCategories,['GRADES']);assert.equal(r.preview.analysis.sensitiveRisk,true);
 await assert.rejects(approveImport(f.staff,r.request,f.options),/FORBIDDEN/);
 const published=await approveImport(f.actor,r.request,f.options),encoded=f.encodes();assert.equal(published.receipt.storageMode,'RAG');
 assert.equal((await f.pool.query('select visibility from public.documents where id=$1',[published.receipt.documentId])).rows[0].visibility,'PUBLIC');
 assert.deepEqual((await getImportPreview(f.actor,r.request.id,f.options)).analysis.sensitiveCategories,['GRADES']);
 assert.deepEqual((await getImportReview(f.actor,r.request.id,f.options)).saved?.draft.warningDispositions,r.draft.warningDispositions);
 const replay=await approveImport(f.actor,r.request,f.options);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,published.receipt);assert.equal(f.encodes(),encoded);
 assert.equal(await f.documentCount(),1);
}));
test('generic policy CORRECTED is not a false-positive decision and cannot publish',()=>fixture(async f=>{
 const r=await f.ready('','CORRECTED');await assert.rejects(approveImport(f.actor,r.request,f.options),/PUBLICATION_PUBLIC_SENSITIVE_DATA/);
 assert.equal(await f.documentCount(),0);assert.equal((await getImportPublication(f.actor,r.request.id,f.options)).receipt,null);
}));
test('a table-bearing source cannot use the grade-policy adjudication',()=>fixture(async f=>{
 const r=await f.ready('<table><tr><td>รายการ</td><td>ผลการเรียน</td></tr></table>');
 await assert.rejects(approveImport(f.actor,r.request,f.options),/PUBLICATION_PUBLIC_SENSITIVE_DATA/);assert.equal(await f.documentCount(),0);
}));
test('student-record findings remain blocked even if every sensitivity warning is marked false positive',()=>fixture(async f=>{
 const r=await f.ready('<p>รายชื่อนักศึกษา รหัสนักศึกษา SAMPLE_ONLY ผลการเรียน</p>');assert(r.preview.analysis.sensitiveCategories.includes('STUDENT_RECORDS'));
 await assert.rejects(approveImport(f.actor,r.request,f.options),/PUBLICATION_PUBLIC_SENSITIVE_DATA/);assert.equal(await f.documentCount(),0);
}));
test('changing the adjudicated review during vector preparation rejects stale publication',()=>fixture(async f=>{
 const r=await f.ready();await assert.rejects(approveImport(f.actor,r.request,{...f.options,beforeCommit:async()=>{
  await saveImportReview(f.actor,r.request.id,{expectedJobRevision:r.saved.jobRevision,expectedExtractionRevision:r.saved.extractionRevision,expectedReviewRevision:r.saved.reviewRevision,
   draft:{...r.draft,warningDispositions:r.draft.warningDispositions.map(d=>({...d,status:'CORRECTED'}))}},f.options);
 }}),/CONFLICT/);assert.equal(await f.documentCount(),0);assert.equal((await getImportPublication(f.actor,r.request.id,f.options)).receipt,null);
}));

test('one approval reads the private original once and still publishes exact reviewed source and receipt',()=>fixture(async f=>{
 const r=await f.ready(),before=f.downloads();const approved=await approveImport(f.actor,r.request,f.options);
 assert.equal(f.downloads()-before,1,'one authenticated operation must not repeatedly download the same encrypted source');
 assert.equal((await getImportPublication(f.actor,r.request.id,f.options)).receipt?.documentId,approved.receipt.documentId);
 assert.equal(await f.documentCount(),1);
 assert.equal((await f.pool.query('select checksum from public.documents where id=$1',[approved.receipt.documentId])).rows[0].checksum,r.source.checksum);
},true));

test('reused review metadata is bound to its stored hash and current actor authorization',()=>fixture(async f=>{
 const r=await f.ready(),review=await getImportReview(f.actor,r.request.id,f.options);
 const expected={expectedJobRevision:r.saved.jobRevision,expectedExtractionRevision:r.saved.extractionRevision,expectedReviewRevision:r.saved.reviewRevision};
 assert(review.saved);
 await assert.rejects(resolveImportReviewVersions(f.staff,r.request.id,review,expected,f.options),/FORBIDDEN/);
 const forged={...review,saved:{...review.saved,draft:{...review.saved.draft,metadata:{...review.saved.draft.metadata,familyCode:'FORGED_METADATA'}}}};
 await assert.rejects(resolveImportReviewVersions(f.actor,r.request.id,forged,expected,f.options),/CONFLICT/);
 const genuine=await resolveImportReviewVersions(f.actor,r.request.id,review,expected,f.options);
 assert(genuine.availableActions.includes('NEW_FAMILY'));assert.equal(await f.documentCount(),0);
}));

test('changed extraction after preparation cannot publish its stale reviewed snapshot',()=>fixture(async f=>{
 const r=await f.ready();await assert.rejects(approveImport(f.actor,r.request,{...f.options,beforeCommit:async()=>{
  await editImportExtraction(f.actor,r.request.id,r.saved.jobRevision,{reason:'Changed controlled extraction during preparation',pages:[{index:0,text:'Updated synthetic policy text.'}]},f.options);
 }}),/CONFLICT/);
 assert.equal(await f.documentCount(),0);assert.equal((await getImportPublication(f.actor,r.request.id,f.options)).receipt,null);
}));

test('forged current counters cannot rebind a review receipt to a newer extraction',()=>fixture(async f=>{
 const r=await f.ready(),review=await getImportReview(f.actor,r.request.id,f.options);assert(review.saved);
 const changed=await editImportExtraction(f.actor,r.request.id,r.saved.jobRevision,{reason:'New controlled extraction invalidates the old review',pages:[{index:0,text:'Updated synthetic policy text.'}]},f.options);
 const forged={...review,stale:false,jobRevision:changed.job.revision,extractionRevision:changed.extractionRevision,
  saved:{...review.saved,jobRevision:changed.job.revision,extractionRevision:changed.extractionRevision}};
 const expected={expectedJobRevision:changed.job.revision,expectedExtractionRevision:changed.extractionRevision,expectedReviewRevision:review.reviewRevision};
 await assert.rejects(resolveImportReviewVersions(f.actor,r.request.id,forged,expected,f.options),/CONFLICT/);
 assert.equal(await f.documentCount(),0);assert.equal((await getImportPublication(f.actor,r.request.id,f.options)).receipt,null);
}));
