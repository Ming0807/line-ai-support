import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,updateProvider,createModel,listProviders} from '../../lib/ai/provider-admin';
import {createAIStore} from '../../lib/ai/store';
import {generate} from '../../lib/ai/gateway';
import {embed} from '../../lib/ai/embedding-gateway';
import {z} from 'zod';
import {testProviderModel} from '../../lib/ai/provider-probe-admin';
const base='https://api.provider-support.com/v1';
const config={name:'Compatible fixture',adapter:'COMPATIBLE',baseUrl:base,apiKey:'canary-compatible-key',enabled:true,priority:1};

async function fixture(work:(pool:Pool,actor:string,staff:string,key:string,providers:string[])=>Promise<void>){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5,application_name:`compatible-${randomUUID()}`});
 const actor=randomUUID(),staff=randomUUID(),key=randomBytes(32).toString('base64'),providers:string[]=[];
 try{
  assert.equal(Number((await pool.query('select count(*) from private.ai_providers')).rows[0].count),0,'DEDICATED_REGISTRY_REQUIRED');
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,$3,true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role,'Compatible fixture']);
  }
  await work(pool,actor,staff,key,providers);
 }finally{
  for(const id of providers)for(const table of ['ai_model_observations','ai_provider_operations','ai_errors','ai_usage_logs','ai_models','ai_providers'])
   await pool.query(`delete from private.${table} where ${table==='ai_providers'?'id':'provider_id'}=$1`,[id]);
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();
 }
}

test('compatible save authorizes before DNS, commits before resolution, preserves keys and blocks unknown free inference',()=>fixture(async(pool,actor,staff,key,ids)=>{
 let dnsCalls=0;
 const options={pool,key,resolveCompatibleAddresses:async(host:string)=>{
  dnsCalls++;assert.equal(host,'api.provider-support.com');
  const inTxn=await pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[pool.options.application_name]);
  assert.equal(inTxn.rows[0].n,0,'DNS_OUTSIDE_SQL');return [{address:'1.1.1.1',family:4 as const}];
 }};
 await assert.rejects(createProvider(staff,config,options),{code:'FORBIDDEN'});await assert.rejects(createProvider(randomUUID(),config,options),{code:'FORBIDDEN'});assert.equal(dnsCalls,0);
 const created=await createProvider(actor,{...config,baseUrl:'https://API.Provider-Support.com.:443/v1/'},options);ids.push(created.id);assert.equal(dnsCalls,1);
 let snapshot=(await listProviders(actor,options))[0];assert.equal(snapshot.baseUrl,base);assert.equal(snapshot.costMode,'FREE_ONLY');assert(!JSON.stringify(snapshot).includes(config.apiKey));
 const generation={modelId:'fixture/model',displayName:'Generation',purpose:'GENERATION',embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,
  enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0};
 await createModel(actor,created.id,generation,options);await createModel(actor,created.id,{...generation,modelId:'fixture/embedding',purpose:'EMBEDDING',embeddingDimensions:2,supportsJson:false},options);
 const store=createAIStore(pool);let inferred=0;
 await assert.rejects(generate({taskType:'ANSWER',messages:[{role:'user',content:'fixture'}],responseName:'fixture',responseSchema:z.object({ok:z.boolean()}).strict()},
  {store,key:'invalid-key',adapters:{COMPATIBLE:{generate:async()=>{inferred++;throw new Error('UNEXPECTED_INFERENCE');},healthCheck:async()=> 'HEALTHY'}}}),{code:'PROVIDER_UNAVAILABLE'});
 await assert.rejects(embed({requestType:'EMBEDDING_QUERY',input:['fixture']},{store,key:'invalid-key',adapters:{COMPATIBLE:{embed:async()=>{inferred++;throw new Error('UNEXPECTED_INFERENCE');}}}}),{code:'PROVIDER_UNAVAILABLE'});
 assert.equal(inferred,0);assert.equal(dnsCalls,1,'NO_INFERENCE_DNS');
 snapshot=(await listProviders(actor,options))[0];const previous=(await pool.query('select api_key_encrypted,network_revision from private.ai_providers where id=$1',[created.id])).rows[0];
 await assert.rejects(updateProvider(actor,created.id,{...config,baseUrl:'https://other.provider-support.com/v1',apiKey:null,revision:snapshot.revision},options),{code:'INVALID_REQUEST'});
 assert.equal(dnsCalls,1,'NO_DNS_WITHOUT_REQUIRED_REPLACEMENT');
 await updateProvider(actor,created.id,{...config,apiKey:null,revision:snapshot.revision,costMode:'ALLOW_PAID'},options);
 const current=(await pool.query('select api_key_encrypted,network_revision from private.ai_providers where id=$1',[created.id])).rows[0];assert.deepEqual(current,previous);
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='AI_PROVIDER_COST_MODE_CHANGED'",[actor])).rows[0].n,1);
 assert.equal((await listProviders(actor,options))[0].costMode,'ALLOW_PAID');
}));

test('compatible selected tests persist PRICE_UNKNOWN without network and endpoint changes retire old identity',()=>fixture(async(pool,actor,_staff,key,ids)=>{
 const options={pool,key,resolveCompatibleAddresses:async()=>[{address:'1.1.1.1',family:4 as const}]};
 const created=await createProvider(actor,config,options);ids.push(created.id);
 const model=await createModel(actor,created.id,{modelId:'fixture/model',displayName:'Fixture',purpose:'GENERATION',embeddingDimensions:null,
  supportsTools:false,supportsJson:true,supportsVision:false,enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0},options);
 let requests=0;
 const blocked=await testProviderModel(actor,created.id,model.id,{providerRevision:1,modelRevision:0,action:'GENERATION_TEST'},
  {pool,key:'invalid-key',compatibleTransport:{request:async()=>{requests++;throw new Error('UNEXPECTED_NETWORK');}}});
 assert.equal(blocked.observation.errorCode,'PRICE_UNKNOWN');assert.equal(blocked.observation.httpStatus,null);assert.equal(requests,0);
 assert.equal((await pool.query('select count(*)::int n from private.ai_usage_logs where provider_id=$1',[created.id])).rows[0].n,0);
 await pool.query(`update private.ai_models set api_format='CHAT',pricing_checked_at=clock_timestamp(),pricing_provider_revision=1,pricing_model_revision=0,
  cooldown_until=clock_timestamp()+interval '5 minutes',
  cooldown_observed_at=clock_timestamp(),cooldown_provider_network_revision=0,cooldown_model_network_revision=0 where id=$1`,[model.id]);
 assert((await listProviders(actor,options))[0].models[0].cooldownUntil);
 await updateProvider(actor,created.id,{...config,baseUrl:'https://other.provider-support.com/second/v1',apiKey:'replacement-fixture-key',revision:1},options);
 const saved=(await listProviders(actor,options))[0];assert.equal(saved.models[0].cooldownUntil,null);
 const row=(await pool.query('select p.network_revision,m.api_format from private.ai_providers p join private.ai_models m on m.provider_id=p.id where p.id=$1',[created.id])).rows[0];
 assert.equal(row.network_revision,1);assert.equal(row.api_format,null);
 assert.equal((await pool.query('select count(*)::int n from private.ai_model_observations where model_id=$1',[model.id])).rows[0].n,1,'OBSERVATION_HISTORY_RETAINED');
}));

test('database compatible endpoint constraint remains closed to unsafe syntax and official host changes',()=>fixture(async(pool,actor,_staff,key,ids)=>{
 const options={pool,key,resolveCompatibleAddresses:async()=>[{address:'1.1.1.1',family:4 as const}]};
 const created=await createProvider(actor,config,options);ids.push(created.id);
 for(const url of ['http://api.provider-support.com/v1','https://127.0.0.1/v1','https://api.local/v1','https://example.com/v1',
  'https://sub.example.org/v1','https://provider.alt/v1','https://api.provider-support.com/v1?key=x','https://user@api.provider-support.com/v1',
  'https://api.provider-support.com/../v1','https://api.provider-support.com/v1/chat/completions',
  'https://api.provider-support.com/v1/Models','https://api.provider-support.com/v1/EMBEDDINGS','https://api.provider-support.com/v1/Chat/Completions']){
  await assert.rejects(pool.query('update private.ai_providers set base_url=$2 where id=$1',[created.id,url]),{code:'23514'});
 }
 await assert.rejects(pool.query("update private.ai_providers set adapter='OPENAI' where id=$1",[created.id]),{code:'23514'});
 assert.equal((await listProviders(actor,options))[0].baseUrl,base);
}));

test('compatible save reauthorizes after DNS and leaves no row or audit when the actor is deactivated',()=>fixture(async(pool,actor,_staff,key,ids)=>{
 const options={pool,key,resolveCompatibleAddresses:async()=>{await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);return [{address:'1.1.1.1',family:4 as const}];}};
 await assert.rejects(createProvider(actor,config,options),{code:'FORBIDDEN'});assert.equal(ids.length,0);
 assert.equal((await pool.query('select count(*)::int n from private.ai_providers')).rows[0].n,0);assert.equal((await pool.query('select count(*)::int n from private.activities where actor_id=$1',[actor])).rows[0].n,0);
}));

test('compatible DNS validation fences concurrent edits and rejects unsafe answer mixtures without effects',()=>fixture(async(pool,actor,_staff,key,ids)=>{
 const resolveCompatibleAddresses=async()=>[{address:'1.1.1.1',family:4 as const}];const options={pool,key,resolveCompatibleAddresses};
 const created=await createProvider(actor,config,options);ids.push(created.id);
 let entered:()=>void=()=>{},release:()=>void=()=>{};const ready=new Promise<void>(res=>{entered=res;}),wait=new Promise<void>(res=>{release=res;});
 const pending=updateProvider(actor,created.id,{...config,apiKey:null,revision:0,name:'Stale edit'},
  {...options,resolveCompatibleAddresses:async()=>{entered();await wait;return resolveCompatibleAddresses();}});
 const assertion=assert.rejects(pending,{code:'CONFLICT'});await ready;
 try{await updateProvider(actor,created.id,{...config,apiKey:null,revision:0,name:'Winning edit'},options);}finally{release();}await assertion;
 assert.equal((await listProviders(actor,options))[0].name,'Winning edit');
 assert.equal((await pool.query("select count(*)::int n from private.activities where actor_id=$1 and action='AI_PROVIDER_UPDATED'",[actor])).rows[0].n,1);
 await assert.rejects(createProvider(actor,config,{...options,resolveCompatibleAddresses:async()=>[{address:'1.1.1.1',family:4 as const},{address:'10.0.0.1',family:4 as const}]}),{code:'ENDPOINT_UNAVAILABLE'});
 assert.equal((await pool.query('select count(*)::int n from private.ai_providers')).rows[0].n,1);
}));
