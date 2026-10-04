import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {createProvider,updateProvider,createModel,updateModel,listProviders,checkProviderHealth} from '../../lib/ai/provider-admin';
import {decryptValue} from '../../lib/security/identity';

test('only active database Super Admin can manage provider/model config; reads never return encrypted or plain keys',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:3}),key=randomBytes(32).toString('base64');
 const admin=randomUUID(),staff=randomUUID(),inactive=randomUUID(),ids=[admin,staff,inactive];let providerId='';
 const secret='fixture-first-'+randomUUID(),replacement='fixture-second-'+randomUUID();
 const settings={name:'Provider fixture '+randomUUID(),adapter:'OPENAI',baseUrl:'https://api.openai.com/v1',priority:1,enabled:true,apiKey:secret};
 const options={pool,key};
 try{
  await pool.query('insert into auth.users(id) select unnest($1::uuid[])',[ids]);
  const department=(await pool.query("select id from public.departments where code='IT' and active")).rows[0].id;
  await pool.query(`insert into public.staff_profiles(id,display_name,role,active,department_id)
   values($1,'Admin fixture','SUPER_ADMIN',true,null),($2,'Staff fixture','STAFF',true,$4),($3,'Inactive fixture','SUPER_ADMIN',false,null)`,[...ids,department]);
  for(const forbidden of [staff,inactive,randomUUID()]){
   await assert.rejects(createProvider(forbidden,settings,options),(error:unknown)=>error instanceof Error&&error.message==='FORBIDDEN');
   await assert.rejects(listProviders(forbidden,options),(error:unknown)=>error instanceof Error&&error.message==='FORBIDDEN');
  }
  const created=await createProvider(admin,settings,options);providerId=created.id;assert.equal(created.revision,0);
  const before=(await listProviders(admin,options)).find(provider=>provider.id===providerId);assert(before&&before.keyConfigured);
  assert(!JSON.stringify(before).includes(secret));assert(!('api_key_encrypted'in before));assert(!('apiKeyEncrypted'in before));
  const model=await createModel(admin,providerId,{modelId:'fixture-model',displayName:'Fixture model',supportsTools:true,supportsJson:true,
   supportsVision:false,enabled:true,priority:1,timeoutMs:20000,inputPricePerMillion:null,outputPricePerMillion:null},options);
  const afterModel=(await listProviders(admin,options)).find(provider=>provider.id===providerId)!;
  const changed=await updateProvider(admin,providerId,{...settings,apiKey:null,priority:2,revision:afterModel.revision},options);assert.equal(changed.revision,afterModel.revision+1);
  let encrypted=(await pool.query('select api_key_encrypted from private.ai_providers where id=$1',[providerId])).rows[0].api_key_encrypted;
  assert.equal(decryptValue(encrypted,key)===secret,true,'empty replacement preserves the old private key');
  await assert.rejects(updateProvider(admin,providerId,{...settings,apiKey:replacement,revision:0},options),
   (error:unknown)=>error instanceof Error&&error.message==='CONFLICT');
  await updateProvider(admin,providerId,{...settings,apiKey:replacement,revision:changed.revision},options);
  encrypted=(await pool.query('select api_key_encrypted from private.ai_providers where id=$1',[providerId])).rows[0].api_key_encrypted;
  assert.equal(decryptValue(encrypted,key)===replacement,true);
  const configured=(await listProviders(admin,options)).find(provider=>provider.id===providerId)!;
  await assert.rejects(updateModel(admin,providerId,model.id,{...configured.models[0],id:undefined,revision:0,enabled:false},options),
   (error:unknown)=>error instanceof Error&&error.message==='INVALID_REQUEST');
  await updateModel(admin,providerId,model.id,{modelId:'fixture-model',displayName:'Fixture model',supportsTools:true,supportsJson:true,
   supportsVision:false,enabled:false,priority:3,timeoutMs:5000,inputPricePerMillion:1,outputPricePerMillion:2,revision:0},options);
  const final=(await listProviders(admin,options)).find(provider=>provider.id===providerId)!;
  assert.equal(final.models[0].enabled,false);assert.equal(final.models[0].timeoutMs,5000);assert.equal(final.models[0].revision,1);
  const healthOptions={...options,adapters:{OPENAI:{generate:async()=>{throw new Error('NO_GENERATION_ALLOWED');},healthCheck:async(config:{apiKey:string})=>{
   assert.equal(config.apiKey===replacement,true);
   const idle=await pool.query("select count(*)::int as count from pg_stat_activity where datname=current_database() and state='idle in transaction'");
   assert.equal(idle.rows[0].count,0,'health HTTP runs outside the config transaction');return 'HEALTHY' as const;
  }}}};
  assert.deepEqual(await checkProviderHealth(admin,providerId,model.id,healthOptions),{healthStatus:'HEALTHY'});
  await updateModel(admin,providerId,model.id,{modelId:'fixture-replacement-model',displayName:'Fixture replacement',supportsTools:true,supportsJson:true,
   supportsVision:false,enabled:true,priority:1,timeoutMs:5000,inputPricePerMillion:null,outputPricePerMillion:null,revision:1},options);
  assert.equal((await listProviders(admin,options)).find(provider=>provider.id===providerId)?.healthStatus,'UNKNOWN',
   'changing the tested model invalidates the previous health result');
  healthOptions.adapters.OPENAI.healthCheck=async()=>{
   const current=(await listProviders(admin,options)).find(provider=>provider.id===providerId)!;
   await updateProvider(admin,providerId,{...settings,apiKey:null,revision:current.revision},options);return 'HEALTHY' as const;
  };
  await assert.rejects(checkProviderHealth(admin,providerId,model.id,healthOptions),
   (error:unknown)=>error instanceof Error&&error.message==='CONFLICT');
  const blocking=await pool.connect();let probe:Promise<unknown>|undefined;
  try{
   healthOptions.adapters.OPENAI.healthCheck=async()=>{
    await blocking.query('begin');
    await blocking.query('select id from private.ai_providers where id=$1 for update',[providerId]);
    await blocking.query('update private.ai_models set revision=revision+1 where id=$1',[model.id]);
    return 'HEALTHY' as const;
   };
   probe=checkProviderHealth(admin,providerId,model.id,healthOptions);
   // Observe a real lock wait, rather than assuming an arbitrary delay proves the race.
   let waiting=false;
   for(let attempt=0;attempt<80&&!waiting;attempt++){
    waiting=(await pool.query(`select exists(select 1 from pg_stat_activity where datname=current_database()
     and wait_event_type='Lock' and query like '%private.ai_providers%' and pid<>pg_backend_pid()) as waiting`)).rows[0].waiting;
    if(!waiting)await delay(25);
   }
   assert(waiting,'the health write waits behind the model configuration writer');
   await blocking.query('commit');
   await assert.rejects(probe,(error:unknown)=>error instanceof Error&&error.message==='CONFLICT');
  }finally{
   await blocking.query('rollback').catch(()=>undefined);blocking.release();
   await probe?.catch(()=>undefined);
  }
  healthOptions.adapters.OPENAI.healthCheck=async()=>{
   await createModel(admin,providerId,{modelId:'fixture-new-primary',displayName:'Fixture primary',supportsTools:true,supportsJson:true,
    supportsVision:false,enabled:true,priority:0,timeoutMs:5000,inputPricePerMillion:null,outputPricePerMillion:null},options);
   return 'HEALTHY' as const;
  };
  await assert.rejects(checkProviderHealth(admin,providerId,model.id,healthOptions),
   (error:unknown)=>error instanceof Error&&error.message==='CONFLICT');
  const audit=await pool.query('select metadata from private.activities where actor_id=$1',[admin]);
  assert((audit.rowCount??0)>=4);assert(!JSON.stringify(audit.rows).includes(secret)&&!JSON.stringify(audit.rows).includes(replacement));
 }finally{
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[ids]);
  if(providerId){await pool.query('delete from private.ai_models where provider_id=$1',[providerId]);await pool.query('delete from private.ai_providers where id=$1',[providerId]);}
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[ids]);await pool.query('delete from auth.users where id=any($1::uuid[])',[ids]);await pool.end();
 }
});
