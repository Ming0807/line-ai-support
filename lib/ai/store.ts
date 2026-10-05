import type {Pool} from 'pg';
import {z} from 'zod';
import type {AIStore,AIModelConfig} from './types';
import type {EmbeddingStore,EmbeddingModelConfig} from './embedding-types';
import {insertModelObservation} from './model-observations';
import {persistModelCooldown,retryEvidenceSchema,validRetryOutcome} from './model-cooldown';

const observationSchema=z.object({providerId:z.uuid(),modelId:z.uuid(),requestType:z.string().regex(/^[A-Z_]{1,32}$/),
 purpose:z.enum(['GENERATION','EMBEDDING']).optional(),
 providerNetworkRevision:z.number().int().min(0).max(2_147_483_647).optional(),modelNetworkRevision:z.number().int().min(0).max(2_147_483_647).optional(),retryEvidence:retryEvidenceSchema.optional(),
 providerRevision:z.number().int().min(0).max(2_147_483_647),modelRevision:z.number().int().min(0).max(2_147_483_647),
 conversationId:z.uuid().optional(),ticketId:z.uuid().optional(),latencyMs:z.number().int().min(0).max(2_147_483_647),
 inputTokens:z.number().int().min(0).max(100_000_000).nullable(),outputTokens:z.number().int().min(0).max(100_000_000).nullable(),
 estimatedCost:z.number().finite().min(0).nullable(),status:z.enum(['SUCCESS','ERROR']),fallbackUsed:z.boolean(),
 errorCode:z.enum(['TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE']).optional(),
 httpStatus:z.number().int().min(100).max(599).optional(),health:z.enum(['HEALTHY','DEGRADED','RATE_LIMITED','OFFLINE','UNKNOWN']),
}).strict().refine(value=>value.status==='ERROR'?value.errorCode!==undefined:value.errorCode===undefined)
 .refine(validRetryOutcome).refine(value=>!value.retryEvidence||value.status==='ERROR'&&value.providerNetworkRevision!==undefined&&value.modelNetworkRevision!==undefined);

export function createAIStore(pool:Pool):AIStore&EmbeddingStore {
 return {
  async loadModels(){
   const query={text:`select m.id,m.provider_id as "providerId",p.adapter,m.model_id as "modelId",p.base_url as "baseUrl",
    p.api_key_encrypted as "apiKeyEncrypted",p.revision as "providerRevision",m.revision as "modelRevision",p.priority as "providerPriority",m.priority,m.timeout_ms as "timeoutMs",
    p.network_revision as "providerNetworkRevision",m.network_revision as "modelNetworkRevision",
    case when m.cooldown_provider_network_revision=p.network_revision and m.cooldown_model_network_revision=m.network_revision then m.cooldown_until else null end as "cooldownUntil",
    m.supports_json as "supportsJson",m.supports_tools as "supportsTools",m.input_price_per_million as "inputPricePerMillion",
    m.output_price_per_million as "outputPricePerMillion",p.cost_mode as "costMode",
    m.api_format as "apiFormat"
    from private.ai_models m join private.ai_providers p on p.id=m.provider_id
    where p.enabled and m.enabled and m.purpose='GENERATION' order by p.priority,m.priority,m.id limit 64`,query_timeout:5000};
   const result=await pool.query(query);
   return result.rows.map(row=>({...row,apiFormat:row.apiFormat??undefined,cooldownUntil:row.cooldownUntil?.toISOString()??null,inputPricePerMillion:row.inputPricePerMillion===null?null:Number(row.inputPricePerMillion),
    outputPricePerMillion:row.outputPricePerMillion===null?null:Number(row.outputPricePerMillion)})) as AIModelConfig[];
  },
  async loadEmbeddingModels(){
   const query={text:`select m.id,m.provider_id as "providerId",p.adapter,m.model_id as "modelId",p.base_url as "baseUrl",
    p.api_key_encrypted as "apiKeyEncrypted",p.revision as "providerRevision",m.revision as "modelRevision",p.priority as "providerPriority",
    p.network_revision as "providerNetworkRevision",m.network_revision as "modelNetworkRevision",
    case when m.cooldown_provider_network_revision=p.network_revision and m.cooldown_model_network_revision=m.network_revision then m.cooldown_until else null end as "cooldownUntil",
    m.priority,m.timeout_ms as "timeoutMs",m.embedding_dimensions as dimensions,m.input_price_per_million as "inputPricePerMillion",
    m.output_price_per_million as "outputPricePerMillion",p.cost_mode as "costMode" from private.ai_models m join private.ai_providers p on p.id=m.provider_id
    where p.enabled and m.enabled and m.purpose='EMBEDDING' order by p.priority,m.priority,m.id limit 64`,query_timeout:5000};
   const result=await pool.query(query);
   return result.rows.map(row=>({...row,cooldownUntil:row.cooldownUntil?.toISOString()??null,inputPricePerMillion:row.inputPricePerMillion===null?null:Number(row.inputPricePerMillion),
    outputPricePerMillion:row.outputPricePerMillion===null?null:Number(row.outputPricePerMillion)})) as EmbeddingModelConfig[];
  },
  async recordAttempt(input){
   const parsed=observationSchema.safeParse(input);if(!parsed.success)throw new Error('AI_OBSERVATION_INVALID');
   const a=parsed.data,client=await pool.connect();
   try{
    await client.query('begin');await client.query("set local statement_timeout='5s'");
    // Configuration writers use the same parent lock; read model revision after any wait.
    const provider=(await client.query('select revision from private.ai_providers where id=$1 for update',[a.providerId])).rows[0];
    const model=(await client.query('select revision,purpose from private.ai_models where id=$1 and provider_id=$2',[a.modelId,a.providerId])).rows[0];
    if(!provider||!model)throw new Error('AI_OBSERVATION_INVALID');
    if(provider.revision===a.providerRevision&&model.revision===a.modelRevision){
     await client.query('update private.ai_providers set health_status=$2,last_health_check=clock_timestamp(),updated_at=clock_timestamp() where id=$1',[a.providerId,a.health]);
    }
    await client.query(`insert into private.ai_usage_logs(provider_id,model_id,request_type,conversation_id,ticket_id,latency_ms,input_tokens,output_tokens,estimated_cost,status,fallback_used,provider_revision,model_revision)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[a.providerId,a.modelId,a.requestType,a.conversationId??null,a.ticketId??null,a.latencyMs,a.inputTokens,a.outputTokens,a.estimatedCost,a.status,a.fallbackUsed,a.providerRevision,a.modelRevision]);
    if(a.errorCode)await client.query(`insert into private.ai_errors(provider_id,model_id,error_type,http_status,message,provider_revision,model_revision) values($1,$2,$3,$4,$3,$5,$6)`,
     [a.providerId,a.modelId,a.errorCode,a.httpStatus??null,a.providerRevision,a.modelRevision]);
    await insertModelObservation(client,{providerId:a.providerId,modelId:a.modelId,providerRevision:a.providerRevision,modelRevision:a.modelRevision,
     purpose:a.purpose??(a.requestType==='EMBEDDING_QUERY'||a.requestType==='EMBEDDING_DOCUMENT'?'EMBEDDING':'GENERATION'),
     action:'RUNTIME',result:a.status,errorCode:a.errorCode??null,httpStatus:a.httpStatus??null,latencyMs:a.latencyMs,observedAt:new Date().toISOString(),retryEvidence:a.retryEvidence});
    await persistModelCooldown(client,a,a.retryEvidence);
    await client.query('commit');
   }catch{await client.query('rollback').catch(()=>undefined);throw new Error('AI_OBSERVATION_FAILED');}
   finally{client.release();}
  },
 };
}
