import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {approveImport} from '../../lib/imports/import-publication';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {saveImportReview,getImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import type {ImportReviewDraft} from '../../lib/imports/review-schema';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {encryptStagingValue} from '../../lib/imports/staging-envelope';
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){
 const actor=randomUUID(),staff=randomUUID(),pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:6,application_name:'publication-'+actor});
 try{await work(await setup(pool,actor,staff));}
 finally{
  await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);
  await pool.query('delete from public.document_relationships where source_document_id in (select id from public.documents where approved_by=$1)',[actor]);
  await pool.query('delete from public.knowledge_chunks where document_id in (select id from public.documents where approved_by=$1)',[actor]);
  await pool.query('update public.documents set supersedes_document_id=null where approved_by=$1',[actor]);
  await pool.query('delete from public.documents where approved_by=$1',[actor]);
  await pool.query('delete from public.document_families where code like $1',['PUB_'+actor.replaceAll('-','').toUpperCase()+'%']);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}
async function setup(pool:Pool,actor:string,staff:string){
 for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Publication fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
 const familyCode='PUB_'+actor.replaceAll('-','').toUpperCase();let countCalls=0,embedCalls=0;const encoded:string[][]=[];
 const provider:LocalE5EmbeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  countPassageTokens:async texts=>{countCalls++;return texts.map(()=>25);},
  embedPassages:async texts=>{embedCalls++;encoded.push([...texts]);const tx=await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",['publication-'+actor]);assert.equal(tx.rows[0].n,0,'no SQL transaction during passage encode');return texts.map(()=>[1,...Array(383).fill(0)]);},
  embedQuery:async()=>{throw new Error('QUERY_EMBED_NOT_ALLOWED');},healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
 const options={pool,key:Buffer.alloc(32,95).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
 async function ready(change?:(draft:ImportReviewDraft)=>ImportReviewDraft){
  const source=createImportSource({bytes:new TextEncoder().encode(`<html><h1>Reviewed synthetic service ${randomUUID()}</h1><p>University service instructions.</p><table><tr><td>Service</td><td></td></tr><tr><td>Library</td><td>001.20</td></tr></table></html>`),filename:'publication.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
  const {job}=await createImportJob(actor,source,options);await analyzeImportJob(actor,job.id,0,options);
  const state=await getImportReview(actor,job.id,options),base=unfinishedReviewDraft();
  let draft:ImportReviewDraft={...base,schemaVersion:2,metadata:{...base.metadata,title:'Publication synthetic',familyCode,newFamily:{name:'Publication family',category:'Fixture'},departmentCode:'IT',documentType:'GUIDE',versionName:'2567',versionStream:'ALL',academicYear:2567,scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:70,visibility:'INTERNAL',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},warningDispositions:state.warnings.map(w=>({warningKey:w.key,status:'CORRECTED',reason:'Reviewed synthetic source'})),chunkPlan:null};
  if(change)draft=change(draft);
  const first=await saveImportReview(actor,job.id,{expectedJobRevision:state.jobRevision,expectedExtractionRevision:state.extractionRevision,expectedReviewRevision:0,draft},options);
  const snapshot=await getImportChunkPlan(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},options);
  draft={...draft,schemaVersion:2,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:snapshot.plan.chunkerVersion}};
  const saved=await saveImportReview(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision,draft},options);
  return {source,plan:snapshot.plan,saved,draft,input:{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true as const}};
 }
 return {pool,actor,staff,options,provider,familyCode,ready,encoded,calls:()=>({countCalls,embedCalls})};
}
test('atomic located publication persists exact immutable receipt and sequential retry does not count or encode again',()=>fixture(async f=>{
 const r=await f.ready();const result=await approveImport(f.actor,r.input,f.options);assert.equal(result.replayed,false);const calls=f.calls();
 const again=await approveImport(f.actor,r.input,f.options);assert.equal(again.replayed,true);assert.deepEqual(again.receipt,result.receipt);assert.deepEqual(f.calls(),calls);
 const rows=(await f.pool.query('select chunk_index,content,source_locations,passage_token_count,embedding_dimensions,embedding_fingerprint,extensions.vector_dims(embedding_e5) dim from public.knowledge_chunks where document_id=$1 order by chunk_index',[result.receipt.documentId])).rows;
 assert.equal(rows.length,r.plan.chunks.length);for(const [i,c] of rows.entries()){assert.equal(c.content,r.plan.chunks[i].content);assert.deepEqual(c.source_locations,r.plan.chunks[i].sourceLocations);assert.equal(c.passage_token_count,25);assert.equal(c.dim,384);assert.equal(c.embedding_fingerprint,LOCAL_EMBEDDING_FINGERPRINT);}
 assert.deepEqual(f.encoded.flat(),r.plan.chunks.map(c=>c.content));assert.equal((await readImportOriginal(f.actor,r.input.id,f.options)).bytes.length,r.source.bytes.length);
 assert.equal((await f.pool.query('select publication_status,status from private.knowledge_import_jobs where id=$1',[r.input.id])).rows[0].publication_status,'COMPLETED');
 await assert.rejects(approveImport(f.actor,{...r.input,expectedReviewRevision:1},f.options),/CONFLICT/);
 await assert.rejects(f.pool.query("update private.knowledge_import_publications set plan_digest=repeat('b',64) where job_id=$1",[r.input.id]),/IMPORT_PUBLICATION_IMMUTABLE/);
}));
test('same job concurrent preparations produce one document and one matching receipt',()=>fixture(async f=>{
 const r=await f.ready();let arrivals=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const options={...f.options,beforeCommit:async()=>{if(++arrivals===2)release();await barrier;}};
 const results=await Promise.all([approveImport(f.actor,r.input,options),approveImport(f.actor,r.input,options)]);
 assert.deepEqual(results[0].receipt,results[1].receipt);assert.equal(results.filter(r=>!r.replayed).length,1);
 assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,1);
 assert.equal((await f.pool.query('select count(*)::int n from private.knowledge_import_publications where job_id=$1',[r.input.id])).rows[0].n,1);
}));
test('active administrator authorization precedes parsing and receipt access; ordinary staff and revoked admins denied',()=>fixture(async f=>{
 const r=await f.ready();await assert.rejects(approveImport(f.staff,new Proxy({}, {get(){throw new Error('INPUT_SHOULD_NOT_BE_READ');}}),f.options),/FORBIDDEN/);
 await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);await assert.rejects(approveImport(f.actor,r.input,f.options),/FORBIDDEN/);assert.equal(f.calls().embedCalls,0);
}));
test('all version actions preserve old rows and whole cancellation instruments remain separate',()=>fixture(async f=>{
 const base=await f.ready();const first=await approveImport(f.actor,base.input,f.options);
 const next=await f.ready(d=>({...d,action:'REPLACE_CURRENT',metadata:{...d.metadata,newFamily:null,academicYear:2569,versionName:'2569'},target:{documentId:first.receipt.documentId,revision:0}}));const replacement=await approveImport(f.actor,next.input,f.options);
 const old=(await f.pool.query('select status,is_current,revision from public.documents where id=$1',[first.receipt.documentId])).rows[0];assert.deepEqual(old,{status:'SUPERSEDED',is_current:false,revision:1});
 const amendment=await f.ready(d=>({...d,action:'AMEND_EXISTING',metadata:{...d.metadata,newFamily:null,academicYear:2569,versionName:'Amendment'},target:{documentId:replacement.receipt.documentId,revision:0}}));const amended=await approveImport(f.actor,amendment.input,f.options);
 const cancellation=await f.ready(d=>({...d,action:'ADD_ADDITIONAL',relationship:'CANCELS',metadata:{...d.metadata,newFamily:null,academicYear:2569,versionName:'Cancellation'},target:{documentId:amended.receipt.documentId,revision:0}}));const cancelled=await approveImport(f.actor,cancellation.input,f.options);
 for(const id of [amended.receipt.documentId,cancelled.receipt.documentId])assert.equal((await f.pool.query('select is_current from public.documents where id=$1',[id])).rows[0].is_current,false);
 const history=await f.ready(d=>({...d,action:'ADD_HISTORICAL',metadata:{...d.metadata,newFamily:null,academicYear:2565,versionName:'2565'}}));const historical=await approveImport(f.actor,history.input,f.options);assert.equal((await f.pool.query('select status from public.documents where id=$1',[historical.receipt.documentId])).rows[0].status,'SUPERSEDED');
 const extra=await f.ready(d=>({...d,action:'ADD_ADDITIONAL',metadata:{...d.metadata,newFamily:null,versionStream:'OTHER'}}));await approveImport(f.actor,extra.input,f.options);
 const relations=(await f.pool.query('select relation_type from public.document_relationships where source_document_id=any($1::uuid[])',[[replacement.receipt.documentId,amended.receipt.documentId,cancelled.receipt.documentId]])).rows.map(r=>r.relation_type).sort();assert.deepEqual(relations,['AMENDS','CANCELS','SUPERSEDES']);
}));
for(const failureAt of ['DOCUMENT','CHUNKS','ACTIVITY','RECEIPT'] as const)test(`forced ${failureAt} failure rolls back family/document/chunks/activity/receipt/completion`,()=>fixture(async f=>{
 const r=await f.ready();await assert.rejects(approveImport(f.actor,r.input,{...f.options,failureAt}),/INTERNAL_ERROR/);
 for(const table of ['public.documents','private.knowledge_import_publications']){const q=table==='public.documents'?'approved_by':'actor_id';assert.equal((await f.pool.query(`select count(*)::int n from ${table} where ${q}=$1`,[f.actor])).rows[0].n,0);}
 assert.equal((await f.pool.query('select count(*)::int n from public.document_families where code=$1',[f.familyCode])).rows[0].n,0);
 assert.equal((await f.pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='KNOWLEDGE_IMPORT_PUBLISHED'",[f.actor])).rows[0].n,0);
 assert.equal((await f.pool.query('select publication_status from private.knowledge_import_jobs where id=$1',[r.input.id])).rows[0].publication_status,'NOT_PUBLISHED');
}));
test('current stream occupied across departments and wrong target revision cannot publish',()=>fixture(async f=>{
 const base=await f.ready();const first=await approveImport(f.actor,base.input,f.options);
 const blocked=await f.ready(d=>({...d,action:'ADD_ADDITIONAL',metadata:{...d.metadata,newFamily:null,departmentCode:'FINANCE'}}));await assert.rejects(approveImport(f.actor,blocked.input,f.options),/CONFLICT/);
 const stale=await f.ready(d=>({...d,action:'REPLACE_CURRENT',metadata:{...d.metadata,newFamily:null},target:{documentId:first.receipt.documentId,revision:9}}));await assert.rejects(approveImport(f.actor,stale.input,f.options),/CONFLICT/);
 assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,1);
}));
test('changed review or revoked actor after outside-SQL vector preparation leaves publication empty',()=>fixture(async f=>{
 const r=await f.ready();await assert.rejects(approveImport(f.actor,r.input,{...f.options,beforeCommit:async()=>{await saveImportReview(f.actor,r.input.id,{expectedJobRevision:r.saved.jobRevision,expectedExtractionRevision:r.saved.extractionRevision,expectedReviewRevision:r.saved.reviewRevision,draft:r.draft},f.options);}}),/CONFLICT/);
 const fresh=await getImportReview(f.actor,r.input.id,f.options);await assert.rejects(approveImport(f.actor,{...r.input,expectedReviewRevision:fresh.reviewRevision},{...f.options,beforeCommit:async()=>{await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);}}),/FORBIDDEN/);
 assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,0);
}));
test('private immutable receipt privileges deny browser reads/writes and server update/delete',()=>fixture(async f=>{
 assert.equal((await f.pool.query("select has_table_privilege('service_role','private.knowledge_import_jobs','DELETE') allowed")).rows[0].allowed,false,'runtime cannot cascade-delete retained originals and publication receipts');
 for(const role of ['anon','authenticated'])assert.equal((await f.pool.query("select has_table_privilege($1,'private.knowledge_import_publications','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
 for(const op of ['SELECT','INSERT'])assert.equal((await f.pool.query("select has_table_privilege('service_role','private.knowledge_import_publications',$1) allowed",[op])).rows[0].allowed,true);
 for(const op of ['UPDATE','DELETE'])assert.equal((await f.pool.query("select has_table_privilege('service_role','private.knowledge_import_publications',$1) allowed",[op])).rows[0].allowed,false);
}));
test('count and encode share one reduced internal preparation deadline even when a provider ignores cancellation',()=>fixture(async f=>{
 const r=await f.ready(),controller=new AbortController();let encoded=false,countBatches=0,encodeBudget=0;
 const provider:LocalE5EmbeddingProvider={...f.provider,countPassageTokens:async(texts:string[])=>{if(++countBatches===1)await new Promise(resolve=>setTimeout(resolve,80));return texts.map(()=>25);},embedPassages:async(_texts,options)=>{encoded=true;encodeBudget=options?.timeoutMs??0;return new Promise<number[][]>(()=>{});}};
 const cleanup=setTimeout(()=>controller.abort(),2000),started=performance.now();
 try{await assert.rejects(approveImport(f.actor,r.input,{...f.options,provider,signal:controller.signal,preparationTimeoutMs:1000}),/CHUNK_PLAN_TIMEOUT/);assert.equal(encoded,true);assert(encodeBudget>0&&encodeBudget<=920);assert(performance.now()-started<1900);}
 finally{clearTimeout(cleanup);controller.abort();}
 assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,0);
}));
test('caller abort settles a counter ignoring cancellation and never writes publication',()=>fixture(async f=>{
 const r=await f.ready(),controller=new AbortController();let counted=false;
 const provider={...f.provider,countPassageTokens:async()=>{counted=true;queueMicrotask(()=>controller.abort());return new Promise<number[]>(()=>{});}};
 await assert.rejects(approveImport(f.actor,r.input,{...f.options,provider,signal:controller.signal}),/CONFLICT/);assert.equal(counted,true);assert.equal(f.calls().embedCalls,0);
 assert.equal((await f.pool.query('select publication_status from private.knowledge_import_jobs where id=$1',[r.input.id])).rows[0].publication_status,'NOT_PUBLISHED');
}));
test('job lock wait reads a fresh review counter after another transaction appends a receipt',()=>fixture(async f=>{
 const r=await f.ready(),blocker=await f.pool.connect();let blocked=false;
 const pending=approveImport(f.actor,r.input,{...f.options,beforeCommit:async()=>{
  await blocker.query('begin');await blocker.query('select id from private.knowledge_import_jobs where id=$1 for update',[r.input.id]);
  const serialized=JSON.stringify(r.saved.saved!.draft),reviewRevision=r.saved.reviewRevision+1;
  const checksum=createHash('sha256').update(JSON.stringify(['yru:knowledge-review-receipt:v1',r.source.checksum,r.saved.jobRevision,r.saved.extractionRevision])).digest('hex');
  const encrypted=encryptStagingValue(serialized,{jobId:r.input.id,checksum,revision:reviewRevision,purpose:'REVIEW'},f.options.key);
  await blocker.query('insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted) values($1,$2,$3,$4,$5,$6,$7)',[r.input.id,reviewRevision,r.saved.jobRevision,r.saved.extractionRevision,f.actor,createHash('sha256').update(serialized).digest('hex'),encrypted]);blocked=true;
 }});
 void pending.catch(()=>{});
 try{
  const until=performance.now()+2500;let waiting=false;
  while(performance.now()<until){const result=await f.pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like 'select id from private.knowledge_import_jobs%for update') waiting",['publication-'+f.actor]);if(blocked&&result.rows[0].waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(waiting,true);await blocker.query('commit');await assert.rejects(pending,/CONFLICT/);
  assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,0);
 }finally{await blocker.query('rollback');blocker.release();await pending.catch(()=>{});}
}));
