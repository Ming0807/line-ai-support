import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

const poolOptions={connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2};
test('knowledge tables fail closed for browser roles, with explicit server privileges and pgvector',async()=>{
 const pool=new Pool(poolOptions);
 try{
  const tables=await pool.query(`select c.relname,c.relrowsecurity,
   has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as browser_access,
   (select bool_and(has_table_privilege('service_role',c.oid,privilege)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege) as server_access
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
   and c.relname=any($1::text[])`,[['document_families','documents','document_relationships','knowledge_chunks']]);
  assert.equal(tables.rowCount,4,'all four version-aware knowledge tables must exist');
  assert(tables.rows.every(r=>r.relrowsecurity&&!r.anon_access&&!r.browser_access&&r.server_access));
  assert.equal((await pool.query("select extname from pg_extension where extname='vector'")).rowCount,1);
  for(const role of ['anon','authenticated']){
   const client=await pool.connect();
   try{await client.query('begin');await client.query(`set local role ${role}`);
    await assert.rejects(client.query('select content from public.knowledge_chunks'),{code:'42501'});
   }finally{await client.query('rollback');client.release();}
  }
 }finally{await pool.end();}
});

test('knowledge constraints preserve reviewed version streams and prevent mixed or malformed vectors',async()=>{
 const pool=new Pool(poolOptions),client=await pool.connect();
 try{
  await client.query('begin');
  const family=(await client.query(`insert into public.document_families(code,name,category,default_storage_mode)
   values($1,'Controlled fixture','REGULATION','RAG') returning id`,['FIXTURE_'+randomUUID().replaceAll('-','').toUpperCase()])).rows[0].id;
  const doc=(await client.query(`insert into public.documents(document_family_id,title,version_name,version_stream,
   status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,
   effective_from,source_url,checksum) values($1,'Controlled fixture','2569','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,
   '2026-01-01','https://fixture.yru.ac.th/regulation.pdf',$2) returning id`,[family,'a'.repeat(64)])).rows[0].id;
  async function rejects(sql:string,values:unknown[]=[]){
   await client.query('savepoint invalid_knowledge');
   await assert.rejects(client.query(sql,values),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&['23514','23505','23503'].includes(String(e.code)));
   await client.query('rollback to savepoint invalid_knowledge');
  }
  await rejects(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,
   official_source,extraction_reviewed,requires_review,effective_from,checksum)
   values($1,'Duplicate current','2570','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2027-01-01',$2)`,[family,'b'.repeat(64)]);
  await rejects("update public.documents set approval_status='PENDING',approved_at=null where id=$1",[doc]);
  await rejects("update public.documents set requires_review=true where id=$1",[doc]);
  await rejects("update public.documents set effective_to='2025-12-31' where id=$1",[doc]);
  await rejects(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,'wrong dimension','[1,0]',3,$2)`,[doc,'c'.repeat(64)]);
  await rejects(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,'zero vector','[0,0]',2,$2)`,[doc,'c'.repeat(64)]);
  await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,12,'Controlled section','Controlled chunk','[1,0]',2,$2)`,[doc,'c'.repeat(64)]);
  await rejects(`insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$1,'AMENDS')`,[doc]);
 }finally{await client.query('rollback');client.release();await pool.end();}
});

test('model purpose defaults preserve generation and explicitly require coherent embedding dimensions',async()=>{
 const pool=new Pool(poolOptions),client=await pool.connect();
 try{
  await client.query('begin');
  const provider=(await client.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted)
   values($1,'OPENAI','https://api.openai.com/v1',$2) returning id`,[randomUUID(),'v1.'+'x'.repeat(80)])).rows[0].id;
  const generation=(await client.query("insert into private.ai_models(provider_id,model_id,display_name) values($1,'fixture-generation','Fixture') returning purpose,embedding_dimensions",[provider])).rows[0];
  assert.deepEqual(generation,{purpose:'GENERATION',embedding_dimensions:null});
  await client.query('savepoint invalid_purpose');
  await assert.rejects(client.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose)
   values($1,'fixture-embedding','Fixture','EMBEDDING')`,[provider]),{code:'23514'});
  await client.query('rollback to savepoint invalid_purpose');
  await client.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,supports_json)
   values($1,'fixture-embedding','Fixture','EMBEDDING',2,false)`,[provider]);
 }finally{await client.query('rollback');client.release();await pool.end();}
});
