import {authorizeImportAdmin,ImportStagingError,withImportAdminTransaction} from './import-staging';
import {getImportPreview} from './import-extraction';
import {getImportReview} from './import-review';
import {versionRequestSchema} from './version-resolver';
import {prepareImportChunkPlan,ImportChunkPlanError,type ImportChunkPreparationOptions} from './chunk-preparation';
import type {ImportChunkPlanSnapshot} from './chunk-plan-types';
export interface ImportChunkPlanOptions extends ImportChunkPreparationOptions {beforeRead?:()=>Promise<void>}
export async function getImportChunkPlan(actor:string,id:string,input:unknown,options:ImportChunkPlanOptions={}):Promise<ImportChunkPlanSnapshot>{
 try{
  await authorizeImportAdmin(actor,options);const parsed=versionRequestSchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');
  const expected=parsed.data,review=await getImportReview(actor,id,options);
  if(review.stale||!review.saved||review.jobRevision!==expected.expectedJobRevision||review.extractionRevision!==expected.expectedExtractionRevision||review.reviewRevision!==expected.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
  const preview=await getImportPreview(actor,id,options);
  if(preview.job.revision!==review.jobRevision||preview.extractionRevision!==review.extractionRevision)throw new ImportStagingError('CONFLICT');
  const plan=await prepareImportChunkPlan(actor,preview,options);if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');
  await options.beforeRead?.();if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');
  return await withImportAdminTransaction(actor,options,async client=>{
   // Acquire the job fence first, then use a fresh READ COMMITTED statement after any wait.
   const job=(await client.query('select id from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];if(!job)throw new ImportStagingError('NOT_FOUND');
   const fresh=(await client.query(`select revision job_revision,status,(select max(revision)::int from private.knowledge_import_revisions where job_id=$1) extraction_revision,
    (select max(review_revision)::int from private.knowledge_import_reviews where job_id=$1) review_revision from private.knowledge_import_jobs where id=$1`,[id])).rows[0];
   if(options.signal?.aborted||fresh.status!=='READY'||fresh.job_revision!==review.jobRevision||fresh.extraction_revision!==review.extractionRevision||fresh.review_revision!==review.reviewRevision)throw new ImportStagingError('CONFLICT');
   return {jobId:id,jobRevision:review.jobRevision,extractionRevision:review.extractionRevision,reviewRevision:review.reviewRevision,plan};
  });
 }catch(error){if(error instanceof ImportStagingError||error instanceof ImportChunkPlanError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}
}
