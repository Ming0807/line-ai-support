import {expect,it,vi} from 'vitest';
import {AIProviderError} from '../lib/ai/types';
import type {AITool,ProviderRequest} from '../lib/ai/types';
import type {CompatibleHttpResponse,CompatibleTransport} from '../lib/ai/compatible-network';
import {createCompatibleChatAdapter} from '../lib/ai/providers/compatible-chat-completions';

const BASE_URL='https://api.provider-support.com/v1';
const MODEL='org/model:free';
const KEY='fixture-key-never-log';
const schema={type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};

function request(overrides:Partial<ProviderRequest>={}):ProviderRequest {
 return {modelId:MODEL,baseUrl:BASE_URL,apiKey:KEY,messages:[{role:'system',content:'Return JSON.'},{role:'user',content:'Hello'}],
  responseSchema:{name:'answer',schema},signal:new AbortController().signal,costMode:'FREE_ONLY',apiFormat:'CHAT',...overrides};
}

function response(json:unknown,status=200,retryAfter:string|null=null,contentType:string|null='application/json'):CompatibleHttpResponse {
 return {status,retryAfter,contentType,json};
}

function transportFor(result:CompatibleHttpResponse):CompatibleTransport {
 return {request:vi.fn<CompatibleTransport['request']>().mockResolvedValue(result)};
}

function completion(content:string|null,options:{finishReason?:string;toolCalls?:unknown[];refusal?:unknown}={}):Record<string,unknown> {
 return {choices:[{index:0,finish_reason:options.finishReason??'stop',message:{role:'assistant',content,
  ...(options.toolCalls===undefined?{}:{tool_calls:options.toolCalls}),...(options.refusal===undefined?{}:{refusal:options.refusal})}}],
  usage:{prompt_tokens:5,completion_tokens:3}};
}

function bodyAt(transport:CompatibleTransport,index=0):Record<string,unknown> {
 const request=vi.mocked(transport.request).mock.calls[index]![1];
 if(!('json'in request))throw new Error('expected a JSON protocol request');
 return request.json as Record<string,unknown>;
}

const lookupTool:AITool={name:'lookup_service',description:'Look up an approved service.',parameters:{type:'object',
 properties:{code:{type:'string'}},required:['code'],additionalProperties:false}};

it('sends standard strict Chat Completions JSON without provider-specific routing or model remapping',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 const input=request();
 const result=await createCompatibleChatAdapter({transport}).generate(input);

 expect(transport.request).toHaveBeenCalledOnce();
 expect(transport.request).toHaveBeenCalledWith(BASE_URL,{route:'chat/completions',apiKey:KEY,signal:input.signal,json:expect.any(Object)});
 const body=bodyAt(transport);
 expect(body).toEqual({model:MODEL,messages:input.messages,stream:false,
  response_format:{type:'json_schema',json_schema:{name:'answer',strict:true,schema}}});
 expect(body).not.toHaveProperty('max_tokens');
 expect(body).not.toHaveProperty('provider');
 expect(body).not.toHaveProperty('models');
 expect(body).not.toHaveProperty('plugins');
 expect(body.model).toBe(MODEL);
 expect(result).toEqual({output:{answer:'hello'},toolCalls:[],inputTokens:5,outputTokens:3,httpStatus:200});
});

it('omits max_tokens when unset and includes it when requested',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 await createCompatibleChatAdapter({transport}).generate(request({maxOutputTokens:64}));
 const body=bodyAt(transport);
 expect(body.max_tokens).toBe(64);
});

it('preserves a single-segment model ID and sends the canonical configured base URL',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 await createCompatibleChatAdapter({transport}).generate(request({modelId:'model.chat-v1',baseUrl:'https://API.provider-support.com:443/v1/'}));
 expect(vi.mocked(transport.request).mock.calls[0]![0]).toBe(BASE_URL);
 expect(bodyAt(transport).model).toBe('model.chat-v1');
});

it('does not dispatch a request when the caller has already cancelled',async()=>{
 const controller=new AbortController();
 controller.abort();
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 await expect(createCompatibleChatAdapter({transport}).generate(request({signal:controller.signal})))
  .rejects.toMatchObject({code:'CANCELLED'});
 expect(transport.request).not.toHaveBeenCalled();
});

it('encodes strict tools and returns only allowlisted tool calls with object arguments',async()=>{
 const transport=transportFor(response(completion(null,{finishReason:'tool_calls',toolCalls:[{
  id:'call_123',type:'function',function:{name:'lookup_service',arguments:'{"code":"LIBRARY"}'},
 }]})));
 const result=await createCompatibleChatAdapter({transport}).generate(request({tools:[lookupTool]}));
 const body=bodyAt(transport);
 expect(body.tools).toEqual([{type:'function',function:{...lookupTool,strict:true}}]);
 expect(body.tool_choice).toBe('auto');
 expect(result).toMatchObject({output:null,toolCalls:[{id:'call_123',name:'lookup_service',arguments:{code:'LIBRARY'}}]});
});

it('rejects Responses format and invalid endpoint/model/key before transport',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 const adapter=createCompatibleChatAdapter({transport});
 const invalid=[
  request({apiFormat:'RESPONSES'}),
  request({baseUrl:'https://api.provider-support.com/v1/chat/completions'}),
  request({baseUrl:'http://api.provider-support.com/v1'}),
  request({modelId:'org/group/model'}),
  request({modelId:'org//model'}),
  request({modelId:'../model'}),
  request({modelId:'模型'}),
  request({apiKey:' fixture-key '}),
 ];
 for(const input of invalid)await expect(adapter.generate(input)).rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(transport.request).not.toHaveBeenCalled();
});

it.each([
 ['non-strict output schema',{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:true}],
 ['incomplete required list',{type:'object',properties:{answer:{type:'string'},extra:{type:'string'}},required:['answer'],additionalProperties:false}],
])('rejects a %s before transport',async(_name,badSchema)=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 await expect(createCompatibleChatAdapter({transport}).generate(request({responseSchema:{name:'answer',schema:badSchema}})))
  .rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(transport.request).not.toHaveBeenCalled();
});

it('rejects duplicate or malformed tool declarations before transport',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}')));
 await expect(createCompatibleChatAdapter({transport}).generate(request({tools:[lookupTool,lookupTool]})))
  .rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(transport.request).not.toHaveBeenCalled();
});

it.each([
 ['multiple choices',{choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"one"}'}},
  {index:1,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"two"}'}}]}],
 ['wrong choice index',{choices:[{index:1,finish_reason:'stop',message:{role:'assistant',content:'{"answer":"one"}'}}]}],
 ['non-assistant message',{choices:[{index:0,finish_reason:'stop',message:{role:'user',content:'{"answer":"one"}'}}]}],
 ['refusal',completion(null,{refusal:'I cannot comply.'})],
 ['non-JSON content',completion('answer: {"answer":"hello"}')],
 ['non-object JSON',completion('[1,2]')],
 ['mixed content and tool call',completion('{"answer":"hello"}',{finishReason:'tool_calls',toolCalls:[{
  id:'call_123',type:'function',function:{name:'lookup_service',arguments:'{}'},
 }]})],
 ['invalid usage', Object.assign(completion('{"answer":"hello"}'),{usage:{prompt_tokens:-1,completion_tokens:1}})],
] as const)('rejects %s with the received successful HTTP status',async(_name,payload)=>{
 const transport=transportFor(response(payload));
 await expect(createCompatibleChatAdapter({transport}).generate(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,message:'INVALID_OUTPUT'});
});

it('rejects malformed and untrusted tool calls',async()=>{
 const cases=[
  [{id:'call_1',type:'function',function:{name:'other_tool',arguments:'{}'}}],
  [{id:'call_same',type:'function',function:{name:'lookup_service',arguments:'{}'}},
   {id:'call_same',type:'function',function:{name:'lookup_service',arguments:'{}'}}],
  [{id:'call_1',type:'function',function:{name:'lookup_service',arguments:'{bad'}}],
  [{id:'call_1',type:'function',function:{name:'lookup_service',arguments:'[]'}}],
 ];
 for(const toolCalls of cases){
  const transport=transportFor(response(completion(null,{finishReason:'tool_calls',toolCalls})));
  await expect(createCompatibleChatAdapter({transport}).generate(request({tools:[lookupTool]})))
   .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
 }
});

it.each([
 [400,'INVALID_REQUEST'],[401,'AUTH_ERROR'],[403,'AUTH_ERROR'],[404,'MODEL_UNAVAILABLE'],[408,'TIMEOUT'],
 [429,'RATE_LIMITED'],[503,'SERVER_ERROR'],[302,'PROVIDER_UNAVAILABLE'],
] as const)('maps HTTP %i to a normalized safe error',async(status,code)=>{
 const transport=transportFor(response({private:'upstream body'},status,status===429||status===503?'60':null));
 try{
  await createCompatibleChatAdapter({transport}).generate(request());
  throw new Error('expected provider error');
 }catch(error){
  expect(error).toMatchObject({code,httpStatus:status,message:code});
  expect((error as Error).message).not.toContain(KEY);
  if(status===429||status===503){
   const evidence=(error as AIProviderError).retryEvidence;
   expect(evidence).toMatchObject({source:'RETRY_AFTER'});
   expect(Date.parse(evidence!.retryAt)-Date.parse(evidence!.observedAt)).toBe(60_000);
  }else expect((error as AIProviderError).retryEvidence).toBeUndefined();
 }
});

it('rejects a successful response with a non-JSON media type',async()=>{
 const transport=transportFor(response(completion('{"answer":"hello"}'),200,null,'text/plain'));
 await expect(createCompatibleChatAdapter({transport}).generate(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});

it('passes health checks through the metadata route and confirms the exact model without inference',async()=>{
 const transport=transportFor(response({data:[{id:'other/model'},{id:MODEL}]}));
 const input=request();
 const health=await createCompatibleChatAdapter({transport}).healthCheck({modelId:MODEL,baseUrl:BASE_URL,apiKey:KEY,signal:input.signal});
 expect(health).toBe('HEALTHY');
 expect(transport.request).toHaveBeenCalledWith(BASE_URL,{route:'models',apiKey:KEY,signal:input.signal});
});

it('maps metadata HTTP failures to truthful health states without inference',async()=>{
 const limited=transportFor(response(null,429,'15'));
 await expect(createCompatibleChatAdapter({transport:limited}).healthCheck({modelId:MODEL,baseUrl:BASE_URL,apiKey:KEY,signal:new AbortController().signal}))
  .resolves.toBe('RATE_LIMITED');
 const unavailable=transportFor(response(null,503));
 await expect(createCompatibleChatAdapter({transport:unavailable}).healthCheck({modelId:MODEL,baseUrl:BASE_URL,apiKey:KEY,signal:new AbortController().signal}))
  .resolves.toBe('OFFLINE');
});

it('maps transport errors without leaking their messages or key',async()=>{
 const transport:CompatibleTransport={request:vi.fn().mockRejectedValue(new TypeError(`transport included ${KEY}`))};
 await expect(createCompatibleChatAdapter({transport}).generate(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE',httpStatus:undefined});
});

it('does not persist a retry hint beyond the bounded 24-hour window',async()=>{
 const transport=transportFor(response(null,503,'86401'));
 await expect(createCompatibleChatAdapter({transport}).generate(request()))
  .rejects.toMatchObject({code:'SERVER_ERROR',httpStatus:503,retryEvidence:undefined});
});

it('preserves typed transport failures including their true HTTP status',async()=>{
 const transport:CompatibleTransport={request:vi.fn().mockRejectedValue(new AIProviderError('SERVER_ERROR',502))};
 await expect(createCompatibleChatAdapter({transport}).generate(request()))
  .rejects.toMatchObject({code:'SERVER_ERROR',httpStatus:502,message:'SERVER_ERROR'});
});
