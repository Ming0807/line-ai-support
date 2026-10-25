import {z} from 'zod';
import type {AIModelConfig} from './types';

const allowed:Record<string,readonly string[]>={
 'https://generativelanguage.googleapis.com/v1beta/openai':['gemini-3.5-flash-lite','gemini-3.8-flash'],
 'https://api.groq.com/openai/v1':['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'],
};
export const knownFreeAccountModels=(baseUrl:string):readonly string[]=>allowed[baseUrl]??[];
export const isKnownFreeAccountModel=(model:Pick<AIModelConfig,'adapter'|'baseUrl'|'modelId'>)=>
 model.adapter==='COMPATIBLE'&&knownFreeAccountModels(model.baseUrl).includes(model.modelId);
const grants=z.array(z.strictObject({providerId:z.uuid(),networkRevision:z.number().int().nonnegative(),
 baseUrl:z.string().max(200),models:z.array(z.string().max(200)).min(1).max(8),
 confirmedAt:z.iso.datetime(),expiresAt:z.iso.datetime()})).max(16);
/** Local operator attestation, not published zero pricing or provider billing verification. */
export function hasConfirmedFreeAccount(model:Pick<AIModelConfig,'providerId'|'providerNetworkRevision'|'adapter'|'baseUrl'|'modelId'>):boolean{
 return confirmedFreeAccountUntil(model)!==null;
}
export function confirmedFreeAccountUntil(model:Pick<AIModelConfig,'providerId'|'providerNetworkRevision'|'adapter'|'baseUrl'|'modelId'>):string|null{
 if(!isKnownFreeAccountModel(model))return null;
 const raw=process.env.YRU_FREE_ACCOUNT_GRANTS;if(!raw||raw.length>16384)return null;
 try{
  const parsed=grants.safeParse(JSON.parse(raw));if(!parsed.success)return null;
  const matches=parsed.data.filter(g=>g.providerId===model.providerId);if(matches.length!==1)return null;
  const g=matches[0],now=Date.now(),start=Date.parse(g.confirmedAt),end=Date.parse(g.expiresAt);
  return g.networkRevision===model.providerNetworkRevision&&g.baseUrl===model.baseUrl&&g.models.includes(model.modelId)
   &&start<=now&&end>now&&end-start<=30*86400000&&end>start?g.expiresAt:null;
 }catch{return null;}
}
