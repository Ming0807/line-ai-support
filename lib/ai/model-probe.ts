import {decryptValue} from '../security/identity';
import {AIProviderError,type AIErrorCode,type AIModelConfig,type AIProviderAdapter,type CostMode,type ProviderRequest,type ProviderResponse} from './types';
import type {EmbeddingAdapter,EmbeddingRequest,EmbeddingResponse} from './embedding-types';
import {authorizeModelCost} from './cost-policy';
import {createPriceReader,type ModelPricing,type PriceReader} from './pricing';
import type {ModelObservationView} from '../../types/provider-observations';
import {isModelCoolingDown} from './model-selection';
import {parseCompatibleBaseUrl} from './compatible-endpoint';
import {createCompatibleTransport,type CompatibleTransport} from './compatible-network';

const OPENROUTER_BASE='https://openrouter.ai/api/v1';
const ZEN_BASE='https://opencode.ai/zen/v1';
const OPENAI_BASE='https://api.openai.com/v1';
const MAX_TIMEOUT_MS=10_000;
const MAX_METADATA_BYTES=8*1024*1024;
const MAX_API_KEY_LENGTH=512;
const MAX_MODEL_ID_LENGTH=200;
const MAX_PRICE_AGE_MS=60_000;

type JsonRecord=Record<string,unknown>;
type ProbeResult=Pick<ModelObservationView,'result'|'errorCode'|'httpStatus'|'latencyMs'|'observedAt'|'retryEvidence'>;

export interface ModelProbeConfig extends AIModelConfig {
 purpose:'GENERATION'|'EMBEDDING';
 dimensions?:number;
}

export interface ProbeOptions {
 key:string;
 generationAdapters:Record<string,AIProviderAdapter>;
 embeddingAdapters:Record<string,EmbeddingAdapter>;
 priceReader?:PriceReader;
 fetchImpl?:typeof fetch;
 compatibleTransport?:CompatibleTransport;
}

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function isSignal(value:unknown):value is AbortSignal {
 return Boolean(value&&typeof value==='object'&&typeof (value as AbortSignal).aborted==='boolean'&&
  typeof (value as AbortSignal).addEventListener==='function'&&typeof (value as AbortSignal).removeEventListener==='function');
}

function signalCode(signal:AbortSignal):AIErrorCode {
 const reason=signal.reason;
 const name=reason&&typeof reason==='object'&&'name' in reason?String((reason as {name:unknown}).name):'';
 return name==='TimeoutError'?'TIMEOUT':'CANCELLED';
}

function safeErrorCode(error:unknown):AIErrorCode {
 if(error instanceof AIProviderError)return error.code;
 if(error&&typeof error==='object'&&'name' in error){
  const name=String((error as {name:unknown}).name);
  if(name==='TimeoutError')return 'TIMEOUT';
  if(name==='AbortError')return 'CANCELLED';
 }
 return 'PROVIDER_UNAVAILABLE';
}

function safeHttpStatus(error:unknown):number|null {
 if(!(error instanceof AIProviderError))return null;
 const status=error.httpStatus;
 return typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?status:null;
}

function codeForStatus(status:number):AIErrorCode {
 if(status===401||status===403)return 'AUTH_ERROR';
 if(status===408)return 'TIMEOUT';
 if(status===429)return 'RATE_LIMITED';
 if(status===404)return 'MODEL_UNAVAILABLE';
 if(status>=500)return 'SERVER_ERROR';
 if(status>=400)return 'INVALID_REQUEST';
 return 'PROVIDER_UNAVAILABLE';
}

function errorForStatus(status:number):AIProviderError {return new AIProviderError(codeForStatus(status),status);}

function observation(result:ProbeResult['result'],errorCode:ProbeResult['errorCode'],httpStatus:number|null,startedAt:number):ProbeResult {
 return {result,errorCode,httpStatus,latencyMs:Math.max(0,Date.now()-startedAt),observedAt:new Date().toISOString()};
}

function failure(error:unknown,startedAt:number,defaultStatus:number|null=null):ProbeResult {
 return {...observation('ERROR',safeErrorCode(error),safeHttpStatus(error)??defaultStatus,startedAt),
  ...(error instanceof AIProviderError&&error.retryEvidence?{retryEvidence:error.retryEvidence}:{})};
}

function blocked(errorCode:'PAID_BLOCKED'|'PRICE_UNKNOWN'|'CAPABILITY_UNSUPPORTED'|'COOLDOWN',startedAt:number):ProbeResult {
 return observation('BLOCKED',errorCode,null,startedAt);
}

function makeDeadline(timeoutMs:number,outer?:AbortSignal):{signal:AbortSignal;dispose:()=>void} {
 const controller=new AbortController();
 const abortFromOuter=()=>controller.abort(outer?.reason??new DOMException('','AbortError'));
 if(outer?.aborted)abortFromOuter();
 else outer?.addEventListener('abort',abortFromOuter,{once:true});
 const timer=controller.signal.aborted?undefined:setTimeout(()=>controller.abort(new DOMException('','TimeoutError')),timeoutMs);
 return {signal:controller.signal,dispose:()=>{
  if(timer!==undefined)clearTimeout(timer);
  outer?.removeEventListener('abort',abortFromOuter);
 }};
}

function raceSignal<T>(work:Promise<T>,signal:AbortSignal,onLateValue?:(value:T)=>void):Promise<T> {
 if(signal.aborted){
  void work.then((value)=>onLateValue?.(value),()=>undefined);
  return Promise.reject(new AIProviderError(signalCode(signal)));
 }
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>signal.removeEventListener('abort',onAbort);
  const onAbort=()=>{
   if(settled)return;
   settled=true;
   cleanup();
   reject(new AIProviderError(signalCode(signal)));
  };
  signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted){onAbort();return;}
  work.then((value)=>{
   if(settled){onLateValue?.(value);return;}
   if(signal.aborted){onLateValue?.(value);onAbort();return;}
   settled=true;cleanup();resolve(value);
  },(error:unknown)=>{
   if(settled)return;
   settled=true;cleanup();reject(error);
  });
 });
}

function cancelBody(response:Response):void {
 try{void response.body?.cancel().catch(()=>undefined);}catch{}
}

function cancelReader(reader:ReadableStreamDefaultReader<Uint8Array>):void {
 try{void reader.cancel().catch(()=>undefined);}catch{}
}

async function fetchMetadata(fetchImpl:typeof fetch,url:string,headers:HeadersInit,signal:AbortSignal):Promise<Response> {
 if(signal.aborted)throw new AIProviderError(signalCode(signal));
 const pending=Promise.resolve().then(()=>fetchImpl(url,{
  method:'GET',headers,redirect:'error',cache:'no-store',signal,
 })).then((response)=>{
  if(signal.aborted){cancelBody(response);throw new AIProviderError(signalCode(signal));}
  return response;
 });
 try{return await raceSignal(pending,signal,cancelBody);}
 catch(error){
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted)throw new AIProviderError(signalCode(signal));
  throw new AIProviderError(safeErrorCode(error));
 }
}

async function readWithSignal(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw new AIProviderError(signalCode(signal));
 const read=Promise.resolve().then(()=>reader.read());
 const cancel=()=>cancelReader(reader);
 signal.addEventListener('abort',cancel,{once:true});
 try{return await raceSignal(read,signal);}
 finally{signal.removeEventListener('abort',cancel);}
}

async function readMetadataBody(response:Response,signal:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();
 if(!reader)throw new AIProviderError('INVALID_OUTPUT',response.status);
 const chunks:Uint8Array[]=[];
 let total=0;
 const cancel=()=>cancelReader(reader);
 try{
  const contentLength=response.headers.get('content-length');
  if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>MAX_METADATA_BYTES)){
   cancel();throw new AIProviderError('INVALID_OUTPUT',response.status);
  }
  while(true){
   if(signal.aborted)throw new AIProviderError(signalCode(signal),response.status);
   const item=await readWithSignal(reader,signal);
   if(item.done)break;
   if(!(item.value instanceof Uint8Array)||(total+=item.value.byteLength)>MAX_METADATA_BYTES){
    cancel();throw new AIProviderError('INVALID_OUTPUT',response.status);
   }
   chunks.push(item.value);
  }
 }catch(error){
  cancel();
  if(error instanceof AIProviderError)throw new AIProviderError(error.code,response.status);
  if(signal.aborted)throw new AIProviderError(signalCode(signal),response.status);
  throw new AIProviderError(safeErrorCode(error),response.status);
 }finally{
  try{reader.releaseLock();}catch{}
 }
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw new AIProviderError('INVALID_OUTPUT',response.status);}
}

async function metadataPayload(response:Response,signal:AbortSignal):Promise<unknown> {
 if(response.status!==200){cancelBody(response);throw errorForStatus(response.status);}
 const text=await readMetadataBody(response,signal);
 try{return JSON.parse(text) as unknown;}
 catch{throw new AIProviderError('INVALID_OUTPUT',response.status);}
}

function modelIdPattern(adapter:string):RegExp {
 if(adapter==='COMPATIBLE')return /^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)?$/;
 if(adapter==='OPENROUTER')return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
 if(adapter==='ZEN')return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
 return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
}

function configProblem(config:unknown):'INVALID_REQUEST'|'CAPABILITY_UNSUPPORTED'|null {
 if(!isRecord(config)||typeof config.adapter!=='string'||typeof config.modelId!=='string'||
  typeof config.baseUrl!=='string'||typeof config.apiKeyEncrypted!=='string'||
  typeof config.timeoutMs!=='number'||!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<1||
  typeof config.purpose!=='string'||!['GENERATION','EMBEDDING'].includes(config.purpose))return 'INVALID_REQUEST';
 if(!['OPENROUTER','ZEN','OPENAI','COMPATIBLE'].includes(config.adapter))return 'CAPABILITY_UNSUPPORTED';
 if(config.modelId.length>MAX_MODEL_ID_LENGTH||!modelIdPattern(config.adapter).test(config.modelId))return 'INVALID_REQUEST';
 const expected=config.adapter==='OPENROUTER'?OPENROUTER_BASE:config.adapter==='ZEN'?ZEN_BASE:OPENAI_BASE;
 if(config.adapter==='COMPATIBLE'){try{parseCompatibleBaseUrl(config.baseUrl);}catch{return 'CAPABILITY_UNSUPPORTED';}}
 else if(config.baseUrl!==expected&&config.baseUrl!==`${expected}/`)return 'CAPABILITY_UNSUPPORTED';
 if(config.purpose==='EMBEDDING'&&config.adapter==='ZEN')return 'CAPABILITY_UNSUPPORTED';
 if(config.purpose==='EMBEDDING'&&(!Number.isSafeInteger(config.dimensions)||
  Number(config.dimensions)<1||Number(config.dimensions)>4096))return 'INVALID_REQUEST';
 if(config.purpose==='GENERATION'&&config.dimensions!==undefined)return 'INVALID_REQUEST';
 if(typeof config.supportsJson!=='boolean'||typeof config.supportsTools!=='boolean')return 'INVALID_REQUEST';
 return null;
}

function assertOptions(options:unknown):asserts options is ProbeOptions {
 if(!isRecord(options)||typeof options.key!=='string'||
  !isRecord(options.generationAdapters)||!isRecord(options.embeddingAdapters)||
  (options.priceReader!==undefined&&typeof options.priceReader!=='function')||
  (options.fetchImpl!==undefined&&typeof options.fetchImpl!=='function')||
  (options.compatibleTransport!==undefined&&(!isRecord(options.compatibleTransport)||typeof options.compatibleTransport.request!=='function')))throw new AIProviderError('INVALID_REQUEST');
}

function isFreshPricing(pricing:ModelPricing|null):boolean {
 if(!pricing||!['FREE','PAID','UNKNOWN'].includes(pricing.status)||
  !Number.isFinite(pricing.inputPricePerMillion)||!Number.isFinite(pricing.outputPricePerMillion)||
  typeof pricing.checkedAt!=='string')return false;
 const checked=Date.parse(pricing.checkedAt),age=Date.now()-checked;
 return Number.isFinite(checked)&&age>=-1000&&age<=MAX_PRICE_AGE_MS;
}

function unknownPricing():ModelPricing {
 return {status:'UNKNOWN',inputPricePerMillion:null,outputPricePerMillion:null,checkedAt:new Date().toISOString(),apiFormat:null};
}

function validatePricing(value:unknown):ModelPricing {
 if(!isRecord(value)||!['FREE','PAID','UNKNOWN'].includes(String(value.status))||
  (value.inputPricePerMillion!==null&&(typeof value.inputPricePerMillion!=='number'||!Number.isFinite(value.inputPricePerMillion)||value.inputPricePerMillion<0))||
  (value.outputPricePerMillion!==null&&(typeof value.outputPricePerMillion!=='number'||!Number.isFinite(value.outputPricePerMillion)||value.outputPricePerMillion<0))||
  typeof value.checkedAt!=='string'||(value.apiFormat!==null&&value.apiFormat!=='CHAT'&&value.apiFormat!=='RESPONSES'))return unknownPricing();
 return value as unknown as ModelPricing;
}

function decryptConfiguredApiKey(model:ModelProbeConfig,options:ProbeOptions):string {
 let apiKey:string;
 try{apiKey=decryptValue(model.apiKeyEncrypted,options.key);}
 catch{throw new AIProviderError('INVALID_REQUEST');}
 if(apiKey.length<1||apiKey.length>MAX_API_KEY_LENGTH||apiKey.trim()!==apiKey||/\s/.test(apiKey))
  throw new AIProviderError('INVALID_REQUEST');
 return apiKey;
}

async function authorizeFree(model:ModelProbeConfig,options:ProbeOptions,signal:AbortSignal):Promise<{
 permission:Awaited<ReturnType<typeof authorizeModelCost>>;pricing:ModelPricing|null;
}> {
 const read=options.priceReader??createPriceReader(options.fetchImpl?{fetchImpl:options.fetchImpl}:{});
 let observed:ModelPricing|null=null;
 const freshReader:PriceReader=async(query,readerSignal)=>{
  observed=validatePricing(await read(query,readerSignal));
  return observed;
 };
 const forcedFree={...model,costMode:'FREE_ONLY' as CostMode};
 const permission=await authorizeModelCost(forcedFree,model.purpose,freshReader,signal);
 return {permission,pricing:observed};
}

function validJsonProbeOutput(value:unknown):boolean {
 return isRecord(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'ok')&&value.ok===true;
}

function validProbeToolCall(value:ProviderResponse):boolean {
 if(value.output!==null||!Array.isArray(value.toolCalls)||value.toolCalls.length!==1)return false;
 const call=value.toolCalls[0];
 if(!isRecord(call)||call.name!=='probe_provider'||typeof call.id!=='string'||call.id.length<1||call.id.length>256||
  !isRecord(call.arguments))return false;
 return Object.keys(call.arguments).length===1&&Object.hasOwn(call.arguments,'marker')&&call.arguments.marker==='PROBE';
}

function requireHttp200(status:unknown):number {
 if(typeof status!=='number'||!Number.isInteger(status)||status<100||status>599)throw new AIProviderError('INVALID_OUTPUT');
 if(status!==200)throw errorForStatus(status);
 return status;
}

async function generationProbe(model:ModelProbeConfig,options:ProbeOptions,signal:AbortSignal,startedAt:number):Promise<ProbeResult> {
 if(model.purpose!=='GENERATION'||!model.supportsJson)return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 const adapter=options.generationAdapters[model.adapter];
 if(!adapter||typeof adapter.generate!=='function')return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 const {permission,pricing}=await authorizeFree(model,options,signal);
 if(!permission){
  const errorCode=isFreshPricing(pricing)&&pricing?.status==='PAID'?'PAID_BLOCKED':'PRICE_UNKNOWN';
  return blocked(errorCode,startedAt);
 }
 if(signal.aborted)throw new AIProviderError(signalCode(signal));
 const apiKey=decryptConfiguredApiKey(model,options);
 const request:ProviderRequest={
  modelId:model.modelId,baseUrl:model.baseUrl,apiKey,
  messages:[
   {role:'system',content:'Return exactly the JSON object {"ok":true}.'},
   {role:'user',content:'Return the required JSON object.'},
  ],
  responseSchema:{name:'provider_probe',schema:{type:'object',properties:{ok:{type:'boolean',const:true}},required:['ok'],additionalProperties:false}},
  signal,maxOutputTokens:32,
  ...(model.adapter==='ZEN'||model.adapter==='OPENROUTER'?{costMode:'FREE_ONLY' as const,
   ...(permission.apiFormat?{apiFormat:permission.apiFormat}:{})}:{}),
 };
 if(model.supportsTools)request.tools=[{name:'probe_provider',description:'Return the fixed provider probe marker.',parameters:{
  type:'object',properties:{marker:{type:'string',const:'PROBE'}},required:['marker'],additionalProperties:false,
 }}];
 let response:ProviderResponse;
 try{response=await adapter.generate(request);}
 catch(error){throw error instanceof AIProviderError?error:new AIProviderError(safeErrorCode(error),safeHttpStatus(error)??undefined);}
 if(!isRecord(response))throw new AIProviderError('INVALID_OUTPUT');
 requireHttp200(response?.httpStatus);
 const valid=model.supportsTools?validProbeToolCall(response):Array.isArray(response.toolCalls)&&response.toolCalls.length===0&&validJsonProbeOutput(response.output);
 if(!valid)throw new AIProviderError('INVALID_OUTPUT',200);
 return observation('SUCCESS',null,200,startedAt);
}

function validEmbedding(response:EmbeddingResponse,dimensions:number):boolean {
 return isRecord(response)&&Array.isArray(response.vectors)&&response.vectors.length===1&&
  Array.isArray(response.vectors[0])&&response.vectors[0].length===dimensions&&
  response.vectors[0].every((value)=>typeof value==='number'&&Number.isFinite(value))&&
  response.vectors[0].some((value)=>value!==0);
}

async function embeddingProbe(model:ModelProbeConfig,options:ProbeOptions,signal:AbortSignal,startedAt:number):Promise<ProbeResult> {
 if(model.purpose!=='EMBEDDING'||!Number.isSafeInteger(model.dimensions)||!model.dimensions)return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 const adapter=options.embeddingAdapters[model.adapter];
 if(!adapter||typeof adapter.embed!=='function')return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 const {permission,pricing}=await authorizeFree(model,options,signal);
 if(!permission){
  const errorCode=isFreshPricing(pricing)&&pricing?.status==='PAID'?'PAID_BLOCKED':'PRICE_UNKNOWN';
  return blocked(errorCode,startedAt);
 }
 if(signal.aborted)throw new AIProviderError(signalCode(signal));
 const apiKey=decryptConfiguredApiKey(model,options);
 let response:EmbeddingResponse;
 const request:EmbeddingRequest={modelId:model.modelId,baseUrl:model.baseUrl,apiKey,input:['YRU provider probe'],
  dimensions:model.dimensions,signal,...(model.adapter==='OPENROUTER'?{costMode:'FREE_ONLY' as const}:{})};
 try{response=await adapter.embed(request);}
 catch(error){throw error instanceof AIProviderError?error:new AIProviderError(safeErrorCode(error),safeHttpStatus(error)??undefined);}
 requireHttp200(response?.httpStatus);
 if(!validEmbedding(response,model.dimensions))throw new AIProviderError('INVALID_OUTPUT',200);
 return observation('SUCCESS',null,200,startedAt);
}

async function metadataProbe(model:ModelProbeConfig,options:ProbeOptions,signal:AbortSignal,onHttpStatus:(status:number)=>void):Promise<number> {
 if(model.adapter==='COMPATIBLE'){
  const response=await (options.compatibleTransport??createCompatibleTransport()).request(model.baseUrl,
   {route:'models',apiKey:decryptConfiguredApiKey(model,options),signal});
  onHttpStatus(response.status);if(response.status!==200)throw errorForStatus(response.status);
  const payload=response.json;
  if(!isRecord(payload)||!Array.isArray(payload.data)||payload.data.length>100_000)throw new AIProviderError('INVALID_OUTPUT',response.status);
  const matches=payload.data.filter(item=>isRecord(item)&&item.id===model.modelId);
  if(matches.length>1)throw new AIProviderError('INVALID_OUTPUT',response.status);
  if(matches.length!==1)throw new AIProviderError('MODEL_UNAVAILABLE',response.status);
  return response.status;
 }
 const fetchImpl=options.fetchImpl??fetch;
 let url:string;
 let headers:HeadersInit={accept:'application/json'};
 if(model.adapter==='OPENROUTER'){
  const base=OPENROUTER_BASE;
  url=`${base}/${model.purpose==='EMBEDDING'?'embeddings/':''}models`;
 }else if(model.adapter==='ZEN'){
  if(model.purpose!=='GENERATION')throw new AIProviderError('INVALID_REQUEST');
  url=`${ZEN_BASE}/models`;
 }else{
  const apiKey=decryptConfiguredApiKey(model,options);
  headers={accept:'application/json',authorization:`Bearer ${apiKey}`};
  url=`${OPENAI_BASE}/models/${encodeURIComponent(model.modelId)}`;
 }
 const response=await fetchMetadata(fetchImpl,url,headers,signal);
 onHttpStatus(response.status);
 const payload=await metadataPayload(response,signal);
 if(model.adapter==='OPENAI'){
  if(!isRecord(payload)||payload.object!=='model'||payload.id!==model.modelId)throw new AIProviderError('MODEL_UNAVAILABLE',response.status);
  return response.status;
 }
 if(!isRecord(payload)||!Array.isArray(payload.data)||payload.data.length>100_000)
  throw new AIProviderError('INVALID_OUTPUT',response.status);
 const matches=payload.data.filter((item)=>isRecord(item)&&item.id===model.modelId);
 if(matches.length>1)throw new AIProviderError('INVALID_OUTPUT',response.status);
 if(matches.length!==1)throw new AIProviderError('MODEL_UNAVAILABLE',response.status);
 return response.status;
}

/** Tests only the explicitly selected, immutable model snapshot; it never routes through fallback selection. */
export async function probeModel(
 config:ModelProbeConfig,
 action:'METADATA'|'GENERATION_TEST'|'EMBEDDING_TEST',
 options:ProbeOptions,
 outer?:AbortSignal,
):Promise<ProbeResult> {
 const startedAt=Date.now();
 let modelConfig:ModelProbeConfig;
 try{
  const problem=configProblem(config);
  if(problem==='INVALID_REQUEST')return failure(new AIProviderError('INVALID_REQUEST'),startedAt);
  if(problem==='CAPABILITY_UNSUPPORTED')return blocked('CAPABILITY_UNSUPPORTED',startedAt);
  assertOptions(options);
  if(outer!==undefined&&!isSignal(outer))return failure(new AIProviderError('INVALID_REQUEST'),startedAt);
  if(!['METADATA','GENERATION_TEST','EMBEDDING_TEST'].includes(action))return failure(new AIProviderError('INVALID_REQUEST'),startedAt);
  modelConfig=config;
 }catch(error){return failure(error,startedAt);}

 if((action==='GENERATION_TEST'&&modelConfig.purpose!=='GENERATION')||
  (action==='EMBEDDING_TEST'&&modelConfig.purpose!=='EMBEDDING'))return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 if(action==='GENERATION_TEST'&&!modelConfig.supportsJson)return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 if(action==='METADATA'&&modelConfig.adapter==='ZEN'&&modelConfig.purpose!=='GENERATION')return blocked('CAPABILITY_UNSUPPORTED',startedAt);
 if(action!=='METADATA'&&isModelCoolingDown(modelConfig))return blocked('COOLDOWN',startedAt);

 const deadline=makeDeadline(Math.min(modelConfig.timeoutMs,MAX_TIMEOUT_MS),outer);
 let observedHttpStatus:number|null=null;
 try{
  if(deadline.signal.aborted)throw new AIProviderError(signalCode(deadline.signal));
  const pending=Promise.resolve().then(async()=>{
   if(action==='METADATA')return await metadataProbe(modelConfig,options,deadline.signal,(status)=>{observedHttpStatus=status;});
   if(action==='GENERATION_TEST')return await generationProbe(modelConfig,options,deadline.signal,startedAt);
   return await embeddingProbe(modelConfig,options,deadline.signal,startedAt);
  });
  const value=await raceSignal(pending,deadline.signal);
  if(action==='METADATA')return observation('SUCCESS',null,value as number,startedAt);
  return value as ProbeResult;
 }catch(error){return failure(error,startedAt,observedHttpStatus);}
 finally{deadline.dispose();}
}

