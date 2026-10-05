import {describe,expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {generate} from '../lib/ai/gateway';
import {encryptValue} from '../lib/security/identity';
import {AIProviderError,type AIProviderAdapter,type AIModelConfig,type AIAttempt,type ProviderResponse} from '../lib/ai/types';

const schema=z.object({answer:z.string()}).strict(),key=randomBytes(32).toString('base64');
const normal:ProviderResponse={output:{answer:'คำตอบทดสอบ'},toolCalls:[],inputTokens:20,outputTokens:10};
const config=(priority:number):AIModelConfig=>({id:randomUUID(),providerId:randomUUID(),adapter:'MOCK',modelId:`fixture-${priority}`,
 baseUrl:'https://api.openai.com/v1',apiKeyEncrypted:encryptValue('fixture-key',key),providerPriority:priority,priority:1,
 providerRevision:0,modelRevision:0,timeoutMs:100,supportsJson:true,supportsTools:true,inputPricePerMillion:1,outputPricePerMillion:2,costMode:'ALLOW_PAID'});
function fixture(models=[config(1),config(2)]){
 const attempts:AIAttempt[]=[];
 const adapter:AIProviderAdapter={generate:vi.fn().mockResolvedValue(normal),healthCheck:vi.fn().mockResolvedValue('HEALTHY')};
 const options={key,adapters:{MOCK:adapter},store:{loadModels:async()=>models,recordAttempt:async(a:AIAttempt)=>{attempts.push(a);}}};
 const request={taskType:'ANSWER',messages:[{role:'user' as const,content:'ทดสอบ'}],responseSchema:schema,responseName:'answer',timeoutMs:1000};
 return {attempts,adapter,options,request,models};
}

describe('AI gateway validation, deadlines and observed attempts',()=>{
 it('normalizes a registry failure without exposing internal error text',async()=>{
  const f=fixture();f.options.store.loadModels=async()=>{throw new Error('private-registry-details');};
  await expect(generate(f.request,f.options)).rejects.toMatchObject({message:'PROVIDER_UNAVAILABLE',code:'PROVIDER_UNAVAILABLE'});
  expect(f.adapter.generate).not.toHaveBeenCalled();
 });
 it('normalizes observation failure and does not generate again after a completed provider request',async()=>{
  const f=fixture();f.options.store.recordAttempt=async()=>{throw new Error('private-observation-details');};
  await expect(generate(f.request,f.options)).rejects.toMatchObject({message:'PROVIDER_UNAVAILABLE',code:'PROVIDER_UNAVAILABLE'});
  expect(f.adapter.generate).toHaveBeenCalledTimes(1);
 });
 it('returns validated output, prioritizes providers and records usage/cost without credentials',async()=>{
  const f=fixture([config(2),config(1)]);
  const result=await generate(f.request,f.options);
  expect(result.output).toEqual(normal.output);expect(result.fallbackUsed).toBe(false);
  expect(vi.mocked(f.adapter.generate).mock.calls[0][0].modelId).toBe('fixture-1');
  expect(f.attempts).toHaveLength(1);expect(f.attempts[0]).toMatchObject({status:'SUCCESS',inputTokens:20,outputTokens:10,health:'HEALTHY',estimatedCost:0.00004});
  expect(JSON.stringify(f.attempts)).not.toContain('fixture-key');
 });
 it.each(['RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','PROVIDER_UNAVAILABLE'] as const)('falls back on %s and records both attempts',async(code)=>{
  const f=fixture();vi.mocked(f.adapter.generate).mockRejectedValueOnce(new AIProviderError(code,code==='RATE_LIMITED'?429:503));
  const result=await generate(f.request,f.options);
  expect(result.output).toEqual(normal.output);expect(result.fallbackUsed).toBe(true);
  expect(f.attempts.map(a=>a.status)).toEqual(['ERROR','SUCCESS']);expect(f.attempts[0].errorCode).toBe(code);
  expect(f.attempts[1].fallbackUsed).toBe(true);
 });
 it('times out even an adapter that ignores abort, then uses the next available model',async()=>{
  const f=fixture();f.models[0].timeoutMs=10;
  vi.mocked(f.adapter.generate).mockImplementationOnce(()=>new Promise(()=>{}));
  const result=await generate(f.request,f.options);
  expect(result.fallbackUsed).toBe(true);expect(f.attempts[0].errorCode).toBe('TIMEOUT');
 });
 it('invalid structured output cannot be returned and falls back',async()=>{
  const f=fixture();vi.mocked(f.adapter.generate).mockResolvedValueOnce({...normal,output:{answer:'x',unexpected:true}});
  expect((await generate(f.request,f.options)).output).toEqual(normal.output);
  expect(f.attempts[0].errorCode).toBe('INVALID_OUTPUT');
 });
 it('does not fall back for authentication errors',async()=>{
  const f=fixture();vi.mocked(f.adapter.generate).mockRejectedValue(new AIProviderError('AUTH_ERROR',401));
  await expect(generate(f.request,f.options)).rejects.toMatchObject({code:'AUTH_ERROR'});
  expect(f.adapter.generate).toHaveBeenCalledTimes(1);expect(f.attempts).toHaveLength(1);
 });
 it('enforces one overall deadline instead of granting every fallback a new budget',async()=>{
  const f=fixture();f.models.forEach(model=>{model.timeoutMs=100;});
  vi.mocked(f.adapter.generate).mockImplementation(()=>new Promise(()=>{}));
  const started=Date.now();await expect(generate({...f.request,timeoutMs:20},f.options)).rejects.toMatchObject({code:'TIMEOUT'});
  expect(Date.now()-started).toBeLessThan(250);expect(f.adapter.generate).toHaveBeenCalledTimes(1);
 });
 it('cancellation prevents further attempts and keeps provider error text out of logs',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  await expect(generate({...f.request,signal:controller.signal},f.options)).rejects.toMatchObject({code:'CANCELLED'});
  expect(f.adapter.generate).not.toHaveBeenCalled();expect(f.attempts).toHaveLength(0);
 });
 it('unknown model tool calls never reach a backend executor or a successful result',async()=>{
  const f=fixture([config(1)]);
  vi.mocked(f.adapter.generate).mockResolvedValue({...normal,output:null,toolCalls:[{id:'call_test',name:'execute_sql',arguments:{sql:'drop table'}}]});
  await expect(generate({...f.request,tools:[{name:'search_knowledge',description:'Search approved knowledge',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]},f.options)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
  expect(f.attempts[0].status).toBe('ERROR');
 });
 it('missing compatible models fails without a provider request or fabricated usage',async()=>{
  const f=fixture([]);await expect(generate(f.request,f.options)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  expect(f.adapter.generate).not.toHaveBeenCalled();expect(f.attempts).toHaveLength(0);
 });
 it('never attempts more than three enabled models',async()=>{
  const f=fixture([config(1),config(2),config(3),config(4)]);
  vi.mocked(f.adapter.generate).mockRejectedValue(new AIProviderError('SERVER_ERROR',503));
  await expect(generate(f.request,f.options)).rejects.toMatchObject({code:'SERVER_ERROR'});
  expect(f.adapter.generate).toHaveBeenCalledTimes(3);expect(f.attempts).toHaveLength(3);
 });
});
