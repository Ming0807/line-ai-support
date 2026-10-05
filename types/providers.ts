import {z} from 'zod';
import {isEmbeddingDimensionAllowed} from '../lib/ai/embedding-models';
import type {ProviderHealth,CostMode,ProviderApiFormat} from '../lib/ai/types';
import type {ModelObservationView,QuotaReadResult} from './provider-observations';
import {parseCompatibleBaseUrl} from '../lib/ai/compatible-endpoint';

export const providerBases={ZEN:'https://opencode.ai/zen/v1',OPENROUTER:'https://openrouter.ai/api/v1',OPENAI:'https://api.openai.com/v1'} as const;
export type ProviderKind=keyof typeof providerBases|'COMPATIBLE';
const costMode=z.enum(['FREE_ONLY','ALLOW_PAID']);
const providerFields={name:z.string().trim().min(1).max(100),adapter:z.enum(['ZEN','OPENROUTER','OPENAI','COMPATIBLE']),
 baseUrl:z.string().max(2048),enabled:z.boolean(),priority:z.number().int().min(0).max(1000)};
const validEndpoint=(value:{adapter:ProviderKind;baseUrl:string})=>{
 if(value.adapter==='COMPATIBLE'){try{parseCompatibleBaseUrl(value.baseUrl);return true;}catch{return false;}}
 return value.baseUrl===providerBases[value.adapter]||value.baseUrl===`${providerBases[value.adapter]}/`;
};
const canonicalEndpoint=<T extends {adapter:ProviderKind;baseUrl:string}>(value:T):T=>
 value.adapter==='COMPATIBLE'?{...value,baseUrl:parseCompatibleBaseUrl(value.baseUrl).baseUrl}:value;
const apiKey=z.string().trim().min(8).max(512).refine(value=>!/[\s]/.test(value));
export const createProviderSchema=z.object({...providerFields,apiKey,costMode:costMode.default('FREE_ONLY')}).strict().refine(validEndpoint,{path:['baseUrl'],message:'PROVIDER_ENDPOINT_MISMATCH'}).transform(canonicalEndpoint);
export const updateProviderSchema=z.object({...providerFields,revision:z.number().int().min(0),apiKey:apiKey.nullable(),costMode:costMode.optional()}).strict().refine(validEndpoint,{path:['baseUrl'],message:'PROVIDER_ENDPOINT_MISMATCH'}).transform(canonicalEndpoint);
const modelFields={modelId:z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)?$/),displayName:z.string().trim().min(1).max(100),
 purpose:z.enum(['GENERATION','EMBEDDING']).default('GENERATION'),embeddingDimensions:z.number().int().min(1).max(4096).nullable().default(null),
 supportsTools:z.boolean(),supportsJson:z.boolean(),supportsVision:z.boolean(),enabled:z.boolean(),priority:z.number().int().min(0).max(1000),
 timeoutMs:z.number().int().min(1000).max(45000),inputPricePerMillion:z.number().finite().min(0).max(10000).nullable(),
 outputPricePerMillion:z.number().finite().min(0).max(10000).nullable()};
const modelPurposeRefinement=(model:z.infer<z.ZodObject<typeof modelFields>>,context:z.RefinementCtx)=>{
 if(model.purpose==='GENERATION'&&model.embeddingDimensions!==null){
  context.addIssue({code:'custom',path:['embeddingDimensions'],message:'GENERATION_REQUIRES_NULL_DIMENSIONS'});
 }
 if(model.purpose==='EMBEDDING'){
  if(model.embeddingDimensions===null)context.addIssue({code:'custom',path:['embeddingDimensions'],message:'EMBEDDING_REQUIRES_DIMENSIONS'});
  else if(!isEmbeddingDimensionAllowed(model.modelId,model.embeddingDimensions)){
   context.addIssue({code:'custom',path:['embeddingDimensions'],message:'EMBEDDING_MODEL_DIMENSION_MISMATCH'});
  }
  for(const capability of ['supportsTools','supportsJson','supportsVision'] as const){
   if(model[capability])context.addIssue({code:'custom',path:[capability],message:'EMBEDDING_CAPABILITY_NOT_SUPPORTED'});
  }
 }
};
export const createModelSchema=z.object(modelFields).strict().superRefine(modelPurposeRefinement);
export const updateModelSchema=z.object({...modelFields,revision:z.number().int().min(0)}).strict().superRefine(modelPurposeRefinement);
export const healthCheckSchema=z.object({modelId:z.uuid()}).strict();
const orderEntry=z.object({id:z.uuid(),revision:z.number().int().min(0).max(2_147_483_647)}).strict();
const fullOrder=z.array(orderEntry).min(1).max(1000).refine(values=>new Set(values.map(value=>value.id)).size===values.length);
export const providerReorderSchema=z.object({order:fullOrder}).strict();
export const modelReorderSchema=z.object({providerRevision:z.number().int().min(0).max(2_147_483_647),purpose:z.enum(['GENERATION','EMBEDDING']),order:fullOrder}).strict();
export const modelRevisionSchema=z.object({providerRevision:z.number().int().min(0),modelRevision:z.number().int().min(0)}).strict();
export const modelTestSchema=modelRevisionSchema.extend({action:z.enum(['METADATA','GENERATION_TEST','EMBEDDING_TEST'])}).strict();
export const previewProfileSchema=z.object({purpose:z.enum(['GENERATION','EMBEDDING']),requiresJson:z.boolean(),requiresTools:z.boolean(),
 fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().refine(value=>value.purpose==='GENERATION'?value.requiresJson&&value.fingerprint===undefined:!value.requiresJson&&!value.requiresTools);
export type PreviewProfile=z.infer<typeof previewProfileSchema>;
export interface FallbackPreviewView {
 profile:PreviewProfile;generatedAt:string;maxInferenceAttempts:3;
 pricingEvidence:'LAST_CATALOG_OBSERVATION';
 /** Positions are 1-based; null identifies an excluded or beyond-limit row. */
 rows:{providerId:string;modelId:string;position:number|null;cooldownUntil?:string|null;reason:'DISABLED'|'KEY_MISSING'|'PRICE_UNKNOWN'|'PAID_BLOCKED'|'CAPABILITY_UNSUPPORTED'|'COOLDOWN'|'VECTOR_COHORT_MISMATCH'|'REGISTRY_LIMIT'|'ATTEMPT_LIMIT'|null}[];
}
export type ModelPurpose='GENERATION'|'EMBEDDING';
export interface ModelView {
 id:string;modelId:string;displayName:string;supportsTools:boolean;supportsJson:boolean;supportsVision:boolean;
 purpose:ModelPurpose;embeddingDimensions:number|null;enabled:boolean;priority:number;timeoutMs:number;
 inputPricePerMillion:number|null;outputPricePerMillion:number|null;revision:number;
 pricingStatus:'FREE'|'PAID'|'UNKNOWN';pricingCheckedAt:string|null;apiFormat:ProviderApiFormat|null;
 latestObservation?:ModelObservationView|null;
 cooldownUntil?:string|null;
}
export interface ProviderView {
 id:string;name:string;adapter:ProviderKind;baseUrl:string;enabled:boolean;priority:number;healthStatus:ProviderHealth;costMode:CostMode;
 lastHealthCheck:string|null;keyConfigured:boolean;revision:number;models:ModelView[];
 quota?:QuotaReadResult|null;
}
