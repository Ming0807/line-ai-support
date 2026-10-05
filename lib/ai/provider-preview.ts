import type {ProviderView,PreviewProfile,FallbackPreviewView} from '../../types/providers';
import {previewProfileSchema} from '../../types/providers';
import {embeddingFingerprint} from './embedding-gateway';
import {MODEL_REGISTRY_LIMIT,compareModelPriority,supportsGeneration,isModelCoolingDown} from './model-selection';
import {ProviderAdminError,listProviders,type ProviderAdminOptions} from './provider-admin';

export function buildFallbackPreview(providers:ProviderView[],profile:PreviewProfile,now=Date.now()):FallbackPreviewView {
 const candidates=providers.flatMap(provider=>provider.models.filter(model=>model.purpose===profile.purpose)
  .map(model=>({provider,model,id:model.id,priority:model.priority,providerPriority:provider.priority}))).sort(compareModelPriority);
 // Match the enabled purpose-specific SQL registry limit before capability/pricing checks.
 const registered=new Set(candidates.filter(value=>value.provider.enabled&&value.model.enabled).slice(0,MODEL_REGISTRY_LIMIT).map(value=>value.id));
 let position=0;
 const rows=candidates.map(({provider,model}):FallbackPreviewView['rows'][number]=>{
  let reason:FallbackPreviewView['rows'][number]['reason']=null;
  const age=model.pricingCheckedAt===null?NaN:now-Date.parse(model.pricingCheckedAt);
  if(!provider.enabled||!model.enabled)reason='DISABLED';
  else if(!registered.has(model.id))reason='REGISTRY_LIMIT';
  else if(!provider.keyConfigured)reason='KEY_MISSING';
  else if(isModelCoolingDown(model,now))reason='COOLDOWN';
  else if(profile.purpose==='GENERATION'&&!supportsGeneration(model,profile.requiresTools))reason='CAPABILITY_UNSUPPORTED';
  else if(profile.purpose==='EMBEDDING'&&profile.fingerprint&&embeddingFingerprint({adapter:provider.adapter,baseUrl:provider.baseUrl,
   modelId:model.modelId,dimensions:model.embeddingDimensions!})!==profile.fingerprint)reason='VECTOR_COHORT_MISMATCH';
  else if(provider.costMode==='FREE_ONLY'){
   if(!Number.isFinite(age)||age < -1000||age>60_000||model.pricingStatus==='UNKNOWN')reason='PRICE_UNKNOWN';
   else if(model.pricingStatus==='PAID')reason='PAID_BLOCKED';
   else if(model.inputPricePerMillion!==0||model.outputPricePerMillion!==0)reason='PRICE_UNKNOWN';
   else if(provider.adapter==='ZEN'&&model.apiFormat===null)reason='PRICE_UNKNOWN';
  }else if(provider.costMode!=='ALLOW_PAID')reason='PRICE_UNKNOWN';
  else if(provider.adapter==='ZEN'&&model.apiFormat===null)reason='PRICE_UNKNOWN';
  if(reason===null&&position>=3)reason='ATTEMPT_LIMIT';
  return {providerId:provider.id,modelId:model.id,reason,position:reason===null?++position:null,...(reason==='COOLDOWN'?{cooldownUntil:model.cooldownUntil}:{})};
 });
 return {profile,generatedAt:new Date(now).toISOString(),maxInferenceAttempts:3,pricingEvidence:'LAST_CATALOG_OBSERVATION',rows};
}
export async function previewProviderOrder(staffId:string,input:unknown,options:ProviderAdminOptions={}):Promise<FallbackPreviewView> {
 const parsed=previewProfileSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 return buildFallbackPreview(await listProviders(staffId,options),parsed.data);
}
