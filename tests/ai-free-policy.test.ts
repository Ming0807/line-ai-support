import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {generate} from '../lib/ai/gateway';
import {embed,embeddingFingerprint} from '../lib/ai/embedding-gateway';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIAttempt,type AIModelConfig,type AIProviderAdapter} from '../lib/ai/types';
import type {EmbeddingAdapter,EmbeddingModelConfig} from '../lib/ai/embedding-types';
import type {ModelPricing,PriceReader} from '../lib/ai/pricing';

const key=randomBytes(32).toString('base64');
const input={taskType:'ANSWER',messages:[{role:'user' as const,content:'ทดสอบ'}],
 responseSchema:z.object({answer:z.string()}).strict(),responseName:'answer',timeoutMs:1000};
function model(index:number,overrides:Partial<AIModelConfig>={}):AIModelConfig {
 return {id:randomUUID(),providerId:randomUUID(),adapter:'OPENROUTER',modelId:`fixture/model-${index}`,
  baseUrl:'https://openrouter.ai/api/v1',apiKeyEncrypted:encryptValue('fixture-key',key),
  providerRevision:1,modelRevision:1,providerPriority:index,priority:1,timeoutMs:100,
  supportsJson:true,supportsTools:true,inputPricePerMillion:0,outputPricePerMillion:0,...overrides};
}
function pricing(status:'FREE'|'PAID'|'UNKNOWN'):ModelPricing {
 return {status,inputPricePerMillion:status==='FREE'?0:status==='PAID'?1:null,
  outputPricePerMillion:status==='FREE'?0:status==='PAID'?2:null,checkedAt:new Date().toISOString(),apiFormat:'CHAT'};
}
function fixture(models:AIModelConfig[],priceReader:PriceReader=vi.fn(async()=>pricing('FREE'))) {
 const attempts:AIAttempt[]=[];
 const chat:AIProviderAdapter={generate:vi.fn(async()=>({output:{answer:'ok'},toolCalls:[],inputTokens:2,outputTokens:1,httpStatus:200})),healthCheck:vi.fn()};
 const embedding:EmbeddingAdapter={embed:vi.fn(async request=>({vectors:request.input.map(()=>[1,0,0]),inputTokens:2,httpStatus:200}))};
 const embeddings:EmbeddingModelConfig[]=models.map(value=>({...value,dimensions:3}));
 const store={loadModels:async()=>models,loadEmbeddingModels:async()=>embeddings,
  recordAttempt:async(value:AIAttempt)=>{attempts.push(value);}};
 return {models,embeddings,attempts,chat,embedding,priceReader,
  gen:{store,key,priceReader,adapters:{OPENROUTER:chat,OPENAI:chat}},
  emb:{store,key,priceReader,adapters:{OPENROUTER:embedding,OPENAI:embedding}}};
}

it.each(['PAID','UNKNOWN'] as const)('defaults generation to FREE_ONLY and blocks %s before decrypt or inference',async status=>{
 const f=fixture([model(1,{apiKeyEncrypted:'intentionally-not-decryptable'})],vi.fn(async()=>pricing(status)));
 await expect(generate(input,f.gen)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(f.priceReader).toHaveBeenCalledOnce();expect(f.chat.generate).not.toHaveBeenCalled();expect(f.attempts).toHaveLength(0);
});
it.each(['PAID','UNKNOWN'] as const)('defaults embedding to FREE_ONLY and blocks %s before decrypt or inference',async status=>{
 const f=fixture([model(1,{apiKeyEncrypted:'intentionally-not-decryptable'})],vi.fn(async()=>pricing(status)));
 await expect(embed({input:['query'],requestType:'EMBEDDING_QUERY'},f.emb)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(f.priceReader).toHaveBeenCalledOnce();expect(f.embedding.embed).not.toHaveBeenCalled();expect(f.attempts).toHaveLength(0);
});
it('falls back from free 429 to the next verified free model without calling a paid model',async()=>{
 const models=[model(1),model(2),model(3)],reader=vi.fn<PriceReader>(async value=>pricing(value.modelId===models[1].modelId?'PAID':'FREE'));
 const f=fixture(models,reader);vi.mocked(f.chat.generate).mockRejectedValueOnce(new AIProviderError('RATE_LIMITED',429));
 expect(await generate(input,f.gen)).toMatchObject({modelId:models[2].id,fallbackUsed:true});
 expect(vi.mocked(f.chat.generate).mock.calls.map(([value])=>value.modelId)).toEqual([models[0].modelId,models[2].modelId]);
 expect(f.attempts.map(value=>value.httpStatus)).toEqual([429,200]);
 expect(f.attempts[1]).toMatchObject({estimatedCost:0,health:'HEALTHY'});
 expect(vi.mocked(f.chat.generate).mock.calls[1][0]).toMatchObject({costMode:'FREE_ONLY',apiFormat:'CHAT'});
});
it('skips blocked catalog entries before applying the three inference attempt limit',async()=>{
 const models=Array.from({length:5},(_,index)=>model(index+1));
 const f=fixture(models,vi.fn(async value=>pricing(value.modelId===models[4].modelId?'FREE':'PAID')));
 expect(await generate(input,f.gen)).toMatchObject({modelId:models[4].id,fallbackUsed:false});
 expect(f.chat.generate).toHaveBeenCalledOnce();
});
it('does not exhaust free embedding quota by trying a paid fallback and preserves the requested vector cohort',async()=>{
 const f=fixture([model(1),model(2)],vi.fn(async value=>pricing(value.modelId.endsWith('-1')?'FREE':'PAID')));
 vi.mocked(f.embedding.embed).mockRejectedValue(new AIProviderError('RATE_LIMITED',429));
 await expect(embed({input:['query'],requestType:'EMBEDDING_QUERY',fingerprint:embeddingFingerprint(f.embeddings[0])},f.emb))
  .rejects.toMatchObject({code:'RATE_LIMITED'});
 expect(f.embedding.embed).toHaveBeenCalledOnce();
 expect(f.priceReader).toHaveBeenCalledWith(expect.objectContaining({purpose:'EMBEDDING',modelId:f.models[0].modelId}),expect.any(AbortSignal));
});
it('uses verified zero prices for embedding cost instead of manual display prices',async()=>{
 const f=fixture([model(1,{inputPricePerMillion:99,outputPricePerMillion:99})]);
 await embed({input:['query'],requestType:'EMBEDDING_QUERY'},f.emb);
 expect(f.attempts[0]).toMatchObject({estimatedCost:0,httpStatus:200});
 expect(vi.mocked(f.embedding.embed).mock.calls[0][0]).toMatchObject({costMode:'FREE_ONLY'});
});
it('allows paid generation only when the trusted registry config explicitly opts in',async()=>{
 const f=fixture([model(1,{adapter:'OPENAI',baseUrl:'https://api.openai.com/v1',costMode:'ALLOW_PAID',inputPricePerMillion:1,outputPricePerMillion:2})],vi.fn(async()=>pricing('UNKNOWN')));
 await generate(input,f.gen);expect(f.chat.generate).toHaveBeenCalledOnce();expect(f.priceReader).not.toHaveBeenCalled();
 // Native adapter retains its existing strict request contract.
 expect(vi.mocked(f.chat.generate).mock.calls[0][0]).not.toHaveProperty('costMode');
 expect(f.attempts[0].estimatedCost).toBe(0.000004);
});
it('fails closed for invalid cost policy and internally inconsistent FREE evidence',async()=>{
 const invalid=fixture([model(1,{costMode:'invalid' as AIModelConfig['costMode']})]);
 await expect(generate(input,invalid.gen)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(invalid.chat.generate).not.toHaveBeenCalled();
 const inconsistent=fixture([model(1)],vi.fn(async()=>({...pricing('FREE'),inputPricePerMillion:1})));
 await expect(generate(input,inconsistent.gen)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(inconsistent.chat.generate).not.toHaveBeenCalled();
});
it('bounds a pricing reader that ignores cancellation within the total generation deadline',async()=>{
 const f=fixture([model(1,{timeoutMs:1000})],vi.fn<PriceReader>(()=>new Promise(()=>{})));
 await expect(generate({...input,timeoutMs:20},f.gen)).rejects.toMatchObject({code:'TIMEOUT'});
 expect(f.chat.generate).not.toHaveBeenCalled();
});
it('shares embedding deadline with metadata and stops before inference after cancellation',async()=>{
 const controller=new AbortController(),reader=vi.fn<PriceReader>(async()=>{controller.abort();return pricing('FREE');});
 const f=fixture([model(1)],reader);
 await expect(embed({input:['query'],requestType:'EMBEDDING_QUERY',signal:controller.signal},f.emb)).rejects.toMatchObject({code:'CANCELLED'});
 expect(f.embedding.embed).not.toHaveBeenCalled();
});
it.each(['invalid',new Date(0).toISOString(),new Date(Date.now()+120_000).toISOString(),undefined])('blocks invalid or stale catalog timestamp %s',async checkedAt=>{
 const f=fixture([model(1)],vi.fn(async()=>({...pricing('FREE'),checkedAt:checkedAt as string})));
 await expect(generate(input,f.gen)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 await expect(embed({input:['query'],requestType:'EMBEDDING_QUERY'},f.emb)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(f.chat.generate).not.toHaveBeenCalled();expect(f.embedding.embed).not.toHaveBeenCalled();
});
it('does not restart the inference budget after catalog lookup',async()=>{
 vi.useFakeTimers();
 try{
  const f=fixture([model(1,{timeoutMs:40})],vi.fn(async()=>{await new Promise(resolve=>setTimeout(resolve,25));return pricing('FREE');}));
  vi.mocked(f.chat.generate).mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,30));return {output:{answer:'late'},toolCalls:[],inputTokens:1,outputTokens:1};});
  const pending=generate({...input,timeoutMs:40},f.gen).catch(error=>error);
  await vi.advanceTimersByTimeAsync(41);
  expect(await pending).toMatchObject({code:'TIMEOUT'});expect(f.chat.generate).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
it('prevents late inference when a timed-out catalog reader eventually resolves',async()=>{
 let complete!:(value:ModelPricing)=>void;
 const f=fixture([model(1,{timeoutMs:1000})],vi.fn<PriceReader>(()=>new Promise(resolve=>{complete=resolve;})));
 await expect(generate({...input,timeoutMs:20},f.gen)).rejects.toMatchObject({code:'TIMEOUT'});
 complete(pricing('FREE'));await Promise.resolve();await Promise.resolve();
 expect(f.chat.generate).not.toHaveBeenCalled();
});
