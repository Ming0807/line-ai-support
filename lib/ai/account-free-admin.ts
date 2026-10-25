import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {confirmedFreeAccountUntil,isKnownFreeAccountModel,knownFreeAccountModels} from './account-free';
import {ProviderAdminError,withProviderAdminTransaction,lockAIProvider,type ProviderAdminOptions} from './provider-admin';
import type {AccountFreeModel} from './types';
import type {FreeAccountView} from '../../types/providers';
type Client=Pick<PoolClient,'query'>;
export interface ManagedFreeAccount {
 provider_id:string;network_revision:number;base_url:string;models:string[];state:'ACTIVE'|'REVOKED';
 confirmed_at:Date;expires_at:Date|null;revoked_at:Date|null;revision:number;
}
const revision=z.number().int().min(0).max(2_147_483_647);
const cas={providerRevision:revision,grantRevision:revision.nullable()};
export const saveFreeAccountSchema=z.strictObject({...cas,models:z.array(z.string().min(1).max(200)).min(1).max(8)
 .refine(models=>new Set(models).size===models.length),validForDays:z.number().int().min(1).max(30),confirmFreeTier:z.literal(true),billingDisabled:z.literal(true)});
export const revokeFreeAccountSchema=z.strictObject(cas);
export async function loadManagedFreeAccounts(client:Client,ids:string[]):Promise<{schemaReady:boolean;rows:ManagedFreeAccount[]}>{
 const readinessQuery={text:"select to_regclass('private.ai_free_account_grants') is not null ready",query_timeout:5000};
 const ready=(await client.query(readinessQuery)).rows[0]?.ready===true;
 if(!ready||ids.length===0)return {schemaReady:ready,rows:[]};
 const grantsQuery={text:'select provider_id,network_revision,base_url,models,state,confirmed_at,expires_at,revoked_at,revision from private.ai_free_account_grants where provider_id=any($1::uuid[])',values:[ids],query_timeout:5000};
 const rows=(await client.query(grantsQuery)).rows as ManagedFreeAccount[];
 return {schemaReady:ready,rows};
}
export function managedAccountUntil(row:ManagedFreeAccount,model:AccountFreeModel,now=Date.now()):string|null{
 if(!isKnownFreeAccountModel(model)||row.state!=='ACTIVE'||row.provider_id!==model.providerId||row.network_revision!==model.providerNetworkRevision
  ||row.base_url!==model.baseUrl||!row.models.includes(model.modelId)||!row.expires_at)return null;
 const start=row.confirmed_at.getTime(),end=row.expires_at.getTime();
 return Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&end>now&&end>start&&end-start<=30*86400000?row.expires_at.toISOString():null;
}
/** A persisted record shadows legacy ENV even when expired, stale or revoked. Never caches authority. */
export async function readAccountFreeUntil(pool:Pool,model:AccountFreeModel,options:{requireEnabled?:boolean}={}):Promise<string|null>{
 const readyQuery={text:"select to_regclass('private.ai_free_account_grants') is not null ready",query_timeout:5000};
 const ready=(await pool.query(readyQuery)).rows[0]?.ready===true;
 // One statement observes the parent identity and grant together. No authority cache or SQL transaction spans HTTP.
 const identityQuery={text:`select p.network_revision parent_network_revision,p.adapter parent_adapter,p.base_url parent_base_url
  ${ready?',g.provider_id,g.network_revision,g.base_url,g.models,g.state,g.confirmed_at,g.expires_at,g.revoked_at,g.revision':''}
  from private.ai_providers p
  join private.ai_models m on m.provider_id=p.id and m.model_id=$2 and m.purpose='GENERATION'
  ${ready?'left join private.ai_free_account_grants g on g.provider_id=p.id':''}
  where p.id=$1 ${options.requireEnabled===false?'':'and p.enabled and m.enabled'}`,values:[model.providerId,model.modelId],query_timeout:5000};
 const parent=(await pool.query(identityQuery)).rows[0];
 if(!parent||parent.parent_network_revision!==model.providerNetworkRevision||parent.parent_adapter!==model.adapter||parent.parent_base_url!==model.baseUrl)return null;
 return parent.provider_id?managedAccountUntil(parent as ManagedFreeAccount,model):confirmedFreeAccountUntil(model);
}
export function freeAccountView(provider:{id:string;adapter:string;base_url:string;network_revision:number},models:{model_id:string;purpose:string}[],row:ManagedFreeAccount|undefined,schemaReady:boolean):FreeAccountView{
 const eligibleModels=provider.adapter==='COMPATIBLE'?models.filter(m=>m.purpose==='GENERATION'&&knownFreeAccountModels(provider.base_url).includes(m.model_id)).map(m=>m.model_id):[];
 if(row){
  const status=row.state==='REVOKED'?'REVOKED':row.network_revision!==provider.network_revision||row.base_url!==provider.base_url||provider.adapter!=='COMPATIBLE'?'STALE':
   row.expires_at&&row.expires_at.getTime()>Date.now()&&eligibleModels.some(modelId=>managedAccountUntil(row,{providerId:provider.id,adapter:provider.adapter,baseUrl:provider.base_url,providerNetworkRevision:provider.network_revision,modelId}))?'ACTIVE':'EXPIRED';
  return {schemaReady,status,revision:row.revision,models:row.models,eligibleModels,confirmedAt:row.confirmed_at.toISOString(),expiresAt:row.expires_at?.toISOString()??null};
 }
 const legacy=eligibleModels.map(modelId=>({modelId,until:confirmedFreeAccountUntil({providerId:provider.id,adapter:provider.adapter,baseUrl:provider.base_url,providerNetworkRevision:provider.network_revision,modelId})})).filter(m=>m.until);
 return {schemaReady,status:legacy.length?'LEGACY':'NONE',revision:null,models:legacy.map(m=>m.modelId),eligibleModels,confirmedAt:null,expiresAt:legacy[0]?.until??null};
}
async function lockedState(client:PoolClient,providerId:string,providerRevision:number,grantRevision:number|null){
 const parent=await lockAIProvider(client,providerId);if(parent.revision!==providerRevision)throw new ProviderAdminError('CONFLICT');
 const config=(await client.query('select id,adapter,base_url,network_revision from private.ai_providers where id=$1',[providerId])).rows[0];
 const managed=await loadManagedFreeAccounts(client,[providerId]);if(!managed.schemaReady)throw new ProviderAdminError('INTERNAL_ERROR');
 const row=managed.rows[0];if((row?.revision??null)!==grantRevision)throw new ProviderAdminError('CONFLICT');
 return {config,row};
}
async function finish(client:PoolClient,staffId:string,providerId:string,action:string,grantRevision:number,models:string[],expiresAt:string|null){
 const updated=(await client.query('update private.ai_providers set revision=revision+1,updated_at=clock_timestamp() where id=$1 returning revision',[providerId])).rows[0];
 await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[staffId,action,{providerId,grantRevision,models,expiresAt,attestation:'FREE_TIER_BILLING_DISABLED'}]);
 return {revision:updated.revision as number,grantRevision};
}
export async function saveFreeAccountGrant(staffId:string,providerId:string,input:unknown,options:ProviderAdminOptions={}){
 const parsed=saveFreeAccountSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 return withProviderAdminTransaction(staffId,options,async client=>{
  const value=parsed.data,{config,row}=await lockedState(client,providerId,value.providerRevision,value.grantRevision);
  const configured=(await client.query("select model_id from private.ai_models where provider_id=$1 and purpose='GENERATION'",[providerId])).rows.map(m=>m.model_id);
  if(config.adapter!=='COMPATIBLE'||value.models.some(model=>!knownFreeAccountModels(config.base_url).includes(model)||!configured.includes(model)))throw new ProviderAdminError('INVALID_REQUEST');
  const next=(row?.revision??-1)+1;
  const saved=(await client.query(`insert into private.ai_free_account_grants(provider_id,network_revision,base_url,models,state,confirmed_at,expires_at,revoked_at,actor_id,revision)
   values($1,$2,$3,$4,'ACTIVE',statement_timestamp(),statement_timestamp()+$5*interval '1 day',null,$6,$7)
   on conflict(provider_id) do update set network_revision=excluded.network_revision,base_url=excluded.base_url,models=excluded.models,state='ACTIVE',
    confirmed_at=excluded.confirmed_at,expires_at=excluded.expires_at,revoked_at=null,actor_id=excluded.actor_id,revision=excluded.revision,updated_at=clock_timestamp()
   returning expires_at`,[providerId,config.network_revision,config.base_url,value.models,value.validForDays,staffId,next])).rows[0];
  return finish(client,staffId,providerId,'AI_FREE_ACCOUNT_CONFIRMED',next,value.models,saved.expires_at.toISOString());
 });
}
export async function revokeFreeAccountGrant(staffId:string,providerId:string,input:unknown,options:ProviderAdminOptions={}){
 const parsed=revokeFreeAccountSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 return withProviderAdminTransaction(staffId,options,async client=>{
  const {config,row}=await lockedState(client,providerId,parsed.data.providerRevision,parsed.data.grantRevision),next=(row?.revision??-1)+1;
  await client.query(`insert into private.ai_free_account_grants(provider_id,network_revision,base_url,models,state,confirmed_at,expires_at,revoked_at,actor_id,revision)
   values($1,$2,$3,$4,'REVOKED',clock_timestamp(),null,clock_timestamp(),$5,$6)
   on conflict(provider_id) do update set state='REVOKED',expires_at=null,revoked_at=clock_timestamp(),actor_id=excluded.actor_id,revision=excluded.revision,updated_at=clock_timestamp()`,
  [providerId,config.network_revision,config.base_url,row?.models??[],staffId,next]);
  return finish(client,staffId,providerId,'AI_FREE_ACCOUNT_REVOKED',next,row?.models??[],null);
 });
}
