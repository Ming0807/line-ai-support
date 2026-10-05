import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {z} from 'zod';
import {createProvider,createModel,listProviders,updateProvider,updateModel} from '../../lib/ai/provider-admin';
import {reorderProviders,reorderModels} from '../../lib/ai/provider-order';
import {createAIStore} from '../../lib/ai/store';
import {generate} from '../../lib/ai/gateway';
import {testProviderModel} from '../../lib/ai/provider-probe-admin';

test('durable cooldown survives order/display edits, obeys network identity and blocks only matching inference',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5});
 const actor=randomUUID(),key=randomBytes(32).toString('base64'),options={pool,key};let providerId:string|undefined;
 try{
  assert.equal(Number((await pool.query('select count(*) from private.ai_providers')).rows[0].count),0,'DEDICATED_REGISTRY_REQUIRED');
  await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Cooldown fixture','SUPER_ADMIN',true)",[actor]);
  const config={name:`Cooldown ${randomUUID()}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',apiKey:'fixture-key',enabled:true,priority:1,costMode:'FREE_ONLY'};
  providerId=(await createProvider(actor,config,options)).id;
  const modelConfig={modelId:'fixture/generation',displayName:'generation',purpose:'GENERATION',embeddingDimensions:null,
   supportsJson:true,supportsTools:false,supportsVision:false,enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0};
  const created=await createModel(actor,providerId,modelConfig,options);
  await createModel(actor,providerId,{...modelConfig,modelId:'fixture/embedding',purpose:'EMBEDDING',embeddingDimensions:2,supportsJson:false},options);
  const store=createAIStore(pool),model=(await store.loadModels())[0];
  assert.equal(model.providerNetworkRevision,0);assert.equal(model.modelNetworkRevision,0);
  const observedAt=new Date().toISOString(),retryAt=new Date(Date.now()+120_000).toISOString();
  const failure={providerId,modelId:created.id,providerRevision:model.providerRevision,modelRevision:model.modelRevision,
   providerNetworkRevision:0,modelNetworkRevision:0,purpose:'GENERATION' as const,requestType:'ANSWER',latencyMs:1,inputTokens:null,outputTokens:null,
   estimatedCost:null,status:'ERROR' as const,errorCode:'RATE_LIMITED' as const,httpStatus:429,fallbackUsed:false,health:'RATE_LIMITED' as const,
   retryEvidence:{source:'RETRY_AFTER' as const,observedAt,retryAt}};
  await store.recordAttempt(failure);
  let group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  assert.equal(group.models.find(value=>value.id===created.id)?.cooldownUntil,retryAt);
  assert.equal((await store.loadEmbeddingModels())[0].cooldownUntil,null,'PURPOSE_ISOLATION');
  await reorderProviders(actor,{order:[{id:providerId,revision:group.revision}]},options);
  group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await reorderModels(actor,providerId,{providerRevision:group.revision,purpose:'GENERATION',order:[{id:created.id,revision:group.models.find(value=>value.id===created.id)!.revision}]},options);
  group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await updateProvider(actor,providerId,{...config,name:'renamed',revision:group.revision,apiKey:null},options);
  group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await updateModel(actor,providerId,created.id,{...modelConfig,displayName:'renamed model',supportsTools:true,revision:group.models.find(value=>value.id===created.id)!.revision},options);
  group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  assert.equal(group.models.find(value=>value.id===created.id)?.cooldownUntil,retryAt,'ORDER_AND_DISPLAY_MUST_NOT_CLEAR_WAIT');
  const longerAt=new Date(Date.now()+180_000).toISOString(),shorterAt=new Date(Date.now()+60_000).toISOString();
  await Promise.all([store.recordAttempt({...failure,retryEvidence:{...failure.retryEvidence,retryAt:longerAt}}),
   store.recordAttempt({...failure,retryEvidence:{...failure.retryEvidence,retryAt:shorterAt}})]);
  assert.equal((await store.loadModels())[0].cooldownUntil,longerAt,'CONCURRENT_SHORTER_HINT_MUST_NOT_SHORTEN_WAIT');
  let catalogCalls=0,inferenceCalls=0;
  const priceReader=async()=>{catalogCalls++;return {status:'FREE' as const,inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT' as const};};
  const adapter={healthCheck:async()=> 'HEALTHY' as const,generate:async()=>{inferenceCalls++;return {output:{answer:'ok'},toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200};}};
  await assert.rejects(generate({taskType:'ANSWER',messages:[{role:'user',content:'fixture'}],responseName:'answer',responseSchema:z.object({answer:z.string()}).strict()},
   {store,key,priceReader,adapters:{OPENROUTER:adapter}}),{code:'PROVIDER_UNAVAILABLE'});
  assert.equal(catalogCalls,0);assert.equal(inferenceCalls,0);
  const blocked=await testProviderModel(actor,providerId,created.id,{providerRevision:group.revision,modelRevision:group.models.find(value=>value.id===created.id)!.revision,action:'GENERATION_TEST'},
   {...options,priceReader,generationAdapters:{OPENROUTER:adapter},embeddingAdapters:{}});
  assert.equal(blocked.observation.errorCode,'COOLDOWN');assert.equal(blocked.observation.httpStatus,null);assert.equal(catalogCalls,0);
  await updateProvider(actor,providerId,{...config,apiKey:'rotated-fixture-key',revision:group.revision},options);
  assert.equal((await store.loadModels())[0].providerNetworkRevision,1);
  assert.equal((await store.loadModels())[0].cooldownUntil,null,'KEY_ROTATION_INVALIDATES_OLD_IDENTITY');
  await store.recordAttempt({...failure,retryEvidence:{...failure.retryEvidence,retryAt:new Date(Date.now()+180_000).toISOString()}});
  assert.equal((await store.loadModels())[0].cooldownUntil,null,'STALE_IN_FLIGHT_KEY_HINT_MUST_NOT_APPLY');
  const rotated=(await store.loadModels())[0];
  await store.recordAttempt({...failure,providerRevision:rotated.providerRevision,modelRevision:rotated.modelRevision,providerNetworkRevision:1});
  assert.equal((await store.loadModels())[0].cooldownUntil,retryAt);
  group=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await updateModel(actor,providerId,created.id,{...modelConfig,modelId:'fixture/replacement',revision:group.models.find(value=>value.id===created.id)!.revision},options);
  assert.equal((await store.loadModels())[0].modelNetworkRevision,1);assert.equal((await store.loadModels())[0].cooldownUntil,null);
  await store.recordAttempt({...failure,providerRevision:rotated.providerRevision,modelRevision:rotated.modelRevision,providerNetworkRevision:1});
  assert.equal((await store.loadModels())[0].cooldownUntil,null,'STALE_MODEL_ID_HINT_MUST_NOT_APPLY');
  const history=(await pool.query('select retry_at,retry_observed_at from private.ai_model_observations where model_id=$1 and retry_at is not null',[created.id])).rows;
  assert.equal(history.length,6);assert.equal(history[0].retry_observed_at.toISOString(),observedAt,'PERSISTENCE_MUST_NOT_RESTART_WAIT');
  await assert.rejects(store.recordAttempt({...failure,httpStatus:200}),{message:'AI_OBSERVATION_INVALID'});
  await assert.rejects(pool.query(`insert into private.ai_model_observations(provider_id,model_id,provider_revision,model_revision,purpose,action,result,error_code,http_status,latency_ms,observed_at,retry_at,retry_observed_at)
   values($1,$2,0,0,'GENERATION','RUNTIME','ERROR','RATE_LIMITED',null,1,$3,$4,$3)`,[providerId,created.id,observedAt,retryAt]),{code:'23514'},'NULL_HTTP_CANNOT_PROVE_RETRY_HINT');
  assert.equal((await pool.query("select relrowsecurity from pg_class where oid='private.ai_model_observations'::regclass")).rows[0].relrowsecurity,true);
  assert.equal((await pool.query("select has_table_privilege('authenticated','private.ai_model_observations','select') as allowed")).rows[0].allowed,false);
 }finally{
  if(providerId){for(const table of ['ai_model_observations','ai_provider_operations','ai_errors','ai_usage_logs','ai_models','ai_providers'])await pool.query(`delete from private.${table} where ${table==='ai_providers'?'id':'provider_id'}=$1`,[providerId]);}
  await pool.query('delete from private.activities where actor_id=$1',[actor]);await pool.query('delete from public.staff_profiles where id=$1',[actor]);await pool.query('delete from auth.users where id=$1',[actor]);await pool.end();
 }
});
