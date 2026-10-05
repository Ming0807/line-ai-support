import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {generate} from '../lib/ai/gateway';
import {embed} from '../lib/ai/embedding-gateway';
import {probeModel} from '../lib/ai/model-probe';
import {buildFallbackPreview} from '../lib/ai/provider-preview';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIAttempt,type AIModelConfig} from '../lib/ai/types';
import type {PriceReader} from '../lib/ai/pricing';
import type {ProviderView} from '../types/providers';

const key=randomBytes(32).toString('base64');
const input={taskType:'ANSWER',messages:[{role:'user' as const,content:'fixture'}],responseName:'answer',responseSchema:z.object({answer:z.string()}).strict()};
function fixture(cooldownUntil:string|null){
 const models:Array<AIModelConfig & {providerNetworkRevision:number;modelNetworkRevision:number;cooldownUntil:string|null}>=[0,1].map(index=>({id:randomUUID(),providerId:randomUUID(),adapter:'OPENROUTER',modelId:`fixture/model-${index}`,
  baseUrl:'https://openrouter.ai/api/v1',apiKeyEncrypted:index===0&&cooldownUntil?'not-decryptable':encryptValue('fixture-key',key),
  providerRevision:3,modelRevision:2,providerNetworkRevision:1,modelNetworkRevision:0,providerPriority:index,priority:0,timeoutMs:1000,
  supportsJson:true,supportsTools:true,inputPricePerMillion:0,outputPricePerMillion:0,cooldownUntil:index===0?cooldownUntil:null}));
 const attempts:AIAttempt[]=[];
 const chat={generate:vi.fn(async()=>({output:{answer:'ok'},toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200})),healthCheck:vi.fn()};
 const embedding={embed:vi.fn(async()=>({vectors:[[1,0]],inputTokens:1,httpStatus:200}))};
 const priceReader=vi.fn<PriceReader>(async()=>({status:'FREE' as const,inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT' as const}));
 const store={loadModels:async()=>models,loadEmbeddingModels:async()=>models.map(model=>({...model,dimensions:2})),recordAttempt:async(attempt:AIAttempt)=>{attempts.push(attempt);}};
 return {models,chat,embedding,priceReader,attempts,gen:{store,key,priceReader,adapters:{OPENROUTER:chat}},emb:{store,key,priceReader,adapters:{OPENROUTER:embedding}}};
}
it('generation skips active cooldown before pricing, decrypting or consuming an inference attempt',async()=>{
 const f=fixture(new Date(Date.now()+60_000).toISOString());
 expect(await generate(input,f.gen)).toMatchObject({modelId:f.models[1].id,fallbackUsed:false});
 expect(f.priceReader).toHaveBeenCalledOnce();expect(f.priceReader.mock.calls[0][0]).toMatchObject({modelId:f.models[1].modelId});
 expect(f.chat.generate).toHaveBeenCalledOnce();expect(f.attempts).toHaveLength(1);
});
it('embedding applies the same cooldown before pricing and key access',async()=>{
 const f=fixture(new Date(Date.now()+60_000).toISOString());
 expect(await embed({input:['fixture'],requestType:'EMBEDDING_QUERY'},f.emb)).toMatchObject({modelId:f.models[1].id,fallbackUsed:false});
 expect(f.priceReader).toHaveBeenCalledOnce();expect(f.embedding.embed).toHaveBeenCalledOnce();expect(f.attempts).toHaveLength(1);
});
it.each([null,new Date(Date.now()-1000).toISOString(),'invalid'])('permits expired/absent/malformed cooldown %s without inventing a delay',async until=>{
 const f=fixture(until);f.models[0].apiKeyEncrypted=encryptValue('fixture-key',key);
 expect(await generate(input,f.gen)).toMatchObject({modelId:f.models[0].id});
 expect(await embed({input:['fixture'],requestType:'EMBEDDING_QUERY'},f.emb)).toMatchObject({modelId:f.models[0].id});
});
it('preserves hint receipt time and network identity in a runtime failure observation',async()=>{
 const f=fixture(null),observedAt=new Date().toISOString(),retryAt=new Date(Date.now()+120_000).toISOString();
 f.chat.generate.mockRejectedValueOnce(new AIProviderError('RATE_LIMITED',429,{source:'RETRY_AFTER',observedAt,retryAt}));
 await generate(input,f.gen);
 expect(f.attempts[0]).toMatchObject({httpStatus:429,providerNetworkRevision:1,modelNetworkRevision:0,retryEvidence:{source:'RETRY_AFTER',observedAt,retryAt}});
});
it('selected inference probe blocks cooldown without pricing, key access or fallback',async()=>{
 const f=fixture(new Date(Date.now()+60_000).toISOString());
 const result=await probeModel({...f.models[0],purpose:'GENERATION'},'GENERATION_TEST',{...f.gen,generationAdapters:f.gen.adapters,embeddingAdapters:f.emb.adapters});
 expect(result).toMatchObject({result:'BLOCKED',errorCode:'COOLDOWN',httpStatus:null});
 expect(f.priceReader).not.toHaveBeenCalled();expect(f.chat.generate).not.toHaveBeenCalled();
});
it('saved preview excludes matching cooldown and exposes its exact expiry; expiry restores eligibility',()=>{
 const f=fixture(new Date(Date.now()+60_000).toISOString()),now=Date.now();
 const providers:ProviderView[]=f.models.map(model=>({id:model.providerId,name:'fixture',adapter:'OPENROUTER',baseUrl:model.baseUrl,enabled:true,priority:model.providerPriority,
  healthStatus:'UNKNOWN',lastHealthCheck:null,keyConfigured:true,revision:3,costMode:'FREE_ONLY',models:[{...model,displayName:'fixture',modelId:model.modelId,purpose:'GENERATION',
   embeddingDimensions:null,supportsVision:false,enabled:true,revision:2,pricingStatus:'FREE',pricingCheckedAt:new Date(now).toISOString(),apiFormat:'CHAT'}]}));
 const profile={purpose:'GENERATION' as const,requiresJson:true,requiresTools:true};
 expect(buildFallbackPreview(providers,profile,now).rows[0]).toMatchObject({reason:'COOLDOWN',position:null,cooldownUntil:f.models[0].cooldownUntil});
 expect(buildFallbackPreview(providers,profile,Date.parse(f.models[0].cooldownUntil!)).rows[0].reason).not.toBe('COOLDOWN');
});
it.each([undefined,'CHAT'] as const)('Zen cannot silently choose a changed/unpinned protocol %s before inference',async apiFormat=>{
 const f=fixture(null);f.models.splice(1);
 Object.assign(f.models[0],{adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'fixture-chat',apiFormat});
 f.priceReader.mockResolvedValue({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'RESPONSES'});
 await expect(generate(input,{...f.gen,adapters:{ZEN:f.chat}})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(f.chat.generate).not.toHaveBeenCalled();expect(f.attempts).toHaveLength(0);
});
it('Zen permits the pinned protocol only when its fresh free catalog agrees',async()=>{
 const f=fixture(null);f.models.splice(1);
 Object.assign(f.models[0],{adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'fixture-chat',apiFormat:'CHAT'});
 expect(await generate(input,{...f.gen,adapters:{ZEN:f.chat}})).toMatchObject({modelId:f.models[0].id});
 expect(f.chat.generate).toHaveBeenCalledOnce();
});
