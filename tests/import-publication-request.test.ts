import {it,expect} from 'vitest';
import {publicationRequestSchema} from '../lib/imports/import-publication';
const request={id:'123e4567-e89b-42d3-a456-426614174000',expectedJobRevision:2,expectedExtractionRevision:1,expectedReviewRevision:2,confirmPublication:true};
it('accepts only deliberate three-counter publication and normalizes UUID case',()=>{expect(publicationRequestSchema.parse({...request,id:request.id.toUpperCase()})).toEqual(request);});
it.each(['metadata','text','vectors','sourceLocations','provider','model','SQL','failureAt','beforeCommit','preparationTimeoutMs'])('rejects supplied %s',key=>{expect(publicationRequestSchema.safeParse({...request,[key]:'forbidden'}).success).toBe(false);});
it.each([0,-1,1.1,1_000_000_000,'1',null,NaN])('refuses invalid expected counters %s',value=>{expect(publicationRequestSchema.safeParse({...request,expectedReviewRevision:value}).success).toBe(false);});
it('refuses missing or false publication confirmation',()=>{expect(publicationRequestSchema.safeParse({...request,confirmPublication:false}).success).toBe(false);expect(publicationRequestSchema.safeParse({...request,confirmPublication:undefined}).success).toBe(false);});
