import {z} from 'zod';
import {isEmbeddingDimensionAllowed} from '../lib/ai/embedding-models';
import type {ProviderHealth} from '../lib/ai/types';

const providerFields={name:z.string().trim().min(1).max(100),adapter:z.literal('OPENAI'),
 baseUrl:z.enum(['https://api.openai.com/v1','https://api.openai.com/v1/']),enabled:z.boolean(),priority:z.number().int().min(0).max(1000)};
const apiKey=z.string().trim().min(8).max(512).refine(value=>!/[\s]/.test(value));
export const createProviderSchema=z.object({...providerFields,apiKey}).strict();
export const updateProviderSchema=z.object({...providerFields,revision:z.number().int().min(0),apiKey:apiKey.nullable()}).strict();
const modelFields={modelId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),displayName:z.string().trim().min(1).max(100),
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
export type ModelPurpose='GENERATION'|'EMBEDDING';
export interface ModelView {
 id:string;modelId:string;displayName:string;supportsTools:boolean;supportsJson:boolean;supportsVision:boolean;
 purpose:ModelPurpose;embeddingDimensions:number|null;enabled:boolean;priority:number;timeoutMs:number;
 inputPricePerMillion:number|null;outputPricePerMillion:number|null;revision:number;
}
export interface ProviderView {
 id:string;name:string;adapter:'OPENAI';baseUrl:string;enabled:boolean;priority:number;healthStatus:ProviderHealth;
 lastHealthCheck:string|null;keyConfigured:boolean;revision:number;models:ModelView[];
}
