import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {knowledgeStructuredCatalogLock} from '../../lib/knowledge/delivery-fence';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
after(()=>pool.end());
const dml=[
 'insert into public.knowledge_chunks(document_id,chunk_index,content) select document_id,chunk_index,content from public.knowledge_chunks where false',
 'update public.knowledge_chunks set requires_review=requires_review where false',
 'delete from public.knowledge_chunks where false',
 'truncate public.knowledge_chunks',
];
const retry=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='40001'&&'message' in error&&error.message==='STRUCTURED_SELECTION_RETRY';
async function conflict(kind:'session'|'transaction',work:(writer:PoolClient,reader:PoolClient)=>Promise<void>){
 const reader=await pool.connect(),writer=await pool.connect();
 try{
  if(kind==='transaction')await reader.query('begin');
  await reader.query(`select ${kind==='session'?'pg_advisory_lock_shared':'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,[knowledgeStructuredCatalogLock]);
  await writer.query("begin;set local role service_role;set local statement_timeout='2s'");
  await work(writer,reader);
 }finally{
  await writer.query('rollback');
  if(kind==='session')await reader.query('select pg_advisory_unlock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  else await reader.query('rollback');
  writer.release();reader.release();
 }
}

test('RAG catalog guard binds every write as a private invoker statement trigger with least execute grants',async()=>{
 const rows=(await pool.query(`select pg_get_triggerdef(t.oid) definition,t.tgenabled enabled,p.prosecdef definer,p.provolatile volatility,p.proconfig config,
  n.nspname namespace,has_function_privilege('anon',p.oid,'EXECUTE') anonymous,has_function_privilege('authenticated',p.oid,'EXECUTE') browser,
  has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
  where t.tgrelid='public.knowledge_chunks'::regclass and t.tgname='rag_selection_catalog' and not t.tgisinternal`)).rows;
 assert.equal(rows.length,1,'RAG_CHUNK_CATALOG_GUARD_REQUIRED');const row=rows[0];
 for(const term of ['BEFORE','INSERT','UPDATE','DELETE','TRUNCATE','FOR EACH STATEMENT'])assert(row.definition.includes(term));
 assert.equal(row.namespace,'private');assert.equal(row.enabled,'O');assert.equal(row.definer,false);assert.equal(row.volatility,'v');
 assert.deepEqual(row.config,['search_path=""']);assert.equal(row.anonymous,false);assert.equal(row.browser,false);assert.equal(row.service,true);
});

for(const kind of ['session','transaction'] as const)test(`all direct chunk writes retry against a shared ${kind} reader without changes`,async()=>{
 const before=(await pool.query('select count(*)::int n from public.knowledge_chunks')).rows[0].n;
 await conflict(kind,async(writer,reader)=>{
  if(kind==='session'){
   const pid=(await reader.query('select pg_backend_pid() pid')).rows[0].pid;
   assert.equal((await pool.query('select state from pg_stat_activity where pid=$1',[pid])).rows[0].state,'idle','NO_SQL_TRANSACTION_ACROSS_DELIVERY_REQUIRED');
  }
  for(const sql of dml){await writer.query('savepoint retry');await assert.rejects(writer.query(sql),retry);await writer.query('rollback to savepoint retry');}
 });
 assert.equal((await pool.query('select count(*)::int n from public.knowledge_chunks')).rows[0].n,before);
});

test('cooperating exclusive writer reenters the guard and releases its lock on rollback',async()=>{
 const client=await pool.connect();
 try{
  await client.query("begin;set local role service_role;set local statement_timeout='2s'");
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  for(const sql of dml.slice(0,3))await client.query(sql);
 }finally{await client.query('rollback');client.release();}
 const reader=await pool.connect();try{
  const row=(await reader.query('select pg_try_advisory_lock_shared(hashtextextended($1,0)) held',[knowledgeStructuredCatalogLock])).rows[0];assert.equal(row.held,true);
 }finally{await reader.query('select pg_advisory_unlock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);reader.release();}
});

test('actual complete RAG miss fences a new matching insert and prior-row-lock update until reader release',async()=>{
 const code='RAG_FENCE_'+randomUUID().replaceAll('-','').toUpperCase(),vector=[1,...Array<number>(383).fill(0)],other=[0,1,...Array<number>(382).fill(0)];
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[code],departmentCode:null,audience:null,studentType:null,
  semester:null,programCode:null,curriculumCode:null,cohort:null};
 const setup=await pool.connect();let documentId:string|undefined,oldChunk:string|undefined;
 try{
  await setup.query('begin');
  const family=(await setup.query("insert into public.document_families(code,name,category) values($1,'Synthetic RAG fence source','GUIDE') returning id",[code])).rows[0].id;
  documentId=(await setup.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,
   official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,'Synthetic reviewed RAG fence source','2569','REGULAR','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
    'https://fixture.yru.ac.th/rag-fence.pdf',$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
  oldChunk=(await setup.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,0,'Synthetic nonmatching retained passage',$2::extensions.vector,384,$3) returning id`,[documentId,JSON.stringify(other),LOCAL_EMBEDDING_FINGERPRINT])).rows[0].id;
  await setup.query('commit');
 }catch(error){await setup.query('rollback');throw error;}finally{setup.release();}
 const reader=await pool.connect(),writer=await pool.connect();let held=false;
 const search=async()=>{
  await reader.query('begin');
  try{const result=await searchKnowledge(reader,{scope,vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,limit:12},'2026-10-09');await reader.query('commit');return result;}
  catch(error){await reader.query('rollback');throw error;}
 };
 try{
  await reader.query('select pg_advisory_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);held=true;
  assert.deepEqual(await search(),[]);
  await writer.query("begin;set local role service_role;set local statement_timeout='2s'");
  // The direct writer already owns a row: the guard must fail, never wait for catalog.
  await writer.query('select id from public.knowledge_chunks where id=$1 for update',[oldChunk]);
  await writer.query('savepoint retry');
  await assert.rejects(writer.query('update public.knowledge_chunks set embedding=$2::extensions.vector where id=$1',[oldChunk,JSON.stringify(vector)]),retry);
  await writer.query('rollback to savepoint retry');
  const insert=`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
   values($1,1,'Synthetic new matching passage',$2::extensions.vector,384,$3) returning id`;
  const parameters=[documentId,JSON.stringify(vector),LOCAL_EMBEDDING_FINGERPRINT];
  await writer.query('savepoint retry');await assert.rejects(writer.query(insert,parameters),retry);await writer.query('rollback to savepoint retry');
  assert.deepEqual(await search(),[]);
  await reader.query('select pg_advisory_unlock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);held=false;
  const added=(await writer.query(insert,parameters)).rows[0].id;await writer.query('commit');
  // RAG keeps the other passage from the same complete reviewed rule context.
  // The newly matching passage must lead; the retained old passage remains context.
  assert.deepEqual((await search()).map(row=>row.chunkId),[added,oldChunk]);
  assert.equal((await pool.query('select count(*)::int n from public.knowledge_chunks where document_id=$1',[documentId])).rows[0].n,2);
 }finally{
  await writer.query('rollback');
  if(held)await reader.query('select pg_advisory_unlock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  writer.release();reader.release();
  // Retain evidence, retire this exact owned source before later global worker fixtures.
  if(documentId)await pool.query("update public.documents set status='ARCHIVED',is_current=false where id=$1",[documentId]);
 }
});
