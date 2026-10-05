import {createHash,randomBytes} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {embed,embeddingFingerprint} from '../lib/ai/embedding-gateway';
import type {EmbeddingAdapter,EmbeddingModelConfig,EmbeddingRequest,EmbeddingResponse} from '../lib/ai/embedding-types';
import {AIProviderError,type AIAttempt} from '../lib/ai/types';
import {encryptValue} from '../lib/security/identity';

type TestInput={input:string[];requestType:'EMBEDDING_QUERY'|'EMBEDDING_DOCUMENT';fingerprint?:string;
 timeoutMs?:number;conversationId?:string;signal?:AbortSignal};

const key=randomBytes(32).toString('base64');
const uuid=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;

function model(index:number,overrides:Partial<EmbeddingModelConfig>={}):EmbeddingModelConfig {
 return {id:uuid(index),providerId:uuid(index+1000),adapter:'MOCK',modelId:`model-${index}`,
  baseUrl:'https://api.openai.com/v1',apiKeyEncrypted:encryptValue('fixture-provider-key',key),
  providerRevision:1,modelRevision:2,providerPriority:index,priority:1,timeoutMs:100,
  inputPricePerMillion:2,outputPricePerMillion:null,dimensions:3,costMode:'ALLOW_PAID',...overrides};
}

function request(overrides:Partial<TestInput>={}):TestInput {
 return {input:['first document','second document'],requestType:'EMBEDDING_QUERY',...overrides};
}

function normalResponse(value:EmbeddingRequest):EmbeddingResponse {
 return {vectors:value.input.map((_,index)=>{
  const vector=Array<number>(value.dimensions).fill(0);
  vector[index%value.dimensions]=1;
  return vector;
 }),inputTokens:10};
}

function fixture(models=[model(1),model(2)]) {
 const attempts:AIAttempt[]=[];
 const adapter:EmbeddingAdapter={embed:vi.fn(async(value:EmbeddingRequest)=>normalResponse(value))};
 const store={
  loadEmbeddingModels:vi.fn(async()=>models),
  recordAttempt:vi.fn(async(attempt:AIAttempt)=>{attempts.push(attempt);}),
 };
 const options={store,key,adapters:{MOCK:adapter}};
 return {attempts,adapter,models,options,store};
}

it('fingerprints only the canonical embedding semantics',()=>{
 const config=model(1);
 const rotated={...config,id:uuid(7),providerId:uuid(8),providerRevision:5,modelRevision:9,
  apiKeyEncrypted:encryptValue('rotated-private-key',key),baseUrl:`${config.baseUrl}/`};
 const expected=createHash('sha256').update(JSON.stringify(['MOCK',config.baseUrl,config.modelId,3])).digest('hex');

 expect(embeddingFingerprint(config)).toMatch(/^[a-f0-9]{64}$/);
 expect(embeddingFingerprint(config)).toBe(expected);
 expect(embeddingFingerprint(rotated)).toBe(expected);
 expect(embeddingFingerprint({...config,dimensions:4})).not.toBe(expected);
 expect(embeddingFingerprint({...config,modelId:'different-model'})).not.toBe(expected);
});

it('returns one validated model result and records revision-safe usage without the key',async()=>{
 const f=fixture();

 const result=await embed(request({conversationId:uuid(22)}),f.options);

 expect(result).toEqual({vectors:[[1,0,0],[0,1,0]],fingerprint:embeddingFingerprint(f.models[0]!),
  dimensions:3,providerId:f.models[0]!.providerId,modelId:f.models[0]!.id,fallbackUsed:false});
 expect(f.adapter.embed).toHaveBeenCalledOnce();
 expect(vi.mocked(f.adapter.embed).mock.calls[0]![0]).toMatchObject({modelId:'model-1',baseUrl:f.models[0]!.baseUrl,
  apiKey:'fixture-provider-key',input:['first document','second document'],dimensions:3});
 expect(f.attempts).toHaveLength(1);
 expect(f.attempts[0]).toMatchObject({providerId:f.models[0]!.providerId,modelId:f.models[0]!.id,
  providerRevision:1,modelRevision:2,requestType:'EMBEDDING_QUERY',conversationId:uuid(22),latencyMs:expect.any(Number),
  inputTokens:10,outputTokens:0,estimatedCost:0.00002,status:'SUCCESS',fallbackUsed:false,health:'HEALTHY'});
 expect(JSON.stringify(f.attempts)).not.toContain('fixture-provider-key');
});

it('keeps embedding cost null when usage or the input price is unavailable',async()=>{
 const f=fixture([model(1,{inputPricePerMillion:null})]);
 vi.mocked(f.adapter.embed).mockResolvedValueOnce({vectors:[[1,0,0],[0,1,0]],inputTokens:null});

 const result=await embed(request({requestType:'EMBEDDING_DOCUMENT'}),f.options);

 expect(result.fallbackUsed).toBe(false);
 expect(f.attempts[0]).toMatchObject({requestType:'EMBEDDING_DOCUMENT',inputTokens:null,outputTokens:0,estimatedCost:null});
});

const invalidInputs:Array<[string,Partial<TestInput>]>=[
 ['an empty input batch',{input:[]}],
 ['more than 16 strings',{input:Array.from({length:17},(_,index)=>`chunk ${index}`)}],
 ['a blank input string',{input:['  \t  ']}],
 ['an input above 6000 UTF-8 bytes',{input:['é'.repeat(3001)]}],
 ['an invalid request type',{requestType:'UNKNOWN' as TestInput['requestType']}],
 ['a malformed fingerprint',{fingerprint:'not-a-sha256'}],
 ['a zero timeout',{timeoutMs:0}],
 ['a timeout above 45 seconds',{timeoutMs:45_001}],
 ['an invalid conversation ID',{conversationId:'private-invalid-id'}],
];

it.each(invalidInputs)('rejects %s before loading the registry',async(_label,overrides)=>{
 const f=fixture();

 await expect(embed(request(overrides),f.options)).rejects.toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 expect(f.store.loadEmbeddingModels).not.toHaveBeenCalled();
 expect(f.adapter.embed).not.toHaveBeenCalled();
});

it('rejects sparse input arrays before loading the registry',async()=>{
 const f=fixture(),sparseInput:string[]=[];
 sparseInput.length=1;

 await expect(embed(request({input:sparseInput}),f.options)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(f.store.loadEmbeddingModels).not.toHaveBeenCalled();
});

it('accepts the inclusive 16-string and 6000 UTF-8 byte input bounds',async()=>{
 const f=fixture([model(1,{dimensions:1})]);
 vi.mocked(f.adapter.embed).mockImplementationOnce(async(value)=>({
  vectors:value.input.map(()=>[1]),inputTokens:1,
 }));

 const result=await embed(request({input:Array.from({length:16},()=> 'x'.repeat(6000))}),f.options);

 expect(result.vectors).toHaveLength(16);
 expect(f.adapter.embed).toHaveBeenCalledOnce();
});

it('uses only models that match the requested fingerprint before sorting and applying the three-model cap',async()=>{
 const first=model(1,{providerPriority:1,priority:2});
 const second=model(2,{providerPriority:1,priority:3,modelId:first.modelId,baseUrl:`${first.baseUrl}/`,
  dimensions:first.dimensions,adapter:first.adapter});
 const other=model(3,{providerPriority:0,modelId:'different-model'});
 const f=fixture([other,second,first]);
 vi.mocked(f.adapter.embed).mockRejectedValueOnce(new AIProviderError('RATE_LIMITED',429));

 const result=await embed(request({input:['one'],fingerprint:embeddingFingerprint(first)}),f.options);

 expect(f.attempts.map((attempt)=>attempt.modelId)).toEqual([first.id,second.id]);
 expect(result).toMatchObject({fingerprint:embeddingFingerprint(first),providerId:second.providerId,modelId:second.id,fallbackUsed:true});
 expect(result.vectors).toEqual([[1,0,0]]);
});

it('does not fall back to a different fingerprint when a match fails',async()=>{
 const matching=model(1);
 const f=fixture([matching,model(2,{modelId:'other-model'})]);
 vi.mocked(f.adapter.embed).mockRejectedValueOnce(new AIProviderError('SERVER_ERROR',503));

 await expect(embed(request({fingerprint:embeddingFingerprint(matching)}),f.options))
  .rejects.toMatchObject({code:'SERVER_ERROR',httpStatus:503});
 expect(f.adapter.embed).toHaveBeenCalledOnce();
 expect(f.attempts.map((attempt)=>attempt.modelId)).toEqual([matching.id]);
});

it('fails without provider calls when the requested fingerprint has no configured match',async()=>{
 const f=fixture();

 await expect(embed(request({fingerprint:'a'.repeat(64)}),f.options))
  .rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
 expect(f.adapter.embed).not.toHaveBeenCalled();
 expect(f.attempts).toHaveLength(0);
});

it.each(['RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','PROVIDER_UNAVAILABLE','INVALID_OUTPUT'] as const)
 ('falls back on retryable %s errors and returns only the successful model vectors',async(code)=>{
 const f=fixture();
 vi.mocked(f.adapter.embed).mockRejectedValueOnce(new AIProviderError(code,503));
 vi.mocked(f.adapter.embed).mockImplementationOnce(async(value)=>({
  vectors:value.input.map(()=>[0,1,0]),inputTokens:6,
 }));

 const result=await embed(request({input:['one']}),f.options);

 expect(result).toMatchObject({providerId:f.models[1]!.providerId,modelId:f.models[1]!.id,fallbackUsed:true,
  fingerprint:embeddingFingerprint(f.models[1]!)});
 expect(result.vectors).toEqual([[0,1,0]]);
 expect(f.attempts.map((attempt)=>attempt.status)).toEqual(['ERROR','SUCCESS']);
 expect(f.attempts[0]).toMatchObject({errorCode:code,httpStatus:503,fallbackUsed:false,outputTokens:0});
 expect(f.attempts[1]).toMatchObject({fallbackUsed:true,outputTokens:0});
});

it.each([
 ['authentication','AUTH_ERROR',401],
 ['provider cancellation','CANCELLED',undefined],
] as const)('does not fall back after %s',async(_label,code,status)=>{
 const f=fixture();
 vi.mocked(f.adapter.embed).mockRejectedValue(new AIProviderError(code,status));

 await expect(embed(request(),f.options)).rejects.toMatchObject({code});
 expect(f.adapter.embed).toHaveBeenCalledOnce();
 expect(f.attempts).toHaveLength(1);
});

const invalidResponses:Array<[string,EmbeddingResponse]>=[
 ['the wrong vector count',{vectors:[[1,0,0]],inputTokens:1}],
 ['the wrong vector dimension',{vectors:[[1,0],[0,1,0]],inputTokens:1}],
 ['a non-finite vector value',{vectors:[[Number.NaN,0,0],[0,1,0]],inputTokens:1}],
 ['a zero vector',{vectors:[[0,0,0],[0,1,0]],inputTokens:1}],
 ['negative token usage',{vectors:[[1,0,0],[0,1,0]],inputTokens:-1}],
 ['non-integer token usage',{vectors:[[1,0,0],[0,1,0]],inputTokens:1.5}],
];

it.each(invalidResponses)('rejects %s from an adapter as INVALID_OUTPUT',async(_label,response)=>{
 const f=fixture([model(1)]);
 vi.mocked(f.adapter.embed).mockResolvedValueOnce(response);

 await expect(embed(request(),f.options)).rejects.toMatchObject({code:'INVALID_OUTPUT',message:'INVALID_OUTPUT'});
 expect(f.attempts[0]).toMatchObject({status:'ERROR',errorCode:'INVALID_OUTPUT',outputTokens:0});
});

it('rejects already-cancelled work before loading the registry',async()=>{
 const f=fixture(),controller=new AbortController();
 controller.abort();

 await expect(embed(request({signal:controller.signal}),f.options)).rejects.toMatchObject({code:'CANCELLED'});
 expect(f.store.loadEmbeddingModels).not.toHaveBeenCalled();
 expect(f.adapter.embed).not.toHaveBeenCalled();
});

it('times out an adapter that ignores its per-model abort, then tries the next model',async()=>{
 const f=fixture();
 f.models[0]!.timeoutMs=10;
 vi.mocked(f.adapter.embed).mockImplementationOnce(()=>new Promise<EmbeddingResponse>(()=>{}));

 const result=await embed(request({timeoutMs:1000,input:['one']}),f.options);

 expect(result.fallbackUsed).toBe(true);
 expect(f.adapter.embed).toHaveBeenCalledTimes(2);
 expect(f.attempts.map((attempt)=>attempt.errorCode)).toEqual(['TIMEOUT',undefined]);
});

it('preserves TIMEOUT when an adapter rejects after its abort signal',async()=>{
 const f=fixture();
 f.models[0]!.timeoutMs=10;
 vi.mocked(f.adapter.embed).mockImplementationOnce((value)=>new Promise<EmbeddingResponse>((_resolve,reject)=>{
  value.signal.addEventListener('abort',()=>reject(new AIProviderError('CANCELLED')),{once:true});
 }));

 const result=await embed(request({timeoutMs:1000,input:['one']}),f.options);

 expect(result.fallbackUsed).toBe(true);
 expect(f.adapter.embed).toHaveBeenCalledTimes(2);
 expect(f.attempts.map((attempt)=>attempt.errorCode)).toEqual(['TIMEOUT',undefined]);
});

it('enforces one overall deadline and does not start a fresh fallback budget',async()=>{
 const f=fixture();
 f.models.forEach((entry)=>{entry.timeoutMs=100;});
 vi.mocked(f.adapter.embed).mockImplementation(()=>new Promise<EmbeddingResponse>(()=>{}));
 const started=Date.now();

 await expect(embed(request({timeoutMs:20}),f.options)).rejects.toMatchObject({code:'TIMEOUT'});

 expect(Date.now()-started).toBeLessThan(250);
 expect(f.adapter.embed).toHaveBeenCalledOnce();
 expect(f.attempts).toHaveLength(1);
});

it('bounds registry reads that ignore cancellation and normalizes the error',async()=>{
 const f=fixture();
 f.store.loadEmbeddingModels.mockImplementation(()=>new Promise<ReturnType<typeof model>[]>(()=>{}));
 const started=Date.now();

 await expect(embed(request({timeoutMs:20}),f.options))
  .rejects.toMatchObject({code:'TIMEOUT',message:'TIMEOUT'});

 expect(Date.now()-started).toBeLessThan(250);
 expect(f.adapter.embed).not.toHaveBeenCalled();
});

it('bounds usage recording and stops instead of triggering another paid fallback call',async()=>{
 const f=fixture();
 f.options.store.recordAttempt.mockImplementation(()=>new Promise<void>(()=>{}));
 const started=Date.now();

 await expect(embed(request({timeoutMs:20}),f.options))
  .rejects.toMatchObject({code:'TIMEOUT',message:'TIMEOUT'});

 expect(Date.now()-started).toBeLessThan(250);
 expect(f.adapter.embed).toHaveBeenCalledOnce();
});

it('normalizes registry failure without leaking its raw message',async()=>{
 const f=fixture();
 f.store.loadEmbeddingModels.mockRejectedValue(new Error('private registry detail'));

 await expect(embed(request(),f.options)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
 expect(f.adapter.embed).not.toHaveBeenCalled();
});

it('stops fallback when attempt recording fails after a provider result',async()=>{
 const f=fixture();
 f.store.recordAttempt.mockRejectedValue(new Error('private observation detail'));

 await expect(embed(request(),f.options)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
 expect(f.adapter.embed).toHaveBeenCalledOnce();
});
