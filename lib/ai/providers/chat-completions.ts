import {AIProviderError,type AIProviderAdapter,type AITool,type CostMode,type ProviderApiFormat,type ProviderHealth,type ProviderRequest,type ProviderResponse} from '../types';
import {readRetryEvidence} from '../retry-evidence';

const OPENROUTER_BASE='https://openrouter.ai/api/v1';
const ZEN_BASE='https://opencode.ai/zen/v1';
const MAX_RESPONSE_BYTES=256*1024;
const MAX_REQUEST_BYTES=512*1024;
const REQUEST_TIMEOUT_MS=10_000;
const HEALTH_TIMEOUT_MS=5_000;
const OPENROUTER_MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ZEN_MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SCHEMA_NAME=/^[A-Za-z0-9_-]{1,64}$/;
const TOOL_NAME=/^[A-Za-z0-9_-]{1,64}$/;

type JsonRecord=Record<string,unknown>;
type ExtendedProviderRequest=ProviderRequest&{costMode?:CostMode;apiFormat?:ProviderApiFormat};
type ProviderKind='OPENROUTER'|'ZEN';
type RequestState={httpStatus?:number};

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasExactKeys(value:JsonRecord,required:string[],optional:string[]=[]):boolean {
 const allowed=new Set([...required,...optional]);
 return required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>allowed.has(key));
}

function invalidRequest():AIProviderError{return new AIProviderError('INVALID_REQUEST');}
function invalidOutput(httpStatus?:number):AIProviderError{return new AIProviderError('INVALID_OUTPUT',httpStatus);}
function unavailable(httpStatus?:number):AIProviderError{return new AIProviderError('PROVIDER_UNAVAILABLE',httpStatus);}

function assertJsonValue(value:unknown,stack=new Set<object>(),depth=0,budget={nodes:0,bytes:0}):void {
 budget.nodes++;
 if(budget.nodes>20_000||depth>40)throw invalidRequest();
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='string'){
  budget.bytes+=new TextEncoder().encode(value).byteLength;
  if(budget.bytes>MAX_REQUEST_BYTES)throw invalidRequest();
  return;
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw invalidRequest();
  return;
 }
 if(typeof value!=='object')throw invalidRequest();
 if(stack.has(value))throw invalidRequest();
 stack.add(value);
 if(Array.isArray(value)){
  if(value.length>10_000)throw invalidRequest();
  for(const item of value)assertJsonValue(item,stack,depth+1,budget);
 }else{
  if(!isRecord(value))throw invalidRequest();
  const entries=Object.entries(value);
  if(entries.length>10_000)throw invalidRequest();
  for(const [key,item] of entries){
   budget.bytes+=new TextEncoder().encode(key).byteLength;
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor||!('value'in descriptor))throw invalidRequest();
   assertJsonValue(item,stack,depth+1,budget);
  }
 }
 stack.delete(value);
 if(budget.bytes>MAX_REQUEST_BYTES)throw invalidRequest();
}

function safeJson(value:unknown):string {
 try{
  assertJsonValue(value);
  const text=JSON.stringify(value);
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>MAX_REQUEST_BYTES)throw invalidRequest();
  return text;
 }catch(error){
  if(error instanceof AIProviderError)throw error;
  throw invalidRequest();
 }
}

function assertStrictSchema(value:unknown,isRoot=false):asserts value is JsonRecord {
 if(!isRecord(value))throw invalidRequest();
 if(isRoot&&value.type!=='object')throw invalidRequest();
 const type=value.type;
 const objectType=type==='object'||(Array.isArray(type)&&type.includes('object'));
 if(objectType||Object.hasOwn(value,'properties')){
  if(!objectType||!isRecord(value.properties)||value.additionalProperties!==false||!Array.isArray(value.required))throw invalidRequest();
  const propertyNames=Object.keys(value.properties);
  if(value.required.length!==propertyNames.length||new Set(value.required).size!==propertyNames.length||
   value.required.some(key=>typeof key!=='string'||!propertyNames.includes(key)))throw invalidRequest();
  for(const schema of Object.values(value.properties))assertStrictSchema(schema);
 }
 if(Object.hasOwn(value,'items'))assertStrictSchema(value.items);
 for(const key of ['anyOf','oneOf','allOf'] as const){
  if(Object.hasOwn(value,key)){
   const choices=value[key];
   if(!Array.isArray(choices)||choices.length<1)throw invalidRequest();
   for(const schema of choices)assertStrictSchema(schema);
  }
 }
 for(const key of ['$defs','definitions'] as const){
  if(Object.hasOwn(value,key)){
   if(!isRecord(value[key]))throw invalidRequest();
   for(const schema of Object.values(value[key] as JsonRecord))assertStrictSchema(schema);
  }
 }
}

function providerFor(baseUrl:unknown):ProviderKind {
 if(baseUrl===OPENROUTER_BASE)return 'OPENROUTER';
 if(baseUrl===ZEN_BASE)return 'ZEN';
 throw invalidRequest();
}

function validateSignal(value:unknown):asserts value is AbortSignal {
 if(!value||typeof value!=='object'||typeof (value as AbortSignal).aborted!=='boolean'||
  typeof (value as AbortSignal).addEventListener!=='function'||typeof (value as AbortSignal).removeEventListener!=='function')throw invalidRequest();
}

function validateCredentials(value:unknown):asserts value is string {
 if(typeof value!=='string'||value.trim()!==value||value.length<1||value.length>512||/\s/.test(value))throw invalidRequest();
}

function validateModelId(kind:ProviderKind,value:unknown):asserts value is string {
 const pattern=kind==='OPENROUTER'?OPENROUTER_MODEL_ID:ZEN_MODEL_ID;
 if(typeof value!=='string'||!pattern.test(value))throw invalidRequest();
}

function validateTools(value:AITool[]|undefined):void {
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>8)throw invalidRequest();
 const names=new Set<string>();
 for(const tool of value){
  if(!isRecord(tool)||!hasExactKeys(tool,['name','description','parameters'])||typeof tool.name!=='string'||
   !TOOL_NAME.test(tool.name)||names.has(tool.name)||typeof tool.description!=='string'||tool.description.trim().length===0||
   tool.description.length>1024||!isRecord(tool.parameters))throw invalidRequest();
  names.add(tool.name);
  safeJson(tool.parameters);
  assertStrictSchema(tool.parameters,true);
 }
}

function validateRequest(value:ProviderRequest):asserts value is ExtendedProviderRequest {
 if(!isRecord(value)||!hasExactKeys(value,['modelId','baseUrl','apiKey','messages','responseSchema','signal'],
  ['tools','maxOutputTokens','costMode','apiFormat']))throw invalidRequest();
 const kind=providerFor(value.baseUrl);
 validateModelId(kind,value.modelId);
 validateCredentials(value.apiKey);
 validateSignal(value.signal);
 if(value.costMode!==undefined&&value.costMode!=='FREE_ONLY'&&value.costMode!=='ALLOW_PAID')throw invalidRequest();
 if(value.apiFormat!==undefined&&value.apiFormat!=='CHAT')throw invalidRequest();
 if(!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>100)throw invalidRequest();
 for(const message of value.messages){
  if(!isRecord(message)||!hasExactKeys(message,['role','content'])||!['system','user','assistant'].includes(String(message.role))||
   typeof message.content!=='string'||message.content.length>200_000)throw invalidRequest();
 }
 if(!isRecord(value.responseSchema)||!hasExactKeys(value.responseSchema,['name','schema'])||typeof value.responseSchema.name!=='string'||
  !SCHEMA_NAME.test(value.responseSchema.name)||!isRecord(value.responseSchema.schema))throw invalidRequest();
 safeJson(value.responseSchema.schema);
 assertStrictSchema(value.responseSchema.schema,true);
 validateTools(value.tools);
 if(value.maxOutputTokens!==undefined&&(!Number.isSafeInteger(value.maxOutputTokens)||value.maxOutputTokens<1||value.maxOutputTokens>100_000))throw invalidRequest();
 const body=makeBody(value,kind);
 safeJson(body);
}

function makeBody(request:ExtendedProviderRequest,kind:ProviderKind):JsonRecord {
 const tools=request.tools??[];
 const body:JsonRecord={model:request.modelId,messages:request.messages,stream:false,
  response_format:{type:'json_schema',json_schema:{name:request.responseSchema.name,strict:true,schema:request.responseSchema.schema}}};
 if(request.maxOutputTokens!==undefined)body.max_tokens=request.maxOutputTokens;
 if(tools.length){
  body.tools=tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters,strict:true}}));
  body.tool_choice='auto';
 }
 if(kind==='OPENROUTER'){
  body.provider={...(request.costMode??'FREE_ONLY')==='FREE_ONLY'?{max_price:{prompt:0,completion:0}}:{},require_parameters:true};
 }
 return body;
}

function errorForSignal(signal:AbortSignal,state:RequestState):AIProviderError {
 const reason=signal.reason;
 const reasonName=reason&&typeof reason==='object'&&'name'in reason?String((reason as {name:unknown}).name):'';
 return new AIProviderError(reasonName==='TimeoutError'?'TIMEOUT':'CANCELLED',state.httpStatus);
}

function responseError(status:number,headers:Headers):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status,readRetryEvidence(status,headers));
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500)return new AIProviderError('SERVER_ERROR',status,readRetryEvidence(status,headers));
 if(status>=400)return new AIProviderError('INVALID_REQUEST',status);
 return unavailable(status);
}

function isAbortError(error:unknown):boolean {
 return Boolean(error&&typeof error==='object'&&'name'in error&&['AbortError','TimeoutError'].includes(String((error as {name:unknown}).name)));
}

function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,outer:AbortSignal,milliseconds:number,state:RequestState):Promise<T> {
 if(outer.aborted)return Promise.reject(errorForSignal(outer,state));
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let onAbort=()=>{};
 const boundary=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>{controller.abort(outer.reason);reject(errorForSignal(outer,state));};
  outer.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{controller.abort(new DOMException('Request timed out','TimeoutError'));reject(new AIProviderError('TIMEOUT',state.httpStatus));},milliseconds);
 });
 const operation=Promise.resolve().then(()=>work(controller.signal));
 return Promise.race([operation,boundary]).finally(()=>{
  if(timer)clearTimeout(timer);
  outer.removeEventListener('abort',onAbort);
 });
}

async function cancelBody(response:Response):Promise<void> {
 await response.body?.cancel().catch(()=>undefined);
}

async function readBoundedBody(response:Response,signal:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();
 if(!reader)throw invalidOutput(response.status);
 const chunks:Uint8Array[]=[];
 let total=0;
 let cancelling=false;
 const cancel=()=>{
  if(cancelling)return;
  cancelling=true;
  try{void reader.cancel().catch(()=>undefined);}catch{}
 };
 let onAbort=()=>{};
 try{
  onAbort=cancel;
  signal.addEventListener('abort',onAbort,{once:true});
  const contentLength=response.headers.get('content-length');
  if(contentLength&&/^\d+$/.test(contentLength)&&Number(contentLength)>MAX_RESPONSE_BYTES){
   cancel();
   throw invalidOutput(response.status);
  }
  while(true){
   if(signal.aborted)throw errorForSignal(signal,{httpStatus:response.status});
   let item:ReadableStreamReadResult<Uint8Array>;
   try{item=await reader.read();}
   catch(error){
    if(signal.aborted)throw errorForSignal(signal,{httpStatus:response.status});
    if(isAbortError(error))throw new AIProviderError('TIMEOUT',response.status);
    throw unavailable(response.status);
   }
   if(item.done)break;
   total+=item.value.byteLength;
   if(total>MAX_RESPONSE_BYTES){cancel();throw invalidOutput(response.status);}
   chunks.push(item.value);
  }
 }catch(error){
  cancel();
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted)throw errorForSignal(signal,{httpStatus:response.status});
  throw unavailable(response.status);
 }finally{
  signal.removeEventListener('abort',onAbort);
  try{reader.releaseLock();}catch{}
 }
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw invalidOutput(response.status);}
}

async function fetchResponse(fetchImpl:typeof fetch,url:string,init:RequestInit,signal:AbortSignal):Promise<Response> {
 if(signal.aborted)throw new AIProviderError('CANCELLED');
 try{return await fetchImpl(url,init);}
 catch(error){
  if(signal.aborted)throw errorForSignal(signal,{});
  if(isAbortError(error))throw new AIProviderError('TIMEOUT');
  throw unavailable();
 }
}

function parsedUsage(value:unknown,httpStatus:number):{inputTokens:number|null;outputTokens:number|null} {
 if(value===undefined||value===null)return {inputTokens:null,outputTokens:null};
 if(!isRecord(value))throw invalidOutput(httpStatus);
 const parse=(item:unknown):number|null=>{
  if(item===undefined||item===null)return null;
  if(typeof item!=='number'||!Number.isSafeInteger(item)||item<0||item>100_000_000)throw invalidOutput(httpStatus);
  return item;
 };
 return {inputTokens:parse(value.prompt_tokens),outputTokens:parse(value.completion_tokens)};
}

function assertBoundedOutput(value:unknown,depth=0,budget={nodes:0}):void {
 budget.nodes++;
 if(budget.nodes>20_000||depth>40)throw invalidOutput();
 if(value===null||typeof value==='boolean'||typeof value==='string')return;
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw invalidOutput();
  return;
 }
 if(Array.isArray(value)){
  if(value.length>10_000)throw invalidOutput();
  for(const item of value)assertBoundedOutput(item,depth+1,budget);
  return;
 }
 if(!isRecord(value))throw invalidOutput();
 for(const item of Object.values(value))assertBoundedOutput(item,depth+1,budget);
}

function parseToolCalls(value:unknown,request:ExtendedProviderRequest,httpStatus:number):ProviderResponse['toolCalls'] {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length<1||value.length>8)throw invalidOutput(httpStatus);
 const allowed=new Set((request.tools??[]).map(tool=>tool.name));
 const ids=new Set<string>();
 return value.map(call=>{
  if(!isRecord(call)||!hasExactKeys(call,['id','type','function'])||call.type!=='function'||typeof call.id!=='string'||
   !/^[A-Za-z0-9_-]{1,200}$/.test(call.id)||ids.has(call.id)||!isRecord(call.function)||
   !hasExactKeys(call.function,['name','arguments'])||typeof call.function.name!=='string'||!allowed.has(call.function.name)||
   typeof call.function.arguments!=='string'||call.function.arguments.length>MAX_RESPONSE_BYTES)throw invalidOutput(httpStatus);
  let args:unknown;
  try{args=JSON.parse(call.function.arguments);}catch{throw invalidOutput(httpStatus);}
  if(!isRecord(args))throw invalidOutput(httpStatus);
  assertBoundedOutput(args);
  ids.add(call.id);
  return {id:call.id,name:call.function.name,arguments:args};
 });
}

function parseResponse(value:unknown,request:ExtendedProviderRequest,httpStatus:number):ProviderResponse&{httpStatus:number} {
 if(!isRecord(value)||!Array.isArray(value.choices)||value.choices.length!==1)throw invalidOutput(httpStatus);
 const choice=value.choices[0];
 if(!isRecord(choice)||choice.index!==0||!isRecord(choice.message)||choice.message.role!=='assistant')throw invalidOutput(httpStatus);
 if(choice.message.refusal!==undefined&&choice.message.refusal!==null&&choice.message.refusal!=='')throw invalidOutput(httpStatus);
 const calls=parseToolCalls(choice.message.tool_calls,request,httpStatus);
 const finishReason=choice.finish_reason;
 if(finishReason==='tool_calls'){
  if(!calls.length||choice.message.content!==null)throw invalidOutput(httpStatus);
 }else if(finishReason==='stop'){
  if(calls.length)throw invalidOutput(httpStatus);
 }else throw invalidOutput(httpStatus);
 const content=choice.message.content;
 let output:unknown|null=null;
 if(content===null){
  if(!calls.length)throw invalidOutput(httpStatus);
 }else{
  if(typeof content!=='string'||content.length<1||content.length>MAX_RESPONSE_BYTES)throw invalidOutput(httpStatus);
  try{output=JSON.parse(content);}catch{throw invalidOutput(httpStatus);}
  if(!isRecord(output))throw invalidOutput(httpStatus);
  assertBoundedOutput(output);
 }
 return {...parsedUsage(value.usage,httpStatus),output,toolCalls:calls,httpStatus};
}

function modelMetadataPath(kind:ProviderKind,baseUrl:string,modelId:string):string {
 if(kind==='ZEN')return `${baseUrl}/models`;
 const [author,slug]=modelId.split('/');
 return `${baseUrl}/model/${encodeURIComponent(author!)}/${encodeURIComponent(slug!)}`;
}

function modelIsAvailable(kind:ProviderKind,payload:unknown,modelId:string):boolean {
 if(kind==='OPENROUTER')return isRecord(payload)&&isRecord(payload.data)&&payload.data.id===modelId;
 if(!isRecord(payload)||!Array.isArray(payload.data))return false;
 return payload.data.some(model=>isRecord(model)&&model.id===modelId);
}

export function createChatCompletionsAdapter(options:{fetchImpl?:typeof fetch}={}):AIProviderAdapter {
 const fetchImpl=options.fetchImpl??fetch;
 return {
  async generate(request):Promise<ProviderResponse>{
   try{validateRequest(request);}catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   const input=request as ExtendedProviderRequest;
   const kind=providerFor(input.baseUrl);
   const body=safeJson(makeBody(input,kind));
   const state:RequestState={};
   return bounded(async signal=>{
    const response=await fetchResponse(fetchImpl,`${input.baseUrl}/chat/completions`,{
     method:'POST',headers:{authorization:`Bearer ${input.apiKey}`,'content-type':'application/json'},
     body,signal,redirect:'error',
    },signal);
    state.httpStatus=response.status;
    if(response.status!==200){const failure=responseError(response.status,response.headers);await cancelBody(response);throw failure;}
    let payload:unknown;
    try{payload=JSON.parse(await readBoundedBody(response,signal));}
    catch(error){
     if(error instanceof AIProviderError){
      if(error.httpStatus===undefined)throw new AIProviderError(error.code,response.status);
      throw error;
     }
     throw invalidOutput(response.status);
    }
    try{return parseResponse(payload,input,response.status);}
    catch(error){
     if(error instanceof AIProviderError){
      if(error.httpStatus===undefined)throw new AIProviderError(error.code,response.status);
      throw error;
     }
     throw invalidOutput(response.status);
    }
   },input.signal,REQUEST_TIMEOUT_MS,state);
  },
  async healthCheck(config):Promise<Exclude<ProviderHealth,'UNKNOWN'>>{
   if(!isRecord(config)||!hasExactKeys(config,['modelId','baseUrl','apiKey','signal']))throw invalidRequest();
   const kind=providerFor(config.baseUrl);
   validateModelId(kind,config.modelId);
   validateCredentials(config.apiKey);
   validateSignal(config.signal);
   const state:RequestState={};
   try{
    return await bounded(async signal=>{
     const response=await fetchResponse(fetchImpl,modelMetadataPath(kind,config.baseUrl,config.modelId),{
      method:'GET',headers:{authorization:`Bearer ${config.apiKey}`},signal,redirect:'error',
     },signal);
     state.httpStatus=response.status;
     if(response.status!==200){
      await cancelBody(response);
      if(response.status===429)return 'RATE_LIMITED';
      if(response.status===400||response.status===404||response.status===422)return 'DEGRADED';
      return 'OFFLINE';
     }
     try{
      const payload=JSON.parse(await readBoundedBody(response,signal));
      return modelIsAvailable(kind,payload,config.modelId)?'HEALTHY':'DEGRADED';
     }catch(error){
      if(error instanceof AIProviderError&&error.code==='CANCELLED')throw error;
      return 'DEGRADED';
     }
    },config.signal,HEALTH_TIMEOUT_MS,state);
   }catch(error){
    if(error instanceof AIProviderError&&error.code==='CANCELLED')throw error;
    return 'OFFLINE';
   }
  },
 };
}
