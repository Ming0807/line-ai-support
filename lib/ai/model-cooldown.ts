import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {RetryEvidence} from './retry-evidence';

export const retryEvidenceSchema=z.object({source:z.literal('RETRY_AFTER'),observedAt:z.iso.datetime(),retryAt:z.iso.datetime()}).strict()
 .refine(value=>{const wait=Date.parse(value.retryAt)-Date.parse(value.observedAt);return wait>=0&&wait<=86_400_000;});
export function validRetryOutcome(value:{retryEvidence?:RetryEvidence;httpStatus?:number|null;errorCode?:string|null}):boolean {
 return !value.retryEvidence||value.httpStatus===429&&value.errorCode==='RATE_LIMITED'||
  typeof value.httpStatus==='number'&&value.httpStatus>=500&&value.httpStatus<=599&&value.errorCode==='SERVER_ERROR';
}
/** Caller holds the provider parent lock. Apply only to the exact credential/endpoint/model snapshot. */
export async function persistModelCooldown(client:Pick<PoolClient,'query'>,identity:{providerId:string;modelId:string;providerNetworkRevision?:number;modelNetworkRevision?:number},retry?:RetryEvidence):Promise<void> {
 if(!retry||identity.providerNetworkRevision===undefined||identity.modelNetworkRevision===undefined)return;
 const safe=retryEvidenceSchema.parse(retry),age=Date.now()-Date.parse(safe.observedAt);
 if(age < -1000||age>60_000||Date.parse(safe.retryAt)<=Date.now())return;
 await client.query(`update private.ai_models m set
  cooldown_until=case when m.cooldown_provider_network_revision=$3 and m.cooldown_model_network_revision=$4 and m.cooldown_until>=$5::timestamptz then m.cooldown_until else $5 end,
  cooldown_observed_at=case when m.cooldown_provider_network_revision=$3 and m.cooldown_model_network_revision=$4 and m.cooldown_until>=$5::timestamptz then m.cooldown_observed_at else $6 end,
  cooldown_provider_network_revision=$3,cooldown_model_network_revision=$4
  from private.ai_providers p where m.id=$1 and m.provider_id=$2 and p.id=m.provider_id and p.network_revision=$3 and m.network_revision=$4`,
  [identity.modelId,identity.providerId,identity.providerNetworkRevision,identity.modelNetworkRevision,safe.retryAt,safe.observedAt]);
}
