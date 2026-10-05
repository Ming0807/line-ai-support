import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {getDatabasePool} from '../database/pool';
import {ProviderAdminError,lockAIProvider} from './provider-admin';

export async function claimProviderOperation(client:Pick<PoolClient,'query'>,providerId:string,scope:string):Promise<string> {
 const window=(await client.query(`select manual_window_count,manual_window_started_at is null or manual_window_started_at<=clock_timestamp()-interval '60 seconds' as reset
  from private.ai_providers where id=$1`,[providerId])).rows[0];
 if(!window||!window.reset&&window.manual_window_count>=10)throw new ProviderAdminError('CONFLICT');
 const token=randomUUID();
 const lease=(await client.query(`insert into private.ai_provider_operations(provider_id,scope,lease_token,expires_at,last_started_at)
  values($1,$2,$3,clock_timestamp()+interval '15 seconds',clock_timestamp())
  on conflict(provider_id,scope) do update set lease_token=excluded.lease_token,expires_at=excluded.expires_at,last_started_at=excluded.last_started_at
  where ai_provider_operations.expires_at<=clock_timestamp() and ai_provider_operations.last_started_at<=clock_timestamp()-interval '5 seconds'
  returning lease_token`,[providerId,scope,token])).rows[0];
 if(!lease)throw new ProviderAdminError('CONFLICT');
 await client.query(`update private.ai_providers set manual_window_count=case when $2 then 1 else manual_window_count+1 end,
  manual_window_started_at=case when $2 then clock_timestamp() else manual_window_started_at end where id=$1`,[providerId,window.reset]);
 return token;
}
export async function verifyProviderOperation(client:PoolClient,providerId:string,scope:string,token:string,revision:number):Promise<void> {
 const parent=await lockAIProvider(client,providerId);
 if(parent.revision!==revision)throw new ProviderAdminError('CONFLICT');
 const live=(await client.query(`select 1 from private.ai_provider_operations where provider_id=$1 and scope=$2 and lease_token=$3 and expires_at>clock_timestamp() for update`,
  [providerId,scope,token])).rows[0];
 if(!live)throw new ProviderAdminError('CONFLICT');
}
export async function releaseProviderOperation(providerId:string,scope:string,token:string,pool?:Pool):Promise<void> {
 const query={text:`update private.ai_provider_operations set expires_at=clock_timestamp()
  where provider_id=$1 and scope=$2 and lease_token=$3`,values:[providerId,scope,token],query_timeout:5000};
 await (pool??getDatabasePool()).query(query).catch(()=>undefined);
}
