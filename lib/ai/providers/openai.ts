import {AIProviderError,type AIProviderAdapter,type AITool,type ProviderRequest,type ProviderResponse} from '../types';
import {createChatCompletionsAdapter} from './chat-completions';
import {readRetryEvidence} from '../retry-evidence';

const OPENAI_BASE='https://api.openai.com/v1';
const ZEN_BASE='https://opencode.ai/zen/v1';
const MAX_RESPONSE_BYTES=256*1024;
const MAX_REQUEST_BYTES=512*1024;
const MODEL_ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SCHEMA_NAME_PATTERN=/^[A-Za-z0-9_-]{1,64}$/;
const TOOL_NAME_PATTERN=/^[A-Za-z0-9_-]{1,64}$/;

type JsonRecord=Record<string,unknown>;

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasExactKeys(value:JsonRecord,required:string[],optional:string[]=[]):boolean {
 const allowed=new Set([...required,...optional]);
 const keys=Object.keys(value);
 return required.every(key=>Object.hasOwn(value,key))&&keys.every(key=>allowed.has(key));
}

function invalidRequest():AIProviderError {return new AIProviderError('INVALID_REQUEST');}
function invalidOutput():AIProviderError {return new AIProviderError('INVALID_OUTPUT');}
function unavailable():AIProviderError {return new AIProviderError('PROVIDER_UNAVAILABLE');}

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
   if(!descriptor||!('value' in descriptor))throw invalidRequest();
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
 const hasObjectType=type==='object'||(Array.isArray(type)&&type.includes('object'));
 if(hasObjectType||Object.hasOwn(value,'properties')){
  if(!hasObjectType||!isRecord(value.properties)||value.additionalProperties!==false||!Array.isArray(value.required))throw invalidRequest();
  const propertyNames=Object.keys(value.properties);
  if(value.required.length!==propertyNames.length||new Set(value.required).size!==propertyNames.length||
   value.required.some((key)=>typeof key!=='string'||!propertyNames.includes(key)))throw invalidRequest();
  for(const schema of Object.values(value.properties))assertStrictSchema(schema);
 }
 if(Object.hasOwn(value,'items'))assertStrictSchema(value.items);
 for(const key of ['anyOf','oneOf','allOf'] as const){
  if(Object.hasOwn(value,key)){
   if(!Array.isArray(value[key])||value[key].length<1)throw invalidRequest();
   for(const schema of value[key] as unknown[])assertStrictSchema(schema);
  }
 }
 for(const key of ['$defs','definitions'] as const){
  if(Object.hasOwn(value,key)){
   if(!isRecord(value[key]))throw invalidRequest();
   for(const schema of Object.values(value[key] as JsonRecord))assertStrictSchema(schema);
  }
 }
}

function validateSignal(signal:unknown):asserts signal is AbortSignal {
 if(!signal||typeof signal!=='object'||typeof (signal as AbortSignal).aborted!=='boolean'||
  typeof (signal as AbortSignal).addEventListener!=='function')throw invalidRequest();
}

function validateBaseUrl(baseUrl:unknown,expectedBase:string):asserts baseUrl is string {
 if(baseUrl!==expectedBase&&baseUrl!==`${expectedBase}/`)throw invalidRequest();
}

function validateCommon(modelId:unknown,baseUrl:unknown,apiKey:unknown,signal:unknown,expectedBase:string):asserts modelId is string {
 const pattern=expectedBase===ZEN_BASE?/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/:MODEL_ID_PATTERN;
 if(typeof modelId!=='string'||!pattern.test(modelId))throw invalidRequest();
 validateBaseUrl(baseUrl,expectedBase);
 if(typeof apiKey!=='string'||apiKey.length<1||apiKey.length>512||apiKey.trim()!==apiKey||/\s/.test(apiKey))throw invalidRequest();
 validateSignal(signal);
}

function validateTools(tools:AITool[]|undefined):void {
 if(tools===undefined)return;
 if(!Array.isArray(tools)||tools.length>128)throw invalidRequest();
 const names=new Set<string>();
 for(const tool of tools){
  if(!isRecord(tool)||!hasExactKeys(tool,['name','description','parameters'])||typeof tool.name!=='string'||!TOOL_NAME_PATTERN.test(tool.name)||names.has(tool.name)||
   typeof tool.description!=='string'||tool.description.trim().length===0||tool.description.length>1024||!isRecord(tool.parameters))throw invalidRequest();
  names.add(tool.name);
  safeJson(tool.parameters);
  assertStrictSchema(tool.parameters,true);
 }
}

function validateRequest(request:ProviderRequest,expectedBase:string):void {
 if(!isRecord(request)||!hasExactKeys(request,['modelId','baseUrl','apiKey','messages','responseSchema','signal'],
  ['tools','maxOutputTokens',...(expectedBase===ZEN_BASE?['costMode','apiFormat']:[])]))throw invalidRequest();
 if(expectedBase===ZEN_BASE&&(request.apiFormat!=='RESPONSES'||
  (request.costMode!==undefined&&request.costMode!=='FREE_ONLY'&&request.costMode!=='ALLOW_PAID')))throw invalidRequest();
 validateCommon(request.modelId,request.baseUrl,request.apiKey,request.signal,expectedBase);
 if(!Array.isArray(request.messages)||request.messages.length<1||request.messages.length>100)throw invalidRequest();
 for(const message of request.messages){
  if(!isRecord(message)||!hasExactKeys(message,['role','content'])||!['system','user','assistant'].includes(String(message.role))||
   typeof message.content!=='string'||message.content.length>200_000)throw invalidRequest();
 }
 if(!isRecord(request.responseSchema)||!hasExactKeys(request.responseSchema,['name','schema'])||typeof request.responseSchema.name!=='string'||
  !SCHEMA_NAME_PATTERN.test(request.responseSchema.name)||!isRecord(request.responseSchema.schema))throw invalidRequest();
 safeJson(request.responseSchema.schema);
 assertStrictSchema(request.responseSchema.schema,true);
 validateTools(request.tools);
 if(request.maxOutputTokens!==undefined&&(!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1||request.maxOutputTokens>100_000))throw invalidRequest();
 const body={model:request.modelId,input:request.messages,text:{format:{type:'json_schema',name:request.responseSchema.name,
  strict:true,schema:request.responseSchema.schema}},...(request.tools?{tools:request.tools}:{}),...(request.maxOutputTokens?{max_output_tokens:request.maxOutputTokens}:{})};
 safeJson(body);
}

function errorForSignal(signal:AbortSignal,error?:unknown):AIProviderError {
 const reason=signal.reason;
 const reasonName=reason&&typeof reason==='object'&&'name' in reason?String((reason as {name:unknown}).name):'';
 const errorName=error&&typeof error==='object'&&'name' in error?String((error as {name:unknown}).name):'';
 return new AIProviderError(reasonName==='TimeoutError'||errorName==='TimeoutError'?'TIMEOUT':'CANCELLED');
}

function responseError(status:number,headers:Headers):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status,readRetryEvidence(status,headers));
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500)return new AIProviderError('SERVER_ERROR',status,readRetryEvidence(status,headers));
 if(status>=400)return new AIProviderError('INVALID_REQUEST',status);
 return new AIProviderError('PROVIDER_UNAVAILABLE',status);
}

async function cancelBody(response:Response):Promise<void> {
 await response.body?.cancel().catch(()=>undefined);
}

async function readWithAbort(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal,cancel:()=>void):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw errorForSignal(signal);
 let onAbort=()=>{};
 const aborted=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>{cancel();reject(errorForSignal(signal));};
  signal.addEventListener('abort',onAbort,{once:true});
 });
 try{
  if(signal.aborted)onAbort();
  return await Promise.race([reader.read(),aborted]);
 }finally{
  signal.removeEventListener('abort',onAbort);
 }
}

async function readBoundedBody(response:Response,signal:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();
 if(!reader)throw invalidOutput();
 const chunks:Uint8Array[]=[];
 let total=0;
 let cancellationRequested=false;
 const cancel=()=>{
  if(cancellationRequested)return;
  cancellationRequested=true;
  try{void reader.cancel().catch(()=>undefined);}catch{}
 };
 try{
  const contentLength=response.headers.get('content-length');
  if(contentLength&&/^\d+$/.test(contentLength)&&Number(contentLength)>MAX_RESPONSE_BYTES){
   cancel();
   throw invalidOutput();
  }
  while(true){
   if(signal.aborted)throw errorForSignal(signal);
   const item=await readWithAbort(reader,signal,cancel);
   if(item.done)break;
   total+=item.value.byteLength;
   if(total>MAX_RESPONSE_BYTES){
    cancel();
    throw invalidOutput();
   }
   chunks.push(item.value);
  }
 }catch(error){
  cancel();
  if(error instanceof AIProviderError)throw error;
  if(signal.aborted||isAbortError(error))throw errorForSignal(signal,error);
  throw unavailable();
 }finally{
  try{reader.releaseLock();}catch{}
 }
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw invalidOutput();}
}

function isAbortError(error:unknown):boolean {
 return Boolean(error&&typeof error==='object'&&'name' in error&&
  ['AbortError','TimeoutError'].includes(String((error as {name:unknown}).name)));
}

async function fetchSafely(fetchImpl:typeof fetch,url:string,init:RequestInit,signal:AbortSignal):Promise<Response> {
 if(signal.aborted)throw errorForSignal(signal);
 try{return await fetchImpl(url,init);}
 catch(error){
  if(signal.aborted||isAbortError(error))throw errorForSignal(signal,error);
  throw unavailable();
 }
}

function parsedUsage(value:unknown):{inputTokens:number|null;outputTokens:number|null} {
 if(value===undefined||value===null)return {inputTokens:null,outputTokens:null};
 if(!isRecord(value))throw invalidOutput();
 const parse=(item:unknown):number|null=>{
  if(item===undefined||item===null)return null;
  if(typeof item!=='number'||!Number.isSafeInteger(item)||item<0)throw invalidOutput();
  return item;
 };
 return {inputTokens:parse(value.input_tokens),outputTokens:parse(value.output_tokens)};
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

function parseResponse(value:unknown,request:ProviderRequest):ProviderResponse {
 if(!isRecord(value)||value.status!=='completed'||!Array.isArray(value.output))throw invalidOutput();
 const toolNames=new Set(request.tools?.map(tool=>tool.name)??[]);
 const toolCalls:{id:string;name:string;arguments:unknown}[]=[];
 const ids=new Set<string>();
 const texts:string[]=[];
 for(const item of value.output){
  if(!isRecord(item)||typeof item.type!=='string')throw invalidOutput();
  if(item.type==='reasoning')continue;
  if(item.type==='message'){
   if(item.role!=='assistant'||!Array.isArray(item.content))throw invalidOutput();
   for(const part of item.content){
    if(!isRecord(part)||typeof part.type!=='string')throw invalidOutput();
    if(part.type==='refusal')throw invalidOutput();
    if(part.type==='output_text'){
     if(typeof part.text!=='string'||part.text.length===0||part.text.length>MAX_RESPONSE_BYTES)throw invalidOutput();
     texts.push(part.text);
    }else throw invalidOutput();
   }
   continue;
  }
  if(item.type==='function_call'){
   if(typeof item.name!=='string'||!toolNames.has(item.name)||typeof item.call_id!=='string'||
    item.call_id.length<1||item.call_id.length>256||ids.has(item.call_id)||typeof item.arguments!=='string'||
    item.arguments.length>MAX_RESPONSE_BYTES||(item.status!==undefined&&item.status!=='completed'))throw invalidOutput();
   let args:unknown;
   try{args=JSON.parse(item.arguments);}catch{throw invalidOutput();}
   if(!isRecord(args))throw invalidOutput();
   assertBoundedOutput(args);
   ids.add(item.call_id);
   toolCalls.push({id:item.call_id,name:item.name,arguments:args});
   continue;
  }
  throw invalidOutput();
 }
 if(texts.length>1||(!texts.length&&!toolCalls.length))throw invalidOutput();
 let output:unknown|null=null;
 if(texts.length===1){
  try{output=JSON.parse(texts[0]!);}catch{throw invalidOutput();}
  if(!isRecord(output))throw invalidOutput();
  assertBoundedOutput(output);
 }
 return {...parsedUsage(value.usage),output,toolCalls};
}

export function createOpenAIAdapter(options:{fetchImpl?:typeof fetch}={}):AIProviderAdapter {
 return createResponsesAdapter(OPENAI_BASE,options);
}

/** Separate immutable endpoint; native OpenAI validation is never broadened to Zen. */
export function createZenResponsesAdapter(options:{fetchImpl?:typeof fetch}={}):AIProviderAdapter {
 const responses=createResponsesAdapter(ZEN_BASE,options),chat=createChatCompletionsAdapter(options);
 return {...responses,healthCheck(config){
  if(config.baseUrl!==ZEN_BASE&&config.baseUrl!==`${ZEN_BASE}/`)return Promise.reject(invalidRequest());
  return chat.healthCheck(config);
 }};
}

function createResponsesAdapter(base:string,options:{fetchImpl?:typeof fetch}):AIProviderAdapter {
 const fetchImpl=options.fetchImpl??fetch;
 return {
  async generate(request):Promise<ProviderResponse>{
   try{validateRequest(request,base);}
   catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   const body:JsonRecord={model:request.modelId,input:request.messages,store:false,
    text:{format:{type:'json_schema',name:request.responseSchema.name,strict:true,schema:request.responseSchema.schema}}};
   if(request.tools)body.tools=request.tools.map((tool)=>({type:'function',name:tool.name,description:tool.description,
    parameters:tool.parameters,strict:true}));
   if(request.maxOutputTokens!==undefined)body.max_output_tokens=request.maxOutputTokens;
   const response=await fetchSafely(fetchImpl,`${base}/responses`,{
    method:'POST',headers:{authorization:`Bearer ${request.apiKey}`,'content-type':'application/json'},
    body:safeJson(body),signal:request.signal,redirect:'error',
   },request.signal);
   if(response.status!==200){const failure=responseError(response.status,response.headers);await cancelBody(response);throw failure;}
   try{
    const payload:unknown=JSON.parse(await readBoundedBody(response,request.signal));
    const parsed=parseResponse(payload,request);
    if(base===ZEN_BASE&&parsed.output!==null&&parsed.toolCalls.length)throw invalidOutput();
    return {...parsed,httpStatus:response.status};
   }catch(error){throw new AIProviderError(error instanceof AIProviderError?error.code:'INVALID_OUTPUT',response.status);}
  },
  async healthCheck(config):Promise<'HEALTHY'|'DEGRADED'|'RATE_LIMITED'|'OFFLINE'> {
   try{
    if(!isRecord(config)||!hasExactKeys(config,['modelId','baseUrl','apiKey','signal']))throw invalidRequest();
    validateCommon(config.modelId,config.baseUrl,config.apiKey,config.signal,base);
   }catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   let response:Response;
   try{
    response=await fetchSafely(fetchImpl,`${base}/models/${encodeURIComponent(config.modelId)}`,{
     method:'GET',headers:{authorization:`Bearer ${config.apiKey}`},signal:config.signal,redirect:'error',
    },config.signal);
   }catch(error){
    if(error instanceof AIProviderError&&['CANCELLED','TIMEOUT','INVALID_REQUEST'].includes(error.code))throw error;
    return 'OFFLINE';
   }
   if(response.status===200){await cancelBody(response);return 'HEALTHY';}
   await cancelBody(response);
   if(response.status===429)return 'RATE_LIMITED';
   if(response.status===404||response.status===400)return 'DEGRADED';
   if(response.status===401||response.status===403||response.status>=500||response.status<200||response.status>=300)return 'OFFLINE';
   return 'DEGRADED';
  },
 };
}
