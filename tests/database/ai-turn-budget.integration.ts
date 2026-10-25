import assert from 'node:assert/strict';
import {test,after,afterEach} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createDurableTurnBudget} from '../../lib/ai/durable-turn-budget';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import type {AIModelConfig} from '../../lib/ai/types';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:6});
const ownedJobs:string[]=[],ownedInbox:string[]=[];
afterEach(async()=>{
 await pool.query("update private.ai_jobs set status='DONE',lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=any($1::uuid[])",[ownedJobs]);
 await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null where id=any($1::uuid[])",[ownedInbox]);
});
after(()=>pool.end());
async function fixture(){
 const key=randomBytes(32).toString('base64'),user='U'+randomUUID().replaceAll('-',''),inbox=randomUUID(),lease=randomUUID(),session=randomUUID(),conversation=randomUUID(),message=randomUUID(),job=randomUUID(),aiLease=randomUUID();
 ownedJobs.push(job);ownedInbox.push(inbox);
 const event={type:'message',source:{type:'user',userId:user},message:{type:'text',id:randomUUID(),text:'Synthetic question'}};
 await pool.query("insert into private.webhook_inbox(id,channel,event_id,user_hash,payload_encrypted,status,lease_token,lease_until) values($1::uuid,'STUDENT',$1::uuid::text,$2,$3,'PROCESSING',$4,clock_timestamp()+interval '2 minutes')",[inbox,hashLineUserId(user,key),encryptValue(JSON.stringify(event),key),lease]);
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1::uuid,$1::uuid::text)',[session]);
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 await pool.query('insert into public.conversations(id,line_session_id) values($1,$2)',[conversation,session]);
 await pool.query("insert into public.messages(id,conversation_id,sender_type,message_type,content,line_message_id,source_event_id) values($1,$2,'USER','TEXT',$3,$4,$5)",[message,conversation,event.message.text,event.message.id,inbox]);
 await pool.query("insert into private.ai_jobs(id,line_session_id,conversation_id,message_id,expected_conversation_revision,request_encrypted,status,lease_token,lease_until) select $1,$2,$3,$4,revision,$6,'PROCESSING',$5,clock_timestamp()+interval '2 minutes' from public.conversations where id=$3",[job,session,conversation,message,aiLease,encryptValue(JSON.stringify({receivedAt:new Date().toISOString()}),key)]);
 const model:AIModelConfig={id:randomUUID(),providerId:randomUUID(),adapter:'MOCK',modelId:'synthetic',baseUrl:'https://example.com',apiKeyEncrypted:'unused',providerRevision:1,modelRevision:1,providerNetworkRevision:1,modelNetworkRevision:1,providerPriority:1,priority:1,timeoutMs:1000,supportsJson:true,supportsTools:false,inputPricePerMillion:0,outputPricePerMillion:0,costMode:'FREE_ONLY'};
 const incoming=()=>createDurableTurnBudget(pool,{kind:'INBOX',id:inbox,leaseToken:lease},key);
 const ai=()=>createDurableTurnBudget(pool,{kind:'AI',id:job,leaseToken:aiLease},key);
 return {key,inbox,lease,session,conversation,message,job,aiLease,model,incoming,ai};
}
test('durable budget shares failures and count from exact inbox to AI job',async()=>{
 const f=await fixture(),first=await f.incoming().reserve(f.model);assert(first);await first.finish('RATE_LIMITED');
 assert.equal(await f.ai().reserve(f.model),null);
 for(let revision=2;revision<=4;revision++){const a=await f.ai().reserve({...f.model,modelRevision:revision});assert(a);await a.finish();}
 assert.equal(await f.ai().reserve({...f.model,modelRevision:5}),null);
 assert.equal(Number((await pool.query('select count(*) n from private.ai_turn_attempts where inbox_id=$1',[f.inbox])).rows[0].n),4);
});
test('assistant six-attempt ceiling leaves room for retrieval composition after routing fallback',async()=>{
 const f=await fixture();
 const incoming=createDurableTurnBudget(pool,{kind:'INBOX',id:f.inbox,leaseToken:f.lease},f.key,{limit:6});
 const ai=createDurableTurnBudget(pool,{kind:'AI',id:f.job,leaseToken:f.aiLease},f.key,{limit:6});
 const failed=await incoming.reserve(f.model);assert(failed);await failed.finish('RATE_LIMITED');
 const fallback={...f.model,modelRevision:2};
 const route=await incoming.reserve(fallback);assert(route);await route.finish();
 for(const stage of ['decision','lookup_plan','answer','optional_final_attempt']){
  assert.equal(await ai.reserve(f.model),null,'FAILED_CONFIGURATION_MUST_STAY_EXCLUDED');
  const attempt=await ai.reserve(fallback);assert(attempt,stage);await attempt.finish();
 }
 assert.equal(await ai.reserve(fallback),null);
 assert.equal((await pool.query('select count(*)::int n from private.ai_turn_attempts where inbox_id=$1',[f.inbox])).rows[0].n,6);
});
test('durable assistant ceiling is bounded and caller mutations cannot alter a turn budget',async()=>{
 const f=await fixture();
 for(const limit of [0,7,1.5,NaN])assert.throws(()=>createDurableTurnBudget(pool,{kind:'AI',id:f.job,leaseToken:f.aiLease},f.key,{limit}),{message:'TURN_BUDGET_INVALID'});
 const options={limit:1},budget=createDurableTurnBudget(pool,{kind:'AI',id:f.job,leaseToken:f.aiLease},f.key,options);
 options.limit=6;const first=await budget.reserve(f.model);assert(first);await first.finish();assert.equal(await budget.reserve(f.model),null);
});
test('stage ceilings reserve plan and final composition without creating separate budgets',async()=>{
 const f=await fixture(),owner={kind:'AI' as const,id:f.job,leaseToken:f.aiLease};
 const decision=createDurableTurnBudget(pool,owner,f.key,{limit:6,reservedSlots:2});
 const plan=createDurableTurnBudget(pool,owner,f.key,{limit:6,reservedSlots:1});
 const final=createDurableTurnBudget(pool,owner,f.key,{limit:6});
 for(let i=0;i<4;i++){const a=await decision.reserve(f.model);assert(a);await a.finish();}
 assert.equal(await decision.reserve(f.model),null);
 const planning=await plan.reserve(f.model);assert(planning);await planning.finish();assert.equal(await plan.reserve(f.model),null);
 const composition=await final.reserve(f.model);assert(composition);await composition.finish();assert.equal(await final.reserve(f.model),null);
 for(const reservedSlots of [-1,6,0.5,NaN])assert.throws(()=>createDurableTurnBudget(pool,owner,f.key,{limit:6,reservedSlots}),{message:'TURN_BUDGET_INVALID'});
});
test('simultaneous workers reserve at most four and same configuration once while in flight',async()=>{
 const f=await fixture();const same=await Promise.all(Array.from({length:6},()=>f.incoming().reserve(f.model)));assert.equal(same.filter(Boolean).length,1);
 const rest=await Promise.all(Array.from({length:8},(_,i)=>f.ai().reserve({...f.model,modelRevision:i+2})));assert.equal(rest.filter(Boolean).length,3);
});
test('crashed reservation remains charged after owner lease changes',async()=>{
 const f=await fixture();assert(await f.ai().reserve(f.model));const next=randomUUID();await pool.query('update private.ai_jobs set lease_token=$2 where id=$1',[f.job,next]);
 const retried=createDurableTurnBudget(pool,{kind:'AI',id:f.job,leaseToken:next},f.key);assert.equal(await retried.reserve(f.model),null);
 await assert.rejects(f.ai().reserve({...f.model,modelRevision:2}),{message:'TURN_OWNER_STALE'});
});
test('foreign or altered message cannot consume another source budget',async()=>{
 const f=await fixture();await pool.query("update public.messages set content='changed' where id=$1",[f.message]);
 await assert.rejects(f.ai().reserve(f.model),{message:'TURN_SOURCE_MISMATCH'});
 assert.equal(Number((await pool.query('select count(*) n from private.ai_turn_attempts where inbox_id=$1',[f.inbox])).rows[0].n),0);
});
test('expired lease and HUMAN takeover forbid inference reservation',async()=>{
 const f=await fixture();await pool.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[f.inbox]);await assert.rejects(f.incoming().reserve(f.model),{message:'TURN_OWNER_STALE'});
 await pool.query("update public.conversations set mode='HUMAN' where id=$1",[f.conversation]);await assert.rejects(f.ai().reserve(f.model),{message:'TURN_OWNER_STALE'});
});
test('lease expiring while waiting for the turn lock forbids reservation',async()=>{
 const f=await fixture(),blocker=await pool.connect();
 let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('select pg_advisory_lock(hashtextextended($1,0))',[`ai-turn:${f.inbox}`]);
  await pool.query("update private.webhook_inbox set lease_until=clock_timestamp()+interval '300 milliseconds' where id=$1",[f.inbox]);
  pending=assert.rejects(f.incoming().reserve(f.model),{message:'TURN_OWNER_STALE'});
  // Wait until the real transaction is blocked, rather than guessing its start time.
  let blocked=false;
  for(let n=0;n<50;n++){
   blocked=Boolean((await pool.query("select exists(select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) waiting")).rows[0].waiting);
   if(blocked)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(blocked,'reservation must reach the held source lock');
  await new Promise(resolve=>setTimeout(resolve,350));
  await blocker.query('select pg_advisory_unlock(hashtextextended($1,0))',[`ai-turn:${f.inbox}`]);
  await pending;
  assert.equal(Number((await pool.query('select count(*) n from private.ai_turn_attempts where inbox_id=$1',[f.inbox])).rows[0].n),0);
 }finally{
  await blocker.query('select pg_advisory_unlock_all()');blocker.release();
  await pending?.catch(()=>undefined);
 }
});
test('real LINE message with a missing source cannot reset to a job budget',async()=>{
 const f=await fixture();await pool.query('update public.messages set source_event_id=null where id=$1',[f.message]);
 await assert.rejects(f.ai().reserve(f.model),{message:'TURN_SOURCE_MISMATCH'});
});
test('legacy synthetic jobs without LINE source remain independently bounded',async()=>{
 const f=await fixture();await pool.query('update public.messages set source_event_id=null,line_message_id=null where id=$1',[f.message]);
 for(let revision=1;revision<=4;revision++){const attempt=await f.ai().reserve({...f.model,modelRevision:revision});assert(attempt);await attempt.finish();}
 assert.equal(await f.ai().reserve({...f.model,modelRevision:5}),null);
});
test('foreign inbox identity cannot be substituted as the shared budget source',async()=>{
 const a=await fixture(),b=await fixture();
 await pool.query('update public.messages set source_event_id=null where id=$1',[b.message]);
 await pool.query('update public.messages set source_event_id=$2 where id=$1',[a.message,b.inbox]);
 await assert.rejects(a.ai().reserve(a.model),{message:'TURN_SOURCE_MISMATCH'});
});
test('terminal outcomes are write-once and different messages are isolated',async()=>{
 const a=await fixture(),b=await fixture(),attempt=await a.ai().reserve(a.model);assert(attempt);await attempt.finish('INVALID_OUTPUT');await attempt.finish();
 assert.equal(await a.ai().reserve(a.model),null);assert(await b.ai().reserve(a.model));
});
test('attempt table has RLS and no browser grants or raw conversation columns',async()=>{
 const row=(await pool.query("select relrowsecurity,has_table_privilege('anon','private.ai_turn_attempts','SELECT,INSERT,UPDATE,DELETE') a,has_table_privilege('authenticated','private.ai_turn_attempts','SELECT,INSERT,UPDATE,DELETE') b from pg_class where oid='private.ai_turn_attempts'::regclass")).rows[0];assert(row.relrowsecurity&&!row.a&&!row.b);
 const columns=(await pool.query("select column_name from information_schema.columns where table_schema='private' and table_name='ai_turn_attempts'")).rows.map(r=>r.column_name);for(const forbidden of ['content','api_key','reply_token','user_id'])assert(!columns.includes(forbidden));
});
