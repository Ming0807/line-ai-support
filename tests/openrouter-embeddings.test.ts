import {expect,it,vi} from 'vitest';
import {createOpenRouterEmbeddingAdapter} from '../lib/ai/providers/openrouter-embeddings';
import type {EmbeddingRequest} from '../lib/ai/embedding-types';

const BASE_URL='https://openrouter.ai/api/v1';
const MODEL='openai/text-embedding-3-small';

function request(overrides:Partial<EmbeddingRequest>={}):EmbeddingRequest {
 return {
  modelId:MODEL,baseUrl:BASE_URL,apiKey:'test-key-never-log',costMode:'FREE_ONLY',
  input:['first chunk','second chunk'],dimensions:3,signal:new AbortController().signal,...overrides,
 };
}

function payload(modelId:string,data:Array<{index:number;embedding:number[]}>,usage?:unknown):unknown {
 return {object:'list',model:modelId,data:data.map((item)=>({object:'embedding',...item})),
  ...(usage===undefined?{}:{usage})};
}

function fetchFor(value:unknown,status=200):typeof fetch {
 return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value),{status}));
}

function fetchForRawBody(body:string):typeof fetch {
 return vi.fn<typeof fetch>().mockResolvedValue(new Response(body,{status:200}));
}

function validData():Array<{index:number;embedding:number[]}> {
 return [{index:0,embedding:[1,0,0]},{index:1,embedding:[0,1,0]}];
}

it('posts bounded float embeddings to the fixed endpoint and restores vectors by input index',async()=>{
 const input=request();
 const fetchImpl=fetchFor(payload(input.modelId,[
  {index:1,embedding:[0,1,0]},{index:0,embedding:[1,0,0]},
 ],{prompt_tokens:7,total_tokens:9}));

 const result=await createOpenRouterEmbeddingAdapter({fetchImpl}).embed(input);

 expect(fetchImpl).toHaveBeenCalledOnce();
 const [url,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(url).toBe(`${BASE_URL}/embeddings`);
 expect(init?.method).toBe('POST');
 expect(init?.redirect).toBe('error');
 expect(init?.signal).toBe(input.signal);
 const headers=new Headers(init?.headers);
 expect(headers.get('authorization')).toBe('Bearer test-key-never-log');
 expect(headers.get('content-type')).toBe('application/json');
 const body=JSON.parse(String(init?.body));
 expect(body).toEqual({model:input.modelId,input:input.input,dimensions:3,encoding_format:'float'});
 expect(JSON.stringify(body)).not.toContain(input.apiKey);
 expect(body).not.toHaveProperty('provider');
 expect(body).not.toHaveProperty('max_price');
 expect(result).toEqual({vectors:[[1,0,0],[0,1,0]],inputTokens:7,httpStatus:200});
});

it('accepts a future slash-qualified model slug and an explicit dimension without guessing either',async()=>{
 const input=request({modelId:'organization/new-embedding-model:free',input:['one chunk'],dimensions:5});
 const vector=[1,0,0,0,0];
 const fetchImpl=fetchFor(payload(input.modelId,[{index:0,embedding:vector}]));

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(input))
  .resolves.toEqual({vectors:[vector],inputTokens:null,httpStatus:200});
 const [,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(JSON.parse(String(init?.body))).toEqual({
  model:input.modelId,input:input.input,dimensions:5,encoding_format:'float',
 });
});

const invalidRequestCases:Array<[string,Partial<EmbeddingRequest>]>=[
 ['an empty batch',{input:[]}],
 ['more than 16 inputs',{input:Array.from({length:17},(_,index)=>`chunk ${index}`)}],
 ['an empty input',{input:['']}],
 ['an input above 6000 UTF-8 bytes',{input:['é'.repeat(3001)]}],
 ['zero dimensions',{dimensions:0}],
 ['dimensions above 4096',{dimensions:4097}],
 ['an unsupported cost mode',{costMode:'UNRECOGNIZED' as EmbeddingRequest['costMode']}],
 ['an unsupported base URL',{baseUrl:'https://attacker.invalid/api/v1'}],
 ['a whitespace-padded key',{apiKey:' key-with-spaces '}],
 ['an invalid slash-qualified model ID',{modelId:'../model'}],
 ['a model ID with an empty path segment',{modelId:'organization//model'}],
 ['a model ID with a trailing slash',{modelId:'organization/model/'}],
];

it.each(invalidRequestCases)('rejects %s before HTTP',async(_label,overrides)=>{
 const fetchImpl=vi.fn<typeof fetch>();

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request(overrides)))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a serialized request above 512 KiB before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const input=request({input:Array.from({length:16},()=> '\u0000'.repeat(6000))});

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(input))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
 ['a non-list envelope',{object:'embedding'}],
 ['a different response model',payload('other/model',validData(),{prompt_tokens:2,total_tokens:2})],
 ['a missing vector',payload(MODEL,validData().slice(0,1),{prompt_tokens:2,total_tokens:2})],
 ['duplicate indices',payload(MODEL,[
  {index:0,embedding:[1,0,0]},{index:0,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['an index outside the input range',payload(MODEL,[
  {index:0,embedding:[1,0,0]},{index:2,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['a vector with the wrong dimensions',payload(MODEL,[
  {index:0,embedding:[1,0]},{index:1,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['a zero vector',payload(MODEL,[
  {index:0,embedding:[0,0,0]},{index:1,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['usage above the documented bound',payload(MODEL,validData(),
  {prompt_tokens:300001,total_tokens:300001})],
] as const)('rejects %s with fixed INVALID_OUTPUT',async(_label,response)=>{
 await expect(createOpenRouterEmbeddingAdapter({fetchImpl:fetchFor(response)}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT',httpStatus:200});
});

it('rejects parsed non-finite vector values',async()=>{
 const fetchImpl=fetchForRawBody('{"object":"list","model":"openai/text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[1e999,0,0]},{"object":"embedding","index":1,"embedding":[0,1,0]}]}');

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT',httpStatus:200});
});

it('rejects malformed JSON with a fixed error',async()=>{
 const fetchImpl=fetchForRawBody('{private response body');

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT',httpStatus:200});
});

const httpErrorCases:Array<[number,string,boolean]>=[
 [400,'INVALID_REQUEST',false],[401,'AUTH_ERROR',false],[402,'INVALID_REQUEST',false],
 [403,'AUTH_ERROR',false],[408,'TIMEOUT',true],
 [404,'MODEL_UNAVAILABLE',true],[429,'RATE_LIMITED',true],[500,'SERVER_ERROR',true],[503,'SERVER_ERROR',true],
];

it.each(httpErrorCases)('maps HTTP %i to %s without reading or exposing its body',async(status,code,retryable)=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('private provider response and secret detail'));},
  cancel(){cancelled=true;},
 }),{status});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code,message:code,httpStatus:status,retryable});
 expect(cancelled).toBe(true);
 const [,init]=fetchImpl.mock.calls[0]!;
 expect(init?.redirect).toBe('error');
});

it('normalizes transport failures to a fixed provider-unavailable error',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private host, key and response details'));

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({httpStatus:undefined});
 const [,init]=fetchImpl.mock.calls[0]!;
 expect(init?.redirect).toBe('error');
});

it('classifies a timeout abort without inventing an HTTP status',async()=>{
 const controller=new AbortController();
 controller.abort(new DOMException('deadline detail','TimeoutError'));
 const fetchImpl=vi.fn<typeof fetch>();

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request({signal:controller.signal})))
  .rejects.toMatchObject({code:'TIMEOUT',message:'TIMEOUT'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a redirect response before inspecting its target or body',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('redirect to private target'));

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
 const [,init]=fetchImpl.mock.calls[0]!;
 expect(init?.redirect).toBe('error');
});

it('rejects a declared oversized response and cancels its body',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array([1]));},
  cancel(){cancelled=true;},
 }),{status:200,headers:{'content-length':String(2*1024*1024+1)}});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 await expect(createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT',httpStatus:200});
 expect(cancelled).toBe(true);
});

it('cancels a response read when the caller aborts',async()=>{
 let cancelled=false;
 const controller=new AbortController();
 const response=new Response(new ReadableStream<Uint8Array>({
  start(){},
  cancel(){cancelled=true;},
 }),{status:200});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
 const pending=createOpenRouterEmbeddingAdapter({fetchImpl}).embed(request({signal:controller.signal}));
 controller.abort(new DOMException('caller stopped','AbortError'));

 await expect(pending).rejects.toMatchObject({code:'CANCELLED',message:'CANCELLED',httpStatus:200});
 expect(cancelled).toBe(true);
});
