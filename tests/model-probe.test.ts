import {expect,it,vi} from 'vitest';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIModelConfig,type AIProviderAdapter,type ProviderResponse} from '../lib/ai/types';
import type {EmbeddingAdapter} from '../lib/ai/embedding-types';
import type {ModelPricing,PriceReader} from '../lib/ai/pricing';
import {probeModel,type ModelProbeConfig,type ProbeOptions} from '../lib/ai/model-probe';

const BASE_KEY=Buffer.alloc(32,7).toString('base64');
const OPENROUTER_BASE='https://openrouter.ai/api/v1';
const MODEL_ID='fixture/free-model';
const API_KEY='probe-key-never-return';

function model(overrides:Partial<ModelProbeConfig>={}):ModelProbeConfig {
 const common:AIModelConfig={
  id:'model-row-1',providerId:'provider-row-1',adapter:'OPENROUTER',modelId:MODEL_ID,
  baseUrl:OPENROUTER_BASE,apiKeyEncrypted:encryptValue(API_KEY,BASE_KEY),
  providerRevision:1,modelRevision:1,providerPriority:0,priority:0,timeoutMs:2000,
  supportsJson:true,supportsTools:false,inputPricePerMillion:0,outputPricePerMillion:0,
  costMode:'FREE_ONLY',
 };
 return {...common,purpose:'GENERATION',...overrides};
}

function freePrice(apiFormat:ModelPricing['apiFormat']='CHAT'):ModelPricing {
 return {status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat};
}

function json(body:unknown,status=200):Response {
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

function validGenerationResponse(overrides:Partial<ProviderResponse>={}):ProviderResponse {
 return {output:{ok:true},toolCalls:[],inputTokens:3,outputTokens:2,httpStatus:200,...overrides};
}

function adapter(generate:AIProviderAdapter['generate']):AIProviderAdapter {
 return {generate,healthCheck:vi.fn<AIProviderAdapter['healthCheck']>(async()=> 'HEALTHY')};
}

function embeddingAdapter(embed:EmbeddingAdapter['embed']):EmbeddingAdapter {return {embed};}

function setup(overrides:{
 priceReader?:PriceReader;fetchImpl?:typeof fetch;generationAdapters?:ProbeOptions['generationAdapters'];
 embeddingAdapters?:ProbeOptions['embeddingAdapters'];
}={}) {
 const generate=vi.fn<AIProviderAdapter['generate']>().mockResolvedValue(validGenerationResponse());
 const embed=vi.fn<EmbeddingAdapter['embed']>().mockResolvedValue({vectors:[[1,0,0]],inputTokens:4,httpStatus:200});
 const priceReader=overrides.priceReader??vi.fn(async()=>freePrice());
 const options:ProbeOptions={key:BASE_KEY,
  generationAdapters:overrides.generationAdapters??{OPENROUTER:adapter(generate)},
  embeddingAdapters:overrides.embeddingAdapters??{OPENROUTER:embeddingAdapter(embed)},
  priceReader,...(overrides.fetchImpl?{fetchImpl:overrides.fetchImpl}:{}),
 };
 return {options,generate,embed,priceReader};
}

it('uses an exact public OpenRouter catalog match for metadata without decrypting or inferring',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:MODEL_ID}]}));
 const f=setup({fetchImpl});
 const result=await probeModel(model({apiKeyEncrypted:'not-a-ciphertext'}),'METADATA',f.options);
 expect(result).toMatchObject({result:'SUCCESS',errorCode:null,httpStatus:200});
 expect(fetchImpl).toHaveBeenCalledOnce();
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe(`${OPENROUTER_BASE}/models`);
 expect(init?.method).toBe('GET');
 expect(init?.redirect).toBe('error');
 expect(new Headers(init?.headers).has('authorization')).toBe(false);
 expect(f.priceReader).not.toHaveBeenCalled();
 expect(f.generate).not.toHaveBeenCalled();
 expect(f.embed).not.toHaveBeenCalled();
 expect(JSON.stringify(result)).not.toContain(API_KEY);
});

it('requires exactly one metadata row matching the selected OpenRouter model',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:'another/model'}]}));
 const f=setup({fetchImpl});
 const result=await probeModel(model(),'METADATA',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'MODEL_UNAVAILABLE',httpStatus:200});
});

it('uses the fixed Zen model catalog without sending credentials',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:'fixture-zen-free'}]}));
 const f=setup({fetchImpl});
 const result=await probeModel(model({adapter:'ZEN',modelId:'fixture-zen-free',baseUrl:'https://opencode.ai/zen/v1'}),
  'METADATA',f.options);
 expect(result).toMatchObject({result:'SUCCESS',httpStatus:200});
 const [url,init]=fetchImpl.mock.calls[0]!;
 expect(url).toBe('https://opencode.ai/zen/v1/models');
 expect(new Headers(init?.headers).has('authorization')).toBe(false);
 expect(f.priceReader).not.toHaveBeenCalled();
});

it('forces FREE_ONLY and sends only fixed safe JSON to the selected generation adapter',async()=>{
 const f=setup();
 const result=await probeModel(model({costMode:'ALLOW_PAID'}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'SUCCESS',errorCode:null,httpStatus:200});
 expect(f.priceReader).toHaveBeenCalledOnce();
 expect(f.priceReader).toHaveBeenCalledWith({adapter:'OPENROUTER',baseUrl:OPENROUTER_BASE,modelId:MODEL_ID,purpose:'GENERATION'},expect.any(AbortSignal));
 expect(f.generate).toHaveBeenCalledOnce();
 const request=f.generate.mock.calls[0]![0];
 expect(request).toMatchObject({modelId:MODEL_ID,baseUrl:OPENROUTER_BASE,apiKey:API_KEY,costMode:'FREE_ONLY',apiFormat:'CHAT'});
 expect(request.messages).toEqual([
  {role:'system',content:'Return exactly the JSON object {"ok":true}.'},
  {role:'user',content:'Return the required JSON object.'},
 ]);
 expect(request.responseSchema.schema).toEqual({type:'object',properties:{ok:{type:'boolean',const:true}},required:['ok'],additionalProperties:false});
 expect(request.tools).toBeUndefined();
 expect(JSON.stringify(result)).not.toContain(API_KEY);
 expect(JSON.stringify(result)).not.toContain('Return exactly');
});

it('requires one exact validated probe tool call when the selected model advertises tools',async()=>{
 const generate=vi.fn<AIProviderAdapter['generate']>().mockResolvedValue(validGenerationResponse({output:null,
  toolCalls:[{id:'probe-call',name:'probe_provider',arguments:{marker:'PROBE'}}]}));
 const f=setup({generationAdapters:{OPENROUTER:adapter(generate)}});
 const result=await probeModel(model({supportsTools:true}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'SUCCESS',httpStatus:200});
 const request=generate.mock.calls[0]![0];
 expect(request.tools).toEqual([{name:'probe_provider',description:'Return the fixed provider probe marker.',parameters:{
  type:'object',properties:{marker:{type:'string',const:'PROBE'}},required:['marker'],additionalProperties:false,
 }}]);
 expect(generate).toHaveBeenCalledOnce();
});

it('fails a tool-capable model that answers JSON instead of returning the required probe tool call',async()=>{
 const f=setup();
 const result=await probeModel(model({supportsTools:true}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
});

it('uses the configured embedding dimension and validates one finite nonzero vector',async()=>{
 const embed=vi.fn<EmbeddingAdapter['embed']>().mockResolvedValue({vectors:[[1,0,0]],inputTokens:4,httpStatus:200});
 const f=setup({embeddingAdapters:{OPENROUTER:embeddingAdapter(embed)}});
 const result=await probeModel(model({purpose:'EMBEDDING',dimensions:3,costMode:'ALLOW_PAID'}),'EMBEDDING_TEST',f.options);
 expect(result).toMatchObject({result:'SUCCESS',httpStatus:200});
 expect(embed).toHaveBeenCalledOnce();
 expect(embed.mock.calls[0]![0]).toMatchObject({modelId:MODEL_ID,apiKey:API_KEY,costMode:'FREE_ONLY',
  dimensions:3,input:['YRU provider probe']});
});

it.each([
 ['paid', {status:'PAID',inputPricePerMillion:1,outputPricePerMillion:1,apiFormat:'CHAT'} as ModelPricing,'PAID_BLOCKED'],
 ['unknown', {status:'UNKNOWN',inputPricePerMillion:null,outputPricePerMillion:null,apiFormat:null} as ModelPricing,'PRICE_UNKNOWN'],
] as const)('blocks %s before decrypting an ALLOW_PAID snapshot or issuing HTTP',async(_label,price,errorCode)=>{
 const priceReader=vi.fn(async()=>({...price,checkedAt:new Date().toISOString()}));
 const f=setup({priceReader});
 const result=await probeModel(model({costMode:'ALLOW_PAID',apiKeyEncrypted:'malformed-encrypted-key'}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'BLOCKED',errorCode,httpStatus:null});
 expect(priceReader).toHaveBeenCalledOnce();
 expect(f.generate).not.toHaveBeenCalled();
 expect(f.options.fetchImpl).toBeUndefined();
});

it('blocks a free price observation outside the cost policy freshness window',async()=>{
 const priceReader=vi.fn(async()=>({...freePrice(),checkedAt:new Date(Date.now()-61_000).toISOString()}));
 const f=setup({priceReader});
 const result=await probeModel(model(),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'BLOCKED',errorCode:'PRICE_UNKNOWN',httpStatus:null});
 expect(f.generate).not.toHaveBeenCalled();
});

it('requires the pinned Zen API format to agree with the catalog before a selected test',async()=>{
 const generate=vi.fn<AIProviderAdapter['generate']>().mockResolvedValue(validGenerationResponse());
 const priceReader=vi.fn(async()=>freePrice('RESPONSES'));
 const f=setup({priceReader,generationAdapters:{ZEN:adapter(generate)}});
 const changed=await probeModel(model({adapter:'ZEN',modelId:'fixture-zen-free',baseUrl:'https://opencode.ai/zen/v1',apiFormat:'CHAT'}),
  'GENERATION_TEST',f.options);
 expect(changed).toMatchObject({result:'BLOCKED',errorCode:'PRICE_UNKNOWN',httpStatus:null});expect(generate).not.toHaveBeenCalled();
 const result=await probeModel(model({adapter:'ZEN',modelId:'fixture-zen-free',baseUrl:'https://opencode.ai/zen/v1',apiFormat:'RESPONSES'}),
  'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'SUCCESS',httpStatus:200});
 expect(generate.mock.calls[0]![0]).toMatchObject({apiFormat:'RESPONSES',costMode:'FREE_ONLY'});
});

it('maps selected-model HTTP errors and never probes a fallback adapter',async()=>{
 const selected=adapter(vi.fn(async()=>{throw new AIProviderError('RATE_LIMITED',429);}));
 const fallback=adapter(vi.fn(async()=>validGenerationResponse()));
 const f=setup({generationAdapters:{OPENROUTER:selected,OPENAI:fallback}});
 const result=await probeModel(model(),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'RATE_LIMITED',httpStatus:429});
 expect(selected.generate).toHaveBeenCalledOnce();
 expect(fallback.generate).not.toHaveBeenCalled();
});

it('preserves actual HTTP 200 when a selected adapter returns invalid structured output',async()=>{
 const generate=vi.fn(async()=>validGenerationResponse({output:{ok:false}}));
 const f=setup({generationAdapters:{OPENROUTER:adapter(generate)}});
 const result=await probeModel(model(),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
});

it('does not infer HTTP 200 when an adapter omits its actual status',async()=>{
 const generate=vi.fn<AIProviderAdapter['generate']>().mockResolvedValue(validGenerationResponse({httpStatus:undefined}));
 const f=setup({generationAdapters:{OPENROUTER:adapter(generate)}});
 const result=await probeModel(model(),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:null});
});

it('uses the embedding-specific public catalog and rejects duplicate exact metadata matches',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:MODEL_ID},{id:MODEL_ID}]}));
 const f=setup({fetchImpl});
 const result=await probeModel(model({purpose:'EMBEDDING',dimensions:4}),'METADATA',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
 expect(fetchImpl.mock.calls[0]![0]).toBe(`${OPENROUTER_BASE}/embeddings/models`);
 expect(f.priceReader).not.toHaveBeenCalled();
});

it('uses authenticated native OpenAI model retrieval only for metadata',async()=>{
 const nativeId='ft:gpt-model:institution:suffix';
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({id:nativeId,object:'model'}));
 const f=setup({fetchImpl});
 const result=await probeModel(model({adapter:'OPENAI',modelId:nativeId,baseUrl:'https://api.openai.com/v1',
  apiKeyEncrypted:encryptValue(API_KEY,BASE_KEY)}),'METADATA',f.options);
 expect(result).toMatchObject({result:'SUCCESS',httpStatus:200});
 expect(fetchImpl.mock.calls[0]![0]).toBe(`https://api.openai.com/v1/models/${encodeURIComponent(nativeId)}`);
 expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
 expect(f.priceReader).not.toHaveBeenCalled();
 expect(f.generate).not.toHaveBeenCalled();
});

it('blocks action and purpose mismatches before price lookup or network access',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const f=setup({fetchImpl});
 const result=await probeModel(model({purpose:'EMBEDDING',dimensions:3}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'BLOCKED',errorCode:'CAPABILITY_UNSUPPORTED',httpStatus:null});
 expect(f.priceReader).not.toHaveBeenCalled();
 expect(fetchImpl).not.toHaveBeenCalled();
 expect(f.generate).not.toHaveBeenCalled();
});

it('reports HTTP 200 when metadata JSON is malformed',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad json',{status:200}));
 const f=setup({fetchImpl});
 const result=await probeModel(model(),'METADATA',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
});

it('bounds a price reader that ignores abort to the configured total timeout',async()=>{
 const priceReader=vi.fn<PriceReader>(()=>new Promise<ModelPricing>(()=>{}));
 const f=setup({priceReader});
 const started=Date.now();
 const result=await probeModel(model({timeoutMs:30}),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'TIMEOUT',httpStatus:null});
 expect(Date.now()-started).toBeLessThan(250);
 expect(f.generate).not.toHaveBeenCalled();
});

it('cancels a metadata body stalled past the shared deadline and retains its HTTP status',async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({
  pull(){return new Promise<void>(()=>{});},
  cancel(){cancelled=true;},
 });
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(body,{status:200}));
 const f=setup({fetchImpl});
 const result=await probeModel(model({timeoutMs:25}),'METADATA',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'TIMEOUT',httpStatus:200});
 expect(cancelled).toBe(true);
});

it('returns only normalized safe provider error fields',async()=>{
 const generate=vi.fn(async()=>{throw new Error(`private key ${API_KEY} and prompt body`);});
 const f=setup({generationAdapters:{OPENROUTER:adapter(generate)}});
 const result=await probeModel(model(),'GENERATION_TEST',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'PROVIDER_UNAVAILABLE',httpStatus:null});
 expect(JSON.stringify(result)).not.toContain(API_KEY);
 expect(JSON.stringify(result)).not.toContain('private key');
 expect(JSON.stringify(result)).not.toContain('prompt body');
});

it('does not treat embedding HTTP 200 with zero, wrong-sized, or missing vectors as success',async()=>{
 for(const vectors of [[[0,0,0]],[[1,0]],[]]){
  const embed=vi.fn<EmbeddingAdapter['embed']>().mockResolvedValue({vectors,inputTokens:null,httpStatus:200});
  const f=setup({embeddingAdapters:{OPENROUTER:embeddingAdapter(embed)}});
  const result=await probeModel(model({purpose:'EMBEDDING',dimensions:3}),'EMBEDDING_TEST',f.options);
  expect(result).toMatchObject({result:'ERROR',errorCode:'INVALID_OUTPUT',httpStatus:200});
 }
});

it('returns cancellation safely when the caller aborts an in-flight selected probe',async()=>{
 const controller=new AbortController();
 const generate=vi.fn<AIProviderAdapter['generate']>(()=>new Promise<ProviderResponse>(()=>{}));
 const f=setup({generationAdapters:{OPENROUTER:adapter(generate)}});
 const pending=probeModel(model(),'GENERATION_TEST',f.options,controller.signal);
 await vi.waitFor(()=>expect(generate).toHaveBeenCalledOnce());
 controller.abort();
 await expect(pending).resolves.toMatchObject({result:'ERROR',errorCode:'CANCELLED',httpStatus:null});
});

it('never reports metadata success for an HTTP failure, even when the body names the model',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:MODEL_ID}]},429));
 const f=setup({fetchImpl});
 const result=await probeModel(model(),'METADATA',f.options);
 expect(result).toMatchObject({result:'ERROR',errorCode:'RATE_LIMITED',httpStatus:429});
});

