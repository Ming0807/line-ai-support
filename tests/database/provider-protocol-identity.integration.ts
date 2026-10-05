import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders,updateModel,updateProvider} from '../../lib/ai/provider-admin';
import {refreshModelPricing} from '../../lib/ai/provider-pricing';
import {reorderModels} from '../../lib/ai/provider-order';
import {createAIStore} from '../../lib/ai/store';
import {buildFallbackPreview} from '../../lib/ai/provider-preview';

test('Zen protocol changes are network identity changes; order retains the pinned protocol and old hints are fenced',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'}),actor=randomUUID();
 const options={pool,key:randomBytes(32).toString('base64')};let providerId:string|undefined;
 try{
  await pool.query('insert into auth.users(id) values($1)',[actor]);await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Protocol fixture','SUPER_ADMIN',true)",[actor]);
  providerId=(await createProvider(actor,{name:`Protocol ${randomUUID()}`,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',apiKey:'fixture-key',enabled:true,priority:1},options)).id;
  const config={modelId:'fixture-chat',displayName:'fixture',purpose:'GENERATION',embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,
   enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0};
  const model=await createModel(actor,providerId,config,options),store=createAIStore(pool);
  async function refresh(apiFormat:'CHAT'|'RESPONSES'){
   const snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
   return refreshModelPricing(actor,providerId!,model.id,{providerRevision:snapshot.revision,modelRevision:snapshot.models[0].revision},
    {pool,priceReader:async()=>({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat})});
  }
  await refresh('CHAT');let loaded=(await store.loadModels()).find(value=>value.id===model.id)!;
  assert.equal(loaded.apiFormat,'CHAT');assert.equal(loaded.modelNetworkRevision,1);
  let snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await reorderModels(actor,providerId,{providerRevision:snapshot.revision,purpose:'GENERATION',order:[{id:model.id,revision:snapshot.models[0].revision}]},options);
  loaded=(await store.loadModels()).find(value=>value.id===model.id)!;assert.equal(loaded.apiFormat,'CHAT','ORDER_MUST_NOT_UNPIN_TRANSPORT');
  snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  assert.equal(snapshot.models[0].apiFormat,'CHAT','DTO_MUST_RETAIN_PIN_AFTER_ORDER');
  assert.equal(buildFallbackPreview([{...snapshot,costMode:'ALLOW_PAID'}],{purpose:'GENERATION',requiresJson:true,requiresTools:false}).rows[0].position,1,'PREVIEW_PROTOCOL_MUST_MATCH_RUNTIME');
  const original=loaded;
  await refresh('RESPONSES');loaded=(await store.loadModels()).find(value=>value.id===model.id)!;
  assert.equal(loaded.apiFormat,'RESPONSES');assert.equal(loaded.modelNetworkRevision,2);assert.equal(loaded.modelRevision,original.modelRevision+1);
  snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;assert.equal(snapshot.models[0].pricingStatus,'FREE','PROOF_MUST_MATCH_NEW_REVISION');
  const observedAt=new Date().toISOString(),retryAt=new Date(Date.now()+60_000).toISOString();
  await store.recordAttempt({providerId,modelId:model.id,providerRevision:original.providerRevision,modelRevision:original.modelRevision,
   providerNetworkRevision:original.providerNetworkRevision,modelNetworkRevision:original.modelNetworkRevision,purpose:'GENERATION',requestType:'ANSWER',latencyMs:1,
   inputTokens:null,outputTokens:null,estimatedCost:null,status:'ERROR',errorCode:'RATE_LIMITED',httpStatus:429,fallbackUsed:false,health:'RATE_LIMITED',
   retryEvidence:{source:'RETRY_AFTER',observedAt,retryAt}});
  assert.equal((await store.loadModels()).find(value=>value.id===model.id)!.cooldownUntil,null,'OLD_PROTOCOL_HINT_MUST_NOT_APPLY');
  assert.equal((await listProviders(actor,options)).find(value=>value.id===providerId)!.models[0].latestObservation,null,'OLD_PROTOCOL_OBSERVATION_NOT_LATEST');
  await refresh('RESPONSES');assert.equal((await store.loadModels()).find(value=>value.id===model.id)!.modelNetworkRevision,2,'SAME_PROTOCOL_RECHECK_IS_NOT_ROTATION');
  snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await updateProvider(actor,providerId,{name:snapshot.name,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',apiKey:'platform-fixture-key',
   enabled:true,priority:1,costMode:'ALLOW_PAID',revision:snapshot.revision},options);
  assert.equal((await store.loadModels()).find(value=>value.id===model.id)!.apiFormat,undefined,'PROVIDER_PLATFORM_SWITCH_MUST_CLEAR_PROTOCOL');
  await refresh('CHAT');snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  await updateProvider(actor,providerId,{name:snapshot.name,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',apiKey:'another-platform-fixture-key',
   enabled:true,priority:1,costMode:'ALLOW_PAID',revision:snapshot.revision},options);
  assert.equal((await store.loadModels()).find(value=>value.id===model.id)!.apiFormat,undefined,'ZEN_SWITCH_REQUIRES_ITS_OWN_PROTOCOL_PROOF');
  await updateModel(actor,providerId,model.id,{...config,modelId:'replacement-chat',revision:loaded.modelRevision},options);
  assert.equal((await store.loadModels()).find(value=>value.id===model.id)!.apiFormat,undefined,'NEW_MODEL_REQUIRES_NEW_PROTOCOL_PROOF');
 }finally{
  if(providerId){for(const table of ['ai_model_observations','ai_provider_operations','ai_errors','ai_usage_logs','ai_models','ai_providers'])await pool.query(`delete from private.${table} where ${table==='ai_providers'?'id':'provider_id'}=$1`,[providerId]);}
  await pool.query('delete from private.activities where actor_id=$1',[actor]);await pool.query('delete from public.staff_profiles where id=$1',[actor]);await pool.query('delete from auth.users where id=$1',[actor]);await pool.end();
 }
});
