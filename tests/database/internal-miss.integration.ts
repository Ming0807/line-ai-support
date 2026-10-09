import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID,createHmac,hkdfSync} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {proveInternalMiss,internalMissStillApplies} from '../../lib/knowledge/internal-miss';
import {knowledgeStructuredCatalogLock} from '../../lib/knowledge/delivery-fence';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {AISnapshot} from '../../lib/ai/run-worker';
import {canonicalDigest} from '../../lib/imports/structured-mapping-contract';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
after(()=>pool.end());
const key=Buffer.alloc(32,94).toString('base64');
const snapshot:AISnapshot={jobId:randomUUID(),sessionId:randomUUID(),conversationId:randomUUID(),messageId:randomUUID(),revision:3,
 question:'ขอข้อมูลระบบทดสอบที่ระบุไว้',history:[{role:'user',content:'ช่วยดูเรื่องเดิมที่คุยไว้ด้วย'}]};
const code='MISS_'+randomUUID().replaceAll('-','').toUpperCase();
const candidate={scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[code],departmentCode:null,audience:null,studentType:null,
 semester:null,programCode:null,curriculumCode:null,cohort:null},structuredQuery:{version:1 as const,dataset:'university_systems' as const,filters:{name:'ระบบทดสอบ'},limit:20},
 queryVector:[1,...Array<number>(383).fill(0)],fingerprint:LOCAL_EMBEDDING_FINGERPRINT};
async function fenced<T>(work:(c:PoolClient)=>Promise<T>,lock=true):Promise<T>{
 const c=await pool.connect();try{await c.query("begin;set local statement_timeout='4s';set local lock_timeout='2s'");
  if(lock)await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  return await work(c);
 }finally{await c.query('rollback');c.release();}
}
async function receipt(c:PoolClient){const result=await proveInternalMiss(c,candidate,snapshot,key);assert.equal(result.status,'EMPTY');
 assert(result.status==='EMPTY');return result.proof;}

test('actual Structured EMPTY plus complete RAG EMPTY yields immutable private receipt and repeats both searches',()=>fenced(async c=>{
 const proof=await receipt(c);assert(Object.isFrozen(proof));assert(Object.isFrozen(proof.scope));assert(Object.isFrozen(proof.queryVector));
 assert.equal(await internalMissStillApplies(c,proof,snapshot,key),true);
 const serialized=JSON.stringify(proof);assert(!serialized.includes(snapshot.question));assert(!serialized.includes(snapshot.history[0].content));
 assert(!serialized.includes(snapshot.sessionId));
}));

test('catalog ownership is mandatory for initial and repeated miss checks',async()=>{
 const proof=await fenced(receipt);
 await fenced(async c=>{assert.equal((await proveInternalMiss(c,candidate,snapshot,key)).status,'UNAVAILABLE');
  assert.equal(await internalMissStillApplies(c,proof,snapshot,key),false);},false);
});

test('actual service-role privileges can seal and freshly verify the receipt',()=>fenced(async c=>{
 await c.query('set local role service_role');const proof=await receipt(c);
 assert.equal(await internalMissStillApplies(c,proof,snapshot,key),true);
}));

for(const isolation of ['repeatable read','serializable'] as const)test(`stale ${isolation} transaction snapshots cannot establish complete miss`,async()=>{
 const proof=await fenced(receipt),c=await pool.connect();
 try{await c.query(`begin isolation level ${isolation}`);
  await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  assert.equal((await proveInternalMiss(c,candidate,snapshot,key)).status,'UNAVAILABLE');
  assert.equal(await internalMissStillApplies(c,proof,snapshot,key),false);
 }finally{await c.query('rollback');c.release();}
});

test('receipt does not cross jobs, sessions, conversations, messages, revisions, question or history',()=>fenced(async c=>{
 const proof=await receipt(c);
 for(const field of ['jobId','sessionId','conversationId','messageId'] as const)
  assert.equal(await internalMissStillApplies(c,proof,{...snapshot,[field]:randomUUID()},key),false,field);
 assert.equal(await internalMissStillApplies(c,proof,{...snapshot,revision:4},key),false);
 assert.equal(await internalMissStillApplies(c,proof,{...snapshot,question:'คำถามอื่น'},key),false);
 assert.equal(await internalMissStillApplies(c,proof,{...snapshot,history:[]},key),false);
 assert.equal(await internalMissStillApplies(c,proof,snapshot,Buffer.alloc(32,95).toString('base64')),false);
}));

test('changed receipt vector, scope, selectors, policy, signature and evaluation day are rejected',()=>fenced(async c=>{
 const proof=await receipt(c);
 const tampered=[{...proof,queryVector:[0,1,...Array<number>(382).fill(0)]},{...proof,scope:{...proof.scope,familyCodes:[]}},
  {...proof,structuredQuery:{...proof.structuredQuery,filters:{name:'ระบบอื่น'}}},{...proof,policy:'OTHER'},
  {...proof,signature:'0'.repeat(64)},{...proof,evaluatedOn:'2026-10-08'},{...proof,extra:true}];
 for(const value of tampered)assert.equal(await internalMissStillApplies(c,value,snapshot,key),false);
}));

test('authentic receipt from the preceding evaluation day fails the database-day check',()=>fenced(async c=>{
 const proof=await receipt(c),oldDate=new Date(proof.evaluatedOn+'T00:00:00.000Z');oldDate.setUTCDate(oldDate.getUTCDate()-1);
 const {signature:previousSignature,...body}=proof;assert.equal(previousSignature.length,64);
 const changed={...body,evaluatedOn:oldDate.toISOString().slice(0,10)};
 const derived=Buffer.from(hkdfSync('sha256',Buffer.from(key,'base64'),'yru-helpdesk-v1','internal-miss-receipt',32));
 const signature=createHmac('sha256',derived).update(canonicalDigest('internal-miss-receipt-v1',changed)).digest('hex');
 assert.equal(await internalMissStillApplies(c,{...changed,signature},snapshot,key),false);
}));

test('candidate and source context are detached before the first asynchronous read',()=>fenced(async c=>{
 const own=structuredClone(candidate),source=structuredClone(snapshot),pending=proveInternalMiss(c,own,source,key);
 own.scope.familyCodes=[];own.queryVector[0]=0;source.question='changed after call';source.history=[];
 const result=await pending;assert.equal(result.status,'EMPTY');assert(result.status==='EMPTY');
 assert.deepEqual(result.proof.scope.familyCodes,[code]);assert.equal(result.proof.queryVector[0],1);
 assert.equal(await internalMissStillApplies(c,result.proof,snapshot,key),true);
}));

test('missing query, incomplete selectors, invalid/nonlocal vector and hostile own JSON never establish a miss',()=>fenced(async c=>{
 let invoked=false;const accessor=Object.defineProperty({},'scope',{enumerable:true,get:()=>{invoked=true;throw new Error('MUST_NOT_RUN');}});
 const invalid=[{...candidate,structuredQuery:undefined},{...candidate,structuredQuery:{version:1,dataset:'tuition_fees',filters:{academic_year:2569},limit:20}},
  {...candidate,queryVector:Array<number>(384).fill(0)},{...candidate,queryVector:[1,0]},
  {...candidate,fingerprint:'1'.repeat(64)},{...candidate,extra:'not accepted'},accessor,new Proxy(candidate,{})];
 for(const value of invalid)assert.notEqual((await proveInternalMiss(c,value,snapshot,key)).status,'EMPTY');
 assert.equal(invoked,false);
}));

const corruptions=[
 ['missing chunk trigger','drop trigger rag_selection_catalog on public.knowledge_chunks'],
 ['disabled chunk trigger','alter table public.knowledge_chunks disable trigger rag_selection_catalog'],
 ['missing document guard','drop trigger structured_selection_catalog on public.documents'],
 ['missing private source guard','drop trigger structured_selection_catalog_source on private.knowledge_import_jobs'],
 ['wrong source-column binding',`drop trigger structured_selection_catalog_source on private.knowledge_import_jobs;
  create trigger structured_selection_catalog_source before update of checksum on private.knowledge_import_jobs for each statement execute function private.lock_structured_selection_catalog()`],
 ['wrong chunk event',`drop trigger rag_selection_catalog on public.knowledge_chunks;
  create trigger rag_selection_catalog before insert on public.knowledge_chunks for each statement execute function private.lock_rag_selection_catalog()`],
 ['no-op chunk function',`create or replace function private.lock_rag_selection_catalog() returns trigger language plpgsql volatile security invoker set search_path='' as $$begin return null;end;$$`],
 ['no-op common function',`create or replace function private.lock_structured_selection_catalog() returns trigger language plpgsql volatile security invoker set search_path='' as $$begin return null;end;$$`],
 ['browser execute','grant execute on function private.lock_rag_selection_catalog() to authenticated'],
 ['missing service execute','revoke execute on function private.lock_rag_selection_catalog() from service_role'],
 ['function search path',"alter function private.lock_rag_selection_catalog() set search_path=public"],
] as const;
for(const [name,sql] of corruptions)test(`installed readiness rejects ${name} without trusting table existence`,()=>fenced(async c=>{
 const proof=await receipt(c);await c.query(sql);
 assert.equal((await proveInternalMiss(c,candidate,snapshot,key)).status,'UNAVAILABLE');
 assert.equal(await internalMissStillApplies(c,proof,snapshot,key),false);
}));

test('new eligible RAG passage invalidates a signed complete miss; retained source is not deleted',async()=>{
 const proof=await fenced(receipt);let documentId:string|undefined;
 try{
  const c=await pool.connect();try{await c.query('begin');
   const family=(await c.query("insert into public.document_families(code,name,category) values($1,'Synthetic internal miss source','GUIDE') returning id",[code])).rows[0].id;
   documentId=(await c.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,
    official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
    values($1,'Synthetic internal miss source','2569','DEFAULT','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
    'https://fixture.yru.ac.th/internal-miss.pdf',$2) returning id`,[family,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
   await c.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint)
    values($1,0,'Synthetic newly available answer',$2::extensions.vector,384,$3)`,[documentId,JSON.stringify(candidate.queryVector),candidate.fingerprint]);
   await c.query('commit');
  }catch(error){await c.query('rollback');throw error;}finally{c.release();}
  await fenced(async c=>{assert.equal(await internalMissStillApplies(c,proof,snapshot,key),false);
   assert.equal((await proveInternalMiss(c,candidate,snapshot,key)).status,'RAG_MATCH');});
  assert.equal((await pool.query('select count(*)::int n from public.knowledge_chunks where document_id=$1',[documentId])).rows[0].n,1);
 }finally{if(documentId)await pool.query("update public.documents set status='ARCHIVED',is_current=false where id=$1",[documentId]);}
});

test('readiness and empty-search receipt restore after every transactional corruption',()=>fenced(async c=>{
 const proof=await receipt(c);assert.equal(await internalMissStillApplies(c,proof,snapshot,key),true);
}));
