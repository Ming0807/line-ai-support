import {AIProviderError,type AIModelConfig,type CostMode,type ProviderApiFormat,type AccountFreeReader} from './types';
import type {ModelPricing,PriceReader} from './pricing';
import {confirmedFreeAccountUntil,isKnownFreeAccountModel} from './account-free';

export interface CostPermission {costMode:CostMode;apiFormat?:ProviderApiFormat;pricing?:ModelPricing;accountConfirmedFree?:true}
/** Registry-only opt-in; callers cannot grant paid access through generation input. */
export async function authorizeModelCost(model:AIModelConfig|Omit<AIModelConfig,'supportsJson'|'supportsTools'>,
 purpose:'GENERATION'|'EMBEDDING',read:PriceReader,signal:AbortSignal,readAccountFreeUntil?:AccountFreeReader):Promise<CostPermission|null> {
 if(signal.aborted)throw new AIProviderError('CANCELLED');
 const mode=model.costMode??'FREE_ONLY';
 if(mode!=='FREE_ONLY'&&mode!=='ALLOW_PAID')return null;
 const needsProtocol=purpose==='GENERATION'&&model.adapter==='ZEN';
 if(needsProtocol&&model.apiFormat!=='CHAT'&&model.apiFormat!=='RESPONSES')return null;
 if(mode==='ALLOW_PAID'&&(!needsProtocol||model.apiFormat))return {costMode:mode,apiFormat:model.apiFormat};
 if(mode==='FREE_ONLY'&&purpose==='GENERATION'&&isKnownFreeAccountModel(model)){
  const expiresAt=readAccountFreeUntil?await readAccountFreeUntil(model):confirmedFreeAccountUntil(model);
  if(signal.aborted)throw new AIProviderError('CANCELLED');
  const end=expiresAt?Date.parse(expiresAt):NaN,remaining=end-Date.now();
  if(Number.isFinite(end)&&remaining>0&&remaining<=30*86400000)
   return {costMode:mode,apiFormat:'CHAT',accountConfirmedFree:true};
 }
 const pricing=await read({adapter:model.adapter,modelId:model.modelId,baseUrl:model.baseUrl,purpose},signal);
 if(signal.aborted)throw new AIProviderError('CANCELLED');
 const checkedAt=Date.parse(pricing.checkedAt),age=Date.now()-checkedAt;
 if(!Number.isFinite(checkedAt)||age < -1000||age>60_000)return null;
 if(mode==='FREE_ONLY'&&(pricing.status!=='FREE'||pricing.inputPricePerMillion!==0||pricing.outputPricePerMillion!==0))return null;
 if(needsProtocol&&pricing.apiFormat!=='CHAT'&&pricing.apiFormat!=='RESPONSES')return null;
 if(needsProtocol&&pricing.apiFormat!==model.apiFormat)return null;
 if(model.adapter==='OPENROUTER'&&pricing.apiFormat!=='CHAT')return null;
 return {costMode:mode,pricing,apiFormat:pricing.apiFormat??undefined};
}
