import type {Pool} from 'pg';
import {providerReorderSchema,modelReorderSchema} from '../../types/providers';
import {ProviderAdminError,withProviderAdminTransaction,lockAIProvider} from './provider-admin';

interface OrderOptions {pool?:Pool}
function checkScope(actual:{id:string;revision:number}[],expected:{id:string;revision:number}[]):void {
 if(actual.length!==expected.length)throw new ProviderAdminError('CONFLICT');
 const revisions=new Map(actual.map(value=>[value.id,value.revision]));
 if(expected.some(value=>revisions.get(value.id)!==value.revision))throw new ProviderAdminError('CONFLICT');
}
export async function reorderProviders(staffId:string,input:unknown,options:OrderOptions={}):Promise<{saved:true}> {
 const parsed=providerReorderSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 return withProviderAdminTransaction(staffId,options,async client=>{
  await client.query("select pg_advisory_xact_lock(hashtextextended('yru.ai_provider_registry',0))");
  const rows=(await client.query('select id,revision from private.ai_providers order by id for update')).rows;
  checkScope(rows,parsed.data.order);
  for(let index=0;index<parsed.data.order.length;index++)await client.query(
   'update private.ai_providers set priority=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1',[parsed.data.order[index].id,index]);
  await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_PROVIDERS_REORDERED',$2)",
   [staffId,{providerIds:parsed.data.order.map(value=>value.id)}]);
  return {saved:true};
 });
}
export async function reorderModels(staffId:string,providerId:string,input:unknown,options:OrderOptions={}):Promise<{saved:true}> {
 const parsed=modelReorderSchema.safeParse(input);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
 return withProviderAdminTransaction(staffId,options,async client=>{
  const parent=await lockAIProvider(client,providerId);
  if(parent.revision!==parsed.data.providerRevision)throw new ProviderAdminError('CONFLICT');
  const rows=(await client.query('select id,revision from private.ai_models where provider_id=$1 and purpose=$2 order by id for update',
   [providerId,parsed.data.purpose])).rows;
  checkScope(rows,parsed.data.order);
  for(let index=0;index<parsed.data.order.length;index++)await client.query(
   'update private.ai_models set priority=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1 and provider_id=$3',
   [parsed.data.order[index].id,index,providerId]);
  await client.query('update private.ai_providers set revision=revision+1,updated_at=clock_timestamp() where id=$1',[providerId]);
  await client.query("insert into private.activities(actor_id,action,metadata) values($1,'AI_MODELS_REORDERED',$2)",
   [staffId,{providerId,purpose:parsed.data.purpose,modelIds:parsed.data.order.map(value=>value.id)}]);
  return {saved:true};
 });
}
