import {expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {routingInferenceBudgetMs} from '../lib/conversation/semantic-routing-contracts';
import {createSemanticRoutingClassifier} from '../lib/conversation/semantic-routing-provider';
import {generate} from '../lib/ai/gateway';
import {encryptValue} from '../lib/security/identity';
import type {AIModelConfig,AIAttempt} from '../lib/ai/types';

it('bounds inference below the remaining inbox lease with the existing seven-second safety reserve',()=>{
 expect(routingInferenceBudgetMs(60000)).toBe(25000);
 expect(routingInferenceBudgetMs('15000')).toBe(8000);
 expect(routingInferenceBudgetMs(7100)).toBe(100);
 for(const invalid of [7000,0,-1,undefined,NaN,Infinity,'invalid'])expect(routingInferenceBudgetMs(invalid)).toBeNull();
});
it('accepts one valid nine-second inference through the real Gateway without a retry or extra provider',async()=>{
 vi.useFakeTimers();
 try{
  const key=randomBytes(32).toString('base64'),attempts:AIAttempt[]=[];
  const model:AIModelConfig={id:randomUUID(),providerId:randomUUID(),adapter:'MOCK',modelId:'owned-timeout-fixture',baseUrl:'https://example.invalid',
   apiKeyEncrypted:encryptValue('synthetic-key',key),providerPriority:0,priority:0,providerRevision:0,modelRevision:0,
   timeoutMs:15000,supportsJson:true,supportsTools:false,inputPricePerMillion:1,outputPricePerMillion:1,costMode:'ALLOW_PAID'};
  const request=vi.fn(async()=>await new Promise<{output:unknown;toolCalls:[];inputTokens:null;outputTokens:null;httpStatus:200}>(resolve=>setTimeout(()=>resolve({
   output:{decision:'CONTINUE',candidateCode:'C1',confidence:.95},toolCalls:[],inputTokens:null,outputTokens:null,httpStatus:200,
  }),9000)));
  const classify=createSemanticRoutingClassifier(input=>generate(input,{key,store:{loadModels:async()=>[model],recordAttempt:async a=>{attempts.push(a);}},
   adapters:{MOCK:{generate:request,healthCheck:async()=> 'HEALTHY'}}}));
  const result=classify({question:'ต่อเรื่องนี้ด้วยครับ',contexts:[{code:'C1',mode:'AI',topic:'การเข้าใช้ระบบ',summary:null,previousUserMessages:[]}]},new AbortController().signal);
  await vi.advanceTimersByTimeAsync(9001);
  expect(await result).toEqual({decision:'CONTINUE',candidateCode:'C1',confidence:.95});
  expect(request).toHaveBeenCalledTimes(1);expect(attempts).toHaveLength(1);expect(attempts[0].status).toBe('SUCCESS');
 }finally{vi.useRealTimers();}
});
