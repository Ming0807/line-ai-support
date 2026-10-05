import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {encryptValue} from '../../lib/security/identity';
import {createAIStore} from '../../lib/ai/store';

test('an in-flight generation preserves usage but cannot overwrite health after a configuration change',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2});
 const key=randomBytes(32).toString('base64');let providerId='';
 try{
  providerId=(await pool.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted)
   values($1,'OPENAI','https://api.openai.com/v1',$2) returning id`,[randomUUID(),encryptValue('fixture-old-key',key)])).rows[0].id;
  const modelId=(await pool.query(`insert into private.ai_models(provider_id,model_id,display_name)
   values($1,'fixture-in-flight','Fixture in flight') returning id`,[providerId])).rows[0].id;
  const store=createAIStore(pool);
  const snapshot=(await store.loadModels()).find(model=>model.id===modelId);
  assert(snapshot&&snapshot.providerRevision===0&&snapshot.modelRevision===0);
  await pool.query(`update private.ai_providers set api_key_encrypted=$2,revision=revision+1,health_status='UNKNOWN' where id=$1`,
   [providerId,encryptValue('fixture-new-key',key)]);
  await store.recordAttempt({providerId,modelId,providerRevision:0,modelRevision:0,requestType:'ANSWER',latencyMs:20,inputTokens:10,outputTokens:5,estimatedCost:null,
   status:'SUCCESS',fallbackUsed:false,health:'HEALTHY'});
  assert.equal((await pool.query('select health_status from private.ai_providers where id=$1',[providerId])).rows[0].health_status,'UNKNOWN');
  assert.equal((await pool.query('select count(*)::int as count from private.ai_usage_logs where provider_id=$1',[providerId])).rows[0].count,1);
  await pool.query('update private.ai_models set revision=revision+1 where id=$1',[modelId]);
  await store.recordAttempt({providerId,modelId,providerRevision:1,modelRevision:0,requestType:'ANSWER',latencyMs:20,inputTokens:null,outputTokens:null,estimatedCost:null,
   status:'ERROR',fallbackUsed:false,errorCode:'AUTH_ERROR',httpStatus:401,health:'OFFLINE'});
  assert.equal((await pool.query('select health_status from private.ai_providers where id=$1',[providerId])).rows[0].health_status,'UNKNOWN');
  assert.deepEqual((await pool.query('select provider_revision,model_revision,status from private.ai_usage_logs where provider_id=$1 order by created_at',[providerId])).rows,
   [{provider_revision:0,model_revision:0,status:'SUCCESS'},{provider_revision:1,model_revision:0,status:'ERROR'}]);
  assert.deepEqual((await pool.query('select provider_revision,model_revision,error_type from private.ai_errors where provider_id=$1',[providerId])).rows,
   [{provider_revision:1,model_revision:0,error_type:'AUTH_ERROR'}]);
 }finally{
  if(providerId){await pool.query('delete from private.ai_model_observations where provider_id=$1',[providerId]);await pool.query('delete from private.ai_errors where provider_id=$1',[providerId]);await pool.query('delete from private.ai_usage_logs where provider_id=$1',[providerId]);
   await pool.query('delete from private.ai_models where provider_id=$1',[providerId]);await pool.query('delete from private.ai_providers where id=$1',[providerId]);}
  await pool.end();
 }
});

test('AI registry is private to browser roles and explicitly usable by service_role',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
 try{
  const result=await pool.query(`select c.relname,c.relrowsecurity,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as browser_read,
   has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_read,
   (select bool_and(has_table_privilege('service_role',c.oid,privilege)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege) as server_access
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='private' and c.relname=any($1::text[])`,[['ai_providers','ai_models','ai_usage_logs','ai_errors']]);
  assert.equal(result.rowCount,4,'all AI registry/log tables exist');
  assert(result.rows.every(row=>row.relrowsecurity&&!row.browser_read&&!row.anon_read&&row.server_access));
 }finally{await pool.end();}
});

test('real AI store records usage, fixed errors and provider health without exposing keys or payloads',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2});
 const key=randomBytes(32).toString('base64'),secret='fixture-api-'+randomUUID();let providerId='';
 try{
  providerId=(await pool.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted)
   values($1,'OPENAI','https://api.openai.com/v1',$2) returning id`,[randomUUID(),encryptValue(secret,key)])).rows[0].id;
  const modelId=(await pool.query(`insert into private.ai_models(provider_id,model_id,display_name)
   values($1,'fixture-store','Fixture store') returning id`,[providerId])).rows[0].id;
  const store=createAIStore(pool);
  const model=(await store.loadModels()).find(item=>item.id===modelId);
  assert(model&&model.providerId===providerId&&model.apiKeyEncrypted!==secret);
  await store.recordAttempt({providerId,modelId,providerRevision:0,modelRevision:0,requestType:'ANSWER',latencyMs:10,inputTokens:null,outputTokens:null,estimatedCost:null,
   status:'ERROR',fallbackUsed:false,errorCode:'RATE_LIMITED',httpStatus:429,health:'RATE_LIMITED'});
  assert.equal((await pool.query('select health_status from private.ai_providers where id=$1',[providerId])).rows[0].health_status,'RATE_LIMITED');
  await store.recordAttempt({providerId,modelId,providerRevision:0,modelRevision:0,requestType:'ANSWER',latencyMs:20,inputTokens:20,outputTokens:10,estimatedCost:null,
   status:'SUCCESS',fallbackUsed:true,health:'HEALTHY'});
  const usage=await pool.query('select status,fallback_used,input_tokens,output_tokens from private.ai_usage_logs where provider_id=$1 order by created_at',[providerId]);
  assert.deepEqual(usage.rows,[{status:'ERROR',fallback_used:false,input_tokens:null,output_tokens:null},{status:'SUCCESS',fallback_used:true,input_tokens:20,output_tokens:10}]);
  const errors=await pool.query('select error_type,message,http_status,metadata from private.ai_errors where provider_id=$1',[providerId]);
  assert.deepEqual(errors.rows,[{error_type:'RATE_LIMITED',message:'RATE_LIMITED',http_status:429,metadata:{}}]);
  assert(!JSON.stringify([...usage.rows,...errors.rows]).includes(secret));
  assert.equal((await pool.query('select health_status from private.ai_providers where id=$1',[providerId])).rows[0].health_status,'HEALTHY');
 }finally{
  if(providerId){await pool.query('delete from private.ai_model_observations where provider_id=$1',[providerId]);await pool.query('delete from private.ai_errors where provider_id=$1',[providerId]);await pool.query('delete from private.ai_usage_logs where provider_id=$1',[providerId]);
   await pool.query('delete from private.ai_models where provider_id=$1',[providerId]);await pool.query('delete from private.ai_providers where id=$1',[providerId]);}
  await pool.end();
 }
});

test('AI registry rejects unsafe base URLs and preserves encrypted keys with deterministic model priority',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'}),client=await pool.connect();
 const key=randomBytes(32).toString('base64'),secret='fixture-api-'+randomUUID();
 try{
  await client.query('begin');
  await client.query('savepoint unsafe_provider');
  await assert.rejects(client.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted)
   values($1,'OPENAI','https://untrusted.example/v1',$2)`,[randomUUID(),encryptValue(secret,key)]),
   (error:unknown)=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='23514');
  await client.query('rollback to savepoint unsafe_provider');
  const provider=(await client.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted,priority)
   values($1,'OPENAI','https://api.openai.com/v1',$2,1) returning id`,[randomUUID(),encryptValue(secret,key)])).rows[0].id;
  await client.query(`insert into private.ai_models(provider_id,model_id,display_name,priority,timeout_ms)
   values($1,'fixture-secondary','Fixture secondary',2,2000),($1,'fixture-primary','Fixture primary',1,2000)`,[provider]);
  const models=await client.query(`select m.model_id,p.api_key_encrypted from private.ai_models m
   join private.ai_providers p on p.id=m.provider_id where p.id=$1 and p.enabled and m.enabled
   order by p.priority,m.priority,m.id`,[provider]);
  assert.deepEqual(models.rows.map(row=>row.model_id),['fixture-primary','fixture-secondary']);
  assert(models.rows.every(row=>typeof row.api_key_encrypted==='string'&&!row.api_key_encrypted.includes(secret)));
 }finally{await client.query('rollback');client.release();await pool.end();}
});
