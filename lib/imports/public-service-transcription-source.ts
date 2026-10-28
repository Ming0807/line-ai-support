import type {DbClient} from '../tickets/authorization';
import {withImportAdminTransaction,decodeStoredImportSourceMetadata,readImportOriginal} from './import-staging';
import type {ImportExtractionOptions} from './import-extraction';
import {serviceTranscriptionParentSchema,type ServiceTranscription} from './public-service-transcription-contract';
import {canonicalDigest,type StructuredMappingPlan} from './structured-mapping-contract';
import {PublicServiceTranscriptionError,validateServiceTranscriptionValues} from './public-service-transcription';
import {sourceLocationSchema,validateLocatedExtraction} from './extraction';
import {isOfficialYruUrl,createImportSource} from './source';
import {decryptStagingValue} from './staging-envelope';
import {createHash} from 'node:crypto';
const invalid=():never=>{throw new PublicServiceTranscriptionError();};
/** Read using the caller's authorized transaction. No file/provider work or parent-job lock here. */
export async function readServiceTranscriptionParent(client:DbClient,parent:ServiceTranscription['parent'],key:string,lock=false,includeExtraction=false){
 try{
  const wanted=serviceTranscriptionParentSchema.parse(parent);
  if(!isOfficialYruUrl(wanted.sourceUrl))invalid();
  if(lock)await client.query('select id from public.documents where id=$1 for share',[wanted.documentId]);
  // A separate statement observes fresh state after a row-lock wait. The receipt is immutable.
  const row=(await client.query(`select d.id,d.document_family_id,d.revision,d.title,d.department_id,d.source_url,d.checksum,d.authority_level,
   p.job_id,p.job_revision,p.extraction_revision,p.review_revision,p.source_checksum,j.source_metadata_encrypted,
   case when $2::boolean then x.extraction_encrypted else null end published_extraction,x.extraction_checksum,
   (select jsonb_agg(k.source_locations order by k.chunk_index) from (select source_locations,chunk_index from public.knowledge_chunks where document_id=d.id and not requires_review order by chunk_index limit 201) k) locations
   from public.documents d join private.knowledge_import_publications p on p.document_id=d.id and p.storage_mode='RAG'
   join private.knowledge_import_jobs j on j.id=p.job_id and j.checksum=p.source_checksum and j.format='HTML' and j.publication_status='COMPLETED'
   join private.knowledge_import_revisions x on x.job_id=p.job_id and x.revision=p.extraction_revision
   join private.knowledge_import_reviews r on r.job_id=p.job_id and r.review_revision=p.review_revision and r.job_revision=p.job_revision and r.extraction_revision=p.extraction_revision and r.payload_hash=p.review_hash
   where d.id=$1 and d.approval_status='APPROVED' and d.visibility='PUBLIC' and d.status='ACTIVE' and d.is_current
    and d.official_source and d.extraction_reviewed and not d.requires_review and not d.archive_only and d.authority_level>0
    and d.document_type='GUIDE' and d.temporal_basis='CURRENT_REVIEWED' and d.current_reviewed_at is not null and d.effective_from is null and d.effective_to is null
    and d.audience='ALL' and d.student_type='ALL' and d.semester is null and d.program_code is null and d.curriculum_code is null and d.cohort is null and d.academic_year is null
    and not exists(select 1 from public.document_relationships x where x.source_document_id=d.id or x.target_document_id=d.id)
    and not exists(select 1 from public.documents other where other.document_family_id=d.document_family_id and other.version_stream=d.version_stream and other.id<>d.id and other.status='ACTIVE' and other.is_current and other.approval_status='APPROVED')`,[wanted.documentId,includeExtraction])).rows[0];
  if(!row||row.checksum!==row.source_checksum||!Array.isArray(row.locations)||row.locations.length<1||row.locations.length>200)invalid();
  const actual=serviceTranscriptionParentSchema.parse({documentId:row.id,familyId:row.document_family_id,documentRevision:row.revision,jobId:row.job_id,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,reviewRevision:row.review_revision,sourceChecksum:row.source_checksum,sourceUrl:row.source_url,title:row.title});
  if(canonicalDigest('transcription-parent-v1',actual)!==canonicalDigest('transcription-parent-v1',wanted))invalid();
  const original=decodeStoredImportSourceMetadata({jobId:actual.jobId,checksum:actual.sourceChecksum,encrypted:row.source_metadata_encrypted},key);
  if(original.sourceUrl!==actual.sourceUrl)invalid();
  const approvedLocations=row.locations.flatMap((locations:unknown)=>{if(!Array.isArray(locations)||locations.length>200)return invalid();return locations.map(location=>sourceLocationSchema.parse(location));});
  if(!Number.isInteger(row.authority_level)||row.authority_level<1||row.authority_level>100)invalid();
  return {parent:actual,approvedLocations,departmentId:row.department_id as string,authorityLevel:row.authority_level as number,publishedExtraction:row.published_extraction as string|null,extractionChecksum:row.extraction_checksum as string};
 }catch{return invalid();}
}
/** Load the exact approved extraction, never the newest private staging draft/status. */
export async function loadPublishedServiceTranscriptionSource(actor:string,parent:ServiceTranscription['parent'],options:ImportExtractionOptions){
 const key=options.key??process.env.ENCRYPTION_KEY;if(!key)return invalid();
 const bound=await withImportAdminTransaction(actor,options,client=>readServiceTranscriptionParent(client,parent,key,false,true));
 const original=await readImportOriginal(actor,parent.jobId,options),source=createImportSource({bytes:original.bytes,filename:original.job.filename,mimeType:original.job.mimeType,sourceUrl:original.job.sourceUrl,acquiredFrom:original.job.acquiredFrom,fetchedAt:original.job.fetchedAt});
 if(options.signal?.aborted||source.format!=='HTML'||source.checksum!==parent.sourceChecksum||source.sourceUrl!==parent.sourceUrl||typeof bound.publishedExtraction!=='string')return invalid();
 const serialized=decryptStagingValue(bound.publishedExtraction,{jobId:parent.jobId,checksum:parent.sourceChecksum,revision:parent.extractionRevision,purpose:'EXTRACTION'},key);
 if(createHash('sha256').update(serialized,'utf8').digest('hex')!==bound.extractionChecksum)return invalid();
 return {...bound,source,extraction:validateLocatedExtraction(source,JSON.parse(serialized))};
}
/** Source parsing is outside SQL; publication/delivery independently fence the immutable receipt and live parent. */
export async function validateServiceTranscriptionSource(actor:string,manifest:ServiceTranscription,plan:StructuredMappingPlan,options:ImportExtractionOptions){
 const bound=await loadPublishedServiceTranscriptionSource(actor,manifest.parent,options);
 validateServiceTranscriptionValues(manifest,plan,{parent:bound.parent,extraction:bound.extraction,approvedLocations:bound.approvedLocations});return bound;
}
