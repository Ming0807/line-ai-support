import {expect,it,vi} from 'vitest';
import {AIProviderError} from '../lib/ai/types';
import type {EmbeddingRequest} from '../lib/ai/embedding-types';
import type {CompatibleHttpResponse,CompatibleTransport} from '../lib/ai/compatible-network';
import {createCompatibleEmbeddingAdapter} from '../lib/ai/providers/compatible-embeddings';

const BASE_URL='https://api.provider-support.com/v1';
const MODEL='org/embed-v2:free';
const KEY='fixture-key-never-log';

function request(overrides:Partial<EmbeddingRequest>={}):EmbeddingRequest {
 return {modelId:MODEL,baseUrl:BASE_URL,apiKey:KEY,input:['first chunk','second chunk'],dimensions:3,
  signal:new AbortController().signal,costMode:'FREE_ONLY',...overrides};
}

function response(json:unknown,status=200,retryAfter:string|null=null,contentType:string|null='application/json'):CompatibleHttpResponse {
 return {status,retryAfter,contentType,json};
}

function transportFor(result:CompatibleHttpResponse):CompatibleTransport {
 return {request:vi.fn<CompatibleTransport['request']>().mockResolvedValue(result)};
}

function bodyAt(transport:CompatibleTransport,index=0):Record<string,unknown> {
 const request=vi.mocked(transport.request).mock.calls[index]![1];
 if(!('json'in request))throw new Error('expected a JSON protocol request');
 return request.json as Record<string,unknown>;
}

function payload(model:string,data:Array<{index:number;embedding:number[]}>,usage?:unknown):unknown {
 return {object:'list',model,data:data.map(item=>({object:'embedding',...item})),...(usage===undefined?{}:{usage})};
}

it('sends standard float embeddings with explicit dimensions and restores vector order by index',async()=>{
 const input=request();
 const transport=transportFor(response(payload(input.modelId,[
  {index:1,embedding:[0,1,0]},{index:0,embedding:[1,0,0]},
 ],{prompt_tokens:7,total_tokens:9})));
 const result=await createCompatibleEmbeddingAdapter({transport}).embed(input);
 expect(transport.request).toHaveBeenCalledOnce();
 expect(transport.request).toHaveBeenCalledWith(BASE_URL,{route:'embeddings',apiKey:KEY,signal:input.signal,json:{
  model:MODEL,input:input.input,encoding_format:'float',dimensions:3,
 }});
 expect(result).toEqual({vectors:[[1,0,0],[0,1,0]],inputTokens:7,httpStatus:200});
 const body=bodyAt(transport);
 expect(body).not.toHaveProperty('provider');
 expect(body).not.toHaveProperty('max_price');
 expect(JSON.stringify(body)).not.toContain(KEY);
});

it('accepts one slash-qualified model ID and keeps the configured identity unchanged',async()=>{
 const input=request({modelId:'team/embed-model.v2:free',input:['only input'],dimensions:2});
 const transport=transportFor(response(payload(input.modelId,[{index:0,embedding:[0.25,1]}])));
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(input))
  .resolves.toEqual({vectors:[[0.25,1]],inputTokens:null,httpStatus:200});
 expect(bodyAt(transport)).toEqual({
  model:input.modelId,input:input.input,encoding_format:'float',dimensions:2,
 });
});

it('does not dispatch when the caller has already cancelled',async()=>{
 const controller=new AbortController();
 controller.abort();
 const transport=transportFor(response(null));
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request({signal:controller.signal})))
  .rejects.toMatchObject({code:'CANCELLED'});
 expect(transport.request).not.toHaveBeenCalled();
});

const invalidRequestCases:Array<[string,Partial<EmbeddingRequest>]>=[
 ['empty input list',{input:[]}],
 ['more than 16 input strings',{input:Array.from({length:17},(_,index)=>`item ${index}`)}],
 ['empty input string',{input:['']}],
 ['input above 6000 UTF-8 bytes',{input:['é'.repeat(3001)]}],
 ['zero dimensions',{dimensions:0}],
 ['dimensions above 4096',{dimensions:4097}],
 ['multiple slash segments',{modelId:'team/group/model'}],
 ['empty slash segment',{modelId:'team//model'}],
 ['path-like model ID',{modelId:'../model'}],
 ['non-ASCII model ID',{modelId:'模型'}],
 ['unsupported endpoint route',{baseUrl:'https://api.provider-support.com/v1/embeddings'}],
 ['whitespace API key',{apiKey:' key '}],
];

it.each(invalidRequestCases)('rejects %s before transport',async(_name,overrides)=>{
 const transport=transportFor(response(null));
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request(overrides)))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(transport.request).not.toHaveBeenCalled();
});

it('rejects a serialized request above 512 KiB before transport',async()=>{
 const transport=transportFor(response(null));
 const input=request({input:Array.from({length:16},()=> '\u0000'.repeat(6000))});
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(transport.request).not.toHaveBeenCalled();
});

it.each([
 ['non-list envelope',{object:'embedding'}],
 ['response model mismatch',payload('different/model',[{index:0,embedding:[1,0,0]},{index:1,embedding:[0,1,0]}])],
 ['wrong data count',payload(MODEL,[{index:0,embedding:[1,0,0]}])],
 ['duplicate indices',payload(MODEL,[{index:0,embedding:[1,0,0]},{index:0,embedding:[0,1,0]}])],
 ['out-of-range index',payload(MODEL,[{index:0,embedding:[1,0,0]},{index:2,embedding:[0,1,0]}])],
 ['wrong vector dimension',payload(MODEL,[{index:0,embedding:[1,0]},{index:1,embedding:[0,1,0]}])],
 ['zero vector',payload(MODEL,[{index:0,embedding:[0,0,0]},{index:1,embedding:[0,1,0]}])],
 ['non-finite vector',payload(MODEL,[{index:0,embedding:[1,Number.NaN,0]},{index:1,embedding:[0,1,0]}])],
 ['unsafe token usage',payload(MODEL,[{index:0,embedding:[1,0,0]},{index:1,embedding:[0,1,0]}],
  {prompt_tokens:300001,total_tokens:300001})],
] as const)('rejects %s while preserving HTTP 200',async(_name,json)=>{
 const transport=transportFor(response(json));
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200,message:'INVALID_OUTPUT'});
});

it('rejects malformed usage and a total below prompt tokens',async()=>{
 for(const usage of [{prompt_tokens:2,total_tokens:1},'unexpected']){
  const transport=transportFor(response(payload(MODEL,[{index:0,embedding:[1,0,0]},{index:1,embedding:[0,1,0]}],usage)));
  await expect(createCompatibleEmbeddingAdapter({transport}).embed(request()))
   .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
 }
});

it.each([
 [400,'INVALID_REQUEST'],[401,'AUTH_ERROR'],[403,'AUTH_ERROR'],[404,'MODEL_UNAVAILABLE'],[408,'TIMEOUT'],
 [429,'RATE_LIMITED'],[503,'SERVER_ERROR'],[302,'PROVIDER_UNAVAILABLE'],
] as const)('maps HTTP %i and retains only bounded retry evidence',async(status,code)=>{
 const transport=transportFor(response({private:'upstream body'},status,status===429||status===503?'30':null));
 try{
  await createCompatibleEmbeddingAdapter({transport}).embed(request());
  throw new Error('expected provider error');
 }catch(error){
  expect(error).toMatchObject({code,httpStatus:status,message:code});
  expect((error as Error).message).not.toContain(KEY);
  const retryEvidence=(error as AIProviderError).retryEvidence;
  if(status===429||status===503){
   expect(retryEvidence).toMatchObject({source:'RETRY_AFTER'});
   expect(Date.parse(retryEvidence!.retryAt)-Date.parse(retryEvidence!.observedAt)).toBe(30_000);
  }else expect(retryEvidence).toBeUndefined();
 }
});

it('rejects a successful response with a non-JSON media type',async()=>{
 const transport=transportFor(response(payload(MODEL,[{index:0,embedding:[1,0,0]},{index:1,embedding:[0,1,0]}]),200,null,'text/html'));
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});

it('maps transport errors without exposing an upstream message or credential',async()=>{
 const transport:CompatibleTransport={request:vi.fn().mockRejectedValue(new TypeError(`socket failure ${KEY}`))};
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',httpStatus:undefined,message:'PROVIDER_UNAVAILABLE'});
});

it('preserves a typed transport failure status',async()=>{
 const transport:CompatibleTransport={request:vi.fn().mockRejectedValue(new AIProviderError('SERVER_ERROR',502))};
 await expect(createCompatibleEmbeddingAdapter({transport}).embed(request()))
  .rejects.toMatchObject({code:'SERVER_ERROR',httpStatus:502,message:'SERVER_ERROR'});
});
