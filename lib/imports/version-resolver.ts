import {z} from 'zod';
import {getImportReview} from './import-review';
import type {ImportExtractionOptions} from './import-extraction';
import {authorizeImportAdmin,withImportAdminTransaction,ImportStagingError} from './import-staging';
import {buildVersionCandidates,type VersionChoices,type VersionDocument,type VersionFamily} from './version-candidates';
const revision=z.number().int().min(1).max(999_999_999);
export const versionRequestSchema=z.object({expectedJobRevision:revision,expectedExtractionRevision:revision,expectedReviewRevision:revision}).strict();
export type VersionRequest=z.infer<typeof versionRequestSchema>;
export interface ImportVersionResolution extends VersionChoices {jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number}
export interface ImportVersionOptions extends ImportExtractionOptions {
 /** Internal race-test seam after decryption and outside SQL; never request-configurable. */
 beforeRead?:()=>Promise<void>;
}
function checkSignal(options:ImportVersionOptions){if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');}
export async function getImportVersionResolution(actor:string,id:string,input:unknown,options:ImportVersionOptions={}):Promise<ImportVersionResolution>{
 try{
  await authorizeImportAdmin(actor,options);
  const parsed=versionRequestSchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');const request=parsed.data;
  const review=await getImportReview(actor,id,options);checkSignal(options);
  if(!review.saved||review.stale||review.jobRevision!==request.expectedJobRevision||review.extractionRevision!==request.expectedExtractionRevision||review.reviewRevision!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
  const metadata=review.saved.draft.metadata;
  await options.beforeRead?.();checkSignal(options);
  return await withImportAdminTransaction(actor,options,async client=>{
   // A review append locks the job but does not update its tuple. Lock first;
   // scalar subqueries in that waiting statement could retain a pre-commit snapshot.
   const locked=(await client.query('select id from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];
   if(!locked)throw new ImportStagingError('NOT_FOUND');
   const snapshot=(await client.query<{revision:number;extraction_revision:number;review_revision:number}>(`select revision,
    (select max(revision)::int from private.knowledge_import_revisions where job_id=j.id) extraction_revision,
    (select max(review_revision)::int from private.knowledge_import_reviews where job_id=j.id) review_revision
    from private.knowledge_import_jobs j where id=$1`,[id])).rows[0];
   if(!snapshot)throw new ImportStagingError('NOT_FOUND');
   if(snapshot.revision!==review.jobRevision||snapshot.extraction_revision!==review.extractionRevision||snapshot.review_revision!==review.reviewRevision)throw new ImportStagingError('CONFLICT');
   // One MVCC statement reads family metadata, bounded versions and relationship flags.
   // Read the entire family so a current stream in another scope still blocks ordinary addition.
   const familyRow=metadata.familyCode===null?undefined:(await client.query<VersionFamily&{documents:VersionDocument[];current_stream_occupied:boolean}>(`select f.id,f.code,f.name,f.category,
    exists(select 1 from public.documents occupied where occupied.document_family_id=f.id and occupied.version_stream=$2 and occupied.is_current) current_stream_occupied,
    coalesce((select jsonb_agg(to_jsonb(candidate) order by candidate."documentId") from (
     select d.id "documentId",d.revision,d.title,department.code "departmentCode",d.document_type "documentType",d.version_name "versionName",
      d.version_stream "versionStream",d.academic_year "academicYear",
      jsonb_build_object('semester',d.semester,'audience',d.audience,'studentType',d.student_type,'programCode',d.program_code,'curriculumCode',d.curriculum_code,'cohort',d.cohort) scope,
      d.status,d.is_current "isCurrent",(d.approval_status='APPROVED') approved,
      exists(select 1 from public.document_relationships r where r.source_document_id=d.id and r.relation_type='AMENDS') "isAmendment",
      exists(select 1 from public.document_relationships r where r.source_document_id=d.id and r.relation_type='CANCELS') "isCancellation",
      d.effective_from::text "effectiveFrom",d.effective_to::text "effectiveTo"
     from public.documents d left join public.departments department on department.id=d.department_id
     where d.document_family_id=f.id order by d.id limit 101
    ) candidate),'[]'::jsonb) documents from public.document_families f where f.code=$1`,[metadata.familyCode,metadata.versionStream])).rows[0];
   checkSignal(options);
   const family=familyRow?{id:familyRow.id,code:familyRow.code,name:familyRow.name,category:familyRow.category}:null;
   return {jobId:id,jobRevision:review.jobRevision,extractionRevision:review.extractionRevision,reviewRevision:review.reviewRevision,
    ...buildVersionCandidates(metadata,family,familyRow?.documents??[]),currentStreamOccupied:familyRow?.current_stream_occupied??false};
  });
 }catch(error){if(error instanceof ImportStagingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}
}
