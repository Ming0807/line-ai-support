import {z} from 'zod';
import {ImportStagingError,withImportAdminTransaction,type ImportStagingOptions} from '../imports/import-staging';
import {catalogQuerySchema,catalogPageSchema,catalogRelationsQuerySchema,catalogEnvelopeSchema,historyEnvelopeSchema,documentEnvelopeSchema,type CatalogResponse,type CatalogHistory,type CatalogDetail} from './catalog-types';
type Options=Pick<ImportStagingOptions,'pool'|'signal'>;
function check(options:Options){if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');}
const timestamp=(column:string)=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
// Fixed internal column expressions only. User selectors are exclusively query parameters.
const family=`jsonb_build_object('id',f.id,'code',f.code,'name',f.name,'category',f.category,'defaultStorageMode',f.default_storage_mode)`;
const summary=`jsonb_build_object('id',d.id,'familyId',d.document_family_id,'title',d.title,'documentType',d.document_type,'versionName',d.version_name,'versionStream',d.version_stream,'academicYear',d.academic_year,
 'department',case when dept.id is null then null else jsonb_build_object('code',dept.code,'name',dept.name_th) end,'status',d.status,'isCurrent',d.is_current,'visibility',d.visibility,'storageMode',receipt.storage_mode,
 'publishedAt',d.published_at,'effectiveFrom',d.effective_from,'effectiveTo',d.effective_to,'authorityLevel',d.authority_level,'approvedAt',${timestamp('d.approved_at')},'sourceUrl',d.source_url,'sourcePageUrl',d.source_page_url,'lastImportAt',${timestamp('job.created_at')})`;
const joins=`left join public.departments dept on dept.id=d.department_id left join private.knowledge_import_publications receipt on receipt.document_id=d.id left join private.knowledge_import_jobs job on job.id=receipt.job_id`;
const approved=`approved as (select d.id,d.document_family_id,d.title,d.status,d.version_stream,d.is_current,d.effective_from,d.created_at,dept.code department_code,job.created_at imported_at,${summary} summary from public.documents d ${joins} where d.approval_status='APPROVED')`;
export async function listKnowledgeCatalog(actor:string,input:unknown,options:Options={}):Promise<CatalogResponse>{
 return withImportAdminTransaction(actor,options,async client=>{
  check(options);const parsed=catalogQuerySchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');const q=parsed.data;
  const row=(await client.query(`with ${approved},
   matched as (select a.* from approved a join public.document_families f on f.id=a.document_family_id
    where ($1::text is null or position(lower($1) in lower(f.code))>0 or position(lower($1) in lower(f.name))>0 or position(lower($1) in lower(a.title))>0)
     and ($2::text is null or a.department_code=$2) and ($3::text is null or a.status=$3)),
   families as (select f.* from public.document_families f where exists(select 1 from matched a where a.document_family_id=f.id)
    or ($2::text is null and $3::text is null and ($1::text is null or position(lower($1) in lower(f.code))>0 or position(lower($1) in lower(f.name))>0))),
   selected as (select f.* from families f order by f.code,f.id limit $5 offset $6),
   previews as (select f.code,f.id,${family} || jsonb_build_object(
    'documentCount',(select count(*)::int from matched a where a.document_family_id=f.id),
    'hasMoreVersions',(select count(*)>5 from matched a where a.document_family_id=f.id),
    'versionsPreview',coalesce((select jsonb_agg(p.summary order by p.is_current desc,p.effective_from desc nulls last,p.created_at desc,p.id) from
     (select a.* from matched a where a.document_family_id=f.id order by a.is_current desc,a.effective_from desc nulls last,a.created_at desc,a.id limit 5) p),'[]'::jsonb),
    'lastImportAt',${timestamp('(select max(a.imported_at) from matched a where a.document_family_id=f.id)')}) item from selected f)
   select jsonb_build_object('families',coalesce((select jsonb_agg(p.item order by p.code,p.id) from previews p),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object('code',dept.code,'name',dept.name_th) order by dept.code,dept.id) from public.departments dept),'[]'::jsonb),
    'totalFamilies',(select count(*)::int from families),'totalDocuments',(select count(*)::int from matched),'page',$4::int,'pageSize',$5::int) payload`,
   [q.q,q.departmentCode,q.status,q.page,q.pageSize,(q.page-1)*q.pageSize])).rows[0];
  check(options);return catalogEnvelopeSchema.parse({catalog:row.payload}).catalog;
 });
}
export async function getKnowledgeFamily(actor:string,id:string,input:unknown,options:Options={}):Promise<CatalogHistory>{
 return withImportAdminTransaction(actor,options,async client=>{
  check(options);if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');const parsed=catalogPageSchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');const q=parsed.data;
  const row=(await client.query(`with ${approved}, matched as (select a.* from approved a where a.document_family_id=$1),
   selected as (select a.* from matched a order by a.version_stream,a.effective_from desc nulls last,a.created_at desc,a.id limit $3 offset $4)
   select jsonb_build_object('family',${family},'documents',coalesce((select jsonb_agg(a.summary order by a.version_stream,a.effective_from desc nulls last,a.created_at desc,a.id) from selected a),'[]'::jsonb),
    'totalDocuments',(select count(*)::int from matched),'page',$2::int,'pageSize',$3::int) payload from public.document_families f where f.id=$1`,[id,q.page,q.pageSize,(q.page-1)*q.pageSize])).rows[0];
  if(!row)throw new ImportStagingError('NOT_FOUND');check(options);return historyEnvelopeSchema.parse({history:row.payload}).history;
 });
}
export async function getKnowledgeDocument(actor:string,id:string,input:unknown,options:Options={}):Promise<CatalogDetail>{
 return withImportAdminTransaction(actor,options,async client=>{
  check(options);if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');const parsed=catalogRelationsQuerySchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');const q=parsed.data;
  const row=(await client.query(`with related as (
   select r.id,r.created_at,jsonb_build_object('type',r.relation_type,'direction',case when r.source_document_id=$1 then 'OUTGOING' else 'INCOMING' end,
    'documentId',other.id,'title',other.title,'versionName',other.version_name,'status',other.status) item
   from public.document_relationships r join public.documents other on other.id=case when r.source_document_id=$1 then r.target_document_id else r.source_document_id end
   where (r.source_document_id=$1 or r.target_document_id=$1) and other.approval_status='APPROVED'),
   selected as (select * from related order by created_at,id limit $3 offset $4)
   select jsonb_build_object('summary',${summary},'scope',jsonb_build_object('semester',d.semester,'audience',d.audience,'studentType',d.student_type,'programCode',d.program_code,'curriculumCode',d.curriculum_code,'cohort',d.cohort),
    'review',jsonb_build_object('officialSource',d.official_source,'extractionReviewed',d.extraction_reviewed,'requiresReview',d.requires_review,'archiveOnly',d.archive_only),
    'supersedesDocumentId',(select older.id from public.documents older where older.id=d.supersedes_document_id and older.approval_status='APPROVED'),
    'createdAt',${timestamp('d.created_at')},'updatedAt',${timestamp('d.updated_at')},'relationships',coalesce((select jsonb_agg(s.item order by s.created_at,s.id) from selected s),'[]'::jsonb),
    'totalRelationships',(select count(*)::int from related),'relationsPage',$2::int,'relationsPageSize',$3::int) payload
   from public.documents d ${joins} where d.id=$1 and d.approval_status='APPROVED'`,[id,q.relationsPage,q.relationsPageSize,(q.relationsPage-1)*q.relationsPageSize])).rows[0];
  if(!row)throw new ImportStagingError('NOT_FOUND');check(options);return documentEnvelopeSchema.parse({document:row.payload}).document;
 });
}
