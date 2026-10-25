import {afterEach,expect,it,vi} from 'vitest';
import {authorizeModelCost} from '../lib/ai/cost-policy';
import type {AIModelConfig} from '../lib/ai/types';
import {generate} from '../lib/ai/gateway';
import {encryptValue} from '../lib/security/identity';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
const model:AIModelConfig={id:'00000000-0000-4000-8000-000000000002',providerId:'00000000-0000-4000-8000-000000000001',adapter:'COMPATIBLE',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',modelId:'gemini-3.5-flash-lite',providerNetworkRevision:3,providerRevision:2,modelRevision:0,providerPriority:0,priority:0,apiKeyEncrypted:'not-a-key',timeoutMs:15000,supportsJson:true,supportsTools:true,costMode:'FREE_ONLY',inputPricePerMillion:null,outputPricePerMillion:null};
const grant=()=>({providerId:model.providerId,networkRevision:3,baseUrl:model.baseUrl,models:[model.modelId],confirmedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()});
const read=vi.fn(async()=>({status:'UNKNOWN' as const,inputPricePerMillion:null,outputPricePerMillion:null,checkedAt:new Date().toISOString(),apiFormat:null}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('does not report manually entered paid rates as the cost of an account-free call',async()=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',JSON.stringify([grant()]));
 const key=randomBytes(32).toString('base64'),recordAttempt=vi.fn();
 await generate({taskType:'ANSWER',messages:[{role:'user',content:'Synthetic test'}],responseName:'answer',responseSchema:z.object({answer:z.string()})},
  {key,store:{loadModels:async()=>[{...model,apiKeyEncrypted:encryptValue('synthetic-key',key),inputPricePerMillion:10,outputPricePerMillion:20}],recordAttempt},
   priceReader:read,adapters:{COMPATIBLE:{healthCheck:async()=> 'HEALTHY',generate:async()=>({output:{answer:'Synthetic answer'},toolCalls:[],inputTokens:100,outputTokens:50})}}});
 expect(recordAttempt).toHaveBeenCalledWith(expect.objectContaining({status:'SUCCESS',inputTokens:100,outputTokens:50,estimatedCost:null}));
 expect(read).not.toHaveBeenCalled();
});
it('admits the explicitly confirmed free account without manufacturing catalog prices',async()=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',JSON.stringify([grant()]));
 expect(await authorizeModelCost(model,'GENERATION',read,new AbortController().signal)).toEqual({costMode:'FREE_ONLY',apiFormat:'CHAT',accountConfirmedFree:true});
 expect(read).not.toHaveBeenCalled();
});
it.each([{providerNetworkRevision:4},{modelId:'gemini-paid'},{adapter:'OPENAI'},{baseUrl:'https://attacker.example'},{providerId:'00000000-0000-4000-8000-000000000009'}])('rejects changed identity %j',async change=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',JSON.stringify([grant()]));
 expect(await authorizeModelCost({...model,...change},'GENERATION',read,new AbortController().signal)).toBeNull();
});
it.each(['invalid',JSON.stringify([{...grant(),expiresAt:'2000-01-01T00:00:00Z'}]),JSON.stringify([{...grant(),expiresAt:'2099-01-01T00:00:00Z'}])])('rejects malformed or expired grants',async value=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',value);
 expect(await authorizeModelCost(model,'GENERATION',read,new AbortController().signal)).toBeNull();
});
it('never grants embeddings through a generation account confirmation',async()=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',JSON.stringify([grant()]));
 expect(await authorizeModelCost(model,'EMBEDDING',read,new AbortController().signal)).toBeNull();
});
it.each([null,'2000-01-01T00:00:00Z'])('rechecks managed revocation/expiry before inference instead of reviving the environment grant (%s)',async expiresAt=>{
 vi.stubEnv('YRU_FREE_ACCOUNT_GRANTS',JSON.stringify([grant()]));
 const key=randomBytes(32).toString('base64'),inference=vi.fn(),readAccountFreeUntil=vi.fn(async()=>expiresAt);
 await expect(generate({taskType:'ANSWER',messages:[{role:'user',content:'Synthetic test'}],responseName:'answer',responseSchema:z.object({answer:z.string()})},
  {key,store:{loadModels:async()=>[{...model,apiKeyEncrypted:encryptValue('synthetic-key',key)}],recordAttempt:vi.fn(),readAccountFreeUntil},
   priceReader:read,adapters:{COMPATIBLE:{healthCheck:async()=> 'HEALTHY',generate:async()=>{inference();return {output:{answer:'Synthetic answer'},toolCalls:[],inputTokens:1,outputTokens:1};}}}})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(readAccountFreeUntil).toHaveBeenCalledOnce();expect(inference).not.toHaveBeenCalled();
});
it('rejects a grant revoked while awaiting durable attempt reservation before exposing the key or calling HTTP',async()=>{
 const key=randomBytes(32).toString('base64'),inference=vi.fn();let revoked=false;
 const readAccountFreeUntil=vi.fn(async()=>revoked?null:new Date(Date.now()+60000).toISOString());
 const finish=vi.fn();
 await expect(generate({taskType:'ANSWER',messages:[{role:'user',content:'Synthetic test'}],responseName:'answer',responseSchema:z.object({answer:z.string()})},
  {key,store:{loadModels:async()=>[{...model,apiKeyEncrypted:encryptValue('synthetic-key',key)}],recordAttempt:vi.fn(),readAccountFreeUntil},
   turnBudget:{get used(){return Number(revoked);},canAttempt:async()=>true,reserve:async()=>{revoked=true;return {finish};}},
   priceReader:read,adapters:{COMPATIBLE:{healthCheck:async()=> 'HEALTHY',generate:async()=>{inference();return {output:{answer:'Synthetic answer'},toolCalls:[],inputTokens:1,outputTokens:1};}}}})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 expect(inference).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledWith('PROVIDER_UNAVAILABLE');
});
