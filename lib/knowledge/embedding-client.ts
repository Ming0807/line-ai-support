import {z} from 'zod';
import {AIProviderError} from '../ai/types';
import type {EmbedInput,EmbedResult} from '../ai/embedding-gateway';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_DIMENSION,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';

export interface EmbeddingCallOptions {signal?:AbortSignal;timeoutMs?:number}
export interface EmbeddingHealth {healthy:boolean;model:string;dimension:number;mode:'Local';observedAt:string;httpStatus:number|null}
export interface EmbeddingProvider {
 readonly modelId:string;readonly revision:string;readonly dimension:number;readonly fingerprint:string;
 embedQuery(text:string,options?:EmbeddingCallOptions):Promise<number[]>;
 embedPassages(texts:string[],options?:EmbeddingCallOptions):Promise<number[][]>;
 healthCheck(options?:EmbeddingCallOptions):Promise<EmbeddingHealth>;
}
export interface LocalEmbeddingConfig {model:string;revision:string;dimension:number;apiUrl:string;apiKey?:string}
export class EmbeddingServiceError extends Error {
 constructor(public readonly code:'EMBEDDING_CONFIG_INVALID'|'EMBEDDING_INPUT_INVALID'|'EMBEDDING_INVALID_RESPONSE'|'EMBEDDING_TIMEOUT'|'EMBEDDING_ABORTED'|'EMBEDDING_UNAVAILABLE'|'EMBEDDING_HTTP_ERROR',public readonly httpStatus:number|null=null){super(code);this.name='EmbeddingServiceError';}
}
const vectorSchema=z.array(z.number().finite()).length(384).refine(vector=>Math.abs(Math.hypot(...vector)-1)<=0.001);
const identity={model:z.literal(LOCAL_EMBEDDING_MODEL),revision:z.literal(LOCAL_EMBEDDING_REVISION),dimension:z.literal(384)};
const singleSchema=z.object({...identity,embedding:vectorSchema}).strict();
const batchSchema=z.object({...identity,embeddings:z.array(vectorSchema).min(1).max(16)}).strict();
const healthSchema=z.object({status:z.literal('ok'),model:z.literal(LOCAL_EMBEDDING_MODEL),revision:z.literal(LOCAL_EMBEDDING_REVISION),dimension:z.literal(384)}).strict();
const encoder=new TextEncoder();const MAX_RESPONSE_BYTES=256*1024;
const textSchema=z.string().min(1).refine(text=>text.trim().length>0&&encoder.encode(text).byteLength<=6000);

export function readLocalEmbeddingConfig():LocalEmbeddingConfig {
 return {model:process.env.EMBEDDING_MODEL??LOCAL_EMBEDDING_MODEL,revision:process.env.EMBEDDING_MODEL_REVISION??LOCAL_EMBEDDING_REVISION,
  dimension:Number(process.env.EMBEDDING_DIMENSION??LOCAL_EMBEDDING_DIMENSION),apiUrl:process.env.EMBEDDING_API_URL??'http://127.0.0.1:8000',apiKey:process.env.EMBEDDING_API_KEY||undefined};
}
function validateConfig(config:LocalEmbeddingConfig):LocalEmbeddingConfig {
 try{
  const url=new URL(config.apiUrl);const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(config.model!==LOCAL_EMBEDDING_MODEL||config.revision!==LOCAL_EMBEDDING_REVISION||config.dimension!==384||url.username||url.password||url.search||url.hash||
   (url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))||(!loopback&&!config.apiKey)||
   (config.apiKey!==undefined&&(config.apiKey.length<16||config.apiKey.length>512||/\s/.test(config.apiKey)))||config.apiUrl.length>2048)throw new Error();
  return {...config,apiUrl:url.toString().replace(/\/+$/,'')};
 }catch{throw new EmbeddingServiceError('EMBEDDING_CONFIG_INVALID');}
}
/** Server infrastructure; never import into a client component. */
export function createLocalE5EmbeddingProvider(options:{config?:LocalEmbeddingConfig;fetchImpl?:typeof fetch}={}):EmbeddingProvider {
 const config=validateConfig(options.config??readLocalEmbeddingConfig());const request=options.fetchImpl??fetch;
 async function call(route:string,body:unknown|undefined,callOptions:EmbeddingCallOptions={}):Promise<{json:unknown;status:number}> {
  const timeout=callOptions.timeoutMs??15_000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>45_000)throw new EmbeddingServiceError('EMBEDDING_INPUT_INVALID');
  if(callOptions.signal?.aborted)throw new EmbeddingServiceError('EMBEDDING_ABORTED');
  const controller=new AbortController();let error:EmbeddingServiceError|undefined;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let rejectAbort:(error:EmbeddingServiceError)=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const cancel=(code:'EMBEDDING_TIMEOUT'|'EMBEDDING_ABORTED')=>{error=new EmbeddingServiceError(code);controller.abort();rejectAbort(error);void reader?.cancel().catch(()=>{});};
  const abort=()=>cancel('EMBEDDING_ABORTED');callOptions.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>cancel('EMBEDDING_TIMEOUT'),timeout);
  try{
   return await Promise.race([cancelled,(async()=>{
    const response=await request(`${config.apiUrl}/${route}`,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal:controller.signal,
     headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(config.apiKey?{authorization:`Bearer ${config.apiKey}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!response.ok){await response.body?.cancel();throw new EmbeddingServiceError('EMBEDDING_HTTP_ERROR',response.status);}
    const length=response.headers.get('content-length');if(length&&(Number(length)>MAX_RESPONSE_BYTES||!/^\d+$/.test(length)))throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);
    if(!response.body)throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);
    reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
    while(true){const result=await reader.read();if(result.done)break;total+=result.value.byteLength;
     if(total>MAX_RESPONSE_BYTES){await reader.cancel();throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);}chunks.push(result.value);}
    const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    try{return {json:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),status:response.status};}catch{throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);}
   })()]);
  }catch(caught){if(error)throw error;if(caught instanceof EmbeddingServiceError)throw caught;throw new EmbeddingServiceError('EMBEDDING_UNAVAILABLE');}
  finally{clearTimeout(timer);callOptions.signal?.removeEventListener('abort',abort);controller.abort();}
 }
 return {modelId:config.model,revision:config.revision,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  async embedQuery(text,callOptions){
   if(!textSchema.safeParse(text).success)throw new EmbeddingServiceError('EMBEDDING_INPUT_INVALID');
   const response=await call('embed',{text,type:'query'},callOptions);const parsed=singleSchema.safeParse(response.json);
   if(!parsed.success)throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);return parsed.data.embedding;
  },
  async embedPassages(texts,callOptions){
   if(!z.array(textSchema).min(1).max(16).safeParse(texts).success)throw new EmbeddingServiceError('EMBEDDING_INPUT_INVALID');
   const response=await call('embed/batch',{texts,type:'passage'},callOptions);const parsed=batchSchema.safeParse(response.json);
   if(!parsed.success||parsed.data.embeddings.length!==texts.length)throw new EmbeddingServiceError('EMBEDDING_INVALID_RESPONSE',response.status);return parsed.data.embeddings;
  },
  async healthCheck(callOptions){
   let status:number|null=null,healthy=false;
   try{const response=await call('health',undefined,{timeoutMs:3000,...callOptions});status=response.status;healthy=healthSchema.safeParse(response.json).success;}
   catch(error){if(error instanceof EmbeddingServiceError)status=error.httpStatus;}
   return {healthy,model:config.model,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:status};
  },
 };
}
export async function embedLocalConfigured(input:EmbedInput,provider:EmbeddingProvider=createLocalE5EmbeddingProvider()):Promise<EmbedResult> {
 if(!input||!Array.isArray(input.input)||input.input.length<1||input.input.length>16||(input.fingerprint!==undefined&&input.fingerprint!==provider.fingerprint)||
  !['EMBEDDING_QUERY','EMBEDDING_DOCUMENT'].includes(input.requestType)||(input.requestType==='EMBEDDING_QUERY'&&input.input.length!==1))throw new AIProviderError('INVALID_REQUEST');
 try{
  const options={signal:input.signal,timeoutMs:input.timeoutMs};const vectors=input.requestType==='EMBEDDING_QUERY'?[await provider.embedQuery(input.input[0],options)]:await provider.embedPassages(input.input,options);
  return {vectors,dimensions:provider.dimension,fingerprint:provider.fingerprint,providerId:'LOCAL_E5',modelId:provider.modelId,fallbackUsed:false};
 }catch(error){throw new AIProviderError(error instanceof EmbeddingServiceError&&error.code==='EMBEDDING_TIMEOUT'?'TIMEOUT':error instanceof EmbeddingServiceError&&error.code==='EMBEDDING_INVALID_RESPONSE'?'INVALID_OUTPUT':'PROVIDER_UNAVAILABLE');}
}
