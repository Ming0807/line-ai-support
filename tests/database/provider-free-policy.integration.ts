import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders,updateProvider,checkProviderHealth} from '../../lib/ai/provider-admin';

test('provider policy defaults FREE_ONLY and allows official free providers with explicit embedding dimensions',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:3});
 const actor=randomUUID(),key=randomBytes(32).toString('base64'),options={pool,key};const created:string[]=[];
 try{
  await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Policy fixture','SUPER_ADMIN',true)",[actor]);
  for(const [adapter,baseUrl] of [['OPENAI','https://api.openai.com/v1'],['ZEN','https://opencode.ai/zen/v1'],['OPENROUTER','https://openrouter.ai/api/v1']]){
   const result=await createProvider(actor,{name:`Policy ${randomUUID()}`,adapter,baseUrl,apiKey:'fixture-key-never-log',enabled:true,priority:1},options);
   created.push(result.id);
   const row=(await pool.query('select cost_mode from private.ai_providers where id=$1',[result.id])).rows[0];
   assert.equal(row.cost_mode,'FREE_ONLY');
   const runtime=(await listProviders(actor,options)).find(value=>value.id===result.id);
   assert(runtime);assert.equal(runtime.costMode,'FREE_ONLY');
   if(adapter==='OPENROUTER'){
    await createModel(actor,result.id,{modelId:'fixture/embedding-free',displayName:'Explicit vectors',purpose:'EMBEDDING',embeddingDimensions:3,
     supportsJson:false,supportsTools:false,supportsVision:false,enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0},options);
    const model=(await listProviders(actor,options)).find(value=>value.id===result.id)?.models[0];
    assert(model);assert.equal(model.embeddingDimensions,3);assert.equal(model.pricingStatus,'UNKNOWN');
   }
  }
  const original=(await listProviders(actor,options)).find(value=>value.adapter==='OPENROUTER'&&created.includes(value.id))!;
  await assert.rejects(updateProvider(actor,original.id,{name:original.name,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',
   apiKey:null,enabled:original.enabled,priority:original.priority,revision:original.revision},options),{message:'INVALID_REQUEST'});
  const unchanged=(await listProviders(actor,options)).find(value=>value.id===original.id)!;
  assert.equal(unchanged.adapter,'OPENROUTER');assert.equal(unchanged.revision,original.revision);
  let calls=0;
  await checkProviderHealth(actor,original.id,original.models[0].id,{...options,adapters:{OPENROUTER:{generate:async()=>{throw new Error('NO_INFERENCE');},
   healthCheck:async value=>{calls++;assert.equal(value.baseUrl,'https://openrouter.ai/api/v1');return 'HEALTHY';}}}});
  assert.equal(calls,1,'the original credential remains confined to its original provider');
  const replaced=await updateProvider(actor,original.id,{name:original.name,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',
   apiKey:'fixture-new-platform-key',enabled:true,priority:original.priority,revision:original.revision},options);
  const newPlatform=(await listProviders(actor,options)).find(value=>value.id===original.id)!;
  assert.equal(newPlatform.revision,replaced.revision);assert.equal(newPlatform.healthStatus,'UNKNOWN');assert.equal(newPlatform.lastHealthCheck,null);
  const paid=await createProvider(actor,{name:`Explicit ${randomUUID()}`,adapter:'OPENAI',baseUrl:'https://api.openai.com/v1',apiKey:'fixture-key',enabled:false,priority:3,costMode:'ALLOW_PAID'},options);
  created.push(paid.id);
  const audit=(await pool.query("select metadata from private.activities where actor_id=$1 and action='AI_PROVIDER_CREATED' and metadata->>'providerId'=$2",[actor,paid.id])).rows[0];
  assert.equal(audit.metadata.costMode,'ALLOW_PAID');
 }finally{
  if(created.length){await pool.query('delete from private.ai_models where provider_id=any($1::uuid[])',[created]);
   await pool.query('delete from private.ai_providers where id=any($1::uuid[])',[created]);}
  await pool.query('delete from private.activities where actor_id=$1',[actor]);
  await pool.query('delete from public.staff_profiles where id=$1',[actor]);
  await pool.query('delete from auth.users where id=$1',[actor]);await pool.end();
 }
});
