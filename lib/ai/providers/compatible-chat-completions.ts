import {parseCompatibleBaseUrl} from '../compatible-endpoint';
import type {CompatibleTransport} from '../compatible-network';
import {AIProviderError,type AIProviderAdapter,type AITool,type ProviderApiFormat,type ProviderHealth,type ProviderRequest,type ProviderResponse} from '../types';
import {readRetryEvidence} from '../retry-evidence';

const MAX_REQUEST_BYTES=512*1024;
const MAX_RESPONSE_BYTES=256*1024;
const MAX_USAGE_TOKENS=100_000_000;
const MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]*)?$/;
const SCHEMA_NAME=/^[A-Za-z0-9_-]{1,64}$/;
const TOOL_NAME=/^[A-Za-z0-9_-]{1,64}$/;
const encoder=new TextEncoder();
type JsonRecord=Record<string,unknown>;
type CompatibleProviderRequest=ProviderRequest&{apiFormat?:ProviderApiFormat};

function isRecord(value:unknown):value is JsonRecord {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
}

function hasExactKeys(value:JsonRecord,required:string[],optional:string[]=[]):boolean {
 const allowed=new Set([...required,...optional]),keys=Object.keys(value);
 if(required.some(key=>!Object.hasOwn(value,key))||keys.some(key=>!allowed.has(key)))return false;
 return keys.every(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return Boolean(descriptor&&'value'in descriptor);});
}

function invalidRequest():AIProviderError{return new AIProviderError('INVALID_REQUEST');}
function invalidOutput(httpStatus?:number):AIProviderError{return new AIProviderError('INVALID_OUTPUT',httpStatus);}
function unavailable(httpStatus?:number):AIProviderError{return new AIProviderError('PROVIDER_UNAVAILABLE',httpStatus);}

function assertJsonValue(value:unknown,stack=new Set<object>(),depth=0,budget={nodes:0,bytes:0}):void {
 if(++budget.nodes>20_000||depth>40)throw invalidRequest();
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='string'){
  budget.bytes+=encoder.encode(value).byteLength;
  if(budget.bytes>MAX_REQUEST_BYTES)throw invalidRequest();
  return;
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw invalidRequest();
  return;
 }
 if(typeof value!=='object'||stack.has(value))throw invalidRequest();
 stack.add(value);
 if(Array.isArray(value)){
  if(value.length>10_000)throw invalidRequest();
  for(let index=0;index<value.length;index++){
   const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
   if(!descriptor||!('value'in descriptor))throw invalidRequest();
   assertJsonValue(descriptor.value,stack,depth+1,budget);
  }
 }else{
  if(!isRecord(value))throw invalidRequest();
  const keys=Object.keys(value);
  if(keys.length>10_000)throw invalidRequest();
  for(const key of keys){
   budget.bytes+=encoder.encode(key).byteLength;
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor||!('value'in descriptor))throw invalidRequest();
   assertJsonValue(descriptor.value,stack,depth+1,budget);
  }
 }
 stack.delete(value);
 if(budget.bytes>MAX_REQUEST_BYTES)throw invalidRequest();
}

function safeJson(value:unknown):string {
 try{
  assertJsonValue(value);
  const serialized=JSON.stringify(value);
  if(typeof serialized!=='string'||encoder.encode(serialized).byteLength>MAX_REQUEST_BYTES)throw invalidRequest();
  return serialized;
 }catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
}

function assertStrictSchema(value:unknown,isRoot=false):asserts value is JsonRecord {
 if(!isRecord(value))throw invalidRequest();
 if(isRoot&&value.type!=='object')throw invalidRequest();
 const type=value.type,objectType=type==='object'||(Array.isArray(type)&&type.includes('object'));
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

function validateSignal(value:unknown):asserts value is AbortSignal {
 if(!(value instanceof AbortSignal))throw invalidRequest();
}

function validateCommon(modelId:unknown,baseUrl:unknown,apiKey:unknown,signal:unknown):string {
 if(typeof modelId!=='string'||modelId.length>200||!MODEL_ID.test(modelId))throw invalidRequest();
 if(typeof apiKey!=='string'||apiKey.length<1||apiKey.length>512||!/^[\x21-\x7e]+$/.test(apiKey))throw invalidRequest();
 validateSignal(signal);
 try{return parseCompatibleBaseUrl(baseUrl).baseUrl;}
 catch{throw invalidRequest();}
}

function validateTools(value:unknown):asserts value is AITool[]|undefined {
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>8)throw invalidRequest();
 const names=new Set<string>();
 for(let index=0;index<value.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
  const tool=descriptor&&'value'in descriptor?descriptor.value:undefined;
  if(!isRecord(tool)||!hasExactKeys(tool,['name','description','parameters'])||typeof tool.name!=='string'||!TOOL_NAME.test(tool.name)||
   names.has(tool.name)||typeof tool.description!=='string'||tool.description.trim().length===0||tool.description.length>1024||
   !isRecord(tool.parameters))throw invalidRequest();
  names.add(tool.name);
  safeJson(tool.parameters);
  assertStrictSchema(tool.parameters,true);
 }
}

function makeBody(request:CompatibleProviderRequest):JsonRecord {
 const tools=request.tools??[];
 const body:JsonRecord={model:request.modelId,messages:request.messages,stream:false,
  response_format:{type:'json_schema',json_schema:{name:request.responseSchema.name,strict:true,schema:request.responseSchema.schema}}};
 if(request.maxOutputTokens!==undefined)body.max_tokens=request.maxOutputTokens;
 if(tools.length){
  body.tools=tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters,strict:true}}));
  body.tool_choice='auto';
 }
 return body;
}

function validateRequest(value:ProviderRequest):asserts value is CompatibleProviderRequest {
 if(!isRecord(value)||!hasExactKeys(value,['modelId','baseUrl','apiKey','messages','responseSchema','signal'],
  ['tools','maxOutputTokens','costMode','apiFormat']))throw invalidRequest();
 validateCommon(value.modelId,value.baseUrl,value.apiKey,value.signal);
 if(value.costMode!==undefined&&value.costMode!=='FREE_ONLY'&&value.costMode!=='ALLOW_PAID')throw invalidRequest();
 if(value.apiFormat!==undefined&&value.apiFormat!=='CHAT')throw invalidRequest();
 if(!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>100)throw invalidRequest();
 for(let index=0;index<value.messages.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value.messages,String(index));
  const message=descriptor&&'value'in descriptor?descriptor.value:undefined;
  if(!isRecord(message)||!hasExactKeys(message,['role','content'])||!['system','user','assistant'].includes(String(message.role))||
   typeof message.content!=='string'||message.content.length>200_000)throw invalidRequest();
 }
 if(!isRecord(value.responseSchema)||!hasExactKeys(value.responseSchema,['name','schema'])||typeof value.responseSchema.name!=='string'||
  !SCHEMA_NAME.test(value.responseSchema.name)||!isRecord(value.responseSchema.schema))throw invalidRequest();
 safeJson(value.responseSchema.schema);
 assertStrictSchema(value.responseSchema.schema,true);
 validateTools(value.tools);
 if(value.maxOutputTokens!==undefined&&(!Number.isSafeInteger(value.maxOutputTokens)||Number(value.maxOutputTokens)<1||Number(value.maxOutputTokens)>100_000))
  throw invalidRequest();
 safeJson(makeBody(value));
}

function retryEvidence(status:number,retryAfter:unknown) {
 if(typeof retryAfter!=='string'||retryAfter.length>1024)return undefined;
 try{return readRetryEvidence(status,new Headers({'Retry-After':retryAfter}));}catch{return undefined;}
}

function responseError(status:number,retryAfter:unknown):AIProviderError {
 if(status===401||status===403)return new AIProviderError('AUTH_ERROR',status);
 if(status===408)return new AIProviderError('TIMEOUT',status);
 if(status===429)return new AIProviderError('RATE_LIMITED',status,retryEvidence(status,retryAfter));
 if(status===404)return new AIProviderError('MODEL_UNAVAILABLE',status);
 if(status>=500&&status<=599)return new AIProviderError('SERVER_ERROR',status,retryEvidence(status,retryAfter));
 if(status>=400&&status<=499)return new AIProviderError('INVALID_REQUEST',status);
 return unavailable(status);
}

function preserveTransportError(error:unknown):AIProviderError {
 if(error instanceof AIProviderError)return new AIProviderError(error.code,error.httpStatus,error.retryEvidence);
 return unavailable();
}

function jsonContentType(value:unknown):boolean {
 if(typeof value!=='string'||value.length>256)return false;
 const mediaType=value.split(';',1)[0]!.trim().toLowerCase();
 return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(mediaType);
}

function assertBoundedOutput(value:unknown,depth=0,budget={nodes:0,bytes:0}):void {
 if(++budget.nodes>20_000||depth>40)throw invalidOutput();
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='string'){
  budget.bytes+=encoder.encode(value).byteLength;
  if(budget.bytes>MAX_RESPONSE_BYTES)throw invalidOutput();
  return;
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw invalidOutput();
  return;
 }
 if(typeof value!=='object')throw invalidOutput();
 if(Array.isArray(value)){
  if(value.length>10_000)throw invalidOutput();
  for(let index=0;index<value.length;index++){
   const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
   if(!descriptor||!('value'in descriptor))throw invalidOutput();
   assertBoundedOutput(descriptor.value,depth+1,budget);
  }
  return;
 }
 if(!isRecord(value))throw invalidOutput();
 for(const key of Object.keys(value)){
  budget.bytes+=encoder.encode(key).byteLength;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!('value'in descriptor))throw invalidOutput();
  assertBoundedOutput(descriptor.value,depth+1,budget);
 }
 if(budget.bytes>MAX_RESPONSE_BYTES)throw invalidOutput();
}

function parsedUsage(value:unknown,httpStatus:number):{inputTokens:number|null;outputTokens:number|null} {
 if(value===undefined||value===null)return {inputTokens:null,outputTokens:null};
 if(!isRecord(value))throw invalidOutput(httpStatus);
 const parse=(tokens:unknown):number|null=>{
  if(tokens===undefined||tokens===null)return null;
  if(typeof tokens!=='number'||!Number.isSafeInteger(tokens)||tokens<0||tokens>MAX_USAGE_TOKENS)throw invalidOutput(httpStatus);
  return tokens;
 };
 return {inputTokens:parse(value.prompt_tokens),outputTokens:parse(value.completion_tokens)};
}

function parseToolCalls(value:unknown,request:CompatibleProviderRequest,httpStatus:number):ProviderResponse['toolCalls'] {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length<1||value.length>8)throw invalidOutput(httpStatus);
 const allowed=new Set((request.tools??[]).map(tool=>tool.name)),ids=new Set<string>();
 return value.map(call=>{
  if(!isRecord(call)||!hasExactKeys(call,['id','type','function'])||call.type!=='function'||typeof call.id!=='string'||
   !/^[A-Za-z0-9_-]{1,200}$/.test(call.id)||ids.has(call.id)||!isRecord(call.function)||
   !hasExactKeys(call.function,['name','arguments'])||typeof call.function.name!=='string'||!allowed.has(call.function.name)||
   typeof call.function.arguments!=='string'||encoder.encode(call.function.arguments).byteLength>MAX_RESPONSE_BYTES)throw invalidOutput(httpStatus);
  let args:unknown;
  try{args=JSON.parse(call.function.arguments);}catch{throw invalidOutput(httpStatus);}
  if(!isRecord(args))throw invalidOutput(httpStatus);
  assertBoundedOutput(args);
  ids.add(call.id);
  return {id:call.id,name:call.function.name,arguments:args};
 });
}

function parseResponse(value:unknown,request:CompatibleProviderRequest,httpStatus:number):ProviderResponse {
 if(!isRecord(value)||!Array.isArray(value.choices)||value.choices.length!==1)throw invalidOutput(httpStatus);
 const choice=value.choices[0];
 if(!isRecord(choice)||choice.index!==0||!isRecord(choice.message)||choice.message.role!=='assistant')throw invalidOutput(httpStatus);
 if(choice.message.refusal!==undefined&&choice.message.refusal!==null&&choice.message.refusal!=='')throw invalidOutput(httpStatus);
 const calls=parseToolCalls(choice.message.tool_calls,request,httpStatus),finishReason=choice.finish_reason;
 if(finishReason==='tool_calls'){
  if(!calls.length||choice.message.content!==null)throw invalidOutput(httpStatus);
 }else if(finishReason==='stop'){
  if(calls.length)throw invalidOutput(httpStatus);
 }else throw invalidOutput(httpStatus);
 let output:unknown|null=null;
 const content=choice.message.content;
 if(content===null){if(!calls.length)throw invalidOutput(httpStatus);}
 else{
  if(typeof content!=='string'||content.length<1||encoder.encode(content).byteLength>MAX_RESPONSE_BYTES)throw invalidOutput(httpStatus);
  try{output=JSON.parse(content);}catch{throw invalidOutput(httpStatus);}
  if(!isRecord(output))throw invalidOutput(httpStatus);
  assertBoundedOutput(output);
 }
 return {...parsedUsage(value.usage,httpStatus),output,toolCalls:calls,httpStatus};
}

function parseStatus(value:unknown):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<100||value>599)throw unavailable();
 return value;
}

function validateHealthConfig(value:unknown):asserts value is Pick<ProviderRequest,'modelId'|'baseUrl'|'apiKey'|'signal'> {
 if(!isRecord(value)||!hasExactKeys(value,['modelId','baseUrl','apiKey','signal']))throw invalidRequest();
 validateCommon(value.modelId,value.baseUrl,value.apiKey,value.signal);
}

function healthErrorStatus(status:number):Exclude<ProviderHealth,'UNKNOWN'> {
 if(status===429)return 'RATE_LIMITED';
 if(status===400||status===404||status===422)return 'DEGRADED';
 return 'OFFLINE';
}

function modelIsAvailable(value:unknown,modelId:string):boolean {
 return isRecord(value)&&Array.isArray(value.data)&&value.data.some(model=>isRecord(model)&&model.id===modelId);
}

export function createCompatibleChatAdapter(options:{transport:CompatibleTransport}):AIProviderAdapter {
 const transport=options.transport;
 return {
  async generate(request):Promise<ProviderResponse>{
   try{validateRequest(request);}catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   const input=request as CompatibleProviderRequest;
   if(input.signal.aborted){
    const reason=input.signal.reason;
    throw new AIProviderError(reason instanceof DOMException&&reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED');
   }
   const baseUrl=parseCompatibleBaseUrl(input.baseUrl).baseUrl;
   const body=makeBody(input);
   try{
    const response=await transport.request(baseUrl,{route:'chat/completions',apiKey:input.apiKey,json:body,signal:input.signal});
    const status=parseStatus(response.status);
    if(status!==200)throw responseError(status,response.retryAfter);
    if(!jsonContentType(response.contentType))throw invalidOutput(status);
    return parseResponse(response.json,input,status);
   }catch(error){
    if(error instanceof AIProviderError)throw preserveTransportError(error);
    if(input.signal.aborted){
     const reason=input.signal.reason;
     throw new AIProviderError(reason instanceof DOMException&&reason.name==='TimeoutError'?'TIMEOUT':'CANCELLED');
    }
    throw unavailable();
   }
  },
  async healthCheck(config):Promise<Exclude<ProviderHealth,'UNKNOWN'>>{
   try{validateHealthConfig(config);}catch(error){if(error instanceof AIProviderError)throw error;throw invalidRequest();}
   if(config.signal.aborted)throw new AIProviderError('CANCELLED');
   const baseUrl=parseCompatibleBaseUrl(config.baseUrl).baseUrl;
   try{
    const response=await transport.request(baseUrl,{route:'models',apiKey:config.apiKey,signal:config.signal});
    const status=parseStatus(response.status);
    if(status!==200)return healthErrorStatus(status);
    if(!jsonContentType(response.contentType))return 'DEGRADED';
    return modelIsAvailable(response.json,config.modelId)?'HEALTHY':'DEGRADED';
   }catch(error){
    if(error instanceof AIProviderError&&error.code==='CANCELLED')throw preserveTransportError(error);
    if(config.signal.aborted)throw new AIProviderError('CANCELLED');
    return 'OFFLINE';
   }
  },
 };
}
