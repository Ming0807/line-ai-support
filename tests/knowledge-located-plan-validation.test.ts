import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {validateLocatedChunkPlan} from '../lib/knowledge/located-plan-validation';
import {computeLocatedChunkPlanDigest} from '../lib/knowledge/located-chunk-plan';
import {LOCAL_EMBEDDING_DIMENSION} from '../lib/knowledge/embedding-space';
import {locatedPlanFixture} from './fixtures/located-plan';
import type {LocatedChunkPlan} from '../lib/knowledge/located-plan-types';
const redigest=(p:LocatedChunkPlan)=>{p.digest=computeLocatedChunkPlanDigest(p.binding,p.sourceChecksum,p.chunks,p.warnings);return p;};
describe('strict private located plan validation',()=>{
 it('accepts actual narrative and lossless empty-cell table plan without changing its prior digest',async()=>{
  const {plan}=await locatedPlanFixture();
  const identity={model:plan.model,modelRevision:plan.modelRevision,embeddingFingerprint:plan.embeddingFingerprint,dimension:LOCAL_EMBEDDING_DIMENSION};
  const oldMaterial={schemaVersion:1,chunkerVersion:'located-e5-v1',binding:{...plan.binding},sourceChecksum:plan.sourceChecksum,identity,chunks:plan.chunks.map(c=>({index:c.index,content:c.content,coverage:{...c.coverage},sourceLocations:c.sourceLocations.map(l=>structuredClone(l)),passageTokenCount:c.passageTokenCount,pageNumber:c.pageNumber,sectionTitle:c.sectionTitle,requiresReview:c.requiresReview})),warnings:structuredClone(plan.warnings)};
  expect(plan.digest).toBe(createHash('sha256').update(JSON.stringify(oldMaterial)).digest('hex'));
  expect(validateLocatedChunkPlan(plan)).toEqual(plan);
 });
 it('returns independent nested copies',async()=>{const {plan}=await locatedPlanFixture();const copy=validateLocatedChunkPlan(plan);plan.chunks[0].content='mutated';expect(copy.chunks[0].content).not.toBe('mutated');copy.chunks[0].sourceLocations.length=0;expect(plan.chunks[0].sourceLocations.length).toBeGreaterThan(0);});
 it.each(['model','modelRevision','embeddingFingerprint','digest','sourceChecksum'] as const)('rejects corrupted %s',async key=>{const {plan}=await locatedPlanFixture();plan[key]='bad';expect(()=>validateLocatedChunkPlan(plan)).toThrow('KNOWLEDGE_PLAN_INPUT_INVALID');});
 it.each([
  (p:LocatedChunkPlan)=>{p.chunks=[];},
  (p:LocatedChunkPlan)=>{p.chunks[0].index=1;},
  (p:LocatedChunkPlan)=>{p.chunks[0].passageTokenCount=513;},
  (p:LocatedChunkPlan)=>{p.chunks[0].content='ส'.repeat(2001);},
  (p:LocatedChunkPlan)=>{p.chunks[0].sourceLocations=[];},
  (p:LocatedChunkPlan)=>{p.chunks[0].sourceLocations.push({kind:'CSV',rowStart:1,rowEnd:1,columnStart:1,columnEnd:1,tableIndex:null});},
  (p:LocatedChunkPlan)=>{p.chunks[0].pageNumber=1;},
  (p:LocatedChunkPlan)=>{const c=p.chunks.find(c=>c.coverage.kind==='PAGE')!;if(c.coverage.kind==='PAGE')c.coverage.end++;},
  (p:LocatedChunkPlan)=>{const c=p.chunks.find(c=>c.coverage.kind==='TABLE')!;if(c.coverage.kind==='TABLE')c.coverage.rowEndIndex=-1;},
  (p:LocatedChunkPlan)=>{const l=p.chunks[0].sourceLocations[0];if(l.kind==='HTML')l.sourceUrl='https://user:password@www.yru.ac.th/';},
 ])('rejects malformed plan even with a recomputed digest %#',async change=>{const {plan}=await locatedPlanFixture();change(plan);redigest(plan);expect(()=>validateLocatedChunkPlan(plan)).toThrow('KNOWLEDGE_PLAN_INPUT_INVALID');});
 it('rejects unknown extra fields rather than accepting supplied vectors',async()=>{const {plan}=await locatedPlanFixture();expect(()=>validateLocatedChunkPlan({...plan,vectors:[[1]]})).toThrow('KNOWLEDGE_PLAN_INPUT_INVALID');});
 it('rejects changed raw text with an old digest',async()=>{const {plan}=await locatedPlanFixture();plan.chunks[0].content=plan.chunks[0].content.replace('บริการ','ขั้นตอน');expect(()=>validateLocatedChunkPlan(plan)).toThrow('KNOWLEDGE_PLAN_INPUT_INVALID');});
});
