import {afterEach,expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';
import type {AISnapshot} from '../lib/ai/run-worker';

const question='วิธีเข้าใช้บริการห้องสมุด',hint='unverified query';
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const snapshot:AISnapshot={jobId:'00000000-0000-4000-8000-000000000001',sessionId:'00000000-0000-4000-8000-000000000002',conversationId:'00000000-0000-4000-8000-000000000003',messageId:'00000000-0000-4000-8000-000000000004',revision:1,question,history:[]};
const hintVector=[1,...Array<number>(383).fill(0)],originalVector=[0,1,...Array<number>(382).fill(0)];
function embedding(vector:number[]){return {vectors:[vector],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimensions:384,providerId:'controlled',modelId:'controlled',fallbackUsed:false};}
function fixture(overrides:Partial<KnowledgeProducerOptions>={}){
 const generate=vi.fn(async(input:{taskType:string})=>({output:input.taskType==='KNOWLEDGE_PLAN'?{scope,selection:{method:'RAG',query:null,notApplicable:{version:1,kind:'PROCEDURE',topic:'LIBRARY_SERVICES',quote:question}}}:
  {version:1,purpose:'YRU_INFORMATION',topic:'LIBRARY_SERVICES',academicYear:null,quote:'ห้องสมุด'},toolCalls:[],providerId:'controlled',modelId:'controlled',fallbackUsed:false}));
 const embed=vi.fn(async(input:{input:string[]})=>embedding(input.input[0]===hint?hintVector:originalVector));
 const search=vi.fn<KnowledgeProducerOptions['search']>(async()=>[]),webFallback=vi.fn<NonNullable<KnowledgeProducerOptions['webFallback']>>(async()=>null);
 // The new option is part of the contract under test, introduced after its RED run.
 const options={compactPlanning:true,generate:generate as KnowledgeProducerOptions['generate'],embed,search,structuredSearch:async()=>({status:'EMPTY' as const}),webFallback,retrievalHint:hint,...overrides};
 return {produce:createKnowledgeProducer(options),generate,embed,search,webFallback};
}
afterEach(()=>vi.useRealTimers());

it('uses at most one original-query recheck and passes only its vector into eligible web admission',async()=>{
 const f=fixture();expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');
 expect(f.embed.mock.calls.map(([input])=>input.input)).toEqual([[hint],[question]]);
 expect(f.search.mock.calls.map(([input])=>input.vector)).toEqual([hintVector,originalVector]);
 expect(f.search.mock.calls.every(([input])=>JSON.stringify(input.scope)===JSON.stringify(scope)&&input.limit===12)).toBe(true);
 expect(f.webFallback).toHaveBeenCalledWith(expect.objectContaining({question,scope,queryVector:originalVector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT}),expect.any(AbortSignal));
});
it('a distinct model hint rechecks the source-validated support query, not the uncompressed original question',async()=>{
 const retrievalQuery='source-validated support subject and actual failed attempt',f=fixture({retrievalQuery});
 await f.produce(snapshot,new AbortController().signal);
 expect(f.embed.mock.calls.map(([input])=>input.input)).toEqual([[hint],[retrievalQuery]]);
 expect(f.webFallback).toHaveBeenCalledWith(expect.objectContaining({question,scope,queryVector:originalVector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT}),expect.any(AbortSignal));
});
it.each([
 {name:'absent hint',retrievalHint:undefined,retrievalQuery:undefined,expected:question},
 {name:'equal hint',retrievalHint:question,retrievalQuery:undefined,expected:question},
 {name:'legacy grounded support query',retrievalHint:undefined,retrievalQuery:'source-validated support details',expected:'source-validated support details'},
 {name:'hint equal to grounded support query',retrievalHint:'source-validated support details',retrievalQuery:'source-validated support details',expected:'source-validated support details'},
])('preserves one search for $name',async({retrievalHint,retrievalQuery,expected})=>{
 const f=fixture({retrievalHint,retrievalQuery});await f.produce(snapshot,new AbortController().signal);
 expect(f.embed.mock.calls.map(([input])=>input.input)).toEqual([[expected]]);expect(f.search).toHaveBeenCalledOnce();
});
it.each(['x'.repeat(6001),'ก'.repeat(2001)])('a short hint cannot bypass the grounded query byte/character limit',async grounded=>{
 const f=fixture();expect((await f.produce({...snapshot,question:grounded},new AbortController().signal)).kind).toBe('CLARIFY');
 expect(f.generate).not.toHaveBeenCalled();expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();expect(f.webFallback).not.toHaveBeenCalled();
});
it.each(['','ก'.repeat(2001),'x'.repeat(6001)])('rejects an empty/oversize hint before planning without clipping',async retrievalHint=>{
 const f=fixture({retrievalHint});expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');
 expect(f.generate).not.toHaveBeenCalled();expect(f.embed).not.toHaveBeenCalled();expect(f.webFallback).not.toHaveBeenCalled();
});
it.each(['hint embedding','hint search','original embedding','original search'] as const)('does not turn a failed %s into a miss',async failure=>{
 const f=fixture();
 if(failure==='hint embedding')f.embed.mockRejectedValueOnce(Error('EMBED_FAILED'));
 if(failure==='hint search')f.search.mockRejectedValueOnce(Error('SEARCH_FAILED'));
 if(failure==='original embedding')f.embed.mockResolvedValueOnce(embedding(hintVector)).mockRejectedValueOnce(Error('EMBED_FAILED'));
 if(failure==='original search')f.search.mockResolvedValueOnce([]).mockRejectedValueOnce(Error('SEARCH_FAILED'));
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');
 expect(f.embed).toHaveBeenCalledTimes(failure.startsWith('hint')?1:2);expect(f.webFallback).not.toHaveBeenCalled();
 expect(f.generate.mock.calls.map(([input])=>input.taskType)).toEqual(['KNOWLEDGE_PLAN']);
});
it.each([1,2])('rejects an invalid embedding at attempt %s without a miss or web admission',async attempt=>{
 const f=fixture();if(attempt===2)f.embed.mockResolvedValueOnce(embedding(hintVector));
 f.embed.mockResolvedValueOnce(embedding(Array<number>(384).fill(0)));
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.webFallback).not.toHaveBeenCalled();
 expect(f.search).toHaveBeenCalledTimes(attempt-1);
});
it.each([1,2])('rejects a malformed search at attempt %s without treating it as empty',async attempt=>{
 const f=fixture();if(attempt===2)f.search.mockResolvedValueOnce([]);
 f.search.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<KnowledgeProducerOptions['search']>>);
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.webFallback).not.toHaveBeenCalled();
 expect(f.search).toHaveBeenCalledTimes(attempt);
});
it.each(['before','hint embedding','hint search','original embedding','original search'] as const)('honors caller cancellation at %s without web admission',async stage=>{
 const controller=new AbortController(),f=fixture();
 if(stage==='before')controller.abort();
 if(stage==='hint embedding')f.embed.mockImplementationOnce(async()=>{controller.abort();return embedding(hintVector);});
 if(stage==='original embedding')f.embed.mockResolvedValueOnce(embedding(hintVector)).mockImplementationOnce(async()=>{controller.abort();return embedding(originalVector);});
 if(stage==='hint search')f.search.mockImplementationOnce(async()=>{controller.abort();return [];});
 if(stage==='original search')f.search.mockResolvedValueOnce([]).mockImplementationOnce(async()=>{controller.abort();return [];});
 await expect(f.produce(snapshot,controller.signal)).rejects.toThrow();expect(f.webFallback).not.toHaveBeenCalled();
});
it.each(['embedding','search'] as const)('retains the existing original-recheck %s timeout and stops before web',async stage=>{
 vi.useFakeTimers();const f=fixture();
 if(stage==='embedding')f.embed.mockResolvedValueOnce(embedding(hintVector)).mockImplementationOnce(()=>new Promise(()=>{}));
 else f.search.mockResolvedValueOnce([]).mockImplementationOnce(()=>new Promise(()=>{}));
 const result=f.produce(snapshot,new AbortController().signal);await vi.advanceTimersByTimeAsync(stage==='embedding'?15001:8001);
 expect((await result).kind).toBe('CLARIFY');expect(f.webFallback).not.toHaveBeenCalled();
 expect(f.generate.mock.calls.map(([input])=>input.taskType)).toEqual(['KNOWLEDGE_PLAN']);
});
