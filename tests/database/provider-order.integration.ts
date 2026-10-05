import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createProvider,createModel,listProviders} from '../../lib/ai/provider-admin';
import {reorderProviders,reorderModels} from '../../lib/ai/provider-order';

test('full-scope provider/model reorder is atomic, revision guarded, role scoped and purpose isolated',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:6});
 const actor=randomUUID(),forbidden=randomUUID(),options={pool,key:randomBytes(32).toString('base64')};const ids:string[]=[];
 try{
  assert.equal(Number((await pool.query('select count(*) from private.ai_providers')).rows[0].count),0,'dedicated local registry must be empty for a full-scope fixture');
  await pool.query('insert into auth.users(id) values($1),($2)',[actor,forbidden]);
  await pool.query("insert into public.staff_profiles(id,display_name,role,active) values($1,'Order fixture','SUPER_ADMIN',true),($2,'Inactive fixture','SUPER_ADMIN',false)",[actor,forbidden]);
  for(let index=0;index<3;index++)ids.push((await createProvider(actor,{name:`Order ${randomUUID()}`,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',apiKey:'fixture-key',enabled:index!==1,priority:10+index},options)).id);
  const before=await listProviders(actor,options),order=before.map(value=>({id:value.id,revision:value.revision})).reverse();
  const privateBefore=(await pool.query('select id,api_key_encrypted,enabled,cost_mode from private.ai_providers order by id')).rows;
  await assert.rejects(reorderProviders(forbidden,{order},options),{message:'FORBIDDEN'});
  await assert.rejects(reorderProviders(actor,{order:order.slice(1)},options),{message:'CONFLICT'});
  await assert.rejects(reorderProviders(actor,{order:[order[0],order[0],order[1]]},options),{message:'INVALID_REQUEST'});
  await reorderProviders(actor,{order},options);
  assert.deepEqual((await listProviders(actor,options)).map(value=>value.id),order.map(value=>value.id));
  assert.deepEqual((await pool.query('select id,api_key_encrypted,enabled,cost_mode from private.ai_providers order by id')).rows,privateBefore);
  await assert.rejects(reorderProviders(actor,{order},options),{message:'CONFLICT'});

  const raced=(await listProviders(actor,options)).map(value=>({id:value.id,revision:value.revision}));
  const outcomes=await Promise.allSettled([reorderProviders(actor,{order:raced.slice().reverse()},options),reorderProviders(actor,{order:raced},options)]);
  assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal(outcomes.filter(value=>value.status==='rejected').length,1);
  const rejected=outcomes.find(value=>value.status==='rejected');assert(rejected?.status==='rejected');assert.equal(rejected.reason.message,'CONFLICT');

  for(const [modelId,purpose,embeddingDimensions] of [['fixture/one','GENERATION',null],['fixture/two','GENERATION',null],['fixture/vector','EMBEDDING',3]] as const)
   await createModel(actor,ids[0],{modelId,displayName:modelId,purpose,embeddingDimensions,supportsTools:false,supportsJson:purpose==='GENERATION',supportsVision:false,enabled:true,priority:10,timeoutMs:1000,inputPricePerMillion:null,outputPricePerMillion:null},options);
  const group=(await listProviders(actor,options)).find(value=>value.id===ids[0])!;
  const gen=group.models.filter(value=>value.purpose==='GENERATION'),embedding=group.models.find(value=>value.purpose==='EMBEDDING')!;
  const payload={purpose:'GENERATION',providerRevision:group.revision,order:gen.map(value=>({id:value.id,revision:value.revision})).reverse()};
  await assert.rejects(reorderModels(actor,ids[0],{...payload,order:[payload.order[0],{id:embedding.id,revision:embedding.revision}]},options),{message:'CONFLICT'});
  await reorderModels(actor,ids[0],payload,options);
  const after=(await listProviders(actor,options)).find(value=>value.id===ids[0])!;
  assert.deepEqual(after.models.filter(value=>value.purpose==='GENERATION').map(value=>value.id),payload.order.map(value=>value.id));
  assert.deepEqual(after.models.find(value=>value.id===embedding.id),embedding,'other purpose remains unchanged');
  await assert.rejects(reorderModels(actor,ids[0],payload,options),{message:'CONFLICT'});
 }finally{
  if(ids.length){await pool.query('delete from private.ai_models where provider_id=any($1::uuid[])',[ids]);await pool.query('delete from private.ai_providers where id=any($1::uuid[])',[ids]);}
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,forbidden]]);
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,forbidden]]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,forbidden]]);await pool.end();
 }
});
