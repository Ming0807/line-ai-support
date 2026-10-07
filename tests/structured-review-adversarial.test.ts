import {it,expect} from 'vitest';
import {structuredMappingFixture} from './fixtures/structured-mapping';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {buildStructuredMappingPlan} from '../lib/imports/structured-mapper';
import {computeStructuredAcknowledgment} from '../lib/imports/structured-preparation';
import {reviewDraftSchema} from '../lib/imports/review-schema';
import {STRUCTURED_DATASETS} from '../lib/knowledge/structured-payload';
it('accepts strict review3 mappings for seven datasets with deliberate modes and null acknowledgments',()=>{
 for(const dataset of STRUCTURED_DATASETS){const f=structuredMappingFixture(dataset,'HTML'),base=unfinishedReviewDraft();for(const storageMode of ['STRUCTURED','BOTH']){
  const draft={...base,schemaVersion:3,chunkPlan:null,metadata:{...base.metadata,storageMode,datasetType:dataset},structuredMapping:{mapping:f.mapping,acknowledgment:null}};expect(reviewDraftSchema.safeParse(draft).success).toBe(true);
  for(const bad of [{...draft,metadata:{...draft.metadata,storageMode:'RAG'}},{...draft,metadata:{...draft.metadata,datasetType:null}},{...draft,structuredMapping:{...draft.structuredMapping,rows:[]}},{...draft,structuredMapping:{...draft.structuredMapping,acknowledgment:{contentDigest:'bad',mapperVersion:'structured-mapper-v1'}}}])expect(reviewDraftSchema.safeParse(bad).success).toBe(false);
 }}
});
it('keeps content acknowledgment stable across review counters but full plan digest changes',()=>{
 const f=structuredMappingFixture('tuition_fees','CSV'),first=buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping),next=buildStructuredMappingPlan(f.source,f.extraction,{...f.binding,reviewRevision:f.binding.reviewRevision+1},f.mapping);
 expect(first.digest).not.toBe(next.digest);expect(computeStructuredAcknowledgment(first)).toEqual(computeStructuredAcknowledgment(next));expect(Object.isFrozen(computeStructuredAcknowledgment(first))).toBe(true);
});
it('content acknowledgment includes exact lexemes, source/mapping/payload/evidence and review warnings',()=>{
 const f=structuredMappingFixture('tuition_fees','CSV'),plan=buildStructuredMappingPlan(f.source,f.extraction,f.binding,f.mapping),baseline=computeStructuredAcknowledgment(plan);
 for(const change of [(p:typeof plan)=>{p.sourceChecksum='f'.repeat(64);},(p:typeof plan)=>{p.extractionDigest='f'.repeat(64);},(p:typeof plan)=>{p.mappingDigest='f'.repeat(64);},(p:typeof plan)=>{p.binding.jobRevision++;},(p:typeof plan)=>{p.rows[0].payloadDigest='f'.repeat(64);},(p:typeof plan)=>{p.flags.push('REVIEW_REQUIRED');},(p:typeof plan)=>{const field=p.rows[0].fields.find(e=>e.kind==='CELL');if(field?.kind==='CELL')field.extractedValue='changed';}]){
  const copied=structuredClone(plan);change(copied);expect(computeStructuredAcknowledgment(copied)).not.toEqual(baseline);
 }
 const copied=structuredClone(plan);copied.digest='f'.repeat(64);expect(computeStructuredAcknowledgment(copied)).toEqual(baseline);
});
it('prevents structured chunks and malformed/missing extra review3 contract fields',()=>{
 const f=structuredMappingFixture('university_systems','HTML'),base=unfinishedReviewDraft(),draft={...base,schemaVersion:3,chunkPlan:null,metadata:{...base.metadata,storageMode:'STRUCTURED',datasetType:'university_systems'},structuredMapping:{mapping:f.mapping,acknowledgment:null}};
 expect(reviewDraftSchema.safeParse({...draft,chunkPlan:{digest:'a'.repeat(64),chunkerVersion:'located-e5-v1'}}).success).toBe(false);
 expect(reviewDraftSchema.safeParse({...draft,structuredMapping:undefined}).success).toBe(false);expect(reviewDraftSchema.safeParse({...draft,approved:true}).success).toBe(false);
});
