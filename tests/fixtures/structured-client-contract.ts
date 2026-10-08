import {computeStructuredAcknowledgment} from '../../lib/imports/structured-acknowledgment';
import {analyzeExtraction} from '../../lib/imports/analyzer';
import {buildStructuredMappingPlan} from '../../lib/imports/structured-mapper';
import type {StructuredMapping} from '../../lib/imports/structured-mapping-contract';
import {structuredMappingFixture} from './structured-mapping';

export function structuredClientContractFixture(){
 const fixture=structuredMappingFixture('tuition_fees','XLSX');
 const expectedMapping=fixture.mapping as StructuredMapping;
 const source={source:{jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,
  reviewRevision:fixture.binding.reviewRevision,sourceChecksum:fixture.source.checksum,
  extractionDigest:expectedMapping.source.extractionDigest}};
 const preview={preview:{
  job:{id:fixture.binding.jobId,status:'READY',revision:fixture.binding.jobRevision,filename:fixture.source.filename,format:fixture.source.format,
   mimeType:fixture.source.mimeType,sourceUrl:fixture.source.sourceUrl,acquiredFrom:fixture.source.acquiredFrom,fetchedAt:fixture.source.fetchedAt,
   acquisition:null,byteLength:fixture.source.bytes.length,createdAt:'2026-10-08T00:00:00.000Z',errorCode:null},
  extractionRevision:fixture.binding.extractionRevision,kind:'PARSED',extraction:fixture.extraction,
  analysis:analyzeExtraction(fixture.source,fixture.extraction),edit:null,
 }};
 const nextReviewRevision=fixture.binding.reviewRevision+1;
 const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,
  {jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,reviewRevision:nextReviewRevision},
  expectedMapping);
 const snapshot={snapshot:{jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,
  reviewRevision:fixture.binding.reviewRevision,nextReviewRevision,plan,acknowledgment:computeStructuredAcknowledgment(plan),publicationAvailable:false}};
 return {fixture,source,preview,snapshot,expectedMapping};
}

export function structuredClientRevalidationFixture(reviewRevision:number){
 const {fixture,preview,expectedMapping}=structuredClientContractFixture();
 const source={source:{jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,
  reviewRevision,sourceChecksum:fixture.source.checksum,extractionDigest:expectedMapping.source.extractionDigest}};
 const nextReviewRevision=reviewRevision+1;
 const plan=buildStructuredMappingPlan(fixture.source,fixture.extraction,
  {jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,reviewRevision:nextReviewRevision},
  expectedMapping);
 const snapshot={snapshot:{jobId:fixture.binding.jobId,jobRevision:fixture.binding.jobRevision,extractionRevision:fixture.binding.extractionRevision,
  reviewRevision,nextReviewRevision,plan,acknowledgment:computeStructuredAcknowledgment(plan),publicationAvailable:false}};
 return {fixture,source,preview,snapshot,expectedMapping};
}
