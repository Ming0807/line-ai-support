import {it,expect} from 'vitest';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {reviewDraftSchema} from '../lib/imports/review-schema';

it('accepts unfinished review3 without discarding legacy1/2',()=>{
 const legacy=unfinishedReviewDraft();
 expect(reviewDraftSchema.parse(legacy)).toEqual(legacy);
 expect(reviewDraftSchema.parse({...legacy,schemaVersion:2,chunkPlan:null}).schemaVersion).toBe(2);
 const draft={...legacy,schemaVersion:3,chunkPlan:null,structuredMapping:null};
 expect(reviewDraftSchema.parse(draft)).toEqual(draft);
 expect(reviewDraftSchema.safeParse({...draft,structuredMapping:undefined}).success).toBe(false);
});
