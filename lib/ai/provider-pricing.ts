import type {Pool} from 'pg';
import {z} from 'zod';
import {modelRevisionSchema} from '../../types/providers';
import {createPriceReader,type PriceReader,type ModelPricing} from './pricing';
import {ProviderAdminError,withProviderAdminTransaction,lockAIProvider} from './provider-admin';

interface PricingOptions {pool?:Pool;priceReader?:PriceReader}
const pricingSchema=z.object({status:z.enum(['FREE','PAID','UNKNOWN']),inputPricePerMillion:z.number().finite().min(0).max(99_999_999).nullable(),
 outputPricePerMillion:z.number().finite().min(0).max(99_999_999).nullable(),checkedAt:z.iso.datetime(),apiFormat:z.enum(['CHAT','RESPONSES']).nullable()}).strict()
 .refine(value=>value.status!=='FREE'||value.inputPricePerMillion===0&&value.outputPricePerMillion===0);
export async function refreshModelPricing(staffId:string,providerId:string,modelId:string,input:unknown,options:PricingOptions={},outer?:AbortSignal):Promise<{pricing:ModelPricing}> {
 const parsed=modelRevisionSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 if(!z.uuid().safeParse(modelId).success)throw new ProviderAdminError('NOT_FOUND');
 const snapshot=await withProviderAdminTransaction(staffId,options,async client=>{
  const provider=await lockAIProvider(client,providerId);
  const row=(await client.query(`select p.adapter,p.base_url,m.model_id,m.purpose,m.revision from private.ai_models m
   join private.ai_providers p on p.id=m.provider_id where p.id=$1 and m.id=$2`,[providerId,modelId])).rows[0];
  if(!row)throw new ProviderAdminError('NOT_FOUND');
  if(provider.revision!==parsed.data.providerRevision||row.revision!==parsed.data.modelRevision)throw new ProviderAdminError('CONFLICT');
  return row;
 });
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  abort=()=>{reject(new ProviderAdminError('INTERNAL_ERROR'));controller.abort();};
  outer?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(abort,10_000);
 });
 let pricing:ModelPricing;
 try{
  if(outer?.aborted)throw new ProviderAdminError('INTERNAL_ERROR');
  const read=options.priceReader??createPriceReader();
  pricing=pricingSchema.parse(await Promise.race([boundary,Promise.resolve().then(()=>read({adapter:snapshot.adapter,
   baseUrl:snapshot.base_url,modelId:snapshot.model_id,purpose:snapshot.purpose},controller.signal))]));
  const age=Date.now()-Date.parse(pricing.checkedAt);if(age < -1000||age>60_000)throw new ProviderAdminError('INTERNAL_ERROR');
 }catch{throw new ProviderAdminError('INTERNAL_ERROR');}
 finally{if(timer)clearTimeout(timer);outer?.removeEventListener('abort',abort);controller.abort();}
 return withProviderAdminTransaction(staffId,options,async client=>{
  const provider=await lockAIProvider(client,providerId);
  const row=(await client.query('select revision,api_format from private.ai_models where id=$1 and provider_id=$2 for update',[modelId,providerId])).rows[0];
  if(provider.revision!==parsed.data.providerRevision||row?.revision!==parsed.data.modelRevision)throw new ProviderAdminError('CONFLICT');
  const protocolChanged=snapshot.adapter==='ZEN'&&row.api_format!==pricing.apiFormat;
  const revision=row.revision+(protocolChanged?1:0);
  await client.query(`update private.ai_models set pricing_status=$3,pricing_checked_at=$4,pricing_provider_revision=$5,
   pricing_model_revision=$6,api_format=$7,input_price_per_million=$8,output_price_per_million=$9,
   revision=$6,network_revision=network_revision+$10::integer where id=$1 and provider_id=$2`,
   [modelId,providerId,pricing.status,pricing.checkedAt,provider.revision,revision,pricing.apiFormat,pricing.inputPricePerMillion,pricing.outputPricePerMillion,protocolChanged?1:0]);
  await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_MODEL_PRICING_CHECKED',$2)",[staffId,{providerId,modelId,status:pricing.status}]);
  return {pricing};
 });
}
