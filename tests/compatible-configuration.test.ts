import {expect,it,vi} from 'vitest';
import {createProviderSchema,updateProviderSchema} from '../types/providers';
import {createProviderRegistry,createEmbeddingProviderRegistry} from '../lib/ai/provider-registry';
import {createPriceReader} from '../lib/ai/pricing';
import {probeModel,type ModelProbeConfig} from '../lib/ai/model-probe';
import type {CompatibleTransport} from '../lib/ai/compatible-network';

const base='https://api.provider-support.com/v1';
const input={name:'Compatible fixture',adapter:'COMPATIBLE',baseUrl:'https://API.Provider-Support.com.:443/v1/',apiKey:'fixture-key',enabled:true,priority:1};
it('accepts and canonicalizes a compatible endpoint with FREE_ONLY by default',()=>{
 expect(createProviderSchema.parse(input)).toMatchObject({adapter:'COMPATIBLE',baseUrl:base,costMode:'FREE_ONLY'});
 expect(updateProviderSchema.parse({...input,apiKey:null,revision:2})).toMatchObject({baseUrl:base});
});
it.each(['http://127.0.0.1','https://api.local/v1','https://user:secret@api.provider-support.com/v1','https://api.provider-support.com/v1?key=secret'])('rejects unsafe compatible configuration %s',baseUrl=>{
 expect(createProviderSchema.safeParse({...input,baseUrl}).success).toBe(false);
});
it('installs compatible generation and embedding adapters without widening official roots',()=>{
 expect(createProviderRegistry()).toHaveProperty('COMPATIBLE.generate');expect(createEmbeddingProviderRegistry()).toHaveProperty('COMPATIBLE.embed');
});
it('keeps generic price UNKNOWN without metadata/DNS/inference, including free-looking names',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();const read=createPriceReader({fetchImpl});
 for(const purpose of ['GENERATION','EMBEDDING'] as const){
  expect(await read({adapter:'COMPATIBLE',baseUrl:base,modelId:'fixture/free:free',purpose},new AbortController().signal)).toMatchObject({status:'UNKNOWN',inputPricePerMillion:null,outputPricePerMillion:null});
 }
 expect(fetchImpl).not.toHaveBeenCalled();
});
const config:ModelProbeConfig={id:'00000000-0000-4000-8000-000000000001',providerId:'00000000-0000-4000-8000-000000000002',
 adapter:'COMPATIBLE',modelId:'fixture/model',baseUrl:base,apiKeyEncrypted:'undecryptable-canary',providerRevision:0,modelRevision:0,providerPriority:0,priority:0,
 timeoutMs:1000,supportsJson:true,supportsTools:false,inputPricePerMillion:0,outputPricePerMillion:0,costMode:'ALLOW_PAID',purpose:'GENERATION'};
it('forces selected compatible tests to PRICE_UNKNOWN before decrypt or network despite paid config/manual zero',async()=>{
 const send=vi.fn<CompatibleTransport['request']>();const transport={request:send};
 const options={key:'invalid-key',generationAdapters:createProviderRegistry({compatibleTransport:transport}),embeddingAdapters:createEmbeddingProviderRegistry({compatibleTransport:transport})};
 expect(await probeModel(config,'GENERATION_TEST',options)).toMatchObject({result:'BLOCKED',errorCode:'PRICE_UNKNOWN',httpStatus:null});
 expect(await probeModel({...config,purpose:'EMBEDDING',dimensions:2,supportsJson:false},'EMBEDDING_TEST',options)).toMatchObject({result:'BLOCKED',errorCode:'PRICE_UNKNOWN',httpStatus:null});
 expect(send).not.toHaveBeenCalled();
});
it('performs selected compatible metadata through the supplied bounded transport and validates model identity',async()=>{
 const send=vi.fn<CompatibleTransport['request']>(async()=>({status:200,contentType:'application/json',retryAfter:null,json:{data:[{id:'fixture/model'}]}}));
 const transport={request:send};
 const {encryptValue}=await import('../lib/security/identity');const key=Buffer.alloc(32,1).toString('base64');
 const observed=await probeModel({...config,apiKeyEncrypted:encryptValue('fixture-key',key)},'METADATA',{
  key,generationAdapters:createProviderRegistry({compatibleTransport:transport}),embeddingAdapters:createEmbeddingProviderRegistry({compatibleTransport:transport}),compatibleTransport:transport,
 });
 expect(observed).toMatchObject({result:'SUCCESS',httpStatus:200});expect(send).toHaveBeenCalledWith(base,expect.objectContaining({route:'models',apiKey:'fixture-key'}));
});
