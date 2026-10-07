import {z} from 'zod';
import {authorizeImportAdmin,ImportStagingError,withImportAdminTransaction} from './import-staging';
import {getImportPreview,type ImportExtractionOptions} from './import-extraction';
import {structuredMappingSchema,hasStructuredMappingLimit} from './review-schema';
import {StructuredMappingError} from './structured-mapping-contract';
import {prepareImportStructuredPlan,computeStructuredAcknowledgment,readImportStructuredSource} from './structured-preparation';
import {computeStructuredExtractionDigest} from './structured-mapper';

const revision=z.number().int().min(0).max(999_999_999);
export const structuredPlanRequestSchema=z.object({expectedJobRevision:revision,expectedExtractionRevision:revision.min(1),expectedReviewRevision:revision.max(999_999_998),mapping:structuredMappingSchema}).strict();
export interface ImportStructuredPlanOptions extends ImportExtractionOptions {/** Internal seam, outside SQL; never request-configurable. */beforeRead?:()=>Promise<void>}
function canonicalJobId(id:string):string{const parsed=z.uuid().safeParse(id);if(!parsed.success)throw new ImportStagingError('NOT_FOUND');return parsed.data.toLowerCase();}
async function contextSnapshot(actor:string,id:string,options:ImportStructuredPlanOptions){
 const preview=await getImportPreview(actor,id,options);
 const reviewRevision=await withImportAdminTransaction(actor,options,async client=>{
  const job=(await client.query('select id from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];if(!job)throw new ImportStagingError('NOT_FOUND');
  const fresh=(await client.query(`select revision,status,(select max(revision)::int from private.knowledge_import_revisions where job_id=$1) extraction_revision,
   coalesce((select max(review_revision)::int from private.knowledge_import_reviews where job_id=$1),0) review_revision from private.knowledge_import_jobs where id=$1`,[id])).rows[0];
  if(options.signal?.aborted||fresh.status!=='READY'||fresh.revision!==preview.job.revision||fresh.extraction_revision!==preview.extractionRevision)throw new ImportStagingError('CONFLICT');
  return fresh.review_revision as number;
 });
 return {preview,review:{jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,reviewRevision}};
}
async function finalFence(actor:string,id:string,expected:{jobRevision:number;extractionRevision:number;reviewRevision:number;sourceChecksum:string},options:ImportStructuredPlanOptions){
 await withImportAdminTransaction(actor,options,async client=>{
  const job=(await client.query('select id from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];if(!job)throw new ImportStagingError('NOT_FOUND');
  // Separate statement obtains a fresh snapshot after any job-lock wait.
  const fresh=(await client.query(`select revision,status,checksum,(select max(revision)::int from private.knowledge_import_revisions where job_id=$1) extraction_revision,
   coalesce((select max(review_revision)::int from private.knowledge_import_reviews where job_id=$1),0) review_revision from private.knowledge_import_jobs where id=$1`,[id])).rows[0];
  if(options.signal?.aborted||fresh.status!=='READY'||fresh.checksum!==expected.sourceChecksum||fresh.revision!==expected.jobRevision||fresh.extraction_revision!==expected.extractionRevision||fresh.review_revision!==expected.reviewRevision)throw new ImportStagingError('CONFLICT');
 });
}
export async function getImportStructuredSource(actor:string,id:string,options:ImportStructuredPlanOptions={}){
 try{
  await authorizeImportAdmin(actor,options);id=canonicalJobId(id);const {review,preview}=await contextSnapshot(actor,id,options);
  const original=await readImportStructuredSource(actor,preview,options),source={jobId:id,jobRevision:review.jobRevision,extractionRevision:review.extractionRevision,reviewRevision:review.reviewRevision,sourceChecksum:original.checksum,extractionDigest:computeStructuredExtractionDigest(original,preview.extraction)};
  if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');await options.beforeRead?.();await finalFence(actor,id,source,options);return source;
 }catch(error){if(error instanceof ImportStagingError||error instanceof StructuredMappingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}
}
export async function getImportStructuredPlan(actor:string,id:string,input:unknown,options:ImportStructuredPlanOptions={}){
 try{
  await authorizeImportAdmin(actor,options);
  id=canonicalJobId(id);
  const parsed=structuredPlanRequestSchema.safeParse(input);if(!parsed.success){if(hasStructuredMappingLimit(parsed.error))throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');throw new ImportStagingError('INVALID_REQUEST');}const request=parsed.data;
  const {review,preview}=await contextSnapshot(actor,id,options);
  if(review.jobRevision!==request.expectedJobRevision||review.extractionRevision!==request.expectedExtractionRevision||review.reviewRevision!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
  const nextReviewRevision=review.reviewRevision+1,plan=await prepareImportStructuredPlan(actor,preview,nextReviewRevision,request.mapping,options),acknowledgment=computeStructuredAcknowledgment(plan);
  if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');await options.beforeRead?.();
  await finalFence(actor,id,{...review,sourceChecksum:plan.sourceChecksum},options);
  return {jobId:id,jobRevision:review.jobRevision,extractionRevision:review.extractionRevision,reviewRevision:review.reviewRevision,nextReviewRevision,plan,acknowledgment,publicationAvailable:false as const};
 }catch(error){if(error instanceof ImportStagingError||error instanceof StructuredMappingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}
}
