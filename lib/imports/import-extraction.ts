import {createHash} from 'node:crypto';
import {z} from 'zod';
import {analyzeExtraction} from './analyzer';
import {validateLocatedExtraction} from './extraction';
import {applyExtractionEdit,type ExtractionEditEvidence} from './review-draft';
import {parseImportSource} from './parse-source';
import {createImportSource} from './source';
import {decryptStagingValue,encryptStagingValue} from './staging-envelope';
import {getImportJob,readImportOriginal,markImportFailed,withImportAdminTransaction,ImportStagingError,type ImportJobView,type ImportStagingOptions} from './import-staging';
import {datasetTypes,extractionFlags,sensitiveCategories,type ImportSource,type LocatedExtraction,type ImportAnalysis} from './types';

export interface ImportExtractionOptions extends ImportStagingOptions {
 signal?:AbortSignal;
 /** Internal controlled parser seam, never accepted from a request body. */
 parse?:(source:ImportSource,signal?:AbortSignal)=>Promise<LocatedExtraction>;
}
export interface ImportPreview {
 job:ImportJobView;extractionRevision:number;kind:'PARSED'|'EDITED';
 extraction:LocatedExtraction;analysis:ImportAnalysis;edit:ExtractionEditEvidence|null;
}
interface RevisionRow {revision:number;kind:ImportPreview['kind'];extraction_checksum:string;extraction_encrypted:string;analysis_encrypted:string;review_encrypted:string|null}
const revisionSchema=z.number().int().min(0).max(999_999_999);
const nullableText=(max:number)=>z.string().max(max).nullable();
const analysisSchema=z.object({title:nullableText(500),departmentCode:nullableText(80),documentType:nullableText(100),familyCode:nullableText(100),versionName:nullableText(100),academicYear:z.number().int().min(1000).max(2999).nullable(),
 publishedDate:z.null(),effectiveFrom:z.null(),effectiveTo:z.null(),authorityLevel:z.null(),containsTables:z.boolean(),datasetCandidate:z.enum(datasetTypes).nullable(),recommendedStorageMode:z.enum(['RAG','STRUCTURED','BOTH']),
 sensitiveRisk:z.boolean(),sensitiveCategories:z.array(z.enum(sensitiveCategories)).max(sensitiveCategories.length),amendmentCandidate:z.boolean(),
 flags:z.array(z.enum([...extractionFlags,'SOURCE_REVIEW_REQUIRED','ACADEMIC_YEAR_AMBIGUOUS','FAMILY_AMBIGUOUS','STRUCTURED_SCHEMA_UNAVAILABLE','SENSITIVE_DATA_REVIEW_REQUIRED'])).max(30),reviewStatus:z.literal('PENDING_REVIEW'),approved:z.literal(false),
}).strict();
const editEvidenceSchema=z.object({reason:z.string().min(1).max(500),changedPages:z.array(z.number().int().min(0).max(999)).max(1000),
 changedCells:z.array(z.object({table:z.number().int().min(0).max(999),row:z.number().int().min(0).max(9999),column:z.number().int().min(0).max(255)}).strict()).max(100_000),titleChanged:z.boolean()}).strict();
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function keyFor(options:ImportStagingOptions){const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ImportStagingError('INTERNAL_ERROR');return key;}
async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof ImportStagingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}}
function checkRevision(value:number){if(!revisionSchema.safeParse(value).success)throw new ImportStagingError('INVALID_REQUEST');}
function checkSignal(signal?:AbortSignal){if(signal?.aborted)throw new ImportStagingError('CONFLICT');}
async function loadSource(actor:string,id:string,expectedRevision:number|undefined,options:ImportExtractionOptions){
 const initial=await getImportJob(actor,id,options);
 if(expectedRevision!==undefined){checkRevision(expectedRevision);if(initial.revision!==expectedRevision)throw new ImportStagingError('CONFLICT');}
 checkSignal(options.signal);
 const read=await readImportOriginal(actor,id,options);
 if(read.job.revision!==initial.revision)throw new ImportStagingError('CONFLICT');checkSignal(options.signal);
 const source=createImportSource({bytes:read.bytes,filename:read.job.filename,mimeType:read.job.mimeType,sourceUrl:read.job.sourceUrl,acquiredFrom:read.job.acquiredFrom,fetchedAt:read.job.fetchedAt});
 return {job:read.job,source};
}
async function confirmRevision(actor:string,id:string,revision:number,options:ImportExtractionOptions){
 return withImportAdminTransaction(actor,options,async client=>{
  const row=(await client.query('select revision from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];
  if(!row)throw new ImportStagingError('NOT_FOUND');if(row.revision!==revision)throw new ImportStagingError('CONFLICT');checkSignal(options.signal);
 });
}
async function readPreview(actor:string,loaded:Awaited<ReturnType<typeof loadSource>>,options:ImportExtractionOptions):Promise<ImportPreview>{
 const {job,source}=loaded;
 const row=await withImportAdminTransaction(actor,options,async client=>{
  const current=(await client.query('select revision from private.knowledge_import_jobs where id=$1 for share',[job.id])).rows[0];
  if(!current)throw new ImportStagingError('NOT_FOUND');if(current.revision!==job.revision)throw new ImportStagingError('CONFLICT');
  const revision=(await client.query<RevisionRow>('select revision,kind,extraction_checksum,extraction_encrypted,analysis_encrypted,review_encrypted from private.knowledge_import_revisions where job_id=$1 and revision<=$2 order by revision desc limit 1',[job.id,job.revision])).rows[0];
  if(!revision)throw new ImportStagingError('CONFLICT');return revision;
 });
 const context={jobId:job.id,checksum:source.checksum,revision:row.revision};
 const serialized=decryptStagingValue(row.extraction_encrypted,{...context,purpose:'EXTRACTION'},keyFor(options));
 if(digest(serialized)!==row.extraction_checksum)throw new ImportStagingError('INTERNAL_ERROR');
 const extraction=validateLocatedExtraction(source,JSON.parse(serialized));
 const analysis=analysisSchema.parse(JSON.parse(decryptStagingValue(row.analysis_encrypted,{...context,purpose:'ANALYSIS'},keyFor(options))));
 const edit=row.review_encrypted===null?null:editEvidenceSchema.parse(JSON.parse(decryptStagingValue(row.review_encrypted,{...context,purpose:'REVIEW'},keyFor(options))));
 await confirmRevision(actor,job.id,job.revision,options);
 return {job,extractionRevision:row.revision,kind:row.kind,extraction,analysis,edit};
}
export async function getImportPreview(actor:string,id:string,options:ImportExtractionOptions={}):Promise<ImportPreview>{
 return safe(async()=>readPreview(actor,await loadSource(actor,id,undefined,options),options));
}
async function appendRevision(actor:string,loaded:Awaited<ReturnType<typeof loadSource>>,extraction:LocatedExtraction,kind:ImportPreview['kind'],baseRevision:number|null,edit:ExtractionEditEvidence|null,options:ImportExtractionOptions):Promise<ImportPreview>{
 const {job,source}=loaded;checkRevision(job.revision);checkSignal(options.signal);
 const revision=job.revision+1,checked=validateLocatedExtraction(source,extraction),serialized=JSON.stringify(checked);
 const analysis=analysisSchema.parse(analyzeExtraction(source,checked));
 const context={jobId:job.id,checksum:source.checksum,revision};
 const encrypted=encryptStagingValue(serialized,{...context,purpose:'EXTRACTION'},keyFor(options));
 const analysisEncrypted=encryptStagingValue(JSON.stringify(analysis),{...context,purpose:'ANALYSIS'},keyFor(options));
 const reviewEncrypted=edit===null?null:encryptStagingValue(JSON.stringify(editEvidenceSchema.parse(edit)),{...context,purpose:'REVIEW'},keyFor(options));
 return withImportAdminTransaction(actor,options,async client=>{
  const current=(await client.query('select revision,checksum from private.knowledge_import_jobs where id=$1 for update',[job.id])).rows[0];
  if(!current)throw new ImportStagingError('NOT_FOUND');if(current.revision!==job.revision||current.checksum!==source.checksum)throw new ImportStagingError('CONFLICT');checkSignal(options.signal);
  await client.query('insert into private.knowledge_import_revisions(job_id,revision,base_revision,actor_id,kind,extraction_checksum,extraction_encrypted,analysis_encrypted,review_encrypted) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job.id,revision,baseRevision,actor,kind,digest(serialized),encrypted,analysisEncrypted,reviewEncrypted]);
  await client.query("update private.knowledge_import_jobs set revision=$2,status='READY',error_code=null,updated_at=clock_timestamp() where id=$1",[job.id,revision]);
  await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[actor,kind==='PARSED'?'KNOWLEDGE_IMPORT_ANALYZED':'KNOWLEDGE_IMPORT_EDITED',{importJobId:job.id,revision}]);
  return {job:{...job,revision,status:'READY',errorCode:null},extractionRevision:revision,kind,extraction:checked,analysis,edit};
 });
}
export async function analyzeImportJob(actor:string,id:string,expectedRevision:number,options:ImportExtractionOptions={}):Promise<ImportPreview>{
 return safe(async()=>{
  const loaded=await loadSource(actor,id,expectedRevision,options);let extraction:LocatedExtraction;
  try{extraction=await (options.parse??parseImportSource)(loaded.source,options.signal);}
  catch(error){
   checkSignal(options.signal);const code=error instanceof Error?error.message:'';
   const failure=code==='IMPORT_PARSER_TIMEOUT'?'IMPORT_PARSE_TIMEOUT':code==='IMPORT_PARSER_UNAVAILABLE'?'IMPORT_PARSER_UNAVAILABLE':['IMPORT_PARSE_INVALID','IMPORT_PARSER_FAILED','IMPORT_PARSER_OUTPUT_LIMIT'].includes(code)?'IMPORT_PARSE_INVALID':null;
   if(failure){await markImportFailed(actor,id,expectedRevision,failure,options);throw new ImportStagingError('INVALID_REQUEST');}
   throw new ImportStagingError('INTERNAL_ERROR');
  }
  return appendRevision(actor,loaded,extraction,'PARSED',null,null,options);
 });
}
export async function editImportExtraction(actor:string,id:string,expectedRevision:number,input:unknown,options:ImportExtractionOptions={}):Promise<ImportPreview>{
 return safe(async()=>{
  const loaded=await loadSource(actor,id,expectedRevision,options),current=await readPreview(actor,loaded,options);
  let result:ReturnType<typeof applyExtractionEdit>;try{result=applyExtractionEdit(loaded.source,current.extraction,input);}catch{throw new ImportStagingError('INVALID_REQUEST');}
  return appendRevision(actor,loaded,result.extraction,'EDITED',current.extractionRevision,result.edit,options);
 });
}
