import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {AIMessage} from './types';

const baseMessage=z.object({role:z.enum(['system','user','assistant']),content:z.string().min(1).max(20000)}).strict();
const requestSchema=z.object({
 model:z.literal('yru-free-pilot'),
 messages:z.array(baseMessage).min(1).max(32),
 stream:z.literal(false).optional(),tools:z.array(z.never()).max(0).optional(),
 temperature:z.number().min(0).max(2).optional(),max_tokens:z.number().int().positive().max(16000).optional(),
 max_completion_tokens:z.number().int().positive().max(16000).optional(),
 reasoning_effort:z.enum(['none','minimal','low','medium','high','xhigh']).optional(),
}).strict();

/** Copilot mode accepts the agentic tool loop: one allowlisted read-only knowledge tool. */
const COPILOT_TOOL_NAME='search_yru_knowledge';
const MAX_COPILOT_TOOL_CALLS=4;
const MAX_TOOL_RESPONSE_BYTES=32*1024;
const toolCallIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const toolCallSchema=z.object({query:z.string().min(1).max(400).refine(query=>query.trim().length>0)}).strict();
function parseToolArguments(value:unknown):{query:string}|null{
 let candidate=value;
 if(typeof value==='string'){
  if(value.length>8000)return null;
  try{candidate=JSON.parse(value);}catch{return null;}
 }
 const parsed=toolCallSchema.safeParse(candidate);
 return parsed.success?parsed.data:null;
}
const copilotAssistantMessage=z.object({role:z.literal('assistant'),content:z.string().max(20000).nullable().optional(),
 tool_calls:z.array(z.object({id:toolCallIdSchema,type:z.literal('function'),
  function:z.object({name:z.literal(COPILOT_TOOL_NAME),arguments:z.string().max(8000)})}).strict()).min(1).max(MAX_COPILOT_TOOL_CALLS).optional()}).strict().superRefine((message,context)=>{
 const ids=new Set<string>();
 for(const [index,call] of (message.tool_calls??[]).entries()){
  if(ids.has(call.id))context.addIssue({code:'custom',path:['tool_calls',index,'id'],message:'INVALID_TOOL_CALL'});
  ids.add(call.id);
  if(!parseToolArguments(call.function.arguments))context.addIssue({code:'custom',path:['tool_calls',index,'function','arguments'],message:'INVALID_TOOL_CALL'});
 }
});
const copilotMessage=z.union([
 baseMessage,
 copilotAssistantMessage,
 z.object({role:z.literal('tool'),content:z.string().min(1).max(32*1024),
  tool_call_id:toolCallIdSchema.optional(),name:z.literal(COPILOT_TOOL_NAME).optional()}).strict(),
]);
const copilotRequestSchema=z.object({
 model:z.literal('yru-free-pilot'),
 messages:z.array(copilotMessage).min(1).max(48),
 stream:z.literal(false).optional(),
 // Hermes sends OpenAI-shaped tools with the JSON schema flattened into `function`
 // (properties/required/additionalProperties beside name/parameters) and no description.
 tools:z.array(z.object({
  type:z.literal('function'),
  function:z.looseObject({
   name:z.literal(COPILOT_TOOL_NAME),
   description:z.string().max(600).nullable().optional(),
   parameters:z.record(z.string(),z.unknown()).optional(),
  }),
 }).loose()).length(1).optional(),
 temperature:z.number().min(0).max(2).optional(),max_tokens:z.number().int().positive().max(16000).optional(),
 max_completion_tokens:z.number().int().positive().max(16000).optional(),
 reasoning_effort:z.enum(['none','minimal','low','medium','high','xhigh']).optional(),
}).strict();
const copilotReplySchema=z.union([
 z.object({content:z.string().min(1).max(20000).refine(content=>content.trim().length>0)}).strict(),
 z.object({toolCalls:z.array(z.object({id:toolCallIdSchema,name:z.literal(COPILOT_TOOL_NAME),arguments:z.unknown()}).strict()).min(1).max(MAX_COPILOT_TOOL_CALLS)}).strict(),
]);

type ValidCopilotReply={content:string}|{toolCalls:{id:string;arguments:{query:string}}[]};
function validateCopilotReply(value:unknown,remainingToolCalls:number):ValidCopilotReply|null{
 const parsed=copilotReplySchema.safeParse(value);
 if(!parsed.success)return null;
 if('content'in parsed.data)return {content:parsed.data.content};
 if(parsed.data.toolCalls.length>remainingToolCalls)return null;
 const ids=new Set<string>();
 const toolCalls:{id:string;arguments:{query:string}}[]=[];
 for(const call of parsed.data.toolCalls){
  const args=parseToolArguments(call.arguments);
  if(ids.has(call.id)||!args)return null;
  ids.add(call.id);
  toolCalls.push({id:call.id,arguments:args});
 }
 return {toolCalls};
}

export interface CopilotToolSupport{
 description:string;
 parameters:unknown;
 execute:(args:{query:string},signal:AbortSignal)=>Promise<unknown>;
 maxToolCalls?:number;
}
export type CopilotReply=({content:string}|{toolCalls:{id:string;name:string;arguments:unknown}[]});

function raceWithAbort<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 let onAbort:(()=>void)|undefined;
 const aborted=new Promise<never>((_resolve,reject)=>{
  onAbort=()=>reject(new Error('PILOT_ABORTED'));
  if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});
 });
 return Promise.race([work,aborted]).finally(()=>{if(onAbort)signal.removeEventListener('abort',onAbort);});
}

/** Synthetic local pilot only. No route is mounted in Next/LINE; no tool or model authority crosses this bridge. */
export async function startHermesPilotBridge(options:{token:string;maxRequests:number;timeoutMs?:number;reply:(messages:AIMessage[],signal:AbortSignal)=>Promise<string>;
 toolSupport?:CopilotToolSupport&{reply?:(messages:unknown[],tools:unknown,signal:AbortSignal)=>Promise<CopilotReply>}}){
 const timeout=options.timeoutMs??45000;
 const maxRequestsBound=options.toolSupport?8:4;
 const maxToolCalls=options.toolSupport?.maxToolCalls??6;
 const timeoutBound=options.toolSupport?90000:45000;
 if(options.token.length<32||!Number.isInteger(options.maxRequests)||options.maxRequests<1||options.maxRequests>maxRequestsBound||!Number.isInteger(timeout)||timeout<1||timeout>timeoutBound||
  (options.toolSupport&&(!Number.isSafeInteger(maxToolCalls)||maxToolCalls<1||maxToolCalls>6)))throw new Error('INVALID_PILOT_CONFIGURATION');
 let requests=0,toolCalls=0;
 const controllers=new Set<AbortController>();
 const copilot=options.toolSupport?.reply;
 const server=createServer(async(req,res)=>{
  const sendEncoded=(status:number,body:string)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);}};
  const send=(status:number,body:unknown)=>sendEncoded(status,JSON.stringify(body));
  const fail=(status:number,code:string)=>send(status,{error:{message:code,type:'pilot_error',code}});
  const expected=Buffer.from(`Bearer ${options.token}`),received=Buffer.from(req.headers.authorization??'');
  if(received.length!==expected.length||!timingSafeEqual(received,expected)){fail(401,'UNAUTHORIZED');req.resume();return;}
  if(options.toolSupport&&req.method==='POST'&&req.url==='/v1/tools/'+COPILOT_TOOL_NAME){
   const controller=new AbortController();controllers.add(controller);
   const timer=setTimeout(()=>controller.abort(),timeout);
   req.on('aborted',()=>controller.abort());
   res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   try{
    const chunks:Buffer[]=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){req.resume();fail(400,'UNSUPPORTED_REQUEST');return;}chunks.push(chunk);}
    let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'UNSUPPORTED_REQUEST');return;}
    const parsed=toolCallSchema.safeParse(body);if(!parsed.success){fail(400,'UNSUPPORTED_REQUEST');return;}
    if(toolCalls>=maxToolCalls){fail(429,'PILOT_BUDGET_EXHAUSTED');return;}
    toolCalls++;
    const result=await raceWithAbort(options.toolSupport.execute(parsed.data,controller.signal),controller.signal);
    if(controller.signal.aborted){fail(503,'GENERATION_UNAVAILABLE');return;}
    let encodedResult:string|undefined;
    try{
     const serialized=JSON.stringify(result);
     if(typeof serialized==='string')encodedResult=JSON.stringify({result:JSON.parse(serialized)});
    }catch{}
    if(!encodedResult||Buffer.byteLength(encodedResult,'utf8')>MAX_TOOL_RESPONSE_BYTES){fail(503,'GENERATION_UNAVAILABLE');return;}
    sendEncoded(200,encodedResult);
   }catch{fail(503,'GENERATION_UNAVAILABLE');}
   finally{clearTimeout(timer);controllers.delete(controller);}
   return;
  }
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){fail(404,'NOT_FOUND');req.resume();return;}
  const controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),timeout);
  req.on('aborted',()=>controller.abort());
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){req.resume();fail(options.toolSupport?400:413,options.toolSupport?'UNSUPPORTED_REQUEST':'BODY_TOO_LARGE');return;}chunks.push(chunk);}
   let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,options.toolSupport?'UNSUPPORTED_REQUEST':'INVALID_JSON');return;}
   const schema=options.toolSupport?copilotRequestSchema:requestSchema;
   const parsed=schema.safeParse(body);
   if(!parsed.success){fail(400,'UNSUPPORTED_REQUEST');return;}
   let serializedMessages:string;
   try{serializedMessages=JSON.stringify(parsed.data.messages);}catch{fail(400,'UNSUPPORTED_REQUEST');return;}
   if(Buffer.byteLength(serializedMessages,'utf8')>35000){fail(400,'UNSUPPORTED_REQUEST');return;}
   if(requests>=options.maxRequests){fail(429,'PILOT_BUDGET_EXHAUSTED');return;}
   requests++;
   if(copilot){
    const outcome=await raceWithAbort(copilot(parsed.data.messages,parsed.data.tools??null,controller.signal),controller.signal);
    if(controller.signal.aborted){fail(503,'GENERATION_UNAVAILABLE');return;}
    const validated=validateCopilotReply(outcome,maxToolCalls-toolCalls);
    if(!validated){fail(503,'GENERATION_UNAVAILABLE');return;}
    if('toolCalls'in validated){
     const outgoing=validated.toolCalls.map(call=>({id:call.id,type:'function' as const,function:{name:COPILOT_TOOL_NAME,arguments:JSON.stringify(call.arguments)}}));
     send(200,{id:`chatcmpl-${randomUUID()}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'yru-free-pilot',
      choices:[{index:0,message:{role:'assistant',content:null,tool_calls:outgoing},finish_reason:'tool_calls'}]});
     return;
    }
    send(200,{id:`chatcmpl-${randomUUID()}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'yru-free-pilot',
     choices:[{index:0,message:{role:'assistant',content:validated.content},finish_reason:'stop'}]});
    return;
   }
   const plain=parsed.data as z.infer<typeof requestSchema>;
   const answer=await raceWithAbort(options.reply(plain.messages as AIMessage[],controller.signal),controller.signal);
   if(controller.signal.aborted){fail(503,'GENERATION_UNAVAILABLE');return;}
   send(200,{id:`chatcmpl-${randomUUID()}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'yru-free-pilot',
    choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}]});
  }catch{fail(503,'GENERATION_UNAVAILABLE');}
  finally{clearTimeout(timer);controllers.delete(controller);}
 });
 server.requestTimeout=options.toolSupport?Math.max(45000,timeout):45000;server.headersTimeout=10000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('PILOT_LISTEN_FAILED');
 return {url:`http://127.0.0.1:${address.port}/v1`,toolUrl:options.toolSupport?`http://127.0.0.1:${address.port}/v1/tools/${COPILOT_TOOL_NAME}`:null,close:()=>new Promise<void>((resolve,reject)=>{
  for(const controller of controllers)controller.abort();server.close(error=>error?reject(error):resolve());server.closeAllConnections();
 })};
}
