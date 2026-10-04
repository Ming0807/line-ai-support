import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createAIStore} from '../../lib/ai/store';
import {encryptValue} from '../../lib/security/identity';

test('real registry separates generation and embedding models without returning disabled configuration',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
 let provider='';
 try{
  provider=(await pool.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted)
   values($1,'OPENAI','https://api.openai.com/v1',$2) returning id`,[randomUUID(),encryptValue('fixture-embedding-key',randomBytes(32).toString('base64'))])).rows[0].id;
  const generation=(await pool.query(`insert into private.ai_models(provider_id,model_id,display_name)
   values($1,'fixture-generation-purpose','Generation') returning id`,[provider])).rows[0].id;
  const embedding=(await pool.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,supports_json)
   values($1,'fixture-embedding-purpose','Embedding','EMBEDDING',2,false) returning id`,[provider])).rows[0].id;
  await pool.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,supports_json,enabled)
   values($1,'fixture-disabled-embedding','Disabled','EMBEDDING',2,false,false)`,[provider]);
  const store=createAIStore(pool);
  assert.deepEqual((await store.loadModels()).filter(m=>m.providerId===provider).map(m=>m.id),[generation]);
  const vectors=(await store.loadEmbeddingModels()).filter(m=>m.providerId===provider);
  assert.equal(vectors.length,1);assert.equal(vectors[0].id,embedding);assert.equal(vectors[0].dimensions,2);
  assert.equal(vectors[0].providerRevision,0);assert.equal(vectors[0].modelRevision,0);
  assert.notEqual(vectors[0].apiKeyEncrypted,'fixture-embedding-key');
  await pool.query('update private.ai_providers set enabled=false where id=$1',[provider]);
  assert(!(await store.loadEmbeddingModels()).some(m=>m.providerId===provider));
 }finally{
  if(provider){await pool.query('delete from private.ai_models where provider_id=$1',[provider]);await pool.query('delete from private.ai_providers where id=$1',[provider]);}
  await pool.end();
 }
});
