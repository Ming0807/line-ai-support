import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {getDatabasePool,transaction} from '../database/pool';
import {encryptValue,decryptValue} from '../security/identity';
import {createProviderSchema,updateProviderSchema,createModelSchema,updateModelSchema,type ProviderView,type ModelView} from '../../types/providers';
import type {AIProviderAdapter,ProviderHealth} from './types';
import {observationView,quotaView} from './model-observations';
import {parseCompatibleBaseUrl} from './compatible-endpoint';
import {isPublicAddress,resolvePublicAddresses,type ResolvedAddress} from './public-addresses';

export class ProviderAdminError extends Error {
 constructor(readonly code:'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'INVALID_REQUEST'|'ENDPOINT_UNAVAILABLE'|'INTERNAL_ERROR'){super(code);this.name='ProviderAdminError';}
}
export interface ProviderAdminOptions {pool?:Pool;key?:string;adapters?:Record<string,AIProviderAdapter>;
 resolveCompatibleAddresses?:(hostname:string,signal:AbortSignal)=>Promise<readonly ResolvedAddress[]>}
export {authorize as authorizeProviderAdmin,run as withProviderAdminTransaction,provider as lockAIProvider};
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
 const row=(await client.query('select id,revision,cost_mode,adapter,base_url from private.ai_providers where id=$1 for update',[id])).rows[0];
 if(!row)throw new ProviderAdminError('NOT_FOUND');return row;
}
async function validateCompatibleDestination(baseUrl:string,options:ProviderAdminOptions):Promise<void>{
 const endpoint=parseCompatibleBaseUrl(baseUrl),controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProviderAdminError('ENDPOINT_UNAVAILABLE'));},5000);});
  const addresses=await Promise.race([deadline,Promise.resolve().then(()=>
   (options.resolveCompatibleAddresses??resolvePublicAddresses)(endpoint.hostname,controller.signal))]);
  if(controller.signal.aborted||!Array.isArray(addresses)||addresses.length===0||addresses.length>64||addresses.some(address=>!isPublicAddress(address)))
   throw new ProviderAdminError('ENDPOINT_UNAVAILABLE');
 }catch{throw new ProviderAdminError('ENDPOINT_UNAVAILABLE');}finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function listProviders(staffId:string,options:ProviderAdminOptions={}):Promise<ProviderView[]>{
 return run(staffId,options,async client=>{
  const providers=(await client.query(`select id,name,adapter,base_url,enabled,priority,health_status,last_health_check,revision,network_revision,
   cost_mode,length(api_key_encrypted)>0 as key_configured from private.ai_providers order by priority,id`)).rows;
  const models=(await client.query(`select id,provider_id,model_id,display_name,purpose,embedding_dimensions,supports_tools,supports_json,supports_vision,
   enabled,priority,timeout_ms,input_price_per_million,output_price_per_million,revision,pricing_status,pricing_checked_at,
   pricing_provider_revision,pricing_model_revision,api_format,network_revision,cooldown_until,cooldown_provider_network_revision,cooldown_model_network_revision from private.ai_models order by priority,id`)).rows;
  const observations=(await client.query(`select distinct on(o.model_id) o.* from private.ai_model_observations o
   join private.ai_models m on m.id=o.model_id and m.revision=o.model_revision
   join private.ai_providers p on p.id=o.provider_id and p.revision=o.provider_revision
   order by o.model_id,o.observed_at desc,o.recorded_at desc,o.id`)).rows;
  const quotas=(await client.query(`select distinct on(o.provider_id) o.* from private.ai_provider_quota_observations o
   join private.ai_providers p on p.id=o.provider_id and p.revision=o.provider_revision
   order by o.provider_id,o.observed_at desc,o.recorded_at desc,o.id`)).rows;
  const observationMap=new Map(observations.map(row=>[row.model_id,observationView(row)]));
  const quotaMap=new Map(quotas.map(row=>[row.provider_id,quotaView(row)]));
  return providers.map(p=>({id:p.id,name:p.name,adapter:p.adapter,baseUrl:p.base_url,enabled:p.enabled,priority:p.priority,
   healthStatus:p.health_status,lastHealthCheck:p.last_health_check?.toISOString()??null,keyConfigured:p.key_configured,revision:p.revision,costMode:p.cost_mode,
   quota:quotaMap.get(p.id)??null,models:models.filter(m=>m.provider_id===p.id).map(m=>({id:m.id,modelId:m.model_id,displayName:m.display_name,
    purpose:m.purpose,embeddingDimensions:m.embedding_dimensions===null?null:Number(m.embedding_dimensions),
    supportsTools:m.supports_tools,supportsJson:m.supports_json,supportsVision:m.supports_vision,enabled:m.enabled,priority:m.priority,
    timeoutMs:m.timeout_ms,inputPricePerMillion:m.input_price_per_million===null?null:Number(m.input_price_per_million),
    outputPricePerMillion:m.output_price_per_million===null?null:Number(m.output_price_per_million),revision:m.revision,
    pricingStatus:m.pricing_provider_revision===p.revision&&m.pricing_model_revision===m.revision?m.pricing_status:'UNKNOWN',
    pricingCheckedAt:m.pricing_provider_revision===p.revision&&m.pricing_model_revision===m.revision?m.pricing_checked_at?.toISOString()??null:null,
    apiFormat:m.api_format,
    latestObservation:observationMap.get(m.id)??null,
    cooldownUntil:m.cooldown_provider_network_revision===p.network_revision&&m.cooldown_model_network_revision===m.network_revision?m.cooldown_until?.toISOString()??null:null} satisfies ModelView))}));
 });
}
export async function createProvider(staffId:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(createProviderSchema,input);
 if(value.adapter==='COMPATIBLE'){
  await run(staffId,options,async()=>undefined);
  await validateCompatibleDestination(value.baseUrl,options);
 }
 return run(staffId,options,async client=>{
  // Serialize registry membership with full-scope provider reorders.
  await client.query("select pg_advisory_xact_lock(hashtextextended('yru.ai_provider_registry',0))");
  const created=(await client.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted,enabled,priority,cost_mode)
   values($1,$2,$3,$4,$5,$6,$7) returning id,revision`,[value.name,value.adapter,value.baseUrl,encryptValue(value.apiKey,keyFor(options)),value.enabled,value.priority,value.costMode])).rows[0];
  await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_PROVIDER_CREATED',$2)",
   [staffId,{providerId:created.id,costMode:value.costMode}]);return created;
 });
}
export async function updateProvider(staffId:string,id:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(updateProviderSchema,input);
 if(value.adapter==='COMPATIBLE'){
  await run(staffId,options,async client=>{
   const current=await provider(client,id);if(current.revision!==value.revision)throw new ProviderAdminError('CONFLICT');
   if(value.apiKey===null&&(value.adapter!==current.adapter||value.baseUrl.replace(/\/+$/,'')!==current.base_url.replace(/\/+$/,'')))
    throw new ProviderAdminError('INVALID_REQUEST');
  });
  await validateCompatibleDestination(value.baseUrl,options);
 }
 return run(staffId,options,async client=>{
  const current=await provider(client,id);if(current.revision!==value.revision)throw new ProviderAdminError('CONFLICT');
  const platformChanged=value.adapter!==current.adapter||value.baseUrl.replace(/\/+$/,'')!==current.base_url.replace(/\/+$/,'');
  if(value.apiKey===null&&platformChanged)
   throw new ProviderAdminError('INVALID_REQUEST');
  const replacement=value.apiKey===null?null:encryptValue(value.apiKey,keyFor(options));
  const changed=(await client.query(`update private.ai_providers set name=$2,adapter=$3,base_url=$4,enabled=$5,priority=$6,
   api_key_encrypted=coalesce($7,api_key_encrypted),health_status=case when $7::text is null then health_status else 'UNKNOWN' end,
   last_health_check=case when $7::text is null then last_health_check else null end,cost_mode=coalesce($8,cost_mode),revision=revision+1,
   network_revision=network_revision+case when $7::text is not null then 1 else 0 end,updated_at=clock_timestamp()
   where id=$1 returning id,revision`,[id,value.name,value.adapter,value.baseUrl,value.enabled,value.priority,replacement,value.costMode??null])).rows[0];
  if(platformChanged)await client.query('update private.ai_models set api_format=null where provider_id=$1',[id]);
  await audit(client,staffId,'AI_PROVIDER_UPDATED',id);
  if(value.costMode!==undefined&&value.costMode!==current.cost_mode)await client.query(
   "insert into private.activities(actor_id,action,metadata) values($1,'AI_PROVIDER_COST_MODE_CHANGED',$2)",
   [staffId,{providerId:id,previousCostMode:current.cost_mode,costMode:value.costMode}]);
  return changed;
 });
}
const modelValues=(value:z.infer<typeof createModelSchema>)=>[value.modelId,value.displayName,value.purpose,value.embeddingDimensions,
 value.supportsTools,value.supportsJson,value.supportsVision,value.enabled,value.priority,value.timeoutMs,
 value.inputPricePerMillion,value.outputPricePerMillion];
export async function createModel(staffId:string,providerId:string,input:unknown,options:ProviderAdminOptions={}):Promise<{id:string;revision:number}>{
 const value=parse(createModelSchema,input);
 return run(staffId,options,async client=>{
  await provider(client,providerId);
  const created=(await client.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,supports_tools,supports_json,supports_vision,enabled,priority,timeout_ms,input_price_per_million,output_price_per_million)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id,revision`,[providerId,...modelValues(value)])).rows[0];
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
  const changed=(await client.query(`update private.ai_models set model_id=$3,display_name=$4,purpose=$5,embedding_dimensions=$6,
   supports_tools=$7,supports_json=$8,supports_vision=$9,enabled=$10,priority=$11,timeout_ms=$12,input_price_per_million=$13,
   output_price_per_million=$14,revision=revision+1,
   api_format=case when model_id is distinct from $3 or purpose is distinct from $5 or embedding_dimensions is distinct from $6 then null else api_format end,
   network_revision=network_revision+case when model_id is distinct from $3 or purpose is distinct from $5 or embedding_dimensions is distinct from $6 then 1 else 0 end,updated_at=clock_timestamp()
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
