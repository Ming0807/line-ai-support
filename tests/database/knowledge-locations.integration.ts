import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {buildCitedAnswer,evidenceStillMatches} from '../../lib/knowledge/citations';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {knowledgeLocations} from '../fixtures/knowledge-locations';
const fingerprint='b'.repeat(64);
const scope:KnowledgeScope={historical:false,academicYear:2569,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
async function fixture(work:(client:PoolClient,document:string,code:string)=>Promise<void>){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:1}),client=await pool.connect();
 try{
  await client.query('begin');const code='TEST_'+randomUUID().replaceAll('-','').toUpperCase();
  const family=(await client.query("insert into public.document_families(code,name,category) values($1,'Location fixture','Test') returning id",[code])).rows[0].id;
  const document=(await client.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,visibility,effective_from,authority_level,checksum)
   values($1,'Located document','2569','MAIN',2569,'ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'PUBLIC','2026-01-01',100,$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
  await work(client,document,code);
 }finally{await client.query('rollback');client.release();await pool.end();}
}
async function chunk(client:PoolClient,document:string,index:number,extra:{locations?:unknown;tokens?:number|null;page?:number|null}={}){
 return (await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,content,embedding,embedding_dimensions,embedding_fingerprint,source_locations,passage_token_count)
  values($1,$2,$3,'Located fixture content','[1,0]'::extensions.vector,2,$4,$5::jsonb,$6) returning id,source_locations,passage_token_count`,[document,index,extra.page??null,fingerprint,JSON.stringify(extra.locations??[]),extra.tokens??null])).rows[0];
}
test('legacy rows remain explicit empty locations with null token evidence and retained vector cohort',()=>fixture(async(client,document)=>{
 const row=(await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
 values($1,0,'Retained legacy fixture','[1,0]'::extensions.vector,2,$2) returning source_locations,passage_token_count,embedding::text`,[document,fingerprint])).rows[0];
 assert.deepEqual(row,{source_locations:[],passage_token_count:null,embedding:'[1,0]'});
}));
test('all five proven locations roundtrip through actual retrieval, backend citations and delivery equality',()=>fixture(async(client,document,code)=>{
 for(const [index,location] of knowledgeLocations.entries())await chunk(client,document,index,{locations:[location],tokens:512,page:location.kind==='PDF'?12:null});
 const previous=await searchKnowledge(client,{scope:{...scope,familyCodes:[code]},vector:[1,0],fingerprint},'2026-10-06');assert.equal(previous.length,5);
 for(const row of previous){const index=(await client.query('select chunk_index from public.knowledge_chunks where id=$1',[row.chunkId])).rows[0].chunk_index;
  assert.deepEqual(row.sourceLocations,[knowledgeLocations[index]]);
  const answer=buildCitedAnswer({answer:'คำตอบทดสอบ',citationChunkIds:[row.chunkId]},[row]);assert.deepEqual(answer.citations[0].sourceLocations,row.sourceLocations);
 }
 const changed=previous.find(row=>row.sourceLocations?.[0].kind==='PDF')!;
 await client.query('update public.knowledge_chunks set source_locations=$2::jsonb where id=$1',[changed.chunkId,JSON.stringify([{...knowledgeLocations[0],blockStart:3}])]);
 const current=await searchKnowledge(client,{scope:{...scope,familyCodes:[code]},vector:[1,0],fingerprint},'2026-10-06');assert.equal(evidenceStillMatches(previous,current),false);
}));
test('SQL rejects invalid shape/kind/size/token bounds and browser roles retain no writes',()=>fixture(async(client,document)=>{
 const invalid=[{locations:{}},{locations:[42]},{locations:[{}]},{locations:[{kind:'UNKNOWN'}]},{locations:Array.from({length:17},()=>knowledgeLocations[0])},{locations:[{kind:'CSV',payload:'x'.repeat(66000)}]},{tokens:0},{tokens:513}];
 for(const [index,value] of invalid.entries()){
  await client.query('savepoint malformed');await assert.rejects(chunk(client,document,index,value));await client.query('rollback to savepoint malformed');
 }
 await chunk(client,document,90,{locations:[knowledgeLocations[0]],page:12,tokens:1});
 for(const role of ['anon','authenticated']){
  const privileges=(await client.query("select has_table_privilege($1,'public.knowledge_chunks','INSERT') insert,has_table_privilege($1,'public.knowledge_chunks','UPDATE') update,has_table_privilege($1,'public.knowledge_chunks','DELETE') delete",[role])).rows[0];assert.deepEqual(privileges,{insert:false,update:false,delete:false});
 }
}));
