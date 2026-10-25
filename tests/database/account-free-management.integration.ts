import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders,updateProvider,updateModel} from '../../lib/ai/provider-admin';
import {createAIStore} from '../../lib/ai/store';
import {generate} from '../../lib/ai/gateway';
import {z} from 'zod';
import {saveFreeAccountGrant,revokeFreeAccountGrant,readAccountFreeUntil} from '../../lib/ai/account-free-admin';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,user:'postgres',password:'postgres',database,max:4});after(()=>pool.end());
test('managed account grants require active Super Admin, exact configured models and CAS; revocation shadows legacy grants',async()=>{
 const admin=randomUUID(),staff=randomUUID(),inactive=randomUUID(),options={pool,key:Buffer.alloc(32,37).toString('base64'),
  resolveCompatibleAddresses:async()=>[{address:'142.250.190.10',family:4 as const}]};
 await pool.query('insert into auth.users(id) select unnest($1::uuid[])',[[admin,staff,inactive]]);
 await pool.query("insert into public.staff_profiles(id,display_name,role,active,department_id) values($1,'Owned grant admin','SUPER_ADMIN',true,null),($2,'Owned grant staff','STAFF',true,(select id from public.departments where code='IT')),($3,'Owned inactive admin','SUPER_ADMIN',false,null)",[admin,staff,inactive]);
 const provider=await createProvider(admin,{name:'Owned free account',adapter:'COMPATIBLE',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',enabled:true,priority:0,apiKey:'synthetic-only'},options);
 await createModel(admin,provider.id,{modelId:'gemini-3.5-flash-lite',displayName:'Owned Lite',purpose:'GENERATION',embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,enabled:false,priority:0,timeoutMs:1000,inputPricePerMillion:null,outputPricePerMillion:null},options);
 const view=async()=>(await listProviders(admin,options)).find(row=>row.id===provider.id)!;
 const initial=await view(),input={providerRevision:initial.revision,grantRevision:null,models:['gemini-3.5-flash-lite'],validForDays:7,confirmFreeTier:true,billingDisabled:true};
 for(const actor of [staff,inactive,randomUUID()])await assert.rejects(saveFreeAccountGrant(actor,provider.id,input,options),/FORBIDDEN/);
 for(const invalid of [{...input,models:['unknown-paid']},{...input,validForDays:31},{...input,billingDisabled:false},{...input,models:['gemini-3.8-flash']},{...input,models:[...input.models,...input.models]}])
  await assert.rejects(saveFreeAccountGrant(admin,provider.id,invalid,options),/INVALID_REQUEST/);
 const saved=await saveFreeAccountGrant(admin,provider.id,input,options),active=await view();
 assert.equal(active.freeAccount?.status,'ACTIVE');assert.equal(active.freeAccount?.revision,0);
 assert.equal(active.models[0].enabled,false,'ATTESTATION_MUST_NOT_ENABLE_A_MODEL');assert.equal(active.costMode,'FREE_ONLY');
 assert(active.models[0].accountFreeUntil);assert.equal(saved.revision,active.revision);
 await assert.rejects(saveFreeAccountGrant(admin,provider.id,input,options),/CONFLICT/);
 const model={providerId:provider.id,providerNetworkRevision:0,adapter:'COMPATIBLE',baseUrl:active.baseUrl,modelId:'gemini-3.5-flash-lite'};
 assert.equal(await readAccountFreeUntil(pool,model),null,'DISABLED_MODEL_MUST_NOT_GAIN_RUNTIME_ADMISSION_FROM_ATTESTATION');
 await pool.query('update private.ai_models set enabled=true where provider_id=$1',[provider.id]);
 assert(await readAccountFreeUntil(pool,model));
 await pool.query('update private.ai_providers set enabled=false where id=$1',[provider.id]);
 assert.equal(await readAccountFreeUntil(pool,model),null,'DISABLED_PROVIDER_MUST_REJECT_A_PREVIOUSLY_LOADED_MODEL');
 await pool.query('update private.ai_providers set enabled=true where id=$1',[provider.id]);
 for(const disabled of ['provider','model'] as const){
  const current=await view(),m=current.models[0],persisted=createAIStore(pool);
  const loaded=(await persisted.loadModels()).find(candidate=>candidate.providerId===provider.id);assert(loaded);
  const providerInput={name:current.name,adapter:current.adapter,baseUrl:current.baseUrl,enabled:false,priority:current.priority,revision:current.revision,apiKey:null};
  const modelInput={modelId:m.modelId,displayName:m.displayName,purpose:m.purpose,embeddingDimensions:m.embeddingDimensions,supportsTools:m.supportsTools,
   supportsJson:m.supportsJson,supportsVision:m.supportsVision,enabled:false,priority:m.priority,timeoutMs:m.timeoutMs,inputPricePerMillion:m.inputPricePerMillion,
   outputPricePerMillion:m.outputPricePerMillion,revision:m.revision};
  let inference=0,finished:string|undefined;
  await assert.rejects(generate({taskType:'ANSWER',messages:[{role:'user',content:'Owned reservation race'}],responseName:'answer',responseSchema:z.strictObject({answer:z.string()})},
   {key:options.key,store:{...persisted,loadModels:async()=>[loaded]},priceReader:async()=>({status:'UNKNOWN',inputPricePerMillion:null,outputPricePerMillion:null,checkedAt:new Date().toISOString(),apiFormat:null}),
    turnBudget:{used:0,canAttempt:()=>true,reserve:async()=>{
     if(disabled==='provider')await updateProvider(admin,provider.id,providerInput,options);else await updateModel(admin,provider.id,m.id,modelInput,options);
     return {finish:error=>{finished=error;}};
    }},adapters:{COMPATIBLE:{healthCheck:async()=> 'HEALTHY',generate:async()=>{inference++;return {output:{answer:'Must not send'},toolCalls:[],inputTokens:1,outputTokens:1};}}}}),/PROVIDER_UNAVAILABLE/);
  assert.equal(inference,0,'CONFIG_DISABLED_DURING_RESERVATION_MUST_NOT_REACH_HTTP');assert.equal(finished,'PROVIDER_UNAVAILABLE');
  const updated=await view();
  if(disabled==='provider')await updateProvider(admin,provider.id,{...providerInput,revision:updated.revision,enabled:true},options);
  else await updateModel(admin,provider.id,m.id,{...modelInput,revision:updated.models[0].revision,enabled:true},options);
 }
 assert.equal(await readAccountFreeUntil(pool,{...model,providerNetworkRevision:1}),null,'NETWORK_CHANGED_GRANT_MUST_FAIL_CLOSED');
 const legacy=process.env.YRU_FREE_ACCOUNT_GRANTS;
 try{
  process.env.YRU_FREE_ACCOUNT_GRANTS=JSON.stringify([{providerId:provider.id,networkRevision:0,baseUrl:active.baseUrl,models:input.models,confirmedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}]);
  await revokeFreeAccountGrant(admin,provider.id,{providerRevision:(await view()).revision,grantRevision:0},options);
  assert.equal(await readAccountFreeUntil(pool,model),null,'REVOKED_MANAGED_ROW_MUST_SHADOW_VALID_ENV_GRANT');
  const revoked=await view();assert.equal(revoked.freeAccount?.status,'REVOKED');assert.equal(revoked.models[0].accountFreeUntil,null);
  const renewed=await saveFreeAccountGrant(admin,provider.id,{...input,providerRevision:revoked.revision,grantRevision:1},options);
  assert.equal(renewed.grantRevision,2);assert(await readAccountFreeUntil(pool,model));
  await pool.query("update private.ai_free_account_grants set confirmed_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where provider_id=$1",[provider.id]);
  assert.equal(await readAccountFreeUntil(pool,model),null,'EXPIRED_MANAGED_ROW_MUST_SHADOW_ENV_GRANT');
  await pool.query("update private.ai_free_account_grants set confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '1 day' where provider_id=$1",[provider.id]);
  await pool.query('update private.ai_providers set network_revision=network_revision+1 where id=$1',[provider.id]);
  assert.equal(await readAccountFreeUntil(pool,model),null,'LOADED_OLD_IDENTITY_MUST_NOT_ADMIT_AFTER_PARENT_NETWORK_CHANGE');
  assert.equal(await readAccountFreeUntil(pool,{...model,providerNetworkRevision:1}),null,'OLD_GRANT_MUST_NOT_AUTHORIZE_NEW_NETWORK_REVISION');
 }finally{if(legacy===undefined)delete process.env.YRU_FREE_ACCOUNT_GRANTS;else process.env.YRU_FREE_ACCOUNT_GRANTS=legacy;}
 const audit=(await pool.query("select action,metadata from private.activities where actor_id=$1 and action like 'AI_FREE_ACCOUNT_%' order by created_at,id",[admin])).rows;
 assert.equal(audit.length,3);assert.deepEqual(new Set(audit.map(row=>row.action)),new Set(['AI_FREE_ACCOUNT_CONFIRMED','AI_FREE_ACCOUNT_REVOKED']));
 assert(!JSON.stringify(audit).includes('synthetic-only'));
 const security=(await pool.query(`select c.relrowsecurity rls,has_table_privilege('anon',c.oid,'select') anon_read,
  has_table_privilege('authenticated',c.oid,'update') browser_write,has_table_privilege('service_role',c.oid,'delete') service_delete
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='ai_free_account_grants'`)).rows[0];
 assert.deepEqual(security,{rls:true,anon_read:false,browser_write:false,service_delete:false});
});
