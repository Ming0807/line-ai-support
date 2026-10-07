import {createHash} from 'node:crypto';
import {reviewDraftSchema,type ImportReviewDraft} from './review-schema';
import {buildReviewWarnings,assertReviewWarningBindings} from './review-warnings';
import {isOfficialYruUrl} from './source';
import type {ImportPreview} from './import-extraction';
import type {ImportReviewState} from './import-review';
import {validateLocatedChunkPlan} from '../knowledge/located-plan-validation';
import {locatedReviewApplies} from '../knowledge/located-chunk-plan';
import type {LocatedChunkPlan} from '../knowledge/located-plan-types';
export type PublicationPolicyCode='PUBLICATION_REVIEW_INCOMPLETE'|'PUBLICATION_PLAN_MISMATCH'|'PUBLICATION_WARNINGS_UNRESOLVED'|'PUBLICATION_QUALITY_REANALYSIS_REQUIRED'|'PUBLICATION_PUBLIC_SENSITIVE_DATA'|'PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE';
export class PublicationPolicyError extends Error{constructor(readonly code:PublicationPolicyCode){super(code);this.name='PublicationPolicyError';}}
export interface ValidatedPublicationReview{draft:Extract<ImportReviewDraft,{schemaVersion:2}>;plan:LocatedChunkPlan;reviewHash:string;officialSource:boolean}
function fail(code:PublicationPolicyCode):never{throw new PublicationPolicyError(code);}
function exactCoverage(preview:ImportPreview,plan:LocatedChunkPlan){
 const mismatch=()=>fail('PUBLICATION_PLAN_MISMATCH');
 const extraction=preview.extraction;
 if(JSON.stringify(plan.warnings)!==JSON.stringify(extraction.report.warnings)||plan.chunks.some(c=>c.sourceLocations.some(l=>l.kind!==preview.job.format)))mismatch();
 for(const c of plan.chunks){if(c.coverage.kind==='PAGE'?c.coverage.index>=extraction.pages.length:c.coverage.index>=extraction.tables.length)mismatch();}
 for(const [index,page] of extraction.pages.entries()){
  const chunks=plan.chunks.filter(c=>c.coverage.kind==='PAGE'&&c.coverage.index===index);let end=0;
  for(const chunk of chunks){
   const range=chunk.coverage;if(range.kind!=='PAGE')return mismatch();
   const requiresReview=page.requiresReview||locatedReviewApplies(extraction.locations.pages[index],extraction.report.warnings);
   if(range.start+range.overlapPrefixLength!==end||range.end<=end||range.end>page.text.length||chunk.content!==page.text.slice(range.start,range.end)||chunk.requiresReview!==requiresReview||
    JSON.stringify(chunk.sourceLocations)!==JSON.stringify([extraction.locations.pages[index]]))mismatch();
   end=range.end;
  }
  if(end!==page.text.length)mismatch();
 }
 for(const [index,table] of extraction.tables.entries()){
  const chunks=plan.chunks.filter(c=>c.coverage.kind==='TABLE'&&c.coverage.index===index);let end=-1;
  for(const chunk of chunks){
   const range=chunk.coverage;if(range.kind!=='TABLE')return mismatch();
   if(range.rowStartIndex!==end+1||range.rowEndIndex>=table.rows.length)mismatch();
   const content=table.rows.slice(range.rowStartIndex,range.rowEndIndex+1).map((row,i)=>`row ${table.firstRow+range.rowStartIndex+i}: ${JSON.stringify(row)}`).join('\n');
   const original=extraction.locations.tables[index];
   const location=original.kind==='CSV'||original.kind==='XLSX'?{...original,rowStart:table.firstRow+range.rowStartIndex,rowEnd:table.firstRow+range.rowEndIndex}:original;
   const requiresReview=extraction.pages.some(p=>p.requiresReview)||locatedReviewApplies(original,extraction.report.warnings);
   if(chunk.content!==content||JSON.stringify(chunk.sourceLocations)!==JSON.stringify([location])||chunk.requiresReview!==requiresReview)mismatch();end=range.rowEndIndex;
  }
  if(end!==table.rows.length-1)mismatch();
 }
}
function checkQuality(preview:ImportPreview,draft:ImportReviewDraft){
 const invalid=()=>fail('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 if(preview.extraction.report.truncated||preview.extraction.report.replacementCharacters>0)invalid();
 const references=buildReviewWarnings(preview);
 for(const [index,warning] of preview.extraction.report.warnings.entries()){
  if(warning.code==='UNSUPPORTED_TABLES'||warning.code==='ENCRYPTED_SOURCE')invalid();
  if(warning.code==='OCR_REQUIRED'){
   if(draft.warningDispositions.find(d=>d.warningKey===references[index].key)?.status!=='CORRECTED')invalid();
   if(preview.kind!=='EDITED'||!preview.edit)invalid();
   const pages=preview.extraction.pages.map((page,index)=>({page,index})).filter(({page})=>warning.location?.kind==='PDF'?page.pageNumber===warning.location.pageNumber:page.requiresReview);
   if(pages.length===0||pages.some(({page,index})=>!page.text.trim()||!preview.edit?.changedPages.includes(index)))invalid();
  }
 }
}
/** Complete private policy only. Target/family eligibility, active actor and counters still require final SQL locks. */
export function validatePublicationReview(preview:ImportPreview,review:ImportReviewState,input:unknown,expectedSourceChecksum:string):ValidatedPublicationReview{
 if(!review.saved)fail('PUBLICATION_REVIEW_INCOMPLETE');
 const saved=review.saved;
 if(preview.job.status!=='READY'||review.stale||review.jobId!==preview.job.id||review.jobRevision!==preview.job.revision||review.extractionRevision!==preview.extractionRevision||
  saved.jobRevision!==review.jobRevision||saved.extractionRevision!==review.extractionRevision||saved.reviewRevision!==review.reviewRevision||review.reviewRevision<1)fail('PUBLICATION_PLAN_MISMATCH');
 const parsed=reviewDraftSchema.safeParse(saved.draft);
 if(parsed.success&&parsed.data.schemaVersion===3)fail('PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE');
 if(!parsed.success||parsed.data.schemaVersion!==2||parsed.data.chunkPlan===null)fail('PUBLICATION_REVIEW_INCOMPLETE');
 const draft=parsed.data,metadata=draft.metadata;
 for(const field of ['title','familyCode','departmentCode','documentType','versionName','versionStream','publishedAt','effectiveFrom','authorityLevel','visibility','storageMode'] as const)if(metadata[field]===null)fail('PUBLICATION_REVIEW_INCOMPLETE');
 if(metadata.scope.audience===null||metadata.scope.studentType===null||draft.action===null||Object.values(draft.attestations).some(v=>!v))fail('PUBLICATION_REVIEW_INCOMPLETE');
 if(draft.action==='NEW_FAMILY'&&(metadata.newFamily===null||metadata.newFamily.name===null||metadata.newFamily.category===null))fail('PUBLICATION_REVIEW_INCOMPLETE');
 const officialSource=metadata.sourceUrl!==null&&isOfficialYruUrl(metadata.sourceUrl);
 if(metadata.visibility==='PUBLIC'&&!officialSource)fail('PUBLICATION_REVIEW_INCOMPLETE');
 let plan:LocatedChunkPlan;try{plan=validateLocatedChunkPlan(input);}catch{return fail('PUBLICATION_PLAN_MISMATCH');}
 if(!/^[a-f0-9]{64}$/.test(expectedSourceChecksum)||plan.sourceChecksum!==expectedSourceChecksum||plan.binding.jobId!==preview.job.id||plan.binding.extractionRevision!==preview.extractionRevision||plan.digest!==draft.chunkPlan!.digest||plan.chunkerVersion!==draft.chunkPlan!.chunkerVersion)fail('PUBLICATION_PLAN_MISMATCH');
 exactCoverage(preview,plan);
 const warnings=buildReviewWarnings(preview);
 try{assertReviewWarningBindings(warnings,draft.warningDispositions);}catch{return fail('PUBLICATION_WARNINGS_UNRESOLVED');}
 if(warnings.some(w=>{const d=draft.warningDispositions.find(d=>d.warningKey===w.key);return !d||d.status==='UNRESOLVED'||d.reason===null;}))fail('PUBLICATION_WARNINGS_UNRESOLVED');
 checkQuality(preview,draft);
 if(metadata.visibility==='PUBLIC'&&(preview.analysis.sensitiveRisk||preview.analysis.sensitiveCategories.length>0||preview.analysis.flags.includes('SENSITIVE_DATA_REVIEW_REQUIRED')))fail('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 if(metadata.storageMode!=='RAG')fail('PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE');
 return {draft,plan,reviewHash:createHash('sha256').update(JSON.stringify(draft),'utf8').digest('hex'),officialSource};
}
