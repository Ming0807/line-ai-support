import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {listKnowledgeCatalog,getKnowledgeFamily,getKnowledgeDocument} from '../../lib/knowledge/catalog';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {approveImport} from '../../lib/imports/import-publication';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
const base={q:null,departmentCode:null,status:null,page:1,pageSize:10};
async function fixture(work:(f:{pool:Pool;actor:string;staff:string;family:string;empty:string;code:string;ids:string[];pending:string})=>Promise<void>){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4}),actor=randomUUID(),staff=randomUUID(),family=randomUUID(),empty=randomUUID(),pending=randomUUID(),ids=Array.from({length:7},()=>randomUUID()),code='CAT_'+actor.replaceAll('-','').toUpperCase();
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Catalog fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
  await pool.query("insert into public.document_families(id,code,name,category,default_storage_mode) values($1,$2,'Catalog test','Fixture','BOTH'),($3,$4,'Empty catalog','Fixture','RAG')",[family,code,empty,code+'_EMPTY']);
  await pool.query("insert into public.documents(id,document_family_id,title,version_name,version_stream,checksum,approved_by) values($1::uuid,$2,'Unapproved hidden','pending','pending',replace(($1::uuid)::text,'-','')||replace(($1::uuid)::text,'-',''),$3)",[pending,family,actor]);
  for(const [i,id] of ids.entries())await pool.query(`insert into public.documents(id,document_family_id,department_id,title,version_name,version_stream,academic_year,published_at,effective_from,status,is_current,approval_status,approved_by,approved_at,extraction_reviewed,requires_review,visibility,checksum,supersedes_document_id,source_url,storage_path)
   values($1::uuid,$2,(select id from public.departments where code=$3),$4,$5,$6,2569,'2026-01-01',$7,$8,$9,'APPROVED',$10,'2026-01-01T00:00:00Z',true,false,$11,replace(($1::uuid)::text,'-','')||replace(($1::uuid)::text,'-',''),$12,'https://fixture.yru.ac.th/source.pdf','PRIVATE_PATH_NEVER_RETURN')`,
   [id,family,i%2===0?'IT':'FINANCE',i===0?'Legacy %_ literal':'Version '+i,'V'+i,i===0?'main':i===1?'parallel':'history',i===1?'2027-01-01':'2026-01-01',i<2?'ACTIVE':'SUPERSEDED',i<2,actor,i===0?'RESTRICTED':'INTERNAL',i===0?pending:null]);
  await pool.query("insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,'AMENDS'),($1,$3,'RELATED_TO')",[ids[1],ids[0],pending]);
  await work({pool,actor,staff,family,empty,code,ids,pending});
 }finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);
  await pool.query('delete from public.document_relationships where source_document_id in (select id from public.documents where document_family_id=any($1::uuid[])) or target_document_id in (select id from public.documents where document_family_id=any($1::uuid[]))',[[family,empty]]);
  await pool.query('delete from public.knowledge_chunks where document_id in (select id from public.documents where document_family_id=any($1::uuid[]))',[[family,empty]]);
  await pool.query('update public.documents set supersedes_document_id=null where document_family_id=any($1::uuid[])',[[family,empty]]);
  await pool.query('delete from public.documents where document_family_id=any($1::uuid[])',[[family,empty]]);
  await pool.query('delete from public.document_families where id=any($1::uuid[])',[[family,empty]]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
test('catalog authenticates active admin before malicious query/ID or cancellation input',()=>fixture(async f=>{
 const poisoned={get q(){throw new Error('INPUT_BEFORE_AUTH');}};
 await assert.rejects(listKnowledgeCatalog(f.staff,poisoned,{pool:f.pool}),/FORBIDDEN/);
 await assert.rejects(getKnowledgeFamily(f.staff,'bad',poisoned,{pool:f.pool}),/FORBIDDEN/);
 await assert.rejects(getKnowledgeDocument(f.staff,'bad',poisoned,{pool:f.pool}),/FORBIDDEN/);
 const controller=new AbortController();controller.abort();await assert.rejects(listKnowledgeCatalog(f.actor,base,{pool:f.pool,signal:controller.signal}),/CONFLICT/);
 await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);await assert.rejects(listKnowledgeCatalog(f.actor,base,{pool:f.pool}),/FORBIDDEN/);
}));
test('approved inventory keeps empty families, exact totals, five previews and literal filters',()=>fixture(async f=>{
 const options={pool:f.pool},catalog=await listKnowledgeCatalog(f.actor,{...base,q:f.code},options);
 assert.equal(catalog.totalFamilies,2);assert.equal(catalog.totalDocuments,7);assert.equal(catalog.families.length,2);const family=catalog.families.find(v=>v.id===f.family)!;assert.equal(family.documentCount,7);assert.equal(family.versionsPreview.length,5);assert.equal(family.hasMoreVersions,true);assert.equal(catalog.families.find(v=>v.id===f.empty)?.documentCount,0);
 assert(family.versionsPreview.every(v=>v.storageMode===null&&v.lastImportAt===null));assert.equal(family.defaultStorageMode,'BOTH');assert(catalog.departments.some(d=>d.code==='IT'&&d.name));
 const filtered=await listKnowledgeCatalog(f.actor,{...base,q:f.code,departmentCode:'IT',status:'SUPERSEDED'},options);assert.equal(filtered.totalFamilies,1);assert.equal(filtered.totalDocuments,3);assert(filtered.families[0].versionsPreview.every(v=>v.status==='SUPERSEDED'&&v.department?.code==='IT'));
 const literal=await listKnowledgeCatalog(f.actor,{...base,q:'%_'},options);assert.equal(literal.totalDocuments,1);assert.equal(literal.families[0].versionsPreview[0].id,f.ids[0]);
 const page1=await listKnowledgeCatalog(f.actor,{...base,q:f.code,pageSize:1},options),page2=await listKnowledgeCatalog(f.actor,{...base,q:f.code,pageSize:1,page:2},options);assert.notEqual(page1.families[0].id,page2.families[0].id);assert.equal(page2.totalFamilies,2);
 assert.deepEqual((await listKnowledgeCatalog(f.actor,{...base,q:f.code,page:10000},options)).families,[]);
}));
test('family history keeps parallel current, future dates, older versions and stable pagination',()=>fixture(async f=>{
 const history=await getKnowledgeFamily(f.actor,f.family,{page:1,pageSize:50},{pool:f.pool});assert.equal(history.totalDocuments,7);assert.equal(history.documents.filter(d=>d.isCurrent).length,2);assert.equal(history.documents.find(d=>d.id===f.ids[1])?.effectiveFrom,'2027-01-01');assert(history.documents.some(d=>d.status==='SUPERSEDED'));
 const paged=[];for(let page=1;page<=4;page++)paged.push(...(await getKnowledgeFamily(f.actor,f.family,{page,pageSize:2},{pool:f.pool})).documents);
 assert.deepEqual(paged.map(d=>d.id),history.documents.map(d=>d.id));assert.equal(new Set(paged.map(d=>d.id)).size,7);
 await assert.rejects(getKnowledgeFamily(f.actor,randomUUID(),{page:1,pageSize:25},{pool:f.pool}),/NOT_FOUND/);
}));
test('detail exposes exact metadata and only approved relationship endpoints without private data',()=>fixture(async f=>{
 const before=(await f.pool.query('select jsonb_agg(to_jsonb(d) order by id) data from public.documents d where document_family_id=$1',[f.family])).rows[0].data;
 const detail=await getKnowledgeDocument(f.actor,f.ids[0],{relationsPage:1,relationsPageSize:25},{pool:f.pool});assert.equal(detail.summary.visibility,'RESTRICTED');assert.equal(detail.supersedesDocumentId,null);assert.equal(detail.totalRelationships,1);assert.deepEqual(detail.relationships.map(r=>[r.type,r.direction,r.documentId]),[['AMENDS','INCOMING',f.ids[1]]]);
 const other=await getKnowledgeDocument(f.actor,f.ids[1],{relationsPage:1,relationsPageSize:1},{pool:f.pool});assert.equal(other.totalRelationships,1);assert.equal(other.relationships[0].direction,'OUTGOING');assert.equal(other.relationships[0].documentId,f.ids[0]);
 assert.deepEqual((await getKnowledgeDocument(f.actor,f.ids[1],{relationsPage:2,relationsPageSize:1},{pool:f.pool})).relationships,[]);
 await assert.rejects(getKnowledgeDocument(f.actor,f.pending,{relationsPage:1,relationsPageSize:25},{pool:f.pool}),/NOT_FOUND/);
 const serialized=JSON.stringify(detail);for(const forbidden of ['PRIVATE_PATH','checksum','storage_path','actorId','content','embedding'])assert(!serialized.includes(forbidden));
 assert.deepEqual((await f.pool.query('select jsonb_agg(to_jsonb(d) order by id) data from public.documents d where document_family_id=$1',[f.family])).rows[0].data,before);
}));
test('real private RAG publication supplies receipt-backed mode and original intake time',()=>fixture(async f=>{
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,countPassageTokens:async texts=>texts.map(()=>20),embedPassages:async texts=>texts.map(()=>[1,...Array(383).fill(0)]),embedQuery:async()=>{throw new Error('NO_QUERY');},healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const options={pool:f.pool,key:Buffer.alloc(32,97).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
 const source=createImportSource({bytes:Buffer.from(`<html><h1>Catalog synthetic ${randomUUID()}</h1><p>Controlled university service instructions for a catalog receipt.</p></html>`),filename:'catalog.html',mimeType:'text/html',sourceUrl:'https://fixture.yru.ac.th/catalog.html',acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(f.actor,source,options);await analyzeImportJob(f.actor,job.id,0,options);const review=await getImportReview(f.actor,job.id,options),empty=unfinishedReviewDraft();
 let draft={...empty,schemaVersion:2 as const,chunkPlan:null as {digest:string;chunkerVersion:'located-e5-v1'}|null,metadata:{...empty.metadata,title:'Actual catalog receipt',familyCode:f.code,departmentCode:'IT',documentType:'GUIDE',versionName:'Receipt',versionStream:'receipt',scope:{...empty.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:70,visibility:'INTERNAL' as const,storageMode:'RAG' as const},action:'ADD_ADDITIONAL' as const,attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},warningDispositions:review.warnings.map(w=>({warningKey:w.key,status:'CORRECTED' as const,reason:'Checked controlled synthetic source'}))};
 let saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:review.jobRevision,expectedExtractionRevision:review.extractionRevision,expectedReviewRevision:0,draft},options);
 const snapshot=await getImportChunkPlan(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},options);draft={...draft,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:snapshot.plan.chunkerVersion}};
 saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,draft},options);
 const published=await approveImport(f.actor,{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true},options);
 const detail=await getKnowledgeDocument(f.actor,published.receipt.documentId,{relationsPage:1,relationsPageSize:25},{pool:f.pool});assert.equal(detail.summary.storageMode,'RAG');assert.equal(detail.summary.lastImportAt,job.createdAt);assert.equal(detail.summary.familyId,f.family);
 const catalog=await listKnowledgeCatalog(f.actor,{...base,q:f.code},{pool:f.pool});assert.equal(catalog.totalDocuments,8);assert.equal(catalog.families.find(v=>v.id===f.family)?.lastImportAt,job.createdAt);
}));
