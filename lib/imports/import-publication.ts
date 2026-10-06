import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {authorizeImportAdmin,withImportAdminTransaction,ImportStagingError,type ImportStagingOptions} from './import-staging';
import {getImportPreview} from './import-extraction';
import {getImportReview} from './import-review';
import {prepareImportChunkPlan,ImportChunkPlanError} from './chunk-preparation';
import {validatePublicationReview,PublicationPolicyError,type ValidatedPublicationReview} from './publication-contract';
import {getImportVersionResolution} from './version-resolver';
import {buildVersionCandidates,type VersionChoices,type VersionDocument,type VersionFamily} from './version-candidates';
import type {ImportReviewDraft} from './review-schema';
import {createLocalE5EmbeddingProvider,type LocalE5EmbeddingProvider} from '../knowledge/embedding-client';
import {embedLocatedChunkPlan,LocatedEmbeddingPreparationError} from '../knowledge/located-embedding-preparation';
import {knowledgeFamilyLock,knowledgeDocumentLock} from '../knowledge/delivery-fence';
const revision=z.number().int().min(1).max(999_999_999);
export const publicationRequestSchema=z.object({id:z.uuid().transform(id=>id.toLowerCase()),expectedJobRevision:revision,expectedExtractionRevision:revision,expectedReviewRevision:revision,confirmPublication:z.literal(true)}).strict();
type Request=z.infer<typeof publicationRequestSchema>;
export interface ImportPublicationOptions extends ImportStagingOptions{
 provider?:LocalE5EmbeddingProvider;
 /** Internal deterministic seams only, never accepted from HTTP. */
 beforeCommit?:()=>Promise<void>;
 failureAt?:'DOCUMENT'|'CHUNKS'|'ACTIVITY'|'RECEIPT';
 preparationTimeoutMs?:number;
}
export interface ImportPublicationReceipt{
 jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;documentId:string;familyId:string;
 storageMode:'RAG'|'STRUCTURED'|'BOTH';action:NonNullable<ImportReviewDraft['action']>;relationship:'CANCELS'|null;planDigest:string;createdAt:string;
}
export interface ImportPublicationResult{receipt:ImportPublicationReceipt;replayed:boolean}
interface ReceiptRow{job_id:string;job_revision:number;extraction_revision:number;review_revision:number;document_id:string;family_id:string;storage_mode:ImportPublicationReceipt['storageMode'];action:ImportPublicationReceipt['action'];relationship:'CANCELS'|null;plan_digest:string;created_at:Date}
function receipt(row:ReceiptRow):ImportPublicationReceipt{return {jobId:row.job_id,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,reviewRevision:row.review_revision,documentId:row.document_id,familyId:row.family_id,storageMode:row.storage_mode,action:row.action,relationship:row.relationship,planDigest:row.plan_digest,createdAt:row.created_at.toISOString()};}
function replay(row:ReceiptRow,request:Request):ImportPublicationResult{
 if(row.job_revision!==request.expectedJobRevision||row.extraction_revision!==request.expectedExtractionRevision||row.review_revision!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
 return {receipt:receipt(row),replayed:true};
}
function checkSignal(options:ImportPublicationOptions){if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');}
async function currentReceipt(client:PoolClient,id:string){return (await client.query<ReceiptRow>('select * from private.knowledge_import_publications where job_id=$1',[id])).rows[0];}
function assertAction(draft:ImportReviewDraft,choices:VersionChoices){
 if(choices.limitExceeded||choices.missingMetadata.length>0||draft.action===null)throw new ImportStagingError('CONFLICT');
 const required=draft.relationship==='CANCELS'?'CANCELS':draft.action;
 if(required==='REPLACE_CURRENT'||required==='AMEND_EXISTING'||required==='CANCELS'){
  const target=choices.candidates.find(c=>c.documentId===draft.target?.documentId&&c.revision===draft.target.revision);
  if(!target||!target.targetActions.includes(required))throw new ImportStagingError('CONFLICT');
 }else if(!choices.availableActions.includes(required)||required==='ADD_ADDITIONAL'&&choices.currentStreamOccupied)throw new ImportStagingError('CONFLICT');
}
async function familyChoices(client:PoolClient,draft:ImportReviewDraft,family:VersionFamily|null):Promise<VersionChoices>{
 if(!family)return buildVersionCandidates(draft.metadata,null,[]);
 const documents=(await client.query<VersionDocument>(`select d.id "documentId",d.revision,d.title,dept.code "departmentCode",d.document_type "documentType",d.version_name "versionName",d.version_stream "versionStream",d.academic_year "academicYear",
  jsonb_build_object('semester',d.semester,'audience',d.audience,'studentType',d.student_type,'programCode',d.program_code,'curriculumCode',d.curriculum_code,'cohort',d.cohort) scope,
  d.status,d.is_current "isCurrent",(d.approval_status='APPROVED') approved,
  exists(select 1 from public.document_relationships r where r.source_document_id=d.id and r.relation_type='AMENDS') "isAmendment",
  exists(select 1 from public.document_relationships r where r.source_document_id=d.id and r.relation_type='CANCELS') "isCancellation",d.effective_from::text "effectiveFrom",d.effective_to::text "effectiveTo"
  from public.documents d left join public.departments dept on dept.id=d.department_id where d.document_family_id=$1 order by d.id limit 101`,[family.id])).rows;
 const choices=buildVersionCandidates(draft.metadata,family,documents);
 choices.currentStreamOccupied=(await client.query('select exists(select 1 from public.documents where document_family_id=$1 and version_stream=$2 and is_current) occupied',[family.id,draft.metadata.versionStream])).rows[0].occupied;
 return choices;
}
async function prepare(actor:string,request:Request,checksum:string,options:ImportPublicationOptions){
 const provider=options.provider??createLocalE5EmbeddingProvider();
 const timeout=options.preparationTimeoutMs??45_000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>45_000)throw new ImportStagingError('INVALID_REQUEST');
 const controller=new AbortController();let timedOut=false;const deadline=performance.now()+timeout;
 const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 let rejectTimeout!:(reason:unknown)=>void;
 const cancellation=new Promise<never>((_,reject)=>{rejectTimeout=reject;});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();rejectTimeout(new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408));},timeout);
 const cancelCaller=()=>rejectTimeout(new ImportStagingError('CONFLICT'));options.signal?.addEventListener('abort',cancelCaller,{once:true});
 try{
  const result=await Promise.race([cancellation,(async()=>{
   const currentOptions={...options,signal:controller.signal};
   const preview=await getImportPreview(actor,request.id,currentOptions),review=await getImportReview(actor,request.id,currentOptions);checkSignal(currentOptions);
   if(!review.saved||review.jobRevision!==request.expectedJobRevision||review.extractionRevision!==request.expectedExtractionRevision||review.reviewRevision!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
   const plan=await prepareImportChunkPlan(actor,preview,{...options,signal:controller.signal,counter:provider,timeoutMs:Math.max(1,Math.floor(deadline-performance.now()))});
   const checked=validatePublicationReview(preview,review,plan,checksum);
   const versions=await getImportVersionResolution(actor,request.id,{expectedJobRevision:request.expectedJobRevision,expectedExtractionRevision:request.expectedExtractionRevision,expectedReviewRevision:request.expectedReviewRevision},currentOptions);assertAction(checked.draft,versions);
   if(controller.signal.aborted)throw new ImportStagingError('CONFLICT');
   const left=Math.floor(deadline-performance.now());if(left<1)throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);
   const embedded=await embedLocatedChunkPlan(checked.plan,provider,{signal:controller.signal,timeoutMs:left});
   return {checked,embeddings:embedded.embeddings,mimeType:preview.job.mimeType};
  })()]);
  checkSignal(options);if(timedOut)throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);return result;
 }catch(error){if(timedOut)throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);throw error;}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);options.signal?.removeEventListener('abort',cancelCaller);controller.abort();}
}
async function finalize(actor:string,request:Request,checked:ValidatedPublicationReview,embeddings:number[][],mimeType:string,options:ImportPublicationOptions):Promise<ImportPublicationResult>{
 const documentId=randomUUID(),draft=checked.draft,m=draft.metadata;
 return withImportAdminTransaction(actor,options,async client=>{
  // Lock first; a counter read in the waiting statement would have an old MVCC snapshot.
  if(!(await client.query('select id from private.knowledge_import_jobs where id=$1 for update',[request.id])).rows[0])throw new ImportStagingError('NOT_FOUND');
  const existing=await currentReceipt(client,request.id);if(existing)return replay(existing,request);
  const snapshot=(await client.query(`select j.revision,j.checksum,j.status,j.publication_status,
   (select max(revision)::int from private.knowledge_import_revisions where job_id=j.id) extraction_revision,
   (select max(review_revision)::int from private.knowledge_import_reviews where job_id=j.id) review_revision,
   (select payload_hash from private.knowledge_import_reviews where job_id=j.id order by review_revision desc limit 1) review_hash
   from private.knowledge_import_jobs j where j.id=$1`,[request.id])).rows[0];
  checkSignal(options);
  if(!snapshot||snapshot.status!=='READY'||snapshot.publication_status!=='NOT_PUBLISHED'||snapshot.revision!==request.expectedJobRevision||snapshot.extraction_revision!==request.expectedExtractionRevision||snapshot.review_revision!==request.expectedReviewRevision||snapshot.checksum!==checked.plan.sourceChecksum||snapshot.review_hash!==checked.reviewHash)throw new ImportStagingError('CONFLICT');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['knowledge-family-code:'+m.familyCode]);
  let family=(await client.query<VersionFamily>('select id,code,name,category from public.document_families where code=$1',[m.familyCode])).rows[0]??null;
  if(family){await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeFamilyLock(family.id)]);await client.query('select id from public.document_families where id=$1 for update',[family.id]);}
  const docLocks=[documentId,...(draft.target?[draft.target.documentId]:[])].sort();
  for(const id of docLocks)await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[knowledgeDocumentLock(id)]);
  if(draft.target)await client.query('select id from public.documents where id=$1 for update',[draft.target.documentId]);
  assertAction(draft,await familyChoices(client,draft,family));
  if(!family){family=(await client.query<VersionFamily>('insert into public.document_families(code,name,category,default_storage_mode) values($1,$2,$3,$4) returning id,code,name,category',[m.familyCode,m.newFamily!.name,m.newFamily!.category,m.storageMode])).rows[0];}
  const department=(await client.query('select id from public.departments where code=$1 and active',[m.departmentCode])).rows[0];if(!department)throw new ImportStagingError('CONFLICT');
  if(draft.action==='REPLACE_CURRENT'){
   const changed=await client.query("update public.documents set status='SUPERSEDED',is_current=false,revision=revision+1,updated_at=clock_timestamp() where id=$1 and revision=$2",[draft.target!.documentId,draft.target!.revision]);if(changed.rowCount!==1)throw new ImportStagingError('CONFLICT');
  }
  const instrument=draft.action==='AMEND_EXISTING'||draft.relationship==='CANCELS',historical=draft.action==='ADD_HISTORICAL';
  await client.query(`insert into public.documents(id,document_family_id,department_id,title,document_type,version_name,version_stream,academic_year,semester,audience,student_type,program_code,curriculum_code,cohort,
   published_at,effective_from,effective_to,status,is_current,authority_level,approval_status,approved_by,approved_at,official_source,extraction_reviewed,requires_review,visibility,archive_only,source_url,source_page_url,mime_type,checksum,supersedes_document_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'APPROVED',$21,clock_timestamp(),$22,true,false,$23,false,$24,$25,$26,$27,$28)`,
   [documentId,family.id,department.id,m.title,m.documentType,m.versionName,m.versionStream,m.academicYear,m.scope.semester,m.scope.audience,m.scope.studentType,m.scope.programCode,m.scope.curriculumCode,m.scope.cohort,m.publishedAt,m.effectiveFrom,m.effectiveTo,historical?'SUPERSEDED':'ACTIVE',!instrument&&!historical,m.authorityLevel,actor,checked.officialSource,m.visibility,m.sourceUrl,m.sourcePageUrl,mimeType,checked.plan.sourceChecksum,draft.action==='REPLACE_CURRENT'?draft.target!.documentId:null]);
  if(options.failureAt==='DOCUMENT')throw new ImportStagingError('INTERNAL_ERROR');
  if(draft.target){const relation=draft.relationship==='CANCELS'?'CANCELS':draft.action==='AMEND_EXISTING'?'AMENDS':'SUPERSEDES';await client.query('insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,$3)',[documentId,draft.target.documentId,relation]);}
  // One bounded JSON recordset statement persists exact prepared canonical vectors and provenance.
  const rows=checked.plan.chunks.map((c,i)=>({index:c.index,page:c.pageNumber,section:c.sectionTitle,content:c.content,locations:c.sourceLocations,tokens:c.passageTokenCount,vector:JSON.stringify(embeddings[i])}));
  await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,requires_review,embedding,embedding_dimensions,embedding_fingerprint,source_locations,passage_token_count)
   select $1,r.index,r.page,r.section,r.content,false,r.vector::extensions.vector,384,$3,r.locations,r.tokens from jsonb_to_recordset($2::jsonb) as r(index integer,page integer,section text,content text,locations jsonb,tokens integer,vector text)`,[documentId,JSON.stringify(rows),checked.plan.embeddingFingerprint]);
  if(options.failureAt==='CHUNKS')throw new ImportStagingError('INTERNAL_ERROR');
  await client.query('update public.document_families set rule_revision=rule_revision+1,updated_at=clock_timestamp() where id=$1',[family.id]);
  await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[actor,'KNOWLEDGE_IMPORT_PUBLISHED',{importJobId:request.id,documentId,familyId:family.id,jobRevision:request.expectedJobRevision,extractionRevision:request.expectedExtractionRevision,reviewRevision:request.expectedReviewRevision,action:draft.action,relationship:draft.relationship,storageMode:m.storageMode,chunkCount:rows.length}]);
  if(options.failureAt==='ACTIVITY')throw new ImportStagingError('INTERNAL_ERROR');
  const row=(await client.query<ReceiptRow>(`insert into private.knowledge_import_publications(job_id,job_revision,extraction_revision,review_revision,actor_id,document_id,family_id,storage_mode,action,relationship,source_checksum,review_hash,plan_digest,embedding_fingerprint)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[request.id,request.expectedJobRevision,request.expectedExtractionRevision,request.expectedReviewRevision,actor,documentId,family.id,m.storageMode,draft.action,draft.relationship,checked.plan.sourceChecksum,checked.reviewHash,checked.plan.digest,checked.plan.embeddingFingerprint])).rows[0];
  if(options.failureAt==='RECEIPT')throw new ImportStagingError('INTERNAL_ERROR');
  checkSignal(options);await client.query("update private.knowledge_import_jobs set publication_status='COMPLETED' where id=$1",[request.id]);
  return {receipt:receipt(row),replayed:false};
 });
}
/** Explicit reviewed publication only. No HTTP route exposes this until relationship/delivery acceptance. */
export async function approveImport(actor:string,input:unknown,options:ImportPublicationOptions={}):Promise<ImportPublicationResult>{
 try{
  await authorizeImportAdmin(actor,options);checkSignal(options);
  const parsed=publicationRequestSchema.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');const request=parsed.data;
  const before=await withImportAdminTransaction(actor,options,async client=>{
   const job=(await client.query('select id,checksum from private.knowledge_import_jobs where id=$1 for share',[request.id])).rows[0];if(!job)throw new ImportStagingError('NOT_FOUND');
   const existing=await currentReceipt(client,request.id);return {checksum:job.checksum as string,result:existing?replay(existing,request):null};
  });
  if(before.result)return before.result;
  const prepared=await prepare(actor,request,before.checksum,options);await options.beforeCommit?.();checkSignal(options);
  return await finalize(actor,request,prepared.checked,prepared.embeddings,prepared.mimeType,options);
 }catch(error){
  if(error instanceof ImportStagingError||error instanceof PublicationPolicyError||error instanceof ImportChunkPlanError)throw error;
  if(error instanceof LocatedEmbeddingPreparationError){if(error.code==='KNOWLEDGE_EMBEDDING_ABORTED')throw new ImportStagingError('CONFLICT');if(error.code==='KNOWLEDGE_EMBEDDING_TIMEOUT')throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);throw new ImportChunkPlanError('CHUNK_PLAN_UNAVAILABLE',503);}
  throw new ImportStagingError('INTERNAL_ERROR');
 }
}
