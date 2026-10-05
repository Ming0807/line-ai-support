import type {AIErrorCode} from '../lib/ai/types';
import type {RetryEvidence} from '../lib/ai/retry-evidence';

export interface QuotaCounter {
 scope:'MODEL'|'PROVIDER_KEY'|'ACCOUNT';
 unit:'REQUESTS'|'TOKENS'|'CREDITS';
 window:'MINUTE'|'DAY'|'MONTH'|'TOTAL'|'UNKNOWN';
 source:'OPENROUTER_KEY'|'RATE_LIMIT_HEADERS';
 limit:number|null;remaining:number|null;resetAt:string|null;retryAfterSeconds:number|null;
 observedAt:string;currency:'USD'|null;
 /** Internal model UUID when the upstream evidence proves a model-specific scope. */
 modelId?:string;
}
export interface QuotaReadResult {
 supported:boolean;httpStatus:number|null;errorCode:AIErrorCode|null;observedAt:string;counters:QuotaCounter[];
}
export type QuotaState='UNKNOWN'|'AVAILABLE'|'NEAR_LIMIT'|'EXHAUSTED';
export interface ModelObservationView {
 id:string;providerId:string;modelId:string;providerRevision:number;modelRevision:number;
 purpose:'GENERATION'|'EMBEDDING';action:'METADATA'|'GENERATION_TEST'|'EMBEDDING_TEST'|'RUNTIME';
 result:'SUCCESS'|'ERROR'|'BLOCKED'|'UNKNOWN';errorCode:AIErrorCode|'PAID_BLOCKED'|'PRICE_UNKNOWN'|'CAPABILITY_UNSUPPORTED'|'COOLDOWN'|null;
 httpStatus:number|null;latencyMs:number;observedAt:string;
 retryEvidence?:RetryEvidence;
}
