import {expect,it,vi} from 'vitest';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import type {AITool,ProviderRequest} from '../lib/ai/types';

type CostMode='FREE_ONLY'|'ALLOW_PAID';
type ChatRequest=ProviderRequest&{costMode?:CostMode;apiFormat?:'CHAT'|'RESPONSES'};

const responseSchema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};

function request(overrides:Partial<ChatRequest>={}):ChatRequest {
 return {
  modelId:'openai/gpt-test:free',baseUrl:'https://openrouter.ai/api/v1',apiKey:'test-key-never-log',
  messages:[{role:'system',content:'Return JSON.'},{role:'user',content:'Hello'}],
  responseSchema:{name:'answer',schema:responseSchema},signal:new AbortController().signal,maxOutputTokens:64,
  apiFormat:'CHAT',...overrides,
 };
}

function completion(content:string|null,options:{status?:string;finishReason?:string;toolCalls?:unknown[];refusal?:string}={}) {
 return {
  id:'chatcmpl-fixture',object:'chat.completion',model:'openai/gpt-test:free',
  choices:[{index:0,finish_reason:options.finishReason??'stop',message:{role:'assistant',content,
   ...(options.refusal===undefined?{}:{refusal:options.refusal}),...(options.toolCalls===undefined?{}:{tool_calls:options.toolCalls})}}],
  ...(options.status===undefined?{}:{status:options.status}),
  usage:{prompt_tokens:5,completion_tokens:3,total_tokens:8},
 };
}

function response(payload:unknown,status=200,headers:HeadersInit={}):Response {
 return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json',...Object.fromEntries(new Headers(headers))}});
}

it('sends OpenRouter strict JSON with backend-owned free price limits by default and captures upstream HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion('{"answer":"hello"}')));
 const input=request({costMode:undefined});
 delete (input as Partial<ChatRequest>).costMode;
 const result=await createChatCompletionsAdapter({fetchImpl}).generate(input);

 expect(fetchImpl).toHaveBeenCalledTimes(1);
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
 expect(init?.method).toBe('POST');
 expect(init?.redirect).toBe('error');
 expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key-never-log');
 expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
 expect(new Headers(init?.headers).get('x-api-key')).toBeNull();
 const body=JSON.parse(String(init?.body));
 expect(body).toMatchObject({
  model:'openai/gpt-test:free',stream:false,max_tokens:64,
  response_format:{type:'json_schema',json_schema:{name:'answer',strict:true,schema:responseSchema}},
  provider:{max_price:{prompt:0,completion:0},require_parameters:true},
 });
 expect(body.models).toBeUndefined();
 expect(body.plugins).toBeUndefined();
 expect(body.messages).toEqual([{role:'system',content:'Return JSON.'},{role:'user',content:'Hello'}]);
 expect(result).toEqual({output:{answer:'hello'},toolCalls:[],inputTokens:5,outputTokens:3,httpStatus:200});
});

it('does not send OpenRouter routing fields to the official Zen chat endpoint',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion('{"answer":"hello"}')));
 await createChatCompletionsAdapter({fetchImpl}).generate(request({
  baseUrl:'https://opencode.ai/zen/v1',modelId:'minimax-m3',costMode:'FREE_ONLY',
 }));

 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://opencode.ai/zen/v1/chat/completions');
 const body=JSON.parse(String(init?.body));
 expect(body.provider).toBeUndefined();
 expect(body.plugins).toBeUndefined();
 expect(body.models).toBeUndefined();
});

it('omits the zero price ceiling only for an explicitly trusted ALLOW_PAID runtime request',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion('{"answer":"hello"}')));
 await createChatCompletionsAdapter({fetchImpl}).generate(request({costMode:'ALLOW_PAID'}));

 const body=JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
 expect(body.provider).toEqual({require_parameters:true});
});

it('rejects a Responses request before contacting the chat endpoint',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({apiFormat:'RESPONSES'})))
  .rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
 ['wrong host','https://openrouter.ai.attacker.example/api/v1','openai/gpt-test:free'],
 ['trailing path','https://openrouter.ai/api/v1/extra','openai/gpt-test:free'],
 ['plain HTTP','http://openrouter.ai/api/v1','openai/gpt-test:free'],
 ['missing vendor slash','https://openrouter.ai/api/v1','gpt-test:free'],
 ['multiple slashes','https://openrouter.ai/api/v1','vendor/group/model'],
 ['empty model segment','https://openrouter.ai/api/v1','vendor/'],
 ['path traversal','https://openrouter.ai/api/v1','vendor/../models'],
 ['Zen slug with slash','https://opencode.ai/zen/v1','vendor/model'],
])('rejects an unsafe %s before contacting the provider',async(_name,baseUrl,modelId)=>{
 const fetchImpl=vi.fn<typeof fetch>();
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({baseUrl,modelId})))
  .rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a non-strict response schema before serializing the request',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({responseSchema:{name:'answer',schema:{
  type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:true,
 }}}))).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects cyclic schema input without contacting the provider',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const cyclic:Record<string,unknown>={type:'object',properties:{},required:[],additionalProperties:false};
 cyclic.self=cyclic;
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({responseSchema:{name:'answer',schema:cyclic}})))
  .rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('sends strict tools and parses only allowlisted function calls with JSON arguments',async()=>{
 const tool:AITool={name:'lookup_service',description:'Look up an approved service.',parameters:{
  type:'object',properties:{code:{type:'string'}},required:['code'],additionalProperties:false,
 }};
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion(null,{finishReason:'tool_calls',toolCalls:[{
  id:'call_123',type:'function',function:{name:'lookup_service',arguments:'{"code":"LIBRARY"}'},
 }]})));
 const result=await createChatCompletionsAdapter({fetchImpl}).generate(request({tools:[tool]}));

 const body=JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
 expect(body.tools).toEqual([{type:'function',function:{...tool,strict:true}}]);
 expect(body.tool_choice).toBe('auto');
 expect(result).toMatchObject({output:null,toolCalls:[{id:'call_123',name:'lookup_service',arguments:{code:'LIBRARY'}}]});
});

it('rejects mixed structured content and tool calls instead of returning two competing actions',async()=>{
 const tool:AITool={name:'lookup_service',description:'Look up an approved service.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }};
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion('{"answer":"also answer"}',{
  finishReason:'tool_calls',toolCalls:[{id:'call_123',type:'function',function:{name:'lookup_service',arguments:'{}'}}],
 })));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({tools:[tool]})))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});

it('rejects caller-supplied protected headers before any provider request',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const unsafeRequest={...request(),headers:{authorization:'Bearer attacker','content-type':'text/plain',host:'attacker.invalid'}};
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(unsafeRequest)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a tool call whose function name was not supplied by the backend',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion(null,{finishReason:'tool_calls',toolCalls:[{
  id:'call_123',type:'function',function:{name:'delete_records',arguments:'{}'},
 }]})));
 const tool:AITool={name:'lookup_service',description:'Look up an approved service.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }};
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request({tools:[tool]})))
  .rejects.toMatchObject({code:'INVALID_OUTPUT'});
});

it('rejects duplicate tool call identifiers and malformed argument JSON',async()=>{
 const tool:AITool={name:'lookup_service',description:'Look up an approved service.',parameters:{
  type:'object',properties:{},required:[],additionalProperties:false,
 }};
 const duplicateCalls=[
  {id:'call_same',type:'function',function:{name:'lookup_service',arguments:'{}'}},
  {id:'call_same',type:'function',function:{name:'lookup_service',arguments:'{}'}},
 ];
 const duplicateFetch=vi.fn<typeof fetch>().mockResolvedValue(response(completion(null,{finishReason:'tool_calls',toolCalls:duplicateCalls})));
 await expect(createChatCompletionsAdapter({fetchImpl:duplicateFetch}).generate(request({tools:[tool]})))
  .rejects.toMatchObject({code:'INVALID_OUTPUT'});

 const malformedFetch=vi.fn<typeof fetch>().mockResolvedValue(response(completion(null,{finishReason:'tool_calls',toolCalls:[{
  id:'call_valid',type:'function',function:{name:'lookup_service',arguments:'{bad json'},
 }]})));
 await expect(createChatCompletionsAdapter({fetchImpl:malformedFetch}).generate(request({tools:[tool]})))
  .rejects.toMatchObject({code:'INVALID_OUTPUT'});
});

it('rejects multiple choices instead of selecting an arbitrary assistant result',async()=>{
 const payload=completion('{"answer":"one"}');
 payload.choices.push({index:1,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"two"}'}});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(payload));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});

it('rejects prose around JSON rather than extracting a substring',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(completion('Answer: {"answer":"hello"}')));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});

it.each([
 ['explicit refusal',completion(null,{refusal:'I cannot help with that request.'})],
 ['length termination',completion('{"answer":"partial"}',{finishReason:'length'})],
 ['content filter termination',completion('{"answer":"blocked"}',{finishReason:'content_filter'})],
 ['missing assistant role',{...completion('{"answer":"hello"}'),choices:[{index:0,finish_reason:'stop',message:{role:'user',content:'{"answer":"hello"}'}}]}],
])('rejects %s as an application-level output failure',async(_name,payload)=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response(payload));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});

it.each([
 [400,'INVALID_REQUEST'],[401,'AUTH_ERROR'],[403,'AUTH_ERROR'],[404,'MODEL_UNAVAILABLE'],[429,'RATE_LIMITED'],[503,'SERVER_ERROR'],[302,'PROVIDER_UNAVAILABLE'],
] as const)('maps HTTP %i to a safe normalized provider error',async(status,code)=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('private body test-key-never-log',{status}));
 try{
  await createChatCompletionsAdapter({fetchImpl}).generate(request());
  throw new Error('expected provider error');
 }catch(error){
  expect(error).toMatchObject({code,httpStatus:status});
  expect((error as Error).message).toBe(code);
  expect((error as Error).message).not.toContain('test-key-never-log');
 }
 expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error');
});

it('does not expose transport errors or a key reflected in an upstream failure',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('transport included test-key-never-log'));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',httpStatus:undefined,message:'PROVIDER_UNAVAILABLE'});
});

it('aborts the bounded request when the caller cancels',async()=>{
 const controller=new AbortController();
 const fetchImpl=vi.fn<typeof fetch>((_input,init)=>new Promise((_resolve,reject)=>{
  init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
 }));
 const pending=createChatCompletionsAdapter({fetchImpl}).generate(request({signal:controller.signal}));
 await Promise.resolve();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 controller.abort();
 await expect(pending).rejects.toMatchObject({code:'CANCELLED',httpStatus:undefined});
 expect(fetchImpl.mock.calls[0]![1]?.signal?.aborted).toBe(true);
});

it('aborts a request that exceeds the adapter timeout',async()=>{
 vi.useFakeTimers();
 try{
  const fetchImpl=vi.fn<typeof fetch>((_input,init)=>new Promise((_resolve,reject)=>{
   init?.signal?.addEventListener('abort',()=>reject(new DOMException('timed out','AbortError')),{once:true});
  }));
  const pending=createChatCompletionsAdapter({fetchImpl}).generate(request());
  const assertion=expect(pending).rejects.toMatchObject({code:'TIMEOUT',httpStatus:undefined});
  await vi.advanceTimersByTimeAsync(10_001);
  await assertion;
  expect(fetchImpl.mock.calls[0]![1]?.signal?.aborted).toBe(true);
 }finally{vi.useRealTimers();}
});

it('rejects an oversized success body without retaining or parsing it',async()=>{
 const oversized=new Uint8Array(256*1024+1);
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
  start(controller){controller.enqueue(oversized);controller.close();},
 }),{status:200,headers:{'content-type':'application/json'}}));
 await expect(createChatCompletionsAdapter({fetchImpl}).generate(request())).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});

it('uses an authenticated metadata GET for health without performing inference',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response({data:{id:'openai/gpt-test:free'}}));
 const health=await createChatCompletionsAdapter({fetchImpl}).healthCheck({
  modelId:'openai/gpt-test:free',baseUrl:'https://openrouter.ai/api/v1',apiKey:'test-key-never-log',signal:new AbortController().signal,
 });
 expect(health).toBe('HEALTHY');
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://openrouter.ai/api/v1/model/openai/gpt-test%3Afree');
 expect(init?.method).toBe('GET');
 expect(init?.body).toBeUndefined();
 expect(init?.redirect).toBe('error');
 expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key-never-log');
});
