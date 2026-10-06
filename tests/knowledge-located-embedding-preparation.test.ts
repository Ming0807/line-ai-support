import type {EmbeddingCallOptions,EmbeddingProvider} from '../lib/knowledge/embedding-client';
import {EmbeddingServiceError} from '../lib/knowledge/embedding-client';
import {computeLocatedChunkPlanDigest} from '../lib/knowledge/located-chunk-plan';
import {embedLocatedChunkPlan} from '../lib/knowledge/located-embedding-preparation';
import type {LocatedChunkPlan} from '../lib/knowledge/located-plan-types';
import {LOCAL_EMBEDDING_DIMENSION,LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../lib/knowledge/embedding-space';
import {locatedPlanFixture} from './fixtures/located-plan';
import {afterEach,describe,expect,it,vi} from 'vitest';

type Embed=NonNullable<EmbeddingProvider['embedPassages']>;
type FakeProvider=EmbeddingProvider&{calls:string[][];options:EmbeddingCallOptions[]};
const kinds=['PDF','DOCX','XLSX','CSV','HTML'] as const;

function unitVector():number[]{return [1,...new Array(LOCAL_EMBEDDING_DIMENSION-1).fill(0)];}

function providerFor(embed?:Embed,identity:Partial<Pick<EmbeddingProvider,'modelId'|'revision'|'dimension'|'fingerprint'>>={}):FakeProvider{
 const provider:FakeProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:LOCAL_EMBEDDING_DIMENSION,
  fingerprint:LOCAL_EMBEDDING_FINGERPRINT,calls:[],options:[],
  async embedQuery(){throw new Error('embedQuery must not be used');},
  async embedPassages(texts,options){
   provider.calls.push([...texts]);provider.options.push(options??{});
   if(embed)return embed(texts,options);
   return texts.map(()=>unitVector());
  },
  async healthCheck(){return {healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:LOCAL_EMBEDDING_DIMENSION,mode:'Local',observedAt:'2026-10-06T00:00:00.000Z',httpStatus:200};},
  ...identity,
 };
 return provider;
}

function locationFor(kind:typeof kinds[number],table:boolean){
 const tableIndex=table?1:null;
 if(kind==='PDF')return {kind,pageNumber:1,blockStart:table?2:1,blockEnd:table?2:1,tableIndex} as const;
 if(kind==='DOCX')return {kind,blockStart:table?2:1,blockEnd:table?2:1,headingPath:table?['Fees']:[],tableIndex} as const;
 if(kind==='XLSX')return {kind,sheetName:'Sheet 1',sheetIndex:1,rowStart:table?1:1,rowEnd:table?2:1,
  columnStart:1,columnEnd:table?2:1,tableIndex} as const;
 if(kind==='CSV')return {kind,rowStart:table?1:1,rowEnd:table?2:1,columnStart:1,columnEnd:table?2:1,tableIndex} as const;
 return {kind,sourceUrl:'https://www.yru.ac.th/services',blockStart:table?2:1,blockEnd:table?2:1,headingPath:table?['Fees']:[],tableIndex} as const;
}

function planForKind(sourcePlan:LocatedChunkPlan,kind:typeof kinds[number]):LocatedChunkPlan{
 const plan=structuredClone(sourcePlan);
 plan.warnings=[];
 plan.chunks=plan.chunks.map(chunk=>({...chunk,pageNumber:kind==='PDF'?1:null,
  sourceLocations:[locationFor(kind,chunk.coverage.kind==='TABLE')]}));
 plan.digest=computeLocatedChunkPlanDigest(plan.binding,plan.sourceChecksum,plan.chunks,plan.warnings);
 return plan;
}

function repeatedPlan(sourcePlan:LocatedChunkPlan,count:number):LocatedChunkPlan{
 const plan=structuredClone(sourcePlan);
 const base=structuredClone(plan.chunks.find(chunk=>chunk.coverage.kind==='PAGE')??plan.chunks[0]);
 plan.chunks=Array.from({length:count},(_value,index)=>({...structuredClone(base),index}));
 plan.digest=computeLocatedChunkPlanDigest(plan.binding,plan.sourceChecksum,plan.chunks,plan.warnings);
 return plan;
}

afterEach(()=>vi.useRealTimers());

describe('embedLocatedChunkPlan',()=>{
 it.each(kinds)('preserves the validated %s evidence and embeds exact ordered passage text',async kind=>{
  const {plan:built}=await locatedPlanFixture();
  const plan=planForKind(built,kind),provider=providerFor();
  const result=await embedLocatedChunkPlan(plan,provider);
  expect(result.plan).toEqual(plan);
  expect(result.plan).not.toBe(plan);
  expect(provider.calls.flat()).toEqual(plan.chunks.map(chunk=>chunk.content));
  expect(result.embeddings).toHaveLength(plan.chunks.length);
  expect(result.embeddings.every(vector=>vector.length===384&&Math.abs(Math.hypot(...vector)-1)<=0.001)).toBe(true);
  expect(result.plan.chunks.map(chunk=>chunk.sourceLocations)).toEqual(plan.chunks.map(chunk=>chunk.sourceLocations));
  expect(result.plan.chunks.map(chunk=>chunk.passageTokenCount)).toEqual(plan.chunks.map(chunk=>chunk.passageTokenCount));
 });

 it('batches 17 chunks as 16 plus 1 without reordering or changing their content',async()=>{
  const {plan}=await locatedPlanFixture();const many=repeatedPlan(plan,17),provider=providerFor();
  const result=await embedLocatedChunkPlan(many,provider);
  expect(provider.calls.map(batch=>batch.length)).toEqual([16,1]);
  expect(provider.calls.flat()).toEqual(many.chunks.map(chunk=>chunk.content));
  expect(result.embeddings).toHaveLength(17);
 });

 it.each([
  ['model', {modelId:'other-model'}],
  ['revision', {revision:'other-revision'}],
  ['fingerprint', {fingerprint:'0'.repeat(64)}],
  ['dimension', {dimension:768}],
 ] as const)('rejects a provider with a mismatched %s before the first call',async(_name,identity)=>{
  const {plan}=await locatedPlanFixture();const provider=providerFor(undefined,identity);
  await expect(embedLocatedChunkPlan(plan,provider)).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_SPACE_INVALID'});
  expect(provider.calls).toHaveLength(0);
 });

 it('validates and deep-copies the input plan before inspecting or calling the provider',async()=>{
  const provider=providerFor(undefined,{modelId:'other-model'});
  await expect(embedLocatedChunkPlan({not:'a located plan'},provider)).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_INPUT_INVALID'});
  expect(provider.calls).toHaveLength(0);
 });

 it.each([
  ['cardinality',()=>[]],
  ['dimension',()=>[new Array(LOCAL_EMBEDDING_DIMENSION-1).fill(0)]],
  ['non-finite values',()=>[[Number.NaN,...new Array(LOCAL_EMBEDDING_DIMENSION-1).fill(0)]]],
  ['non-normalized output',()=>[[0.5,...new Array(LOCAL_EMBEDDING_DIMENSION-1).fill(0)]]],
 ] as const)('rejects malformed provider %s as a fixed space error',async(_name,makeVectors)=>{
  const {plan}=await locatedPlanFixture();
  const provider=providerFor(async()=>makeVectors());
  await expect(embedLocatedChunkPlan(plan,provider)).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_SPACE_INVALID'});
 });

 it('returns detached plan and vector copies even when the provider mutates its arguments and output',async()=>{
  const {plan}=await locatedPlanFixture();const original=structuredClone(plan);
  let providerVectors:number[][]=[];
  const provider=providerFor(async texts=>{
   texts[0]='provider mutation';providerVectors=texts.map(()=>unitVector());return providerVectors;
  });
  const result=await embedLocatedChunkPlan(plan,provider);
  expect(plan).toEqual(original);
  expect(result.plan.chunks[0].content).toBe(original.chunks[0].content);
  expect(result.plan).not.toBe(plan);
  expect(result.embeddings[0]).not.toBe(providerVectors[0]);
  providerVectors[0][0]=0;
  expect(result.embeddings[0][0]).toBe(1);
 });

 it('returns no partial embeddings when a later batch fails and suppresses provider details',async()=>{
  const {plan}=await locatedPlanFixture();const many=repeatedPlan(plan,17);
  const provider=providerFor(async()=>{
   if(provider.calls.length===2)throw new Error('private passage leaked by provider');
   return [unitVector(),...Array.from({length:15},()=>unitVector())];
  });
  await expect(embedLocatedChunkPlan(many,provider)).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_UNAVAILABLE',message:'KNOWLEDGE_EMBEDDING_UNAVAILABLE'});
  expect(provider.calls.map(batch=>batch.length)).toEqual([16,1]);
 });

 it('maps known provider abort and timeout errors to fixed helper errors',async()=>{
  const {plan}=await locatedPlanFixture();
  await expect(embedLocatedChunkPlan(plan,providerFor(async()=>{throw new EmbeddingServiceError('EMBEDDING_TIMEOUT');})))
   .rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_TIMEOUT'});
  await expect(embedLocatedChunkPlan(plan,providerFor(async()=>{throw new EmbeddingServiceError('EMBEDDING_ABORTED');})))
   .rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_ABORTED'});
 });

 it('uses one shrinking deadline across batches and aborts a provider that ignores it',async()=>{
  vi.useFakeTimers();
  const {plan}=await locatedPlanFixture();const many=repeatedPlan(plan,17);
  let secondSignal:AbortSignal|undefined;
  const provider=providerFor((texts,options)=>{
   if(provider.calls.length===1)return new Promise(resolve=>setTimeout(()=>resolve(texts.map(()=>unitVector())),7));
   secondSignal=options?.signal;void texts;
   return new Promise(()=>{});
  });
  const pending=embedLocatedChunkPlan(many,provider,{timeoutMs:10});
  const rejection=expect(pending).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_TIMEOUT'});
  await vi.advanceTimersByTimeAsync(7);
  await Promise.resolve();await Promise.resolve();
  expect(provider.calls).toHaveLength(2);
  expect(provider.options[1].timeoutMs).toBeLessThanOrEqual(3);
  await vi.advanceTimersByTimeAsync(3);
  await rejection;
  expect(secondSignal?.aborted).toBe(true);
 });

 it('honors caller abort and cleans up its abort listener when the provider ignores cancellation',async()=>{
  const {plan}=await locatedPlanFixture();const controller=new AbortController();
  const add=vi.spyOn(controller.signal,'addEventListener'),remove=vi.spyOn(controller.signal,'removeEventListener');
  let providerSignal:AbortSignal|undefined;
  const provider=providerFor((_texts,options)=>{providerSignal=options?.signal;return new Promise(()=>{});});
  const pending=embedLocatedChunkPlan(plan,provider,{signal:controller.signal,timeoutMs:1000});
  const rejection=expect(pending).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_ABORTED'});
  controller.abort();
  await rejection;
  expect(providerSignal?.aborted).toBe(true);
  const listener=add.mock.calls.find(([type])=>type==='abort')?.[1];
  expect(listener).toBeDefined();
  expect(remove).toHaveBeenCalledWith('abort',listener);
 });

 it('rejects invalid deadline options before provider work',async()=>{
  const {plan}=await locatedPlanFixture();const provider=providerFor();
  await expect(embedLocatedChunkPlan(plan,provider,{timeoutMs:0})).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_INPUT_INVALID'});
  await expect(embedLocatedChunkPlan(plan,provider,{timeoutMs:45_001})).rejects.toMatchObject({code:'KNOWLEDGE_EMBEDDING_INPUT_INVALID'});
  expect(provider.calls).toHaveLength(0);
 });
});
