import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {getDatabasePool,transaction} from '../database/pool';
import {encryptValue,decryptValue} from '../security/identity';
import {createProviderSchema,updateProviderSchema,createModelSchema,updateModelSchema,type ProviderView,type ModelView} from '../../types/providers';
import type {AIProviderAdapter,ProviderHealth} from './types';

export class ProviderAdminError extends Error {
 constructor(readonly code:'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'INVALID_REQUEST'|'INTERNAL_ERROR'){super(code);this.name='ProviderAdminError';}
}
export interface ProviderAdminOptions {pool?:Pool;key?:string;adapters?:Record<string,AIProviderAdapter>}
async function authorize(client:Pick<PoolClient,'query'>,staffId:string){
 if(!z.uuid().safeParse(staffId).success)throw new ProviderAdminError('FORBIDDEN');
 const actor=(await client.query("select role from public.staff_profiles where id=$1 and active for share",[staffId])).rows[0];
 if(actor?.role!=='SUPER_ADMIN')throw new ProviderAdminError('FORBIDDEN');
}
function parse<T>(schema:z.ZodType<T>,input:unknown):T{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');return parsed.data;
}
function keyFor(options:ProviderAdminOptions):string{
 const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ProviderAdminError('INTERNAL_ERROR');return key;
}
async function run<T>(staffId:string,options:ProviderAdminOptions,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 try{return await transaction(async client=>{await authorize(client,staffId);return work(client);},options.pool??getDatabasePool());}
 catch(error){if(error instanceof ProviderAdminError)throw error;
  if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='23505')throw new ProviderAdminError('CONFLICT');
  throw new ProviderAdminError('INTERNAL_ERROR');}
}
async function audit(client:PoolClient,staffId:string,action:string,providerId:string,modelId?:string){
 await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[staffId,action,{providerId,...(modelId?{modelId}:{})}]);
}
async function provider(client:PoolClient,id:string){
 if(!z.uuid().safeParse(id).success)throw new ProviderAdminError('NOT_FOUND');
 const row=(await client.query('select id,revision from private.ai_providers where id=$1 for update',[id])).rows[0];
 if(!row)throw new ProviderAdminError('NOT_FOUND');return row;
}
export async function listProviders(staffId:string,options:ProviderAdminOptions={}):Promise<ProviderView[]>{
 return run(staffId,options,async client=>{
  const providers=(await client.query(`select id,name,adapter,base_url,enabled,priority,health_status,last_health_check,revision,
   length(api_key_encrypted)>0 as key_configured from private.ai_providers order by priority,id`)).rows;
  const models=(await client.query(`select id,provider_id,model_id,display_name,supports_tools,supports_json,supports_vision,
   enabled,priority,timeout_ms,input_price_per_million,output_price_per_million,revision from private.ai_models order by priority,id`)).rows;
  return providers.map(p=>({id:p.id,name:p.name,adapter:p.adapter,baseUrl:p.base_url,enabled:p.enabled,priority:p.priority,
   healthStatus:p.health_status,lastHealthCheck:p.last_health_check?.toISOString()??null,keyConfigured:p.key_configured,revision:p.revision,
   models:models.filter(m=>m.provider_id===p.id).map(m=>({id:m.id,modelId:m.model_id,displayName:m.display_name,
    supportsTools:m.supports_tools,supportsJson:m.supports_json,supportsVision:m.supports_vision,enabled:m.enabled,priority:m.priority,
    timeoutMs:m.timeout_ms,inputPricePerMillion:m.input_price_per_million===null?null:Number(m.input_price_per_million),
    outputPricePerMillion:m.output_price_per_million===null?null:Number(m.output_price_per_million),revision:m.revision} satisfies ModelView))}));
 });
}
export async function createProvider(staffId:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(createProviderSchema,input);
 return run(staffId,options,async client=>{
  const created=(await client.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted,enabled,priority)
   values($1,$2,$3,$4,$5,$6) returning id,revision`,[value.name,value.adapter,value.baseUrl,encryptValue(value.apiKey,keyFor(options)),value.enabled,value.priority])).rows[0];
  await audit(client,staffId,'AI_PROVIDER_CREATED',created.id);return created;
 });
}
export async function updateProvider(staffId:string,id:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(updateProviderSchema,input);
 return run(staffId,options,async client=>{
  const current=await provider(client,id);if(current.revision!==value.revision)throw new ProviderAdminError('CONFLICT');
  const replacement=value.apiKey===null?null:encryptValue(value.apiKey,keyFor(options));
  const changed=(await client.query(`update private.ai_providers set name=$2,adapter=$3,base_url=$4,enabled=$5,priority=$6,
   api_key_encrypted=coalesce($7,api_key_encrypted),health_status=case when $7::text is null then health_status else 'UNKNOWN' end,
   last_health_check=case when $7::text is null then last_health_check else null end,revision=revision+1,updated_at=clock_timestamp()
   where id=$1 returning id,revision`,[id,value.name,value.adapter,value.baseUrl,value.enabled,value.priority,replacement])).rows[0];
  await audit(client,staffId,'AI_PROVIDER_UPDATED',id);return changed;
 });
}
const modelValues=(value:z.infer<typeof createModelSchema>)=>[value.modelId,value.displayName,value.supportsTools,value.supportsJson,value.supportsVision,
 value.enabled,value.priority,value.timeoutMs,value.inputPricePerMillion,value.outputPricePerMillion];
export async function createModel(staffId:string,providerId:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(createModelSchema,input);
 return run(staffId,options,async client=>{
  await provider(client,providerId);
  const created=(await client.query(`insert into private.ai_models(provider_id,model_id,display_name,supports_tools,supports_json,supports_vision,enabled,priority,timeout_ms,input_price_per_million,output_price_per_million)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,revision`,[providerId,...modelValues(value)])).rows[0];
  await client.query("update private.ai_providers set revision=revision+1,health_status='UNKNOWN',last_health_check=null,updated_at=clock_timestamp() where id=$1",[providerId]);
  await audit(client,staffId,'AI_MODEL_CREATED',providerId,created.id);return created;
 });
}
export async function updateModel(staffId:string,providerId:string,id:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(updateModelSchema,input);
 return run(staffId,options,async client=>{
  await provider(client,providerId);if(!z.uuid().safeParse(id).success)throw new ProviderAdminError('NOT_FOUND');
  const current=(await client.query('select revision from private.ai_models where id=$1 and provider_id=$2 for update',[id,providerId])).rows[0];
  if(!current)throw new ProviderAdminError('NOT_FOUND');if(current.revision!==value.revision)throw new ProviderAdminError('CONFLICT');
  const changed=(await client.query(`update private.ai_models set model_id=$3,display_name=$4,supports_tools=$5,supports_json=$6,supports_vision=$7,
   enabled=$8,priority=$9,timeout_ms=$10,input_price_per_million=$11,output_price_per_million=$12,revision=revision+1,updated_at=clock_timestamp()
   where id=$1 and provider_id=$2 returning id,revision`,[id,providerId,...modelValues(value)])).rows[0];
  await client.query("update private.ai_providers set revision=revision+1,health_status='UNKNOWN',last_health_check=null,updated_at=clock_timestamp() where id=$1",[providerId]);
  await audit(client,staffId,'AI_MODEL_UPDATED',providerId,id);return changed;
 });
}
export async function checkProviderHealth(staffId:string,providerId:string,modelId:string,options:ProviderAdminOptions={}):Promise<{healthStatus:ProviderHealth}>{
 const config=await run(staffId,options,async client=>{
  if(!z.uuid().safeParse(providerId).success||!z.uuid().safeParse(modelId).success)throw new ProviderAdminError('NOT_FOUND');
  const row=(await client.query(`select p.adapter,p.base_url,p.api_key_encrypted,p.revision as provider_revision,m.revision as model_revision,m.model_id
   from private.ai_providers p join private.ai_models m on m.provider_id=p.id where p.id=$1 and m.id=$2`,[providerId,modelId])).rows[0];
  if(!row)throw new ProviderAdminError('NOT_FOUND');return row;
 });
 const adapters=options.adapters??(await import('./provider-registry')).createProviderRegistry();
 const adapter=adapters[config.adapter];if(!adapter)throw new ProviderAdminError('INVALID_REQUEST');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const boundary=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProviderAdminError('INTERNAL_ERROR'));},10_000);});
 let health:ProviderHealth;
 try{health=await Promise.race([adapter.healthCheck({modelId:config.model_id,baseUrl:config.base_url,
  apiKey:decryptValue(config.api_key_encrypted,keyFor(options)),signal:controller.signal}),boundary]);}
 catch{health='OFFLINE';}finally{if(timer)clearTimeout(timer);}
 if(!['HEALTHY','DEGRADED','RATE_LIMITED','OFFLINE'].includes(health))throw new ProviderAdminError('INTERNAL_ERROR');
 return run(staffId,options,async client=>{
  const current=await provider(client,providerId);
  // Read model state in a new statement after waiting for its parent's configuration lock.
  const currentModel=(await client.query('select revision from private.ai_models where id=$1 and provider_id=$2',[modelId,providerId])).rows[0];
  if(current.revision!==config.provider_revision||currentModel?.revision!==config.model_revision)throw new ProviderAdminError('CONFLICT');
  await client.query('update private.ai_providers set health_status=$2,last_health_check=clock_timestamp(),updated_at=clock_timestamp() where id=$1',
   [providerId,health]);
  await audit(client,staffId,'AI_PROVIDER_HEALTH_CHECKED',providerId,modelId);return {healthStatus:health};
 });
}
