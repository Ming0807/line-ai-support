import {expect,it,vi} from 'vitest';
import {createImportModelProposal,freeImportStore} from '@/lib/imports/model-assistance-proposal';
import type {AIModelConfig} from '@/lib/ai/types';
import {randomBytes,randomUUID} from 'node:crypto';
import {encryptValue} from '@/lib/security/identity';
import {generate as gateway} from '@/lib/ai/gateway';

const source={segments:[{id:'p1',text:'ประกาศ คู่มือบริการห้องสมุด ปีการศึกษา 2569'}],families:[{code:'LIBRARY_GUIDE',name:'คู่มือห้องสมุด'}],departments:[{code:'LIBRARY',name:'ห้องสมุด'}]};
const output={suggestions:[{field:'title',value:'คู่มือบริการห้องสมุด',segmentId:'p1',quote:'คู่มือบริการห้องสมุด'}]};
it('leaves the saved backup time after a first-model timeout for explicit import assistance',async()=>{
 vi.useFakeTimers();try{
  const key=randomBytes(32).toString('base64');
  const models:AIModelConfig[]=[0,1].map(priority=>({id:randomUUID(),providerId:randomUUID(),adapter:'MOCK',modelId:`model-${priority}`,baseUrl:'https://example.com/v1',apiKeyEncrypted:encryptValue('synthetic-only',key),providerRevision:0,modelRevision:0,providerPriority:priority,priority:0,timeoutMs:15000,supportsTools:false,supportsJson:true,costMode:'FREE_ONLY',inputPricePerMillion:0,outputPricePerMillion:0}));
  const invoke=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve({output,toolCalls:[],inputTokens:1,outputTokens:1,httpStatus:200}),12000)));
  const propose=createImportModelProposal(input=>gateway(input,{key,store:{loadModels:async()=>models,recordAttempt:async()=>{}},adapters:{MOCK:{generate:invoke,healthCheck:async()=>'HEALTHY'}},priceReader:async()=>({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,checkedAt:new Date().toISOString(),apiFormat:'CHAT'})}));
  const pending=expect(propose(source,new AbortController().signal)).resolves.toEqual(output.suggestions);void pending.catch(()=>undefined);
  await vi.advanceTimersByTimeAsync(27001);await pending;expect(invoke).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
it('requires exact source evidence and existing reference codes',async()=>{
 const generate=vi.fn().mockResolvedValue({output,toolCalls:[]});
 expect(await createImportModelProposal(generate)(source,new AbortController().signal)).toEqual(output.suggestions);
 generate.mockResolvedValue({output:{suggestions:[{...output.suggestions[0],quote:'invented'}]},toolCalls:[]});
 await expect(createImportModelProposal(generate)(source,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 generate.mockResolvedValue({output:{suggestions:[{...output.suggestions[0],field:'familyCode',value:'INVENTED'}]},toolCalls:[]});
 await expect(createImportModelProposal(generate)(source,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('rejects authority fields, duplicate proposals, tools and unmapped year',async()=>{
 for(const result of [
  {output:{suggestions:[{...output.suggestions[0],field:'visibility',value:'PUBLIC'}]},toolCalls:[]},
  {output:{suggestions:[...output.suggestions,...output.suggestions]},toolCalls:[]},
  {output,toolCalls:[{name:'publish'}]},
  {output:{suggestions:[{...output.suggestions[0],field:'academicYear',value:'2570'}]},toolCalls:[]},
 ])await expect(createImportModelProposal(vi.fn().mockResolvedValue(result))(source,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('does not dispatch after cancellation',async()=>{
 const generate=vi.fn(),controller=new AbortController();controller.abort();
 await expect(createImportModelProposal(generate)(source,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(generate).not.toHaveBeenCalled();
});
it('normalizes a Thai-digit academic year while retaining the exact source quote',async()=>{
 const thaiSource={...source,segments:[{id:'p1',text:'ประกาศ ปีการศึกษา ๒๕๖๙'}]};
 for(const value of ['2569','๒๕๖๙']){
  const generate=vi.fn().mockResolvedValue({output:{suggestions:[{field:'academicYear',value,segmentId:'p1',quote:'ปีการศึกษา ๒๕๖๙'}]},toolCalls:[]});
  expect(await createImportModelProposal(generate)(thaiSource,new AbortController().signal)).toEqual([{field:'academicYear',value:'2569',segmentId:'p1',quote:'ปีการศึกษา ๒๕๖๙'}]);
 }
});
it('excludes paid and unspecified cost modes while preserving observation writes',async()=>{
 const models=[{id:'free',costMode:'FREE_ONLY'},{id:'paid',costMode:'ALLOW_PAID'},{id:'unknown'}] as AIModelConfig[];
 const store={loadModels:vi.fn().mockResolvedValue(models),recordAttempt:vi.fn()};
 expect(await freeImportStore(store).loadModels()).toEqual([models[0]]);
 expect(freeImportStore(store).recordAttempt).toBe(store.recordAttempt);
});
