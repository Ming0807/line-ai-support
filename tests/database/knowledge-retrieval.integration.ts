import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const baseScope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,
 audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const fingerprint='d'.repeat(64);
const poolOptions={connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2};
async function fixture(client:PoolClient,code:string,options:Record<string,unknown>={}){
 const family=(await client.query(`insert into public.document_families(code,name,category) values($1,'Controlled retrieval','REGULATION')
  on conflict(code) do update set name=excluded.name returning id`,[code])).rows[0].id;
 const v={title:'Controlled official source',stream:randomUUID(),year:2569,status:'ACTIVE',current:true,approved:'APPROVED',
  official:true,reviewed:true,requiresReview:false,visibility:'PUBLIC',archive:false,from:'2026-01-01',to:null,audience:'ALL',
  program:null,cohort:null,authority:100,vector:'[0.8,0.6]',dimensions:2,fingerprint,...options};
 const id=(await client.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,
  status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,visibility,archive_only,
  effective_from,effective_to,audience,program_code,cohort,authority_level,source_url,checksum)
  values($1,$2,$3,$4,$5,$6,$7,$8,case when $8='APPROVED' then clock_timestamp() else null end,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
  'https://fixture.yru.ac.th/controlled.pdf',$20) returning id`,[family,v.title,String(v.year),v.stream,v.year,v.status,v.current,v.approved,
  v.official,v.reviewed,v.requiresReview,v.visibility,v.archive,v.from,v.to,v.audience,v.program,v.cohort,v.authority,
  randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
 const chunk=(await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,embedding,embedding_dimensions,embedding_fingerprint)
  values($1,0,12,'ข้อ 5','Controlled official transfer rule',$2::extensions.vector,$3,$4) returning id`,[id,v.vector,v.dimensions,v.fingerprint])).rows[0].id;
 return {id,chunk};
}
async function withDatabase(work:(client:PoolClient)=>Promise<void>){
 const pool=new Pool(poolOptions),client=await pool.connect();
 try{await client.query('begin');await work(client);}finally{await client.query('rollback');client.release();await pool.end();}
}
test('real PG filters unsafe current evidence before similarity, fingerprint and authority ranking',()=>withDatabase(async client=>{
 const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();
 const good=await fixture(client,code);
 await fixture(client,code,{title:'Closer weaker guide',authority:70,vector:'[1,0]'});
 for(const options of [
  {status:'SUPERSEDED',current:false,year:2567},{status:'PENDING_REVIEW',current:false,approved:'PENDING'},
  {official:false},{visibility:'INTERNAL'},{visibility:'RESTRICTED'},{archive:true},{from:'2027-01-01'},
  {to:'2026-10-03'},{status:'PENDING_REVIEW',current:false,reviewed:false,requiresReview:true},
  {fingerprint:'e'.repeat(64)},{vector:'[1,0,0]',dimensions:3},
 ])await fixture(client,code,{vector:'[1,0]',...options});
 const results=await searchKnowledge(client,{scope:{...baseScope,familyCodes:[code]},vector:[1,0],fingerprint,threshold:0.65},'2026-10-04');
 assert.equal(results.length,2);
 assert.equal(results[0].documentId,good.id,'authority wins after relevant evidence has passed applicability and similarity');
 assert.equal(results[0].pageNumber,12);assert.equal(results[0].sectionTitle,'ข้อ 5');
 assert.equal(results[0].sourceUrl,'https://fixture.yru.ac.th/controlled.pdf');
 assert(!JSON.stringify(results).includes('embedding'));
}));

test('historical year intentionally uses the approved older version; current does not',()=>withDatabase(async client=>{
 const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();
 const old=await fixture(client,code,{status:'SUPERSEDED',current:false,year:2567,from:'2024-01-01',to:'2024-12-31',vector:'[1,0]'});
 const current=await fixture(client,code);
 const historical=await searchKnowledge(client,{scope:{...baseScope,historical:true,academicYear:2567,familyCodes:[code]},vector:[1,0],fingerprint},'2026-10-04');
 assert.deepEqual(historical.map(r=>r.documentId),[old.id]);
 const normal=await searchKnowledge(client,{scope:{...baseScope,familyCodes:[code]},vector:[1,0],fingerprint},'2026-10-04');
 assert.deepEqual(normal.map(r=>r.documentId),[current.id]);
 await assert.rejects(searchKnowledge(client,{scope:{...baseScope,historical:true},vector:[1,0],fingerprint},'2026-10-04'),{message:'KNOWLEDGE_SCOPE_INVALID'});
}));

test('unknown audience/program/cohort cannot silently select scoped rules',()=>withDatabase(async client=>{
 const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();
 const regular=await fixture(client,code,{audience:'REGULAR',program:'IT',cohort:2568});
 await fixture(client,code,{audience:'WEEKEND',program:'IT',cohort:2568,vector:'[1,0]'});
 const search=(scope:KnowledgeScope)=>searchKnowledge(client,{scope,vector:[1,0],fingerprint},'2026-10-04');
 assert.deepEqual(await search({...baseScope,familyCodes:[code]}),[]);
 assert.deepEqual((await search({...baseScope,familyCodes:[code],audience:'REGULAR',programCode:'IT',cohort:2568})).map(r=>r.documentId),[regular.id]);
 assert.deepEqual(await search({...baseScope,familyCodes:[code],audience:'REGULAR',programCode:'IT',cohort:2569}),[]);
}));

test('explicit as-of retrieval picks latest applicable version of each stream before vector similarity',()=>withDatabase(async client=>{
 const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase(),stream='same-reviewed-stream';
 const old=await fixture(client,code,{stream,status:'SUPERSEDED',current:false,year:2567,from:'2024-01-01',vector:'[1,0]'});
 const current=await fixture(client,code,{stream,from:'2026-01-01'});
 const search=(date:string)=>searchKnowledge(client,{scope:{...baseScope,historical:true,asOfDate:date,familyCodes:[code]},vector:[1,0],fingerprint},'2026-10-04');
 assert.deepEqual((await search('2024-05-01')).map(r=>r.documentId),[old.id]);
 assert.deepEqual((await search('2026-05-01')).map(r=>r.documentId),[current.id]);
 await assert.rejects(search('2024-02-30'),{message:'KNOWLEDGE_SCOPE_INVALID'});
}));

test('retrieval has a PostgreSQL execution deadline and preserves a shorter caller transaction deadline',async()=>{
 const pool=new Pool({...poolOptions,max:3}),client=await pool.connect(),blocker=await pool.connect();
 try{
  await blocker.query('begin');await blocker.query('lock table public.documents in access exclusive mode');
  await client.query('begin');await client.query("set local statement_timeout='100ms'");
  const started=Date.now();
  await assert.rejects(searchKnowledge(client,{scope:baseScope,vector:[1,0],fingerprint},'2026-10-04'),{code:'57014'});
  assert(Date.now()-started<1500,'the caller\'s shorter deadline remains effective');
  await client.query('rollback');
  await client.query('begin');
  // The retrieval function must install an actual server timeout even when the caller has none.
  await blocker.query('rollback');
  await searchKnowledge(client,{scope:baseScope,vector:[1,0],fingerprint},'2026-10-04');
  assert.equal((await client.query('show statement_timeout')).rows[0].statement_timeout,'4s');
 }finally{await client.query('rollback');await blocker.query('rollback');client.release();blocker.release();await pool.end();}
});

test('a year with several revisions in one stream requires an as-of date instead of mixing rules',()=>withDatabase(async client=>{
 const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase(),stream='same-year-reviewed-stream';
 await fixture(client,code,{stream,status:'SUPERSEDED',current:false,from:'2026-01-01'});
 await fixture(client,code,{stream,from:'2026-08-01'});
 await assert.rejects(searchKnowledge(client,{scope:{...baseScope,historical:true,academicYear:2569,familyCodes:[code]},
  vector:[1,0],fingerprint},'2026-10-04'),{message:'KNOWLEDGE_SCOPE_AMBIGUOUS'});
}));
