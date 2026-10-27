import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,mock} from 'node:test';
import {PDFParse} from 'pdf-parse';
import {Pool} from 'pg';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob,getImportPreview,editImportExtraction} from '../../lib/imports/import-extraction';
import {parsePdfSource} from '../../lib/imports/pdf-parser';
import {createPdfFixture} from '../fixtures/import-pdf';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {approveImport,getImportPublication} from '../../lib/imports/import-publication';
import {reviewDraftSchema} from '../../lib/imports/review-schema';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const vector=[1,...Array(383).fill(0)];
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){
 const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:3}),actor=randomUUID();
 try{assert.equal((await pool.query('select current_database() name')).rows[0].name,database);await work(await setup(pool,actor));}
 finally{try{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);
  await pool.query('delete from public.knowledge_chunks where document_id in (select id from public.documents where approved_by=$1)',[actor]);
  await pool.query('delete from public.document_relationships where source_document_id in (select id from public.documents where approved_by=$1) or target_document_id in (select id from public.documents where approved_by=$1)',[actor]);
  await pool.query('delete from public.documents where approved_by=$1',[actor]);
  await pool.query('delete from public.document_families where code like $1',['PUBLIC_'+actor.replaceAll('-','').toUpperCase()+'%']);
  await pool.query('delete from private.activities where actor_id=$1',[actor]);await pool.query('delete from public.staff_profiles where id=$1',[actor]);await pool.query('delete from auth.users where id=$1',[actor]);
 }finally{await pool.end();}}
}
async function setup(pool:Pool,actor:string){
 await pool.query('insert into auth.users(id) values($1)',[actor]);await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Synthetic public-source reviewer',true)",[actor]);
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,countPassageTokens:async texts=>texts.map(()=>25),embedPassages:async texts=>texts.map(()=>vector),embedQuery:async()=>vector,healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const options={pool,key:Buffer.alloc(32,95).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
 async function ready(body='เวลาเปิดบริการตามหน้าเว็บทางการ',kind:'GUIDE'|'FORM'|'ANNOUNCEMENT'='GUIDE',dated=false){
  const family='PUBLIC_'+actor.replaceAll('-','').toUpperCase()+'_'+randomUUID().slice(0,8).toUpperCase(),url=`https://www.yru.ac.th/qa-public-source/${randomUUID()}`;
  const source=createImportSource({bytes:new TextEncoder().encode(`<html><body><h1>เอกสารสังเคราะห์ทดสอบเท่านั้น</h1><p>${body}</p><p>Fixture ${family}</p></body></html>`),filename:'fixture.html',mimeType:'text/html',sourceUrl:url,acquiredFrom:'UPLOAD',fetchedAt:null});
  const {job}=await createImportJob(actor,source,options);const preview=await analyzeImportJob(actor,job.id,0,options),review=await getImportReview(actor,job.id,options),base=unfinishedReviewDraft();
  const draft=reviewDraftSchema.parse({...base,schemaVersion:4,metadata:{...base.metadata,title:'Synthetic public-source fixture',familyCode:family,newFamily:{name:family,category:'TEST_ONLY'},departmentCode:'IT',documentType:kind,versionName:'fixture',versionStream:'ALL',academicYear:2569,scope:{...base.metadata.scope,audience:kind==='ANNOUNCEMENT'?'ปริญญาตรี':'ALL',studentType:kind==='ANNOUNCEMENT'?'ภาคปกติ':'ALL',cohort:kind==='ANNOUNCEMENT'?2568:null},publishedAt:kind==='ANNOUNCEMENT'?'2025-06-06':null,effectiveFrom:dated?'2026-01-01':null,authorityLevel:50,sourceUrl:url,sourcePageUrl:url,visibility:'PUBLIC',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:null,structuredMapping:null,
   publicSourceReview:{temporalBasis:dated?'DATED':'CURRENT_REVIEWED',temporalReason:dated?null:'Reviewer inspected the current official source; no source effective date claimed.',sensitivityAdjudications:preview.analysis.sensitiveCategories.map(category=>({category,basis:kind==='FORM'?'PUBLIC_BLANK_TEMPLATE':category==='PHONE'?'INSTITUTIONAL_CONTACT':'GENERAL_POLICY_WORDING',reason:'All synthetic source blocks inspected; no filled personal records.'}))},warningDispositions:review.warnings.map(w=>({warningKey:w.key,status:w.code==='SENSITIVE_DATA_REVIEW_REQUIRED'?'FALSE_POSITIVE':'CORRECTED',reason:'Synthetic source reviewed in full; all warning evidence retained.'}))});
  let saved=await saveImportReview(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:review.reviewRevision,draft},options);
  const planned=await getImportChunkPlan(actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},options);
  saved=await saveImportReview(actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,draft:{...draft,chunkPlan:{digest:planned.plan.digest,chunkerVersion:planned.plan.chunkerVersion}}},options);
  return {family,jobId:job.id,source,request:{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true as const},saved,preview};
 }
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 async function search(family:string,extra:Partial<KnowledgeScope>={}){const c=await pool.connect();try{await c.query('begin read only');return await searchKnowledge(c,{scope:{...scope,familyCodes:[family],...extra},vector,fingerprint:provider.fingerprint,threshold:-1});}finally{await c.query('rollback').catch(()=>{});c.release();}}
 return {pool,actor,options,ready,search};
}
test('normal current-only publication retains unknown dates, immutable server review time and idempotent receipt',()=>fixture(async f=>{
 const r=await f.ready();const published=await approveImport(f.actor,r.request,f.options);
 const row=(await f.pool.query('select published_at,effective_from,effective_to,temporal_basis,current_reviewed_at from public.documents where id=$1',[published.receipt.documentId])).rows[0];
 assert.equal(row.published_at,null);assert.equal(row.effective_from,null);assert.equal(row.effective_to,null);assert.equal(row.temporal_basis,'CURRENT_REVIEWED');assert(row.current_reviewed_at instanceof Date);
 assert.deepEqual((await getImportPublication(f.actor,r.jobId,f.options)).receipt,published.receipt);assert.deepEqual((await approveImport(f.actor,r.request,f.options)).receipt,published.receipt);
 await assert.rejects(f.pool.query("update public.documents set current_reviewed_at=clock_timestamp() where id=$1",[published.receipt.documentId]));
 const evidence=await f.search(r.family);assert(evidence.some(e=>e.documentId===published.receipt.documentId&&e.ruleProof&&e.sourceLocations?.length));
 assert.equal((await f.search(r.family,{historical:true,asOfDate:'2026-10-26'})).length,0);assert.equal((await f.search(r.family,{historical:true,academicYear:2569})).length,0);
 await f.pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[published.receipt.documentId]);assert.equal((await f.search(r.family)).length,0,'revoking public visibility must remain possible');
}));
test('normal dated schema4 publication keeps explicit effective date and supports historical retrieval with unknown publication date',()=>fixture(async f=>{
 const r=await f.ready(undefined,undefined,true),published=await approveImport(f.actor,r.request,f.options);
 const row=(await f.pool.query('select temporal_basis,current_reviewed_at,published_at from public.documents where id=$1',[published.receipt.documentId])).rows[0];assert.equal(row.temporal_basis,'DATED');assert.equal(row.current_reviewed_at,null);assert.equal(row.published_at,null);
 assert((await f.search(r.family,{historical:true,asOfDate:'2026-10-01'})).some(e=>e.documentId===published.receipt.documentId));
}));
test('normal current notice publication is limited to the exact cohort/degree/study-type and cannot lose that scope',()=>fixture(async f=>{
 const r=await f.ready('Synthetic current activity notice for a specific cohort','ANNOUNCEMENT'),published=await approveImport(f.actor,r.request,f.options);
 const exact={cohort:2568,audience:'ปริญญาตรี',studentType:'ภาคปกติ'};
 assert((await f.search(r.family,exact)).some(e=>e.documentId===published.receipt.documentId));
 for(const extra of [{...exact,cohort:2569},{...exact,cohort:null},{...exact,audience:'ปริญญาโท'},{...exact,studentType:'กศ.บป.'},{...exact,historical:true,asOfDate:'2026-10-26'}])assert.equal((await f.search(r.family,extra)).length,0);
 for(const field of ['cohort','published_at','audience','student_type'])await assert.rejects(f.pool.query(`update public.documents set ${field}=null where id=$1`,[published.receipt.documentId]));
 assert.deepEqual((await approveImport(f.actor,r.request,f.options)).receipt,published.receipt);
}));
test('normal reviewed public blank template and office contact retain warnings and source proofs',()=>fixture(async f=>{
 for(const [text,type]of [['คำร้อง รหัสนักศึกษา ........ ผลการเรียน ........','FORM'],['โทรศัพท์: 073299675 ต่อ23300 เวลาเปิดบริการ','GUIDE']] as const){
  const r=await f.ready(text,type),published=await approveImport(f.actor,r.request,f.options);const preview=await getImportPreview(f.actor,r.jobId,f.options);assert(preview.analysis.sensitiveRisk);assert(preview.analysis.sensitiveCategories.length>0);assert((await f.search(r.family)).some(e=>e.documentId===published.receipt.documentId));
 }
}));
test('normal public review refuses populated identifiers and personal mobile even when a reviewer labels them public',()=>fixture(async f=>{
 for(const [text,type]of [['คำร้อง รหัสนักศึกษา 4069123456 ผลการเรียน 3.50','FORM'],['โทรศัพท์: 0812345678','GUIDE']] as const){const r=await f.ready(text,type);await assert.rejects(approveImport(f.actor,r.request,f.options),/PUBLICATION_PUBLIC_SENSITIVE_DATA/u);assert.equal((await getImportPublication(f.actor,r.jobId,f.options)).receipt,null);}
}));
test('saved schema4 cannot downgrade and unknown-date document cannot become an amendment source or target',()=>fixture(async f=>{
 const r=await f.ready(),review=await getImportReview(f.actor,r.jobId,f.options);assert(review.saved&&review.saved.draft.schemaVersion===4);
 const {publicSourceReview:discarded,...old}=review.saved.draft;void discarded;
 await assert.rejects(saveImportReview(f.actor,r.jobId,{expectedJobRevision:review.jobRevision,expectedExtractionRevision:review.extractionRevision,expectedReviewRevision:review.reviewRevision,draft:{...old,schemaVersion:3}},f.options),/CONFLICT/u);
 const published=await approveImport(f.actor,r.request,f.options),dated=await f.ready(undefined,undefined,true),datedPublished=await approveImport(f.actor,dated.request,f.options);
 for(const [source,target]of [[published.receipt.documentId,datedPublished.receipt.documentId],[datedPublished.receipt.documentId,published.receipt.documentId]])await assert.rejects(f.pool.query("insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,'AMENDS')",[source,target]));
 const replacement=await f.ready('Synthetic replacement request',undefined,true),candidate=await getImportReview(f.actor,replacement.jobId,f.options);assert(candidate.saved&&candidate.saved.draft.schemaVersion===4);
 const draft={...candidate.saved.draft,metadata:{...candidate.saved.draft.metadata,familyCode:r.family,newFamily:null},action:'REPLACE_CURRENT' as const,target:{documentId:published.receipt.documentId,revision:0}};
 const saved=await saveImportReview(f.actor,replacement.jobId,{expectedJobRevision:candidate.jobRevision,expectedExtractionRevision:candidate.extractionRevision,expectedReviewRevision:candidate.reviewRevision,draft},f.options);
 await assert.rejects(approveImport(f.actor,{...replacement.request,expectedReviewRevision:saved.reviewRevision},f.options),/CONFLICT/u);assert.equal((await getImportPublication(f.actor,replacement.jobId,f.options)).receipt,null);
}));
for(const documentType of ['FORM','GUIDE'] as const)test(`normal source-bound ${documentType} diagram review retains the blocking finding`,()=>fixture(async f=>{
 const url=`https://www.yru.ac.th/qa-diagram/${randomUUID()}`;
 const source=createImportSource({bytes:createPdfFixture([{lines:[{text:'Credit overload form workflow',y:720},{text:'Complete the request form and submit to the faculty.',y:690},{text:'If rejected by a committee, notify the applicant.',y:660}]}]),filename:'diagram.pdf',mimeType:'application/pdf',sourceUrl:url,acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(f.actor,source,f.options);
 const detector=mock.method(PDFParse.prototype,'getTable',async()=>({total:1,pages:[{num:1,tables:documentType==='FORM'?[[[],[''],['']]]:[[],[]]}],mergedTables:[]}));
 let preview;try{preview=await analyzeImportJob(f.actor,job.id,0,{...f.options,parse:parsePdfSource});}finally{detector.mock.restore();}
 preview=await editImportExtraction(f.actor,job.id,preview.job.revision,{pages:[{index:0,text:preview.extraction.pages[0].text+'\nSource page manually checked in this synthetic fixture; empty boxes are a process diagram.'}],reason:'Every source step and branch checked; original and empty geometry retained.'},f.options);
 const review=await getImportReview(f.actor,job.id,f.options),base=unfinishedReviewDraft(),family='PUBLIC_'+f.actor.replaceAll('-','').toUpperCase()+'_DIAGRAM';
 const draft=reviewDraftSchema.parse({...base,schemaVersion:4,metadata:{...base.metadata,title:'Synthetic diagram workflow',familyCode:family,newFamily:{name:family,category:'TEST_ONLY'},departmentCode:'IT',documentType,versionName:'reviewed',versionStream:'ALL',scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},authorityLevel:50,sourceUrl:url,visibility:'PUBLIC',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:null,structuredMapping:null,
  publicSourceReview:{temporalBasis:'CURRENT_REVIEWED',temporalReason:'Reviewed current form; no source effective date stated.',sensitivityAdjudications:[],extractionAdjudications:review.warnings.filter(w=>w.code==='UNSUPPORTED_TABLES').map(w=>({warningKey:w.key,basis:'REVIEWED_NON_TABULAR_DIAGRAM',reason:'Read the whole synthetic source page: all detected cells empty, full flow text checked.'}))},
  warningDispositions:review.warnings.map(w=>({warningKey:w.key,status:w.code==='UNSUPPORTED_TABLES'?'FALSE_POSITIVE':'CORRECTED',reason:'Synthetic original source fully reviewed; no warning removed.'}))});
 let saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:review.reviewRevision,draft},f.options);
 const plan=await getImportChunkPlan(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},f.options);
 saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,draft:{...draft,chunkPlan:{digest:plan.plan.digest,chunkerVersion:plan.plan.chunkerVersion}}},f.options);
 const request={id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true};
 const published=await approveImport(f.actor,request,f.options);assert.deepEqual((await approveImport(f.actor,request,f.options)).receipt,published.receipt);
 const retained=await getImportPreview(f.actor,job.id,f.options);assert(retained.extraction.report.warnings.some(w=>w.code==='UNSUPPORTED_TABLES'&&w.severity==='BLOCKING'));if(documentType==='GUIDE')assert.equal(retained.extraction.tables.length,0);assert((await f.search(family)).some(e=>e.documentId===published.receipt.documentId&&e.sourceLocations?.some(l=>l.kind==='PDF'&&l.pageNumber===1)));
}));
