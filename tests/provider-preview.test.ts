import {expect,it} from 'vitest';
import {buildFallbackPreview} from '../lib/ai/provider-preview';
import type {ProviderView,ModelView,PreviewProfile} from '../types/providers';
const profile:PreviewProfile={purpose:'GENERATION',requiresJson:true,requiresTools:true},now=Date.now();
function model(id:string,overrides:Partial<ModelView>={}):ModelView {
 return {id,modelId:`fixture/${id}`,displayName:id,purpose:'GENERATION',embeddingDimensions:null,supportsTools:true,supportsJson:true,supportsVision:false,
  enabled:true,priority:1,timeoutMs:1000,inputPricePerMillion:0,outputPricePerMillion:0,revision:0,pricingStatus:'FREE',pricingCheckedAt:new Date(now).toISOString(),apiFormat:'CHAT',...overrides};
}
function provider(id:string,models:ModelView[],overrides:Partial<ProviderView>={}):ProviderView {
 return {id,name:id,adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',enabled:true,priority:1,costMode:'FREE_ONLY',healthStatus:'UNKNOWN',lastHealthCheck:null,
  keyConfigured:true,revision:0,models,...overrides};
}
it('previews the purpose/capability/price profile in saved deterministic provider/model order',()=>{
 const result=buildFallbackPreview([provider('second',[model('z'),model('a')],{priority:2}),provider('first',[model('b'),model('c',{supportsTools:false})])],profile,now);
 expect(result.rows.filter(value=>value.position!==null).map(value=>value.modelId)).toEqual(['b','a','z']);
 expect(result.rows.find(value=>value.modelId==='c')?.reason).toBe('CAPABILITY_UNSUPPORTED');
 expect(result.maxInferenceAttempts).toBe(3);expect(result.pricingEvidence).toBe('LAST_CATALOG_OBSERVATION');
});
it('keeps disabled, paid, unknown and stale rows truthful and does not promote manual zero prices',()=>{
 const result=buildFallbackPreview([provider('fixture',[model('disabled',{enabled:false}),model('paid',{pricingStatus:'PAID'}),
  model('unknown',{pricingStatus:'UNKNOWN'}),model('stale',{pricingCheckedAt:new Date(now-61_000).toISOString()})])],profile,now);
 expect(Object.fromEntries(result.rows.map(value=>[value.modelId,value.reason]))).toEqual({disabled:'DISABLED',paid:'PAID_BLOCKED',unknown:'PRICE_UNKNOWN',stale:'PRICE_UNKNOWN'});
});
it('only explicit trusted ALLOW_PAID changes the runtime cost eligibility',()=>{
 const result=buildFallbackPreview([provider('fixture',[model('paid',{pricingStatus:'PAID'})],{costMode:'ALLOW_PAID'})],profile,now);
 expect(result.rows[0]).toMatchObject({modelId:'paid',position:1,reason:null});
});
it('separates embedding scope and honors a requested vector cohort',()=>{
 const result=buildFallbackPreview([provider('fixture',[model('chat'),model('vector',{purpose:'EMBEDDING',embeddingDimensions:3,supportsJson:false,supportsTools:false})])],
  {purpose:'EMBEDDING',requiresJson:false,requiresTools:false,fingerprint:'0'.repeat(64)},now);
 expect(result.rows).toHaveLength(1);expect(result.rows[0].reason).toBe('VECTOR_COHORT_MISMATCH');
});
it('marks eligible candidates beyond the three actual inference attempts',()=>{
 const result=buildFallbackPreview([provider('fixture',['a','b','c','d'].map(value=>model(value)))],profile,now);
 expect(result.rows.filter(value=>value.position!==null).map(value=>value.position)).toEqual([1,2,3]);
 expect(result.rows[3]).toMatchObject({modelId:'d',position:null,reason:'ATTEMPT_LIMIT'});
});
