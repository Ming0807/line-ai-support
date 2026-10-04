import {expect,it,vi} from 'vitest';
import {createOpenAIEmbeddingAdapter} from '../lib/ai/providers/openai-embeddings';
import type {EmbeddingRequest} from '../lib/ai/embedding-types';
import {isEmbeddingDimensionAllowed} from '../lib/ai/embedding-models';

function request(overrides:Partial<EmbeddingRequest>={}):EmbeddingRequest {
 return {
  modelId:'text-embedding-3-small',baseUrl:'https://api.openai.com/v1',apiKey:'test-key-never-log',
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

it('sends the bounded float embedding request and restores vectors by input index',async()=>{
 const input=request();
 const fetchImpl=fetchFor(payload(input.modelId,[
  {index:1,embedding:[0,1,0]},{index:0,embedding:[1,0,0]},
 ],{prompt_tokens:7,total_tokens:9}));

 const result=await createOpenAIEmbeddingAdapter({fetchImpl}).embed(input);

 expect(fetchImpl).toHaveBeenCalledOnce();
 const [url,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(url).toBe('https://api.openai.com/v1/embeddings');
 expect(init?.method).toBe('POST');
 expect(init?.redirect).toBe('error');
 expect(init?.signal).toBe(input.signal);
 const headers=new Headers(init?.headers);
 expect(headers.get('authorization')).toBe('Bearer test-key-never-log');
 expect(headers.get('content-type')).toBe('application/json');
 const body=JSON.parse(String(init?.body));
 expect(body).toEqual({model:input.modelId,input:input.input,dimensions:3,encoding_format:'float'});
 expect(JSON.stringify(body)).not.toContain(input.apiKey);
 expect(result).toEqual({vectors:[[1,0,0],[0,1,0]],inputTokens:7});
});

it('omits unsupported dimensions for ada-002 and accepts its fixed 1536-vector output',async()=>{
 const input=request({modelId:'text-embedding-ada-002',input:['one chunk'],dimensions:1536});
 const vector=[1,...Array<number>(1535).fill(0)];
 const fetchImpl=fetchFor(payload(input.modelId,[{index:0,embedding:vector}],{prompt_tokens:3,total_tokens:3}));

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(input))
  .resolves.toEqual({vectors:[vector],inputTokens:3});
 const [,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 expect(JSON.parse(String(init?.body))).not.toHaveProperty('dimensions');
});

it('rejects unsupported ada-002 dimensions before HTTP',async()=>{
 const input=request({modelId:'text-embedding-ada-002',input:['one chunk'],dimensions:2});
 const fetchImpl=fetchFor(payload(input.modelId,[{index:0,embedding:[0.5,0.5]}]));

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(input))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects an ada-002 response that does not match its fixed configured dimension',async()=>{
 const input=request({modelId:'text-embedding-ada-002',input:['one chunk'],dimensions:1536});
 const fetchImpl=fetchFor(payload(input.modelId,[{index:0,embedding:[1,0]}]));

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(input))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

const invalidRequestCases:Array<[string,Partial<EmbeddingRequest>]>=[
 ['an empty batch',{input:[]}],
 ['more than 16 inputs',{input:Array.from({length:17},(_,index)=>`chunk ${index}`)}],
 ['an empty input',{input:['']}],
 ['an input above 6000 UTF-8 bytes',{input:['é'.repeat(3001)]}],
 ['zero dimensions',{dimensions:0}],
 ['dimensions above 4096',{dimensions:4097}],
 ['text-embedding-3-small dimensions above its native size',{modelId:'text-embedding-3-small',dimensions:1537}],
 ['text-embedding-3-small dimensions at 4096',{modelId:'text-embedding-3-small',dimensions:4096}],
 ['text-embedding-3-large dimensions above its native size',{modelId:'text-embedding-3-large',dimensions:3073}],
 ['an unsupported base URL',{baseUrl:'https://api.openai.com/v1/../other'}],
 ['a whitespace-padded key',{apiKey:' key-with-spaces '}],
 ['an invalid model ID',{modelId:'../model'}],
];

it.each(invalidRequestCases)('rejects %s before HTTP',async(_label,overrides)=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const input=request(overrides);
 if(input.modelId.startsWith('text-embedding-3-')&&input.dimensions>1000)
  expect(isEmbeddingDimensionAllowed(input.modelId,input.dimensions)).toBe(false);

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(input))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('accepts the inclusive 16-input, 6000-byte, and 4096-dimension limits',async()=>{
 const input=request({modelId:'text-embedding-future-unknown',input:Array.from({length:16},()=> 'x'.repeat(6000)),dimensions:4096});
 const vector=[1,...Array<number>(4095).fill(0)];
 const fetchImpl=fetchFor(payload(input.modelId,Array.from({length:16},(_,index)=>({index,embedding:vector}))));

 const result=await createOpenAIEmbeddingAdapter({fetchImpl}).embed(input);

 const [,init]=vi.mocked(fetchImpl).mock.calls[0]!;
 const body=JSON.parse(String(init?.body));
 expect(body.input).toHaveLength(16);
 expect(body.dimensions).toBe(4096);
 expect(result.vectors).toHaveLength(16);
 expect(result.vectors[0]).toHaveLength(4096);
});

it('rejects a request body above 512 KiB after per-input validation',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const input=request({input:Array.from({length:16},()=> '\u0000'.repeat(6000))});

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(input))
  .rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
 ['a non-list envelope',{object:'embedding'}],
 ['a different model',payload('text-embedding-3-large',validData(),{prompt_tokens:2,total_tokens:2})],
 ['a missing embedding',payload('text-embedding-3-small',validData().slice(0,1),{prompt_tokens:2,total_tokens:2})],
 ['duplicate indices',payload('text-embedding-3-small',[
  {index:0,embedding:[1,0,0]},{index:0,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['an index outside the input range',payload('text-embedding-3-small',[
  {index:0,embedding:[1,0,0]},{index:2,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['a vector with the wrong dimensions',payload('text-embedding-3-small',[
  {index:0,embedding:[1,0]},{index:1,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['a zero vector',payload('text-embedding-3-small',[
  {index:0,embedding:[0,0,0]},{index:1,embedding:[0,1,0]},
 ],{prompt_tokens:2,total_tokens:2})],
 ['usage above the documented bound',payload('text-embedding-3-small',validData(),
  {prompt_tokens:300001,total_tokens:300001})],
] as const)('rejects %s with fixed INVALID_OUTPUT',async(_label,response)=>{
 await expect(createOpenAIEmbeddingAdapter({fetchImpl:fetchFor(response)}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('rejects parsed non-finite vector values',async()=>{
 const fetchImpl=fetchForRawBody('{"object":"list","model":"text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[1e999,0,0]},{"object":"embedding","index":1,"embedding":[0,1,0]}],"usage":{"prompt_tokens":2,"total_tokens":2}}');

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('rejects malformed JSON as fixed INVALID_OUTPUT',async()=>{
 const fetchImpl=fetchForRawBody('{malformed private response');

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
});

it('returns null token usage when the provider omits usage',async()=>{
 const fetchImpl=fetchFor(payload(request().modelId,validData()));

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .resolves.toEqual({vectors:[[1,0,0],[0,1,0]],inputTokens:null});
});

const httpErrorCases:Array<[number,string,boolean]>=[
 [400,'INVALID_REQUEST',false],[401,'AUTH_ERROR',false],[403,'AUTH_ERROR',false],
 [404,'MODEL_UNAVAILABLE',true],[429,'RATE_LIMITED',true],[500,'SERVER_ERROR',true],[503,'SERVER_ERROR',true],
];

it.each(httpErrorCases)('maps HTTP %i to %s without reading its body',async(status,code,retryable)=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('private provider response'));},
  cancel(){cancelled=true;},
 }),{status});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code,message:code,httpStatus:status,retryable});
 expect(cancelled).toBe(true);
 const [,init]=fetchImpl.mock.calls[0]!;
 expect(init?.redirect).toBe('error');
});

it('normalizes network failures without exposing raw transport details',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private transport detail'));

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
});

it('rejects an oversized streamed response and cancels its reader',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(2*1024*1024+1));},
  cancel(){cancelled=true;},
 }),{status:200});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request()))
  .rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
 expect(cancelled).toBe(true);
});

it('cancels promptly when the response reader remains pending after abort',async()=>{
 let markReadStarted!:()=>void;
 const readStarted=new Promise<void>((resolve)=>{markReadStarted=resolve;});
 const reader={
  read:vi.fn(()=>{
   markReadStarted();
   return new Promise<ReadableStreamReadResult<Uint8Array>>(()=>{});
  }),
  cancel:vi.fn().mockResolvedValue(undefined),
  releaseLock:vi.fn(),
 };
 const response=new Response(null,{status:200});
 Object.defineProperty(response,'body',{value:{getReader:()=>reader}});
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(response);
 const controller=new AbortController();
 const removeEventListener=vi.spyOn(controller.signal,'removeEventListener');
 const pending=createOpenAIEmbeddingAdapter({fetchImpl}).embed(request({signal:controller.signal}));

 await readStarted;
 controller.abort(new DOMException('private cancellation detail','AbortError'));

 const outcome=await Promise.race([
  pending.then(
   ()=>({kind:'resolved' as const}),
   (error:unknown)=>({kind:'rejected' as const,error}),
  ),
  new Promise<{kind:'pending'}>((resolve)=>setTimeout(()=>resolve({kind:'pending'}),100)),
 ]);

 expect(outcome).toMatchObject({kind:'rejected',error:{code:'CANCELLED',message:'CANCELLED'}});
 expect(reader.cancel).toHaveBeenCalledOnce();
 expect(removeEventListener).toHaveBeenCalledWith('abort',expect.any(Function));
});

it.each([
 ['user cancellation','AbortError','CANCELLED'],
 ['timeout','TimeoutError','TIMEOUT'],
] as const)('normalizes an already-aborted %s signal',async(_label,reasonName,code)=>{
 const controller=new AbortController();
 controller.abort(new DOMException('private cancellation detail',reasonName));
 const fetchImpl=vi.fn<typeof fetch>();

 await expect(createOpenAIEmbeddingAdapter({fetchImpl}).embed(request({signal:controller.signal})))
  .rejects.toMatchObject({code,message:code});
 expect(fetchImpl).not.toHaveBeenCalled();
});
