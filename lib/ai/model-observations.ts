import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {ModelObservationView,QuotaReadResult} from '../../types/provider-observations';
import {retryEvidenceSchema,validRetryOutcome} from './model-cooldown';

export const operationalErrorSchema=z.enum(['TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE']);
const http=z.number().int().min(100).max(599).nullable();
export const probeResultSchema=z.object({result:z.enum(['SUCCESS','ERROR','BLOCKED','UNKNOWN']),
 errorCode:operationalErrorSchema.or(z.enum(['PAID_BLOCKED','PRICE_UNKNOWN','CAPABILITY_UNSUPPORTED','COOLDOWN'])).nullable(),
 httpStatus:http,latencyMs:z.number().int().min(0).max(2_147_483_647),observedAt:z.iso.datetime(),retryEvidence:retryEvidenceSchema.optional()}).strict()
 .refine(value=>value.result==='SUCCESS'?value.errorCode===null:value.result==='UNKNOWN'||value.errorCode!==null)
 .refine(validRetryOutcome).refine(value=>!value.retryEvidence||value.result==='ERROR');
const counter=z.object({scope:z.enum(['MODEL','PROVIDER_KEY','ACCOUNT']),unit:z.enum(['REQUESTS','TOKENS','CREDITS']),
 window:z.enum(['MINUTE','DAY','MONTH','TOTAL','UNKNOWN']),source:z.enum(['OPENROUTER_KEY','RATE_LIMIT_HEADERS']),
 limit:z.number().finite().nonnegative().nullable(),remaining:z.number().finite().nonnegative().nullable(),
 resetAt:z.iso.datetime().nullable(),retryAfterSeconds:z.number().finite().nonnegative().max(86400).nullable(),
 observedAt:z.iso.datetime(),currency:z.literal('USD').nullable(),modelId:z.uuid().optional()}).strict()
 .refine(value=>(value.scope==='MODEL')===(value.modelId!==undefined))
 .refine(value=>value.unit==='CREDITS'?value.currency==='USD':value.currency===null)
 .refine(value=>value.limit===null||value.remaining===null||value.remaining<=value.limit);
export const quotaResultSchema=z.object({supported:z.boolean(),httpStatus:http,errorCode:operationalErrorSchema.nullable(),
 observedAt:z.iso.datetime(),counters:z.array(counter).max(16)}).strict()
 .refine(value=>value.supported||value.httpStatus===null&&value.errorCode===null&&value.counters.length===0);

export function observationView(row:Record<string,unknown>):ModelObservationView {
 return {id:String(row.id),providerId:String(row.provider_id),modelId:String(row.model_id),providerRevision:Number(row.provider_revision),
  modelRevision:Number(row.model_revision),purpose:row.purpose as ModelObservationView['purpose'],action:row.action as ModelObservationView['action'],
  result:row.result as ModelObservationView['result'],errorCode:row.error_code as ModelObservationView['errorCode'],
  httpStatus:row.http_status===null?null:Number(row.http_status),latencyMs:Number(row.latency_ms),observedAt:(row.observed_at as Date).toISOString(),
  ...(row.retry_at&&row.retry_observed_at?{retryEvidence:{source:'RETRY_AFTER',observedAt:(row.retry_observed_at as Date).toISOString(),retryAt:(row.retry_at as Date).toISOString()}}:{})};
}
export function quotaView(row:Record<string,unknown>):QuotaReadResult {
 return quotaResultSchema.parse({supported:row.supported,httpStatus:row.http_status,errorCode:row.error_code,
  observedAt:(row.observed_at as Date).toISOString(),counters:row.counters});
}
export async function insertModelObservation(client:Pick<PoolClient,'query'>,
 value:Omit<ModelObservationView,'id'>):Promise<ModelObservationView> {
 const safe=probeResultSchema.parse({result:value.result,errorCode:value.errorCode,httpStatus:value.httpStatus,latencyMs:value.latencyMs,observedAt:value.observedAt,retryEvidence:value.retryEvidence});
 const row=(await client.query(`insert into private.ai_model_observations(provider_id,model_id,provider_revision,model_revision,purpose,action,result,error_code,http_status,latency_ms,observed_at,retry_at,retry_observed_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
  [value.providerId,value.modelId,value.providerRevision,value.modelRevision,value.purpose,value.action,safe.result,safe.errorCode,safe.httpStatus,safe.latencyMs,safe.observedAt,safe.retryEvidence?.retryAt??null,safe.retryEvidence?.observedAt??null])).rows[0];
 return observationView(row);
}
