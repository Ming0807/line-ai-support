import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {publicationSources} from '../../tests/fixtures/publication-sources';
import {createLocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../../lib/knowledge/embedding-space';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {approveImport} from '../../lib/imports/import-publication';
import {unfinishedReviewDraft} from '../../tests/fixtures/import-review';
import {buildCitedAnswer} from '../../lib/knowledge/citations';
import type {KnowledgeEvidence} from '../../lib/knowledge/types';
// Fixed local target, synthetic INTERNAL sources, no university-corpus approval or remote/paid calls.
const actor=randomUUID(),application='publication-local-'+actor,database='yru_publication_qa_'+actor.replaceAll('-','').slice(0,12);
assert(/^yru_publication_qa_[a-f0-9]{12}$/.test(database));
const container='supabase_db_line-ai-yru';
const command=(args:string[],input?:string)=>execFileSync('docker',['exec',...(input===undefined?[]:['-i']),container,...args],{encoding:'utf8',input,windowsHide:true,timeout:60_000,maxBuffer:16*1024*1024});
const sql=(target:string,role:string,input:string)=>command(['psql','-X','-At','-U',role,'-d',target,'-v','ON_ERROR_STOP=1'],input);
assert.equal(sql('postgres','supabase_admin',`select count(*) from pg_database where datname='${database}'`).trim(),'0');
const authSchema=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=auth','--no-owner','--no-privileges']);
assert(authSchema.includes('CREATE SCHEMA auth'));
sql('postgres','supabase_admin',`create database ${database} owner postgres;`);
sql(database,'supabase_admin',authSchema);
sql(database,'supabase_admin',`create schema extensions;create extension vector with schema extensions;grant usage on schema auth,extensions to postgres,anon,authenticated,service_role;grant references on auth.users to postgres;`);
const migrations=(await readdir('supabase/migrations')).filter(f=>/^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();
for(const file of migrations)sql(database,'postgres',`begin;set local statement_timeout='10s';\n${await readFile('supabase/migrations/'+file,'utf8')}\ncommit;`);
sql(database,'postgres',(await readFile('supabase/seed.sql','utf8')).replace(/on conflict\(code\) do update[\s\S]*;\s*$/,'on conflict(code) do nothing;'));
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:3,application_name:application});
const provider=createLocalE5EmbeddingProvider({config:{model:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,apiUrl:'http://127.0.0.1:8000'}});
const directory='.superpowers/staging/import-preview/publication-local/'+database;await mkdir(directory,{recursive:true});
const options={pool,key:randomBytes(32).toString('base64'),originalBackend:'PRIVATE_DATABASE' as const,provider,counter:provider};
const retained:{jobId:string;documentId:string;format:string}[]=[],checks=[];
try{
 assert.equal((await provider.healthCheck()).healthy,true);
 sql(database,'supabase_admin',`insert into auth.users(id) values('${actor}');`);await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Retained synthetic publication QA',true)",[actor]);
 for(const source of publicationSources(actor)){
  const {job}=await createImportJob(actor,source,options);await analyzeImportJob(actor,job.id,0,options);
  const state=await getImportReview(actor,job.id,options),base=unfinishedReviewDraft();
  const draft={...base,schemaVersion:2 as const,metadata:{...base.metadata,title:`Synthetic ${source.format} publication`,familyCode:'QA_PUB_'+actor.replaceAll('-','').toUpperCase()+'_'+source.format,newFamily:{name:`Synthetic ${source.format}`,category:'QA'},departmentCode:'IT',documentType:'GUIDE',versionName:'Reviewed fixture',versionStream:'ALL',scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:70,visibility:'INTERNAL' as const,storageMode:'RAG' as const},action:'NEW_FAMILY' as const,attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},warningDispositions:state.warnings.map(w=>({warningKey:w.key,status:'CORRECTED' as const,reason:'Synthetic original and measured extraction checked'})),chunkPlan:null};
  const first=await saveImportReview(actor,job.id,{expectedJobRevision:state.jobRevision,expectedExtractionRevision:state.extractionRevision,expectedReviewRevision:0,draft},options);
  const plan=await getImportChunkPlan(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},options);
  const saved=await saveImportReview(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision,draft:{...draft,chunkPlan:{digest:plan.plan.digest,chunkerVersion:plan.plan.chunkerVersion}}},options);
  const request={id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true as const};
  const result=await approveImport(actor,request,options);retained.push({jobId:job.id,documentId:result.receipt.documentId,format:source.format});
  assert.deepEqual((await approveImport(actor,request,options)).receipt,result.receipt);
  const rows=(await pool.query(`select c.id,c.chunk_index,c.content,c.page_number,c.section_title,c.source_locations,c.passage_token_count,extensions.vector_dims(c.embedding_e5) dimension,extensions.vector_norm(c.embedding_e5) norm,d.visibility,d.checksum
   from public.knowledge_chunks c join public.documents d on d.id=c.document_id where d.id=$1 order by c.chunk_index`,[result.receipt.documentId])).rows;
  assert.equal(rows.length,plan.plan.chunks.length);
  for(const [i,row] of rows.entries()){
   assert.equal(row.visibility,'INTERNAL');assert.equal(row.checksum,source.checksum);assert.equal(row.content,plan.plan.chunks[i].content);assert.deepEqual(row.source_locations,plan.plan.chunks[i].sourceLocations);assert.equal(row.passage_token_count,plan.plan.chunks[i].passageTokenCount);assert.equal(row.dimension,384);assert(Math.abs(row.norm-1)<=0.001);
   const evidence:KnowledgeEvidence={chunkId:row.id,documentId:result.receipt.documentId,documentRevision:0,title:draft.metadata.title,familyCode:draft.metadata.familyCode,academicYear:null,authorityLevel:70,pageNumber:row.page_number,sectionTitle:row.section_title,sourceUrl:null,sourceLocations:row.source_locations,content:row.content,similarity:1};
   const cited=buildCitedAnswer({answer:'Synthetic verification',citationChunkIds:[row.id]},[evidence]);assert.deepEqual(cited.citations[0].sourceLocations,row.source_locations);
  }
  assert.deepEqual(Buffer.from((await readImportOriginal(actor,job.id,options)).bytes),Buffer.from(source.bytes));
  checks.push({format:source.format,chunks:rows.length,maxTokens:Math.max(...rows.map(r=>r.passage_token_count)),dimension:384,normalized:true,exactLocationsAndCitations:true,idempotent:true,originalRetained:true});
 }
 await writeFile(directory+'/result.json',JSON.stringify({status:'PASS',checks,universityCorpusApproved:false,remoteTarget:false,paidCalls:0},null,2));
 console.log(JSON.stringify({status:'PASS',checks,universityCorpusApproved:false,remoteTarget:false,paidCalls:0}));
}finally{
 // Exact owned synthetic originals and receipts remain recoverable; no cache/source/history deletion.
 await writeFile(directory+'/original-recovery.json',JSON.stringify({database,actorId:actor,key:options.key,retained,isolated:true},null,2),{mode:0o600});
 await pool.end();
}
