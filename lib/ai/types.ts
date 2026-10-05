export interface AIMessage {role:'system'|'user'|'assistant';content:string}
export interface AITool {name:string;description:string;parameters:Record<string,unknown>}
export type CostMode='FREE_ONLY'|'ALLOW_PAID';
export type ProviderApiFormat='CHAT'|'RESPONSES';
export interface ProviderRequest {
 modelId:string;baseUrl:string;apiKey:string;messages:AIMessage[];
 responseSchema:{name:string;schema:Record<string,unknown>};tools?:AITool[];
 signal:AbortSignal;maxOutputTokens?:number;costMode?:CostMode;apiFormat?:ProviderApiFormat;
}
export interface ProviderResponse {
 output:unknown|null;toolCalls:{id:string;name:string;arguments:unknown}[];
 inputTokens:number|null;outputTokens:number|null;httpStatus?:number;
}
export type ProviderHealth='HEALTHY'|'DEGRADED'|'RATE_LIMITED'|'OFFLINE'|'UNKNOWN';
export type AIErrorCode='TIMEOUT'|'CANCELLED'|'RATE_LIMITED'|'SERVER_ERROR'|'MODEL_UNAVAILABLE'|
 'AUTH_ERROR'|'INVALID_OUTPUT'|'INVALID_REQUEST'|'PROVIDER_UNAVAILABLE';
export class AIProviderError extends Error {
 readonly retryable:boolean;
 constructor(readonly code:AIErrorCode,readonly httpStatus?:number,readonly retryEvidence?:RetryEvidence){
  super(code);this.name='AIProviderError';
  this.retryable=['TIMEOUT','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','INVALID_OUTPUT','PROVIDER_UNAVAILABLE'].includes(code);
 }
}
export interface AIProviderAdapter {
 generate(request:ProviderRequest):Promise<ProviderResponse>;
 healthCheck(config:Pick<ProviderRequest,'modelId'|'baseUrl'|'apiKey'|'signal'>):Promise<Exclude<ProviderHealth,'UNKNOWN'>>;
}
export interface AIModelConfig {
 id:string;providerId:string;adapter:string;modelId:string;baseUrl:string;apiKeyEncrypted:string;
 providerRevision:number;modelRevision:number;providerPriority:number;priority:number;timeoutMs:number;supportsJson:boolean;supportsTools:boolean;
 providerNetworkRevision?:number;modelNetworkRevision?:number;cooldownUntil?:string|null;
 inputPricePerMillion:number|null;outputPricePerMillion:number|null;costMode?:CostMode;apiFormat?:ProviderApiFormat;
}
export interface AIAttempt {
 purpose?:'GENERATION'|'EMBEDDING';
 providerNetworkRevision?:number;modelNetworkRevision?:number;retryEvidence?:RetryEvidence;
 providerId:string;modelId:string;providerRevision:number;modelRevision:number;requestType:string;conversationId?:string;ticketId?:string;
 latencyMs:number;inputTokens:number|null;outputTokens:number|null;estimatedCost:number|null;
 status:'SUCCESS'|'ERROR';fallbackUsed:boolean;errorCode?:AIErrorCode;httpStatus?:number;health:ProviderHealth;
}
export interface AIStore {
 loadModels():Promise<AIModelConfig[]>;
 recordAttempt(attempt:AIAttempt):Promise<void>;
}
import type {RetryEvidence} from './retry-evidence';
