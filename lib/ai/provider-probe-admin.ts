import type {Pool} from 'pg';
import {z} from 'zod';
import {modelTestSchema} from '../../types/providers';
import {ProviderAdminError,withProviderAdminTransaction,lockAIProvider} from './provider-admin';
import {claimProviderOperation,verifyProviderOperation,releaseProviderOperation} from './provider-operation';
import {probeModel,type ProbeOptions,type ModelProbeConfig} from './model-probe';
import {insertModelObservation,probeResultSchema} from './model-observations';
import {createProviderRegistry,createEmbeddingProviderRegistry} from './provider-registry';
import type {ModelObservationView} from '../../types/provider-observations';
import {persistModelCooldown} from './model-cooldown';

type AdminProbeOptions={pool?:Pool}&Partial<ProbeOptions>;
export async function testProviderModel(staffId:string,providerId:string,modelId:string,input:unknown,options:AdminProbeOptions={},outer?:AbortSignal):Promise<{observation:ModelObservationView}> {
 const parsed=modelTestSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 if(!z.uuid().safeParse(modelId).success)throw new ProviderAdminError('NOT_FOUND');
 const scope=`MODEL:${modelId}`;
 const snapshot=await withProviderAdminTransaction(staffId,options,async client=>{
  const parent=await lockAIProvider(client,providerId);
  const row=(await client.query(`select m.id,m.provider_id as "providerId",p.adapter,m.model_id as "modelId",p.base_url as "baseUrl",
   p.api_key_encrypted as "apiKeyEncrypted",p.revision as "providerRevision",m.revision as "modelRevision",p.priority as "providerPriority",
   p.network_revision as "providerNetworkRevision",m.network_revision as "modelNetworkRevision",
   case when m.cooldown_provider_network_revision=p.network_revision and m.cooldown_model_network_revision=m.network_revision then m.cooldown_until else null end as "cooldownUntil",
   m.priority,m.timeout_ms as "timeoutMs",m.supports_json as "supportsJson",m.supports_tools as "supportsTools",m.purpose,
   m.embedding_dimensions as dimensions,m.input_price_per_million as "inputPricePerMillion",m.output_price_per_million as "outputPricePerMillion",
   p.cost_mode as "costMode",m.api_format as "apiFormat"
   from private.ai_models m join private.ai_providers p on p.id=m.provider_id where m.id=$1 and p.id=$2`,[modelId,providerId])).rows[0];
  if(!row)throw new ProviderAdminError('NOT_FOUND');
  if(parent.revision!==parsed.data.providerRevision||row.modelRevision!==parsed.data.modelRevision)throw new ProviderAdminError('CONFLICT');
  if(parsed.data.action==='GENERATION_TEST'&&row.purpose!=='GENERATION'||parsed.data.action==='EMBEDDING_TEST'&&row.purpose!=='EMBEDDING')throw new ProviderAdminError('INVALID_REQUEST');
  const token=await claimProviderOperation(client,providerId,scope);
  const config:ModelProbeConfig={...row,cooldownUntil:row.cooldownUntil?.toISOString()??null,dimensions:row.dimensions===null?undefined:Number(row.dimensions),apiFormat:row.apiFormat??undefined,
   inputPricePerMillion:row.inputPricePerMillion===null?null:Number(row.inputPricePerMillion),outputPricePerMillion:row.outputPricePerMillion===null?null:Number(row.outputPricePerMillion)};
  return {config,token};
 });
 try{
  const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ProviderAdminError('INTERNAL_ERROR');
  const result=probeResultSchema.parse(await probeModel(snapshot.config,parsed.data.action,{key,
   generationAdapters:options.generationAdapters??createProviderRegistry({fetchImpl:options.fetchImpl,compatibleTransport:options.compatibleTransport}),
   embeddingAdapters:options.embeddingAdapters??createEmbeddingProviderRegistry({fetchImpl:options.fetchImpl,compatibleTransport:options.compatibleTransport}),
   priceReader:options.priceReader,fetchImpl:options.fetchImpl,compatibleTransport:options.compatibleTransport},outer));
  const age=Date.now()-Date.parse(result.observedAt);if(age < -1000||age>60_000)throw new ProviderAdminError('INTERNAL_ERROR');
  return await withProviderAdminTransaction(staffId,options,async client=>{
   await verifyProviderOperation(client,providerId,scope,snapshot.token,snapshot.config.providerRevision);
   const model=(await client.query('select revision from private.ai_models where id=$1 and provider_id=$2 for update',[modelId,providerId])).rows[0];
   if(model?.revision!==snapshot.config.modelRevision)throw new ProviderAdminError('CONFLICT');
   const observation=await insertModelObservation(client,{...result,providerId,modelId,providerRevision:snapshot.config.providerRevision,
    modelRevision:snapshot.config.modelRevision,purpose:snapshot.config.purpose,action:parsed.data.action});
   await persistModelCooldown(client,{...snapshot.config,modelId},result.retryEvidence);
   await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_MODEL_TESTED',$2)",
    [staffId,{providerId,modelId,action:parsed.data.action,result:result.result,httpStatus:result.httpStatus}]);
   return {observation};
  });
 }catch(error){if(error instanceof ProviderAdminError)throw error;throw new ProviderAdminError('INTERNAL_ERROR');}
 finally{await releaseProviderOperation(providerId,scope,snapshot.token,options.pool);}
}
