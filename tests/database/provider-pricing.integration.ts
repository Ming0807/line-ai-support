import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders,updateProvider} from '../../lib/ai/provider-admin';
import {refreshModelPricing} from '../../lib/ai/provider-pricing';
import {createAIStore} from '../../lib/ai/store';

test('pricing refresh is outside SQL, persists only matching revisions and cannot grant manual free eligibility',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4});
 const actor=randomUUID(),options={pool,key:randomBytes(32).toString('base64')};let providerId='';
 const config={name:`Price ${randomUUID()}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',apiKey:'fixture-key',enabled:true,priority:1};
 try{
  await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Price fixture','SUPER_ADMIN',true)",[actor]);
  providerId=(await createProvider(actor,config,options)).id;
  const model=await createModel(actor,providerId,{modelId:'fixture/free',displayName:'Fixture',supportsJson:true,supportsTools:true,supportsVision:false,
   enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0},options);
  const snapshot=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  const revisions={providerRevision:snapshot.revision,modelRevision:model.revision};
  assert.equal(snapshot.models[0].pricingStatus,'UNKNOWN');
  const read=async()=>{
   assert.equal(Number((await pool.query("select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].count),0);
   return {status:'FREE' as const,inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT' as const};
  };
  assert.equal((await refreshModelPricing(actor,providerId,model.id,revisions,{pool,priceReader:read})).pricing.status,'FREE');
  assert.equal((await listProviders(actor,options)).find(value=>value.id===providerId)?.models[0].pricingStatus,'FREE');
  assert.equal((await createAIStore(pool).loadModels()).find(value=>value.id===model.id)?.costMode,'FREE_ONLY');
  const raced=async()=>{
   await updateProvider(actor,providerId,{...config,apiKey:null,revision:snapshot.revision,costMode:'ALLOW_PAID'},options);
   return read();
  };
  await assert.rejects(refreshModelPricing(actor,providerId,model.id,revisions,{pool,priceReader:raced}),{message:'CONFLICT'});
  const after=(await listProviders(actor,options)).find(value=>value.id===providerId)!;
  assert.equal(after.costMode,'ALLOW_PAID');assert.equal(after.models[0].pricingStatus,'UNKNOWN');
  assert.equal((await createAIStore(pool).loadModels()).find(value=>value.id===model.id)?.costMode,'ALLOW_PAID');
 }finally{
  if(providerId){await pool.query('delete from private.ai_models where provider_id=$1',[providerId]);await pool.query('delete from private.ai_providers where id=$1',[providerId]);}
  await pool.query('delete from private.activities where actor_id=$1',[actor]);await pool.query('delete from public.staff_profiles where id=$1',[actor]);
  await pool.query('delete from auth.users where id=$1',[actor]);await pool.end();
 }
});
