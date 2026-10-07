import {expect,it} from 'vitest';
import {validateStructuredPublicationReview} from '../lib/imports/publication-contract';
import {structuredMappingFixture} from './fixtures/structured-mapping';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {buildReviewWarnings} from '../lib/imports/review-warnings';
import {computeStructuredAcknowledgment} from '../lib/imports/structured-acknowledgment';
import {buildStructuredMappingPlan} from '../lib/imports/structured-mapper';
import type {ImportPreview} from '../lib/imports/import-extraction';
import type {ImportReviewState} from '../lib/imports/import-review';
import {validateStructuredMapping} from '../lib/imports/structured-mapping-contract';
import {reviewDraftSchema} from '../lib/imports/review-schema';
function fixture(){
 const f=structuredMappingFixture('university_systems','HTML'),mapping=validateStructuredMapping(f.mapping);
 mapping.source.jobRevision=f.binding.extractionRevision;
 const binding={...f.binding,jobRevision:f.binding.extractionRevision},plan=buildStructuredMappingPlan(f.source,f.extraction,binding,mapping);
 const preview:ImportPreview={job:{id:binding.jobId,status:'READY',revision:binding.jobRevision,filename:f.source.filename,format:'HTML',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null,acquisition:null,byteLength:f.source.bytes.length,createdAt:'2026-10-08T00:00:00.000Z',errorCode:null},extractionRevision:binding.extractionRevision,kind:'PARSED',extraction:f.extraction,analysis:analyzeExtraction(f.source,f.extraction),edit:null};
 const base=unfinishedReviewDraft(),parsed=reviewDraftSchema.parse({...base,schemaVersion:3,metadata:{...base.metadata,title:'Reviewed',familyCode:'POLICY_TEST',newFamily:{name:'Test',category:'Fixture'},departmentCode:'IT',documentType:'GUIDE',versionName:'1',versionStream:'ALL',scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:70,visibility:'INTERNAL',storageMode:'STRUCTURED',datasetType:'university_systems'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:null,structuredMapping:{mapping,acknowledgment:computeStructuredAcknowledgment(plan)},warningDispositions:buildReviewWarnings(preview).map(w=>({warningKey:w.key,status:'CORRECTED',reason:'Reviewed synthetic evidence'}))});
 if(parsed.schemaVersion!==3||!parsed.structuredMapping)throw new Error('FIXTURE');const draft=parsed;
 const review:ImportReviewState={jobId:binding.jobId,jobRevision:binding.jobRevision,extractionRevision:binding.extractionRevision,reviewRevision:binding.reviewRevision,stale:false,warnings:buildReviewWarnings(preview),saved:{reviewRevision:binding.reviewRevision,jobRevision:binding.jobRevision,extractionRevision:binding.extractionRevision,actorId:'123e4567-e89b-42d3-a456-426614174001',createdAt:'2026-10-08T00:00:00.000Z',draft}};
 return {f,preview,review,draft};
}
it('accepts complete structured policy without a text chunk plan',()=>{const f=fixture();const r=validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum);expect(r.plan).toBeNull();expect(r.sourceChecksum).toBe(f.f.source.checksum);expect(r.draft.metadata.storageMode).toBe('STRUCTURED');});
it.each(['sourceAuthorityReviewed','extractionReviewed','applicabilityReviewed','sensitivityReviewed','versionReviewed'] as const)('structured policy still requires %s',key=>{const f=fixture();f.draft.attestations[key]=false;expect(()=>validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
it('requires explicit mapping acknowledgment and rejects stale saved review',()=>{const f=fixture();f.review.saved!.draft={...f.draft,structuredMapping:{...f.draft.structuredMapping!,acknowledgment:null}};expect(()=>validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');f.review.saved!.draft=f.draft;f.review.stale=true;expect(()=>validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');});
it('requires BOTH chunk consent and preserves sensitivity/quality gates',()=>{const f=fixture();f.review.saved!.draft={...f.draft,metadata:{...f.draft.metadata,storageMode:'BOTH'}};expect(()=>validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');f.review.saved!.draft=f.draft;f.preview.extraction.report.truncated=true;expect(()=>validateStructuredPublicationReview(f.preview,f.review,null,f.f.source.checksum)).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');});
