import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ImportStagingError,authorizeImportAdmin,withImportAdminTransaction} from './import-staging';
import {getImportPreview,type ImportPreview,type ImportExtractionOptions} from './import-extraction';
import {reviewDraftSchema,reviewSaveSchema,hasStructuredMappingLimit,type ImportReviewDraft} from './review-schema';
import {buildReviewWarnings,assertReviewWarningBindings,type ReviewWarning} from './review-warnings';
import {encryptStagingValue,decryptStagingValue} from './staging-envelope';
import {prepareImportChunkPlan} from './chunk-preparation';
import {prepareImportStructuredPlan,computeStructuredAcknowledgment} from './structured-preparation';
import {StructuredMappingError} from './structured-mapping-contract';
import type {PassageTokenCounter} from '../knowledge/embedding-client';
export interface ImportReviewOptions extends ImportExtractionOptions {
 counter?:PassageTokenCounter;
 /** Internal deterministic concurrency seam, outside SQL; never request-configurable. */
 beforeCommit?:()=>Promise<void>;
}
export interface ImportReviewState {
 jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;stale:boolean;warnings:ReviewWarning[];
 saved:{reviewRevision:number;jobRevision:number;extractionRevision:number;actorId:string;createdAt:string;draft:ImportReviewDraft}|null;
}
interface ReviewRow {
 review_revision:number;job_revision:number;extraction_revision:number;actor_id:string;payload_hash:string;review_encrypted:string;created_at:Date;
}
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
function keyFor(options:ImportReviewOptions){const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ImportStagingError('INTERNAL_ERROR');return key;}
function checkSignal(options:ImportReviewOptions){if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');}
async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof ImportStagingError||error instanceof StructuredMappingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}}
function receiptContext(jobId:string,checksum:string,jobRevision:number,extractionRevision:number,reviewRevision:number){
 return {jobId,checksum:digest(JSON.stringify(['yru:knowledge-review-receipt:v1',checksum,jobRevision,extractionRevision])),revision:reviewRevision,purpose:'REVIEW' as const};
}
async function lockedSnapshot(client:PoolClient,preview:ImportPreview,mode:'share'|'update',requireReady=false){
 const job=(await client.query<{revision:number;checksum:string;status:string}>(`select revision,checksum,status from private.knowledge_import_jobs where id=$1 for ${mode}`,[preview.job.id])).rows[0];
 if(!job)throw new ImportStagingError('NOT_FOUND');if(job.revision!==preview.job.revision)throw new ImportStagingError('CONFLICT');
 if(requireReady&&job.status!=='READY')throw new ImportStagingError('CONFLICT');
 const extraction=(await client.query('select max(revision)::int revision from private.knowledge_import_revisions where job_id=$1',[preview.job.id])).rows[0];
 if(extraction.revision!==preview.extractionRevision)throw new ImportStagingError('CONFLICT');
 const row=(await client.query<ReviewRow>('select review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted,created_at from private.knowledge_import_reviews where job_id=$1 order by review_revision desc limit 1',[preview.job.id])).rows[0]??null;
 return {checksum:job.checksum,row};
}
function readDraft(row:ReviewRow,id:string,checksum:string,options:ImportReviewOptions):ImportReviewDraft{
 const serialized=decryptStagingValue(row.review_encrypted,receiptContext(id,checksum,row.job_revision,row.extraction_revision,row.review_revision),keyFor(options));
 if(digest(serialized)!==row.payload_hash)throw new ImportStagingError('INTERNAL_ERROR');
 const draft=reviewDraftSchema.parse(JSON.parse(serialized));if(JSON.stringify(draft)!==serialized)throw new ImportStagingError('INTERNAL_ERROR');return draft;
}
function state(preview:ImportPreview,saved:ImportReviewState['saved']):ImportReviewState {
 return {jobId:preview.job.id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,reviewRevision:saved?.reviewRevision??0,
  stale:saved!==null&&(saved.jobRevision!==preview.job.revision||saved.extractionRevision!==preview.extractionRevision),warnings:buildReviewWarnings(preview),saved};
}
export async function getImportReview(actor:string,id:string,options:ImportReviewOptions={}):Promise<ImportReviewState>{
 return safe(async()=>{
  const preview=await getImportPreview(actor,id,options);checkSignal(options);
  const snapshot=await withImportAdminTransaction(actor,options,client=>lockedSnapshot(client,preview,'share'));
  let saved:ImportReviewState['saved']=null;
  if(snapshot.row){
   const row=snapshot.row,draft=readDraft(row,id,snapshot.checksum,options);
   saved={reviewRevision:row.review_revision,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,actorId:row.actor_id,createdAt:row.created_at.toISOString(),draft};
  }
  const result=state(preview,saved);
  await withImportAdminTransaction(actor,options,async client=>{
   const current=await lockedSnapshot(client,preview,'share');checkSignal(options);
   if(current.checksum!==snapshot.checksum||(current.row?.review_revision??0)!==result.reviewRevision)throw new ImportStagingError('CONFLICT');
  });
  return result;
 });
}
export async function saveImportReview(actor:string,id:string,input:unknown,options:ImportReviewOptions={}):Promise<ImportReviewState>{
 return safe(async()=>{
  await authorizeImportAdmin(actor,options);
  const parsed=reviewSaveSchema.safeParse(input);if(!parsed.success){if(hasStructuredMappingLimit(parsed.error))throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');throw new ImportStagingError('INVALID_REQUEST');}const request=parsed.data;
  const preview=await getImportPreview(actor,id,options);checkSignal(options);
  if(preview.job.revision!==request.expectedJobRevision||preview.extractionRevision!==request.expectedExtractionRevision)throw new ImportStagingError('CONFLICT');
  const snapshot=await withImportAdminTransaction(actor,options,client=>lockedSnapshot(client,preview,'share'));
  if((snapshot.row?.review_revision??0)!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
  if(request.expectedReviewRevision>=999_999_999||request.draft.schemaVersion===3&&preview.job.status!=='READY')throw new ImportStagingError('CONFLICT');
  if(snapshot.row&&request.draft.schemaVersion!==3&&readDraft(snapshot.row,id,snapshot.checksum,options).schemaVersion===3)throw new ImportStagingError('CONFLICT');
  try{assertReviewWarningBindings(buildReviewWarnings(preview),request.draft.warningDispositions);}catch{throw new ImportStagingError('INVALID_REQUEST');}
  if(request.draft.schemaVersion!==1&&request.draft.chunkPlan!==null){
   const plan=await prepareImportChunkPlan(actor,preview,options);
   if(plan.digest!==request.draft.chunkPlan.digest||plan.chunkerVersion!==request.draft.chunkPlan.chunkerVersion)throw new ImportStagingError('INVALID_REQUEST');
  }
  if(request.draft.schemaVersion===3&&request.draft.structuredMapping!==null){
   const mapped=request.draft.structuredMapping,plan=await prepareImportStructuredPlan(actor,preview,request.expectedReviewRevision+1,mapped.mapping,options);
   if(plan.sourceChecksum!==snapshot.checksum)throw new ImportStagingError('CONFLICT');
   if(mapped.acknowledgment!==null){const ack=computeStructuredAcknowledgment(plan);
    if(mapped.acknowledgment.contentDigest!==ack.contentDigest||mapped.acknowledgment.mapperVersion!==ack.mapperVersion)throw new ImportStagingError('INVALID_REQUEST');
   }
  }
  const reviewRevision=request.expectedReviewRevision+1,serialized=JSON.stringify(request.draft),payloadHash=digest(serialized);
  const encrypted=encryptStagingValue(serialized,receiptContext(id,snapshot.checksum,preview.job.revision,preview.extractionRevision,reviewRevision),keyFor(options));
  checkSignal(options);await options.beforeCommit?.();checkSignal(options);
  const row=await withImportAdminTransaction(actor,options,async client=>{
   const current=await lockedSnapshot(client,preview,'update',request.draft.schemaVersion===3);checkSignal(options);
   if(current.checksum!==snapshot.checksum||(current.row?.review_revision??0)!==request.expectedReviewRevision)throw new ImportStagingError('CONFLICT');
   const inserted=(await client.query<ReviewRow>(`insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted)
    values($1,$2,$3,$4,$5,$6,$7) returning review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted,created_at`,
    [id,reviewRevision,preview.job.revision,preview.extractionRevision,actor,payloadHash,encrypted])).rows[0];
   await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[actor,'KNOWLEDGE_IMPORT_REVIEW_SAVED',{importJobId:id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,reviewRevision}]);
   return inserted;
  });
  return state(preview,{reviewRevision:row.review_revision,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,actorId:row.actor_id,createdAt:row.created_at.toISOString(),draft:request.draft});
 });
}
