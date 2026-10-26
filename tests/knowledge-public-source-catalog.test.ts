import {it,expect} from 'vitest';
import {catalogSummarySchema} from '../lib/knowledge/catalog-types';
it('represents source date uncertainty separately from server current-review observation',()=>{
 const summary={id:'123e4567-e89b-42d3-a456-426614174001',familyId:'123e4567-e89b-42d3-a456-426614174002',title:'บริการสาธารณะ',documentType:'GUIDE',versionName:'ฉบับตรวจทาน',versionStream:'PUBLIC',academicYear:null,department:null,status:'ACTIVE',isCurrent:true,visibility:'PUBLIC',storageMode:'RAG',publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:50,approvedAt:'2026-10-26T01:00:00.000Z',sourceUrl:'https://library.yru.ac.th/contact',sourcePageUrl:null,lastImportAt:'2026-10-26T00:00:00.000Z',temporalBasis:'CURRENT_REVIEWED',currentReviewedAt:'2026-10-26T01:00:00.000Z'};
 const parsed=catalogSummarySchema.parse(summary);expect(parsed.temporalBasis).toBe('CURRENT_REVIEWED');expect(parsed.publishedAt).toBeNull();expect(parsed.effectiveFrom).toBeNull();expect(parsed.currentReviewedAt).toBe(summary.currentReviewedAt);
 expect(catalogSummarySchema.safeParse({...summary,temporalBasis:'UNKNOWN'}).success).toBe(false);
 const {temporalBasis:mode,currentReviewedAt:stamp,...legacy}=summary;void mode;void stamp;expect(catalogSummarySchema.parse(legacy)).toEqual(legacy);
});
