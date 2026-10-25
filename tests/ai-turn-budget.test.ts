import {describe,expect,it,vi} from 'vitest';
import {createTurnBudget} from '../lib/ai/turn-budget';
import {AIProviderError,type AIModelConfig,type AIProviderAdapter} from '../lib/ai/types';
import {generate} from '../lib/ai/gateway';
import {encryptValue} from '../lib/security/identity';
import {z} from 'zod';
import type {PriceReader} from '../lib/ai/pricing';
import type {TurnBudget} from '../lib/ai/turn-budget';

const key=Buffer.alloc(32,9).toString('base64');
function model(id='model-a',revision=1):AIModelConfig{return {id,providerId:'provider-'+id,adapter:'MOCK',modelId:id,baseUrl:'https://example.com',apiKeyEncrypted:encryptValue('synthetic-key',key),providerRevision:1,modelRevision:revision,providerNetworkRevision:1,modelNetworkRevision:revision,providerPriority:1,priority:id==='model-a'?1:2,timeoutMs:1000,supportsJson:true,supportsTools:false,inputPricePerMillion:0,outputPricePerMillion:0,costMode:'FREE_ONLY'};}
const input={taskType:'TEST',messages:[{role:'user' as const,content:'synthetic'}],responseName:'answer',responseSchema:z.object({answer:z.string()}),timeoutMs:2000};
const success={output:{answer:'ok'},toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200};
function options(budget:TurnBudget,adapter:AIProviderAdapter['generate'],models=[model(),model('model-b')]){
 return {key,turnBudget:budget,store:{loadModels:async()=>models,recordAttempt:vi.fn(async()=>{})},adapters:{MOCK:{generate:adapter,healthCheck:vi.fn()}},priceReader:vi.fn<PriceReader>(async()=>({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT'}))};
}
describe('server-owned inference turn budget',()=>{
 it('awaits durable reservation before HTTP and durable completion before returning',async()=>{
  const order:string[]=[],adapter=vi.fn(async()=>{order.push('http');return success;});
  const budget:TurnBudget={used:0,canAttempt:async()=>true,reserve:async()=>{await Promise.resolve();order.push('reserved');return {finish:async()=>{await Promise.resolve();order.push('finished');}};}};
  await generate(input,options(budget,adapter));expect(order).toEqual(['reserved','http','finished']);
 });
 it('does not call providers when durable ownership validation fails',async()=>{
  const adapter=vi.fn(),budget:TurnBudget={used:0,canAttempt:async()=>{throw new Error('TURN_OWNER_STALE');},reserve:vi.fn()};
  await expect(generate(input,options(budget,adapter))).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(adapter).not.toHaveBeenCalled();expect(budget.reserve).not.toHaveBeenCalled();
 });
 it('never starts HTTP if a durable reservation completes after cancellation',async()=>{
  const controller=new AbortController(),adapter=vi.fn();
  let release:()=>void=()=>{},started:()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{started=resolve;});
  const budget:TurnBudget={used:0,canAttempt:async()=>true,reserve:async()=>{started();await new Promise<void>(resolve=>{release=resolve;});return {finish:vi.fn()};}};
  const pending=expect(generate({...input,signal:controller.signal},options(budget,adapter))).rejects.toMatchObject({code:'CANCELLED'});
  await waiting;controller.abort();await pending;release();await new Promise(resolve=>setTimeout(resolve,0));expect(adapter).not.toHaveBeenCalled();
 });
 it('does not return an answer or try another model when durable completion fails',async()=>{
  const adapter=vi.fn().mockResolvedValue(success),budget:TurnBudget={used:1,canAttempt:async()=>true,reserve:async()=>({finish:async()=>{throw new Error('DB_UNAVAILABLE');}})};
  await expect(generate(input,options(budget,adapter))).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(adapter).toHaveBeenCalledTimes(1);
 });
 it('skips a failed configuration on the next generation stage without Retry-After',async()=>{
  const budget=createTurnBudget({limit:4}),adapter=vi.fn().mockRejectedValueOnce(new AIProviderError('RATE_LIMITED',429)).mockResolvedValue(success),config=options(budget,adapter);
  await generate(input,config);await generate(input,config);
  expect(adapter.mock.calls.map(call=>call[0].modelId)).toEqual(['model-a','model-b','model-b']);expect(budget.used).toBe(3);
 });
 it('retains the total cap across successful stages',async()=>{const budget=createTurnBudget({limit:2}),adapter=vi.fn().mockResolvedValue(success),config=options(budget,adapter);await generate(input,config);await generate(input,config);await expect(generate(input,config)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(adapter).toHaveBeenCalledTimes(2);});
 it('isolates independent turns',async()=>{const first=createTurnBudget({limit:1}),second=createTurnBudget({limit:1});first.reserve(model())?.finish('RATE_LIMITED');expect(first.reserve(model())).toBeNull();expect(second.reserve(model())).not.toBeNull();});
 it.each(['UNKNOWN','PAID'] as const)('does not consume inference budget for %s metadata',async status=>{const budget=createTurnBudget({limit:2}),adapter=vi.fn(),config=options(budget,adapter);config.priceReader.mockResolvedValue({status,inputPricePerMillion:null,outputPricePerMillion:null,checkedAt:new Date().toISOString(),apiFormat:null});await expect(generate(input,config)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(budget.used).toBe(0);expect(adapter).not.toHaveBeenCalled();});
 it('rejects concurrent duplicate attempts and releases a successful model for later calls',()=>{const budget=createTurnBudget({limit:4});const attempt=budget.reserve(model());expect(budget.reserve(model())).toBeNull();attempt?.finish();expect(budget.reserve(model())).not.toBeNull();});
 it('permits a changed configuration but does not reset consumed attempts',()=>{const budget=createTurnBudget({limit:2});budget.reserve(model())?.finish('INVALID_OUTPUT');expect(budget.reserve(model())).toBeNull();expect(budget.reserve(model('model-a',2))).not.toBeNull();expect(budget.used).toBe(2);});
 it('caps simultaneous stages after cost authorization',async()=>{const budget=createTurnBudget({limit:1}),adapter=vi.fn().mockResolvedValue(success),config=options(budget,adapter);const results=await Promise.allSettled([generate(input,config),generate(input,config)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(adapter).toHaveBeenCalledTimes(1);});
 it('does not charge a call canceled before it starts',async()=>{const budget=createTurnBudget({limit:1}),adapter=vi.fn();await expect(generate({...input,signal:AbortSignal.abort()},options(budget,adapter))).rejects.toMatchObject({code:'CANCELLED'});expect(budget.used).toBe(0);});
 it.each([0,5,1.5,NaN])('rejects an invalid attempt ceiling %s',limit=>{expect(()=>createTurnBudget({limit})).toThrow('TURN_BUDGET_INVALID');});
 it('ignores duplicate finish calls so failure cannot be overwritten by success',()=>{const budget=createTurnBudget({limit:3}),attempt=budget.reserve(model());attempt?.finish('RATE_LIMITED');attempt?.finish();expect(budget.reserve(model())).toBeNull();});
 it('retains a charged timed-out attempt even if its adapter ignores abort',async()=>{
  const budget=createTurnBudget({limit:2}),adapter=vi.fn(async()=>new Promise<typeof success>(()=>{})),config=options(budget,adapter,[model()]);
  await expect(generate({...input,timeoutMs:30},config)).rejects.toMatchObject({code:'TIMEOUT'});
  expect(budget.used).toBe(1);expect(budget.canAttempt(model())).toBe(false);
  await expect(generate(input,config)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(adapter).toHaveBeenCalledTimes(1);
 });
});
