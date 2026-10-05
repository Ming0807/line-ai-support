import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
 studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const vector=[1,...Array<number>(383).fill(0)];
const poolOptions={connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2};

test('E5 has a real generated vector(384) projection while preserving browser RLS and old vectors',async()=>{
 const pool=new Pool(poolOptions);
 try{
  const result=await pool.query(`select format_type(a.atttypid,a.atttypmod) as type,a.attgenerated,n.nspname as schema from pg_attribute a
   join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
   where a.attrelid='public.knowledge_chunks'::regclass and a.attname='embedding_e5'`);
  assert.equal(result.rowCount,1);assert.match(result.rows[0].type,/^(extensions\.)?vector\(384\)$/);assert.equal(result.rows[0].schema,'extensions');assert.equal(result.rows[0].attgenerated,'s');
  const privileges=(await pool.query(`select relrowsecurity,has_table_privilege('anon','public.knowledge_chunks','SELECT') as anon,
   has_table_privilege('authenticated','public.knowledge_chunks','SELECT') as browser from pg_class where oid='public.knowledge_chunks'::regclass`)).rows[0];
  assert(privileges.relrowsecurity&&!privileges.anon&&!privileges.browser);
 }finally{await pool.end();}
});

test('local cohort stores/searches 384, excludes unsafe versions and rejects wrong dimensions without harming legacy cohorts',async()=>{
 const pool=new Pool(poolOptions),client=await pool.connect();
 try{
  await client.query('begin');
  const code='FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase();
  const family=(await client.query(`insert into public.document_families(code,name,category) values($1,'Local E5 fixture','REGULATION') returning id`,[code])).rows[0].id;
  const doc=(await client.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,
   approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,'Controlled E5 source','2569','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
   'https://fixture.yru.ac.th/e5.pdf',$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
  const insert=async(index:number,values:number[],fingerprint=LOCAL_EMBEDDING_FINGERPRINT)=>client.query(`insert into public.knowledge_chunks
   (document_id,chunk_index,page_number,section_title,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,$2,3,'ข้อ 1','Controlled reviewed E5 chunk',$3::extensions.vector,$4,$5)
   returning id,extensions.vector_dims(embedding_e5) as dimensions`,[doc,index,JSON.stringify(values),values.length,fingerprint]);
  const chunk=(await insert(0,vector)).rows[0];assert.equal(chunk.dimensions,384);
  const legacy=(await insert(1,[1,0],'a'.repeat(64))).rows[0];assert.equal(legacy.dimensions,null);
  await client.query('savepoint wrong_e5');
  await assert.rejects(insert(2,[1,0]),(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&['23514','22000'].includes(String(error.code)));
  await client.query('rollback to savepoint wrong_e5');
  const request={scope:{...scope,familyCodes:[code]},vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT};
  const results=await searchKnowledge(client,request,'2026-10-05');assert.deepEqual(results.map(x=>x.chunkId),[chunk.id]);
  assert.equal(results[0].pageNumber,3);assert.equal(results[0].sourceUrl,'https://fixture.yru.ac.th/e5.pdf');
  await assert.rejects(searchKnowledge(client,{...request,vector:[1,0]},'2026-10-05'),{message:'KNOWLEDGE_SCOPE_INVALID'});
  await client.query("update public.documents set visibility='INTERNAL' where id=$1",[doc]);
  assert.deepEqual(await searchKnowledge(client,request,'2026-10-05'),[]);
  assert.deepEqual((await client.query('select embedding::text from public.knowledge_chunks where id=$1',[legacy.id])).rows[0],{embedding:'[1,0]'});
 }finally{await client.query('rollback');client.release();await pool.end();}
});
