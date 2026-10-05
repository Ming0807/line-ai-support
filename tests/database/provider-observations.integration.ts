import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders,updateProvider} from '../../lib/ai/provider-admin';
import {testProviderModel} from '../../lib/ai/provider-probe-admin';
import {refreshProviderQuota} from '../../lib/ai/provider-quota-admin';
import {createAIStore} from '../../lib/ai/store';
import {AIProviderError} from '../../lib/ai/types';

test('per-model probes and quotas are authorized, selected-only, outside SQL, leased and revision guarded',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5});
 const actor=randomUUID(),nonadmin=randomUUID(),key=randomBytes(32).toString('base64');let providerId='';
 const config={name:`Observation ${randomUUID()}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',apiKey:'fixture-key',enabled:true,priority:1};
 try{
  for(const id of [actor,nonadmin])await pool.query('insert into auth.users(id) values($1)',[id]);
  await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Probe fixture','SUPER_ADMIN',true)",[actor]);
  assert.equal((await pool.query("insert into public.staff_profiles(id,display_name,role,active,department_id) select $1,'Denied fixture','STAFF',true,id from public.departments limit 1",[nonadmin])).rowCount,1);
  providerId=(await createProvider(actor,config,{pool,key})).id;
  const model=await createModel(actor,providerId,{modelId:'fixture/free',displayName:'Fixture',supportsJson:true,supportsTools:false,supportsVision:false,
   enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0},{pool,key});
  const snapshot=(await listProviders(actor,{pool})).find(value=>value.id===providerId)!;
  const revisions={providerRevision:snapshot.revision,modelRevision:model.revision};
  let calls=0,pricingCalls=0;
  const priceReader=async()=>{pricingCalls++;return {status:'FREE' as const,inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT' as const};};
  const adapter={generate:async()=>{
   calls++;assert.equal(Number((await pool.query("select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].count),0);
   return {output:{ok:true},toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200};
  },healthCheck:async()=> 'HEALTHY' as const};
  const options={pool,key,priceReader,generationAdapters:{OPENROUTER:adapter},embeddingAdapters:{}};
  await assert.rejects(testProviderModel(nonadmin,providerId,model.id,{...revisions,action:'GENERATION_TEST'},options),{message:'FORBIDDEN'});
  assert.equal(calls,0);assert.equal(pricingCalls,0);
  const result=await testProviderModel(actor,providerId,model.id,{...revisions,action:'GENERATION_TEST'},options);
  assert.equal(result.observation.result,'SUCCESS');assert.equal(result.observation.httpStatus,200);assert.equal(calls,1);
  assert.equal(Number((await pool.query('select count(*) from private.ai_usage_logs where provider_id=$1',[providerId])).rows[0].count),0);
  const dto=(await listProviders(actor,{pool})).find(value=>value.id===providerId)!;
  assert.equal(dto.models[0].latestObservation?.httpStatus,200);
  assert.equal(JSON.stringify(dto).includes('fixture-key'),false);
  await assert.rejects(testProviderModel(actor,providerId,model.id,{...revisions,action:'GENERATION_TEST'},options),{message:'CONFLICT'});
  assert.equal(calls,1);
  const quota=await refreshProviderQuota(actor,providerId,{providerRevision:snapshot.revision},{pool,key,quotaReader:async()=>{
   assert.equal(Number((await pool.query("select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].count),0);
   return {supported:true,httpStatus:200,errorCode:null,observedAt:new Date().toISOString(),counters:[{scope:'ACCOUNT',unit:'REQUESTS',window:'DAY',source:'OPENROUTER_KEY',limit:50,remaining:4,resetAt:null,retryAfterSeconds:null,observedAt:new Date().toISOString(),currency:null}]};
  }});
  assert.equal(quota.quota.counters[0].scope,'ACCOUNT');
  assert.equal((await listProviders(actor,{pool})).find(value=>value.id===providerId)?.quota?.httpStatus,200);
  // Let only this fixture's operation slot become eligible again; no wall-clock wait.
  await pool.query("update private.ai_provider_operations set last_started_at=clock_timestamp()-interval '6 seconds',expires_at=clock_timestamp()-interval '1 second' where provider_id=$1",[providerId]);
  let resolveProbe:()=>void=()=>{};const held=new Promise<void>(resolve=>{resolveProbe=resolve;});
  let entered:()=>void=()=>{};const boundary=new Promise<void>(resolve=>{entered=resolve;});
  const racingAdapter={...adapter,generate:async()=>{entered();await held;return {output:{ok:true},toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200};}};
  const pending=testProviderModel(actor,providerId,model.id,{...revisions,action:'GENERATION_TEST'},{...options,generationAdapters:{OPENROUTER:racingAdapter}});
  await boundary;
  await assert.rejects(testProviderModel(actor,providerId,model.id,{...revisions,action:'GENERATION_TEST'},options),{message:'CONFLICT'});
  await updateProvider(actor,providerId,{...config,apiKey:null,revision:snapshot.revision,costMode:'ALLOW_PAID'},{pool,key});
  resolveProbe();await assert.rejects(pending,{message:'CONFLICT'});
  const after=(await listProviders(actor,{pool})).find(value=>value.id===providerId)!;
  assert.equal(after.models[0].latestObservation,null);assert.equal(after.quota,null);
  const store=createAIStore(pool);
  await store.recordAttempt({providerId,modelId:model.id,providerRevision:after.revision,modelRevision:model.revision,
   requestType:'ANSWER',latencyMs:7,inputTokens:1,outputTokens:1,estimatedCost:0,status:'SUCCESS',fallbackUsed:false,health:'HEALTHY',httpStatus:200});
  assert.equal((await listProviders(actor,{pool})).find(value=>value.id===providerId)?.models[0].latestObservation?.action,'RUNTIME');
  const currentRevisions={providerRevision:after.revision,modelRevision:model.revision};
  const eligible=async()=>{await pool.query("update private.ai_provider_operations set last_started_at=clock_timestamp()-interval '6 seconds',expires_at=clock_timestamp()-interval '1 second' where provider_id=$1",[providerId]);};
  await eligible();
  const blocked=await testProviderModel(actor,providerId,model.id,{...currentRevisions,action:'GENERATION_TEST'},{...options,
   priceReader:async()=>({status:'PAID',inputPricePerMillion:1,outputPricePerMillion:1,checkedAt:new Date().toISOString(),apiFormat:'CHAT'})});
  assert.equal(blocked.observation.result,'BLOCKED');assert.equal(blocked.observation.errorCode,'PAID_BLOCKED');assert.equal(blocked.observation.httpStatus,null);assert.equal(calls,1);
  for(const [code,httpStatus] of [['RATE_LIMITED',429],['TIMEOUT',undefined],['INVALID_OUTPUT',200]] as const){
   await eligible();
   const failed=await testProviderModel(actor,providerId,model.id,{...currentRevisions,action:'GENERATION_TEST'},{...options,
    generationAdapters:{OPENROUTER:{...adapter,generate:async()=>{throw new AIProviderError(code,httpStatus);}},UNUSED:{...adapter,generate:async()=>{throw new Error('must never fallback');}}}});
   assert.equal(failed.observation.errorCode,code);assert.equal(failed.observation.httpStatus,httpStatus??null);assert.equal(failed.observation.result,'ERROR');
  }
  assert.equal(Number((await pool.query('select count(*) from private.ai_usage_logs where provider_id=$1',[providerId])).rows[0].count),1);
  await assert.rejects(testProviderModel(actor,providerId,model.id,{...currentRevisions,action:'EMBEDDING_TEST'},options),{message:'INVALID_REQUEST'});
  await eligible();await pool.query('update private.ai_providers set manual_window_count=10,manual_window_started_at=clock_timestamp() where id=$1',[providerId]);
  await assert.rejects(testProviderModel(actor,providerId,model.id,{...currentRevisions,action:'GENERATION_TEST'},options),{message:'CONFLICT'});
  await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);
  await assert.rejects(listProviders(actor,{pool}),{message:'FORBIDDEN'});
  await pool.query('update public.staff_profiles set active=true where id=$1',[actor]);
  await eligible();await pool.query('update private.ai_providers set manual_window_count=0 where id=$1',[providerId]);
  const cancel=new AbortController();
  const cancelledQuota=await refreshProviderQuota(actor,providerId,{providerRevision:after.revision},{pool,key,quotaReader:async()=>{
   cancel.abort();return new Promise<never>(()=>{});
  }},cancel.signal);
  assert.equal(cancelledQuota.quota.errorCode,'CANCELLED');assert.equal(cancelledQuota.quota.httpStatus,null);
  assert.equal((await listProviders(actor,{pool})).find(value=>value.id===providerId)?.quota?.errorCode,'CANCELLED');
  await eligible();const cancelBody=new AbortController();
  const cancelledAfterHttp=await refreshProviderQuota(actor,providerId,{providerRevision:after.revision},{pool,key,fetchImpl:async()=>{
   setTimeout(()=>cancelBody.abort(),5);
   return new Response(new ReadableStream({start(){},cancel(){}}),{status:200});
  }},cancelBody.signal);
  assert.equal(cancelledAfterHttp.quota.errorCode,'CANCELLED');assert.equal(cancelledAfterHttp.quota.httpStatus,200,'QUOTA_ABORT_MUST_RETAIN_RECEIVED_HTTP');
  await pool.query("update private.ai_models set purpose='EMBEDDING',embedding_dimensions=2,supports_json=false,supports_tools=false,revision=revision+1 where id=$1",[model.id]);
  await store.recordAttempt({providerId,modelId:model.id,providerRevision:after.revision,modelRevision:model.revision,purpose:'GENERATION',
   requestType:'ANSWER',latencyMs:1,inputTokens:1,outputTokens:1,estimatedCost:0,status:'SUCCESS',fallbackUsed:false,health:'HEALTHY',httpStatus:200});
  assert.equal((await pool.query('select purpose from private.ai_model_observations where model_id=$1 order by observed_at desc limit 1',[model.id])).rows[0].purpose,'GENERATION','IN_FLIGHT_PURPOSE_MUST_USE_SNAPSHOT');
  for(const table of ['ai_model_observations','ai_provider_quota_observations','ai_provider_operations']){
   const security=(await pool.query("select relrowsecurity,has_table_privilege('authenticated',oid,'SELECT') as exposed from pg_class where oid=$1::regclass",[`private.${table}`])).rows[0];
   assert.equal(security.relrowsecurity,true);assert.equal(security.exposed,false);
  }
 }finally{
  if(providerId){
   for(const table of ['ai_model_observations','ai_provider_quota_observations','ai_provider_operations','ai_usage_logs','ai_errors','ai_models'])await pool.query(`delete from private.${table} where provider_id=$1`,[providerId]).catch(()=>undefined);
   await pool.query('delete from private.ai_providers where id=$1',[providerId]);
  }
  for(const id of [actor,nonadmin]){
   await pool.query('delete from private.activities where actor_id=$1',[id]);await pool.query('delete from public.staff_profiles where id=$1',[id]);await pool.query('delete from auth.users where id=$1',[id]);
  }
  await pool.end();
 }
});
