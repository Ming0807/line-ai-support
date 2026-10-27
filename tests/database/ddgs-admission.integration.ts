import assert from 'node:assert/strict';
import {after,beforeEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {reserveWebSearch,observeWebSearch,readSuccessfulWebSearch,webSearchAdmissionIdentity} from '../../lib/knowledge/web-search-admission';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
const service=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',options:'-c role=service_role',max:4});
after(async()=>{await ageSyntheticLedger();await Promise.all([pool.end(),service.end()]);});
const key=Buffer.alloc(32,81).toString('base64');
const input=()=>({consumer:'STUDENT',operationId:randomUUID(),ownerId:randomUUID(),purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null});
// Synthetic time setup only in the exact isolated owned DB; production grants/triggers remain unchanged.
async function ageSyntheticLedger(){
 const client=await pool.connect();try{
  await client.query('begin');await client.query('alter table private.web_search_attempts disable trigger web_search_attempt_admission');
  await client.query("update private.web_search_attempts set reserved_at=clock_timestamp()-interval '2 years',quota_day=(clock_timestamp()-interval '2 years')::date,quota_month=date_trunc('month',clock_timestamp()-interval '2 years')::date");
  await client.query('alter table private.web_search_attempts enable trigger web_search_attempt_admission');await client.query('commit');
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
beforeEach(ageSyntheticLedger);
test('retained search ledger has an immutable provider discriminator defaulting existing rows to Tavily',async()=>{
 const result=await pool.query("select column_default,is_nullable from information_schema.columns where table_schema='private' and table_name='web_search_attempts' and column_name='provider'");
 assert.equal(result.rowCount,1);assert.equal(result.rows[0].is_nullable,'NO');assert.match(result.rows[0].column_default,/TAVILY/);
});
test('DDGS success retains null HTTP, request ID and billing credits; Tavily cannot consume that observation',async()=>{
 const req=input(),admitted=await reserveWebSearch(service,req,key,'DDGS');assert.equal(admitted.status,'RESERVED');if(admitted.status!=='RESERVED')throw new Error('ADMISSION_EXPECTED');
 assert.equal(await observeWebSearch(service,admitted.attemptId,{kind:'DDGS_SUCCESS'}),true);
 const row=(await pool.query('select provider,observation,http_status,provider_request_id,credits from private.web_search_attempts where attempt_id=$1',[admitted.attemptId])).rows[0];
 assert.deepEqual(row,{provider:'DDGS',observation:'SUCCESS',http_status:null,provider_request_id:null,credits:null});
 assert.equal(await observeWebSearch(service,admitted.attemptId,{kind:'DDGS_SUCCESS'}),false);
 const client=await pool.connect();try{await assert.rejects(readSuccessfulWebSearch(client,admitted.attemptId,req,key,randomUUID()),/WEB_SEARCH_OBSERVATION_INVALID/);}finally{client.release();}
});
test('provider is immutable and a DDGS row cannot claim fabricated Tavily success metadata',async()=>{
 const admitted=await reserveWebSearch(service,input(),key,'DDGS');if(admitted.status!=='RESERVED')throw new Error('ADMISSION_EXPECTED');
 await assert.rejects(pool.query("update private.web_search_attempts set provider='TAVILY' where attempt_id=$1",[admitted.attemptId]),/WEB_SEARCH_ATTEMPT_IMMUTABLE/);
 assert.equal(await observeWebSearch(service,admitted.attemptId,{kind:'SUCCESS',httpStatus:200,providerRequestId:randomUUID(),credits:1}),false);
 assert.equal((await pool.query('select observation from private.web_search_attempts where attempt_id=$1',[admitted.attemptId])).rows[0].observation,'UNKNOWN');
 assert.equal((await pool.query("select has_column_privilege('service_role','private.web_search_attempts','provider','UPDATE') allowed")).rows[0].allowed,false);
});
test('one operation has distinct retained provider identities and same-provider retries do not reserve again',async()=>{
 const req=input();assert.notEqual(webSearchAdmissionIdentity(req,key).requestKey,webSearchAdmissionIdentity(req,key,'DDGS').requestKey);
 assert.equal((await reserveWebSearch(service,req,key)).status,'RESERVED');assert.equal((await reserveWebSearch(service,req,key,'DDGS')).status,'RESERVED');
 assert.equal((await reserveWebSearch(service,req,key,'DDGS')).status,'DUPLICATE');assert.equal((await reserveWebSearch(service,req,key)).status,'DUPLICATE');
});
test('concurrent DDGS operations obey a global ten-second spacing gate with one winner',async()=>{
 const results=await Promise.all(Array.from({length:4},()=>reserveWebSearch(service,input(),key,'DDGS')));
 assert.equal(results.filter(r=>r.status==='RESERVED').length,1);assert.equal(results.filter(r=>r.status==='EXHAUSTED').length,3);
});
test('concurrent duplicate DDGS operations retain one admission and report duplicates',async()=>{
 const req=input(),results=await Promise.all(Array.from({length:4},()=>reserveWebSearch(service,req,key,'DDGS')));
 assert.equal(results.filter(r=>r.status==='RESERVED').length,1);assert.equal(results.filter(r=>r.status==='DUPLICATE').length,3);
});
test('DDGS shares the existing daily cap rather than bypassing exhausted Tavily admission',async()=>{
 await service.query("insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic) select replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),repeat('1',64),'STUDENT','YRU_INFORMATION','WIFI_ACCESS' from generate_series(1,49)");
 assert.equal((await reserveWebSearch(service,input(),key,'DDGS')).status,'RESERVED');
 assert.equal((await reserveWebSearch(service,input(),key)).status,'EXHAUSTED');assert.equal((await reserveWebSearch(service,input(),key,'DDGS')).status,'EXHAUSTED');
});
