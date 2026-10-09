import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {reserveWebSearch,observeWebSearch} from '../../lib/knowledge/web-search-admission';
import {createWebSearchRuntime} from '../../lib/knowledge/web-search-runtime';
import {createHash} from 'node:crypto';
import {TavilySearchError} from '../../lib/knowledge/tavily-search';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:8});
const servicePool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',options:'-c role=service_role',max:8});
after(()=>Promise.all([pool.end(),servicePool.end()]));
const digest=()=>randomBytes(32).toString('hex');
async function insert(c:PoolClient,extra=''){
 return c.query(`insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic,academic_year${extra})
 values($1,$2,'STUDENT','YRU_INFORMATION','ACADEMIC_CALENDAR',2569${extra?',\'2001-01-01\',\'2001-01-01\',\'2001-01-01\'':''}) returning *`,[digest(),digest()]);
}
async function rollback(work:(c:PoolClient)=>Promise<void>){
 const c=await pool.connect();try{await c.query('begin');await work(c);}finally{await c.query('rollback');c.release();}
}

test('search ledger is private RLS with least observation-only mutation grants',async()=>{
 assert.equal((await pool.query("select to_regclass('private.web_search_attempts') is not null ready")).rows[0].ready,true);
 const rows=(await pool.query(`select c.relrowsecurity rls,has_table_privilege('service_role',c.oid,'SELECT') read,
  has_table_privilege('service_role',c.oid,'INSERT') append,has_table_privilege('service_role',c.oid,'UPDATE') update,
  has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE') destructive,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anonymous,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') browser,
  (select bool_and(has_column_privilege('service_role',c.oid,a.attname,'UPDATE')=(a.attname=any(array['observation','http_status','provider_request_id','credits'])))
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns
  from pg_class c where c.oid='private.web_search_attempts'::regclass`)).rows;
 assert.deepEqual(rows,[{rls:true,read:true,append:true,update:false,destructive:false,anonymous:false,browser:false,columns:true}]);
});

test('reservation derives UTC timestamps and periods instead of accepting caller stamps',async()=>rollback(async c=>{
 await c.query('set local role service_role');
 const row=(await insert(c,',reserved_at,quota_day,quota_month')).rows[0];
 const stamp=(await c.query("select quota_day=(clock_timestamp() at time zone 'UTC')::date day_ok,quota_month=date_trunc('month',clock_timestamp() at time zone 'UTC')::date month_ok from private.web_search_attempts where attempt_id=$1",[row.attempt_id])).rows[0];
 assert.equal(stamp.day_ok,true);assert.equal(stamp.month_ok,true);
 assert(row.reserved_at.getUTCFullYear()>2025);assert.equal(row.observation,'UNKNOWN');assert.equal(row.http_status,null);
}));

test('base identity is immutable and attempts cannot be deleted or truncated even by an owner',async()=>rollback(async c=>{
 const row=(await insert(c)).rows[0];
 for(const sql of ["update private.web_search_attempts set owner_digest=$2 where attempt_id=$1",'delete from private.web_search_attempts where attempt_id=$1','truncate private.web_search_attempts']){
  await c.query('savepoint denial');
  await assert.rejects(c.query(sql,sql.includes('$2')?[row.attempt_id,digest()]:sql.includes('$1')?[row.attempt_id]:[]),/WEB_SEARCH_ATTEMPT_IMMUTABLE/u);
  await c.query('rollback to savepoint denial');
 }
 assert.equal((await c.query('select count(*)::int n from private.web_search_attempts where attempt_id=$1',[row.attempt_id])).rows[0].n,1);
}));

test('observations permit one checked UNKNOWN to SUCCESS or ERROR transition and never a refund',async()=>rollback(async c=>{
 const before=(await c.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
 const a=(await insert(c)).rows[0],b=(await insert(c)).rows[0];await c.query('set local role service_role');
 await c.query("update private.web_search_attempts set observation='SUCCESS',http_status=200,provider_request_id=$2,credits=1 where attempt_id=$1",[a.attempt_id,randomUUID()]);
 await c.query("update private.web_search_attempts set observation='ERROR',http_status=429 where attempt_id=$1",[b.attempt_id]);
 await c.query('savepoint denial');
 await assert.rejects(c.query("update private.web_search_attempts set observation='UNKNOWN',http_status=null,provider_request_id=null,credits=null where attempt_id=$1",[a.attempt_id]),/WEB_SEARCH_ATTEMPT_IMMUTABLE/u);
 await c.query('rollback to savepoint denial');
 assert.equal((await c.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,before+2);
 assert.deepEqual((await c.query('select observation from private.web_search_attempts where attempt_id=any($1::uuid[]) order by observation',[[a.attempt_id,b.attempt_id]])).rows,[{observation:'ERROR'},{observation:'SUCCESS'}]);
}));

test('closed purpose/topic/year and success payload constraints reject contradictory rows',async()=>rollback(async c=>{
 for(const [purpose,topic,year] of [['GENERAL_PUBLIC','ACADEMIC_CALENDAR',null],['YRU_INFORMATION','GENERAL_WIFI_HELP',null],['YRU_INFORMATION','WIFI_ACCESS',2569],['YRU_INFORMATION','ACADEMIC_CALENDAR',2399]]){
  await c.query('savepoint invalid');await assert.rejects(c.query(`insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic,academic_year) values($1,$2,'STAFF',$3,$4,$5)`,[digest(),digest(),purpose,topic,year]));await c.query('rollback to savepoint invalid');
 }
 const row=(await insert(c)).rows[0];await c.query('savepoint invalid');
 await assert.rejects(c.query("update private.web_search_attempts set observation='SUCCESS',http_status=200 where attempt_id=$1",[row.attempt_id]));await c.query('rollback to savepoint invalid');
}));

test('monthly ceiling counts retained other-day attempts without a counter reset',async()=>rollback(async c=>{
 // Only the disposable database owner establishes synthetic retained history.
 // Production service cannot disable triggers, forge periods or remove attempts.
 await c.query('alter table private.web_search_attempts disable trigger user');
 await c.query(`insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic,academic_year,reserved_at,quota_day,quota_month)
 select repeat(md5('month-fixture-'||n),2),$1,'STAFF','GENERAL_PUBLIC','GENERAL_WIFI_HELP',null,
  other_day::timestamp at time zone 'UTC',other_day,bucket_month from generate_series(1,500) n cross join lateral(
   select date_trunc('month',clock_timestamp() at time zone 'UTC')::date bucket_month) m cross join lateral(
   select case when (clock_timestamp() at time zone 'UTC')::date=m.bucket_month then m.bucket_month+1 else m.bucket_month end other_day) d`,[digest()]);
 await c.query('alter table private.web_search_attempts enable trigger user');await c.query('set local role service_role');
 await assert.rejects(insert(c),/WEB_SEARCH_QUOTA_EXHAUSTED/u);
}));

const key=Buffer.alloc(32,19).toString('base64');
const request=()=>({consumer:'STUDENT',operationId:randomUUID(),ownerId:randomUUID(),purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569});
const recoveredRequest=request();

test('helper commits once under takeover races and changed owner/topic/year cannot reopen operation',async()=>{
 const input=recoveredRequest,results=await Promise.all(Array.from({length:12},()=>reserveWebSearch(servicePool,input,key)));
 assert.equal(results.filter(r=>r.status==='RESERVED').length,1);assert.equal(results.filter(r=>r.status==='DUPLICATE').length,11);
 for(const change of [{ownerId:randomUUID()},{topic:'TUITION_FEES'},{academicYear:2568}])assert.deepEqual(await reserveWebSearch(servicePool,{...input,...change},key),{status:'DUPLICATE'});
 const admitted=results.find(r=>r.status==='RESERVED');assert(admitted&&admitted.status==='RESERVED');
 const row=(await pool.query('select * from private.web_search_attempts where attempt_id=$1',[admitted.attemptId])).rows[0];
 assert.equal(row.observation,'UNKNOWN');for(const id of [input.ownerId,input.operationId])assert(!JSON.stringify(row).includes(id));
 assert.equal(row.request_key.length,64);assert.equal(row.owner_digest.length,64);
});

test('helper uses separate purpose and consumer attempts, observes once and never refunds unknown/errors',async()=>{
 const input=request(),a=await reserveWebSearch(servicePool,input,key);assert(a.status==='RESERVED');
 const b=await reserveWebSearch(servicePool,{...input,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null},key);assert(b.status==='RESERVED');
 const c=await reserveWebSearch(servicePool,{...input,consumer:'STAFF'},key);assert(c.status==='RESERVED');
 assert.equal(await observeWebSearch(servicePool,a.attemptId,{kind:'ERROR',httpStatus:null}),true);
 assert.equal(await observeWebSearch(servicePool,a.attemptId,{kind:'SUCCESS',httpStatus:200,providerRequestId:randomUUID(),credits:1}),false);
 assert.equal(await observeWebSearch(servicePool,b.attemptId,{kind:'SUCCESS',httpStatus:200,providerRequestId:randomUUID(),credits:1}),true);
 assert.equal(await observeWebSearch(servicePool,b.attemptId,{kind:'SUCCESS',httpStatus:200,providerRequestId:randomUUID(),credits:1}),false);
 assert.equal(await observeWebSearch(servicePool,c.attemptId,{kind:'SUCCESS',httpStatus:200}),false);
 assert.deepEqual(await reserveWebSearch(servicePool,input,key),{status:'DUPLICATE'});
});

test('a multirow direct insert cannot cross the ceiling or retain a partial batch',async()=>rollback(async c=>{
 const before=(await c.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
 await c.query('set local role service_role');await c.query('savepoint batch');
 await assert.rejects(c.query(`insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic)
  select repeat(md5('batch-'||n),2),$1,'STAFF','GENERAL_PUBLIC','GENERAL_WIFI_HELP' from generate_series(1,65) n`,[digest()]),/WEB_SEARCH_QUOTA_EXHAUSTED/u);
 await c.query('rollback to savepoint batch');
 assert.equal((await c.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,before);
}));

function runtimeFixture(){
 const apiKey='synthetic-search-key',time=Date.now(),order:string[]=[];
 const config={enabled:true,apiKey,attestation:{mode:'RESEARCHER_NO_PAYG',keySha256:createHash('sha256').update(apiKey).digest('hex'),attestedAt:new Date(time-1000).toISOString()}};
 const adapter={usage:async()=>({currentPlan:'Researcher',keyUsage:0,keyLimit:1000,planUsage:0,planLimit:1000,paygoUsage:0,paygoLimit:0}),
  search:async()=>{order.push('POST');return {requestId:randomUUID(),credits:1 as const,results:[]};}};
 return {config,adapter,order,time};
}

test('runtime observes a committed reservation from another connection before mock POST, then fences takeover',async()=>{
 const f=runtimeFixture(),input=request();let attemptId:string|undefined;
 f.adapter.search=async()=>{
  assert(attemptId,'EXACT_ATTEMPT_REQUIRED');
  const rows=(await pool.query('select observation from private.web_search_attempts where attempt_id=$1',[attemptId])).rows;
  assert.deepEqual(rows,[{observation:'UNKNOWN'}],'COMMIT_BEFORE_NETWORK_REQUIRED');f.order.push('POST');return {requestId:randomUUID(),credits:1 as const,results:[]};
 };
 const run=createWebSearchRuntime({pool:servicePool,encryptionKey:key,config:f.config,adapter:f.adapter,now:()=>f.time,
  reserve:async value=>{const admitted=await reserveWebSearch(servicePool,value,key);if(admitted.status==='RESERVED')attemptId=admitted.attemptId;return admitted;}});
 assert.equal((await run(input,new AbortController().signal)).status,'READY');assert.deepEqual(f.order,['POST']);
 assert.equal((await run(input,new AbortController().signal)).status,'ALREADY_ATTEMPTED');assert.deepEqual(f.order,['POST']);
});

test('cancelled after commit remains UNKNOWN and a restarted runtime cannot repeat the search',async()=>{
 const f=runtimeFixture(),input=request(),controller=new AbortController();let attemptId:string|undefined;
 const run=createWebSearchRuntime({pool:servicePool,encryptionKey:key,config:f.config,adapter:f.adapter,now:()=>f.time,
  reserve:async value=>{const admitted=await reserveWebSearch(servicePool,value,key);if(admitted.status==='RESERVED')attemptId=admitted.attemptId;controller.abort();return admitted;}});
 assert.equal((await run(input,controller.signal)).status,'UNAVAILABLE');assert.deepEqual(f.order,[]);assert(attemptId);
 assert.equal((await pool.query('select observation from private.web_search_attempts where attempt_id=$1',[attemptId])).rows[0].observation,'UNKNOWN');
 const restarted=createWebSearchRuntime({pool:servicePool,encryptionKey:key,config:f.config,adapter:f.adapter,now:()=>f.time});
 assert.equal((await restarted(input,new AbortController().signal)).status,'ALREADY_ATTEMPTED');assert.deepEqual(f.order,[]);
});

test('unknown transport consumes a committed attempt and never repeats across runtime instances',async()=>{
 const f=runtimeFixture(),input={...request(),consumer:'STAFF'};
 f.adapter.search=async()=>{f.order.push('POST');throw new TavilySearchError('WEB_SEARCH_TIMEOUT');};
 const options={pool:servicePool,encryptionKey:key,config:f.config,adapter:f.adapter,now:()=>f.time};
 assert.equal((await createWebSearchRuntime(options)(input,new AbortController().signal)).status,'UNAVAILABLE');
 assert.equal((await createWebSearchRuntime(options)(input,new AbortController().signal)).status,'ALREADY_ATTEMPTED');assert.deepEqual(f.order,['POST']);
});

test('quota lock timeout grants no admission and leaves no attempt',async()=>{
 const c=await pool.connect(),before=(await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
 try{
  await c.query('begin');await c.query("select pg_advisory_xact_lock(hashtextextended('web-search-quota:v1',0))");
  assert.deepEqual(await reserveWebSearch(servicePool,request(),key),{status:'UNAVAILABLE'});
 }finally{await c.query('rollback');c.release();}
 assert.equal((await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,before);
});

test('invalid helper input/key fails closed and isolation cannot bypass direct insert capacity',async()=>{
 const before=(await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
 for(const input of [{...request(),question:'private'}, {...request(),ownerId:'bad'}, {...request(),academicYear:0}])assert.deepEqual(await reserveWebSearch(pool,input,key),{status:'UNAVAILABLE'});
 assert.deepEqual(await reserveWebSearch(pool,request(),'bad-key'),{status:'UNAVAILABLE'});
 assert.equal((await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,before);
 const c=await pool.connect();try{
  await c.query('begin isolation level repeatable read');await c.query('set local role service_role');
  await assert.rejects(insert(c),/WEB_SEARCH_ADMISSION_UNAVAILABLE/u);
 }finally{await c.query('rollback');c.release();}
});

test('concurrent direct service inserts enforce the shared daily ceiling atomically',async()=>{
 const before=(await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n;
 const values=await Promise.all(Array.from({length:65},async()=>{
  const c=await pool.connect();try{await c.query('begin');await c.query("set local statement_timeout='10s';set local role service_role");
   await insert(c);await c.query('commit');return 'RESERVED';
  }catch(error){await c.query('rollback');assert.match(error instanceof Error?error.message:'',/WEB_SEARCH_QUOTA_EXHAUSTED/u);return 'EXHAUSTED';}
  finally{c.release();}
 }));
 assert.equal(values.filter(v=>v==='RESERVED').length,50-before);assert.equal(values.filter(v=>v==='EXHAUSTED').length,15+before);
 assert.equal((await pool.query('select count(*)::int n from private.web_search_attempts')).rows[0].n,50);
 assert.deepEqual(await reserveWebSearch(pool,request(),key),{status:'EXHAUSTED'});
 assert.deepEqual(await reserveWebSearch(servicePool,recoveredRequest,key),{status:'DUPLICATE'});
});
