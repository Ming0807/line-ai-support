import {createHash} from 'node:crypto';
import {z} from 'zod';
import {decryptValue} from '../security/identity';
import type {EmbeddingAdapter,EmbeddingModelConfig,EmbeddingResponse,EmbeddingStore} from './embedding-types';
import {AIProviderError,type AIAttempt,type ProviderHealth} from './types';

export interface EmbedInput {
 input:string[];
 requestType:'EMBEDDING_QUERY'|'EMBEDDING_DOCUMENT';
 fingerprint?:string;
 timeoutMs?:number;
 conversationId?:string;
 signal?:AbortSignal;
}

export interface EmbeddingGatewayOptions {
 store:EmbeddingStore;
 key:string;
 adapters:Record<string,EmbeddingAdapter>;
}

export interface EmbedResult {
 vectors:number[][];
 fingerprint:string;
 dimensions:number;
 providerId:string;
 modelId:string;
 fallbackUsed:boolean;
}

const encoder=new TextEncoder();
const MAX_TIMEOUT_MS=45_000;
const DEFAULT_TIMEOUT_MS=20_000;
const MAX_INPUTS=16;
const MAX_INPUT_BYTES=6000;
const responseShape=z.object({
 vectors:z.array(z.array(z.number().finite()).min(1).max(4096)),
 inputTokens:z.number().int().min(0).max(100_000_000).nullable(),
}).strict();

/** Identifies the vector space, excluding credentials and registry bookkeeping. */
export function embeddingFingerprint(model:Pick<EmbeddingModelConfig,'adapter'|'baseUrl'|'modelId'|'dimensions'>):string {
 const canonical=JSON.stringify([model.adapter,model.baseUrl.replace(/\/+$/,''),model.modelId,model.dimensions]);
 return createHash('sha256').update(canonical).digest('hex');
}

function validateInput(input:EmbedInput):void {
 if(!input||typeof input!=='object'||!Array.isArray(input.input)||input.input.length<1||input.input.length>MAX_INPUTS||
  (input.requestType!=='EMBEDDING_QUERY'&&input.requestType!=='EMBEDDING_DOCUMENT')||
  (input.fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(input.fingerprint))||
  (input.timeoutMs!==undefined&&(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>MAX_TIMEOUT_MS))||
  (input.conversationId!==undefined&&!z.uuid().safeParse(input.conversationId).success)||
  (input.signal!==undefined&&(!input.signal||typeof input.signal.addEventListener!=='function'||
   typeof input.signal.removeEventListener!=='function'||typeof input.signal.aborted!=='boolean')))
  throw new AIProviderError('INVALID_REQUEST');
 for(let index=0;index<input.input.length;index++){
  const value=input.input[index];
  if(!Object.hasOwn(input.input,index)||typeof value!=='string'||value.trim().length===0||encoder.encode(value).byteLength>MAX_INPUT_BYTES)
   throw new AIProviderError('INVALID_REQUEST');
 }
}

/** Even an adapter or store that ignores its signal cannot hold the gateway open. */
async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,milliseconds:number,outer?:AbortSignal):Promise<T> {
 if(outer?.aborted)throw new AIProviderError('CANCELLED');
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let abort=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  abort=()=>{reject(new AIProviderError('CANCELLED'));controller.abort();};
  outer?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{reject(new AIProviderError('TIMEOUT'));controller.abort();},milliseconds);
 });
 try{
  return await Promise.race([boundary,Promise.resolve().then(()=>work(controller.signal))]);
 }finally{
  if(timer)clearTimeout(timer);
  outer?.removeEventListener('abort',abort);
 }
}

async function privateState<T>(work:()=>Promise<T>,milliseconds:number,signal?:AbortSignal):Promise<T> {
 try{return await bounded(work,milliseconds,signal);}
 catch(error){throw error instanceof AIProviderError?error:new AIProviderError('PROVIDER_UNAVAILABLE');}
}

function healthFor(code:string):ProviderHealth {
 if(code==='RATE_LIMITED')return 'RATE_LIMITED';
 if(['PROVIDER_UNAVAILABLE','MODEL_UNAVAILABLE','AUTH_ERROR'].includes(code))return 'OFFLINE';
 return 'DEGRADED';
}

function estimatedCost(model:EmbeddingModelConfig,inputTokens:number|null):number|null {
 const price=model.inputPricePerMillion;
 if(inputTokens===null||price===null||!Number.isFinite(price)||price<0)return null;
 return Math.round(inputTokens*price/1_000_000*1e8)/1e8;
}

function validateResponse(value:unknown,inputCount:number,dimensions:number):EmbeddingResponse {
 const parsed=responseShape.safeParse(value);
 if(!parsed.success||parsed.data.vectors.length!==inputCount||
  parsed.data.vectors.some((vector)=>vector.length!==dimensions||!vector.some((number)=>number!==0)))
  throw new AIProviderError('INVALID_OUTPUT');
 return parsed.data;
}

function normalizeAdapterError(error:unknown):AIProviderError {
 if(error instanceof AIProviderError)return error;
 if(error instanceof z.ZodError)return new AIProviderError('INVALID_OUTPUT');
 return new AIProviderError('PROVIDER_UNAVAILABLE');
}

export async function embed(input:EmbedInput,options:EmbeddingGatewayOptions):Promise<EmbedResult> {
 validateInput(input);
 if(input.signal?.aborted)throw new AIProviderError('CANCELLED');

 const timeout=input.timeoutMs??DEFAULT_TIMEOUT_MS;
 const deadline=Date.now()+timeout;
 const registered=await privateState(()=>options.store.loadEmbeddingModels(),timeout,input.signal);
 if(!Array.isArray(registered))throw new AIProviderError('PROVIDER_UNAVAILABLE');
 let models:EmbeddingModelConfig[];
 try{
  models=[...registered];
  if(input.fingerprint!==undefined)
   models=models.filter((model)=>embeddingFingerprint(model)===input.fingerprint);
  models=models.sort((a,b)=>a.providerPriority-b.providerPriority||a.priority-b.priority||a.id.localeCompare(b.id)).slice(0,3);
 }catch{throw new AIProviderError('PROVIDER_UNAVAILABLE');}
 if(!models.length)throw new AIProviderError('PROVIDER_UNAVAILABLE');

 let lastError=new AIProviderError('PROVIDER_UNAVAILABLE');
 for(let index=0;index<models.length;index++){
  if(input.signal?.aborted)throw new AIProviderError('CANCELLED');
  const remaining=deadline-Date.now();
  if(remaining<=0)throw new AIProviderError('TIMEOUT');
  const model=models[index]!;
  const started=Date.now();
  let response:EmbeddingResponse|undefined;
  let error:AIProviderError|undefined;
  const budget=Math.min(remaining,model.timeoutMs);
  try{
   const adapter=options.adapters[model.adapter];
   if(!adapter)throw new AIProviderError('PROVIDER_UNAVAILABLE');
   const apiKey=decryptValue(model.apiKeyEncrypted,options.key);
   const raw=await bounded((signal)=>adapter.embed({modelId:model.modelId,baseUrl:model.baseUrl,apiKey,
    input:input.input,dimensions:model.dimensions,signal}),budget,input.signal);
   response=validateResponse(raw,input.input.length,model.dimensions);
  }catch(caught){error=normalizeAdapterError(caught);}

  const attempt:AIAttempt={providerId:model.providerId,modelId:model.id,requestType:input.requestType,
   providerRevision:model.providerRevision,modelRevision:model.modelRevision,conversationId:input.conversationId,
   latencyMs:Math.max(0,Date.now()-started),inputTokens:response?.inputTokens??null,outputTokens:0,
   estimatedCost:response?estimatedCost(model,response.inputTokens):null,status:error?'ERROR':'SUCCESS',
   fallbackUsed:index>0,errorCode:error?.code,httpStatus:error?.httpStatus,health:error?healthFor(error.code):'HEALTHY'};
  await privateState(()=>options.store.recordAttempt(attempt),Math.max(1,deadline-Date.now()),input.signal);

  if(!error)return {vectors:response!.vectors,fingerprint:embeddingFingerprint(model),dimensions:model.dimensions,
   providerId:model.providerId,modelId:model.id,fallbackUsed:index>0};
  lastError=error;
  if(!error.retryable||(error.code==='TIMEOUT'&&budget===remaining))throw error;
 }
 throw lastError;
}
