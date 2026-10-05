import type {Pool} from 'pg';
import {z} from 'zod';
import {decryptValue} from '../security/identity';
import {ProviderAdminError,withProviderAdminTransaction,lockAIProvider} from './provider-admin';
import {claimProviderOperation,verifyProviderOperation,releaseProviderOperation} from './provider-operation';
import {createQuotaReader} from './provider-quota';
import {quotaResultSchema} from './model-observations';
import type {QuotaReadResult} from '../../types/provider-observations';
import {AIProviderError} from './types';

interface QuotaOptions {pool?:Pool;key?:string;quotaReader?:ReturnType<typeof createQuotaReader>;fetchImpl?:typeof fetch}
export const quotaRefreshSchema=z.object({providerRevision:z.number().int().min(0).max(2_147_483_647)}).strict();
export async function refreshProviderQuota(staffId:string,providerId:string,input:unknown,options:QuotaOptions={},outer?:AbortSignal):Promise<{quota:QuotaReadResult}> {
 const parsed=quotaRefreshSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 const scope='QUOTA';
 const snapshot=await withProviderAdminTransaction(staffId,options,async client=>{
  const parent=await lockAIProvider(client,providerId);
  if(parent.revision!==parsed.data.providerRevision)throw new ProviderAdminError('CONFLICT');
  const row=(await client.query('select adapter,base_url,api_key_encrypted from private.ai_providers where id=$1',[providerId])).rows[0];
  return {...row,token:await claimProviderOperation(client,providerId,scope)};
 });
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,failureTimer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
 try{
  let apiKey='';
  if(snapshot.adapter==='OPENROUTER'&&!outer?.aborted){
   const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ProviderAdminError('INTERNAL_ERROR');
   apiKey=decryptValue(snapshot.api_key_encrypted,key);
  }
  const boundary=new Promise<never>((_resolve,reject)=>{
   const stop=(code:'CANCELLED'|'TIMEOUT')=>{
    if(controller.signal.aborted)return;
    controller.abort(new DOMException(code,code==='TIMEOUT'?'TimeoutError':'AbortError'));
    // Give the cooperative reader's abort microtasks time to retain a received HTTP status.
    // Ignoring readers still hit this boundary in the next event-loop turn.
    failureTimer=setTimeout(()=>reject(new AIProviderError(code)),0);
   };
   abort=()=>stop('CANCELLED');
   outer?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>stop('TIMEOUT'),10_000);
  });
  const read=options.quotaReader??createQuotaReader({fetchImpl:options.fetchImpl});
  let raw:QuotaReadResult;
  try{
   if(outer?.aborted)throw new AIProviderError('CANCELLED');
   raw=await Promise.race([boundary,Promise.resolve().then(()=>read({adapter:snapshot.adapter,baseUrl:snapshot.base_url,apiKey},controller.signal))]);
  }catch(error){
   if(!(error instanceof AIProviderError)||!['TIMEOUT','CANCELLED'].includes(error.code))throw error;
   raw={supported:snapshot.adapter==='OPENROUTER',httpStatus:null,errorCode:snapshot.adapter==='OPENROUTER'?error.code:null,
    observedAt:new Date().toISOString(),counters:[]};
  }
  const quota=quotaResultSchema.parse(raw);
  const age=Date.now()-Date.parse(quota.observedAt);if(age < -1000||age>60_000)throw new ProviderAdminError('INTERNAL_ERROR');
  if(quota.counters.some(counter=>counter.modelId!==undefined||Date.now()-Date.parse(counter.observedAt)>60_000||Date.parse(counter.observedAt)>Date.now()+1000))
   throw new ProviderAdminError('INTERNAL_ERROR'); // Current supported endpoint reports only key/account scopes.
  return await withProviderAdminTransaction(staffId,options,async client=>{
   await verifyProviderOperation(client,providerId,scope,snapshot.token,parsed.data.providerRevision);
   await client.query(`insert into private.ai_provider_quota_observations(provider_id,provider_revision,supported,http_status,error_code,observed_at,counters)
    values($1,$2,$3,$4,$5,$6,$7)`,[providerId,parsed.data.providerRevision,quota.supported,quota.httpStatus,quota.errorCode,quota.observedAt,JSON.stringify(quota.counters)]);
   await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_PROVIDER_QUOTA_CHECKED',$2)",
    [staffId,{providerId,supported:quota.supported,httpStatus:quota.httpStatus}]);return {quota};
  });
 }catch(error){if(error instanceof ProviderAdminError)throw error;throw new ProviderAdminError('INTERNAL_ERROR');}
 finally{if(timer)clearTimeout(timer);if(failureTimer)clearTimeout(failureTimer);outer?.removeEventListener('abort',abort);controller.abort();await releaseProviderOperation(providerId,scope,snapshot.token,options.pool);}
}
