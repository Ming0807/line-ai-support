import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {getDatabasePool,transaction} from '../database/pool';
import {decryptOriginal,encryptOriginal} from './original-envelope';
import {verifyImportSource} from './source';
import {decryptStagingValue,encryptStagingValue} from './staging-envelope';
import type {ImportFormat,ImportSource,OriginalRef} from './types';
import {acquireOfficialUrl,type OfficialUrlOptions} from './url-importer';
import {urlAcquisitionSchema,validateUrlAcquisition,type UrlAcquisitionProvenance} from './source-provenance';
import {createOriginalStorage,type OriginalStorage} from './original-storage';
export interface ImportStagingOptions {pool?:Pool;key?:string;acquisition?:unknown;originalBackend?:OriginalRef['backend'];storage?:OriginalStorage}
export class ImportStagingError extends Error {
 constructor(readonly code:'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'INVALID_REQUEST'|'INTERNAL_ERROR'){super(code);this.name='ImportStagingError';}
}
export interface ImportJobView {id:string;status:'READY'|'FAILED';revision:number;filename:string;format:ImportFormat;mimeType:string;sourceUrl:string|null;acquiredFrom:'UPLOAD'|'URL';fetchedAt:string|null;acquisition:UrlAcquisitionProvenance|null;byteLength:number;createdAt:string;errorCode:string|null}
interface ImportRow {id:string;original_id:string;checksum:string;format:ImportFormat;backend:OriginalRef['backend'];byte_length:number;key_version:1;
 original_ciphertext?:Buffer|null;source_metadata_encrypted:string;status:ImportJobView['status'];revision:number;created_at:Date;error_code:string|null}
const columns='id,original_id,checksum,format,backend,byte_length,key_version,source_metadata_encrypted,status,revision,created_at,error_code';
const sourceMetadataSchema=z.object({filename:z.string().min(1).max(180),mimeType:z.string().min(1).max(200),sourceUrl:z.url().max(2048).nullable(),
 acquiredFrom:z.enum(['UPLOAD','URL']),fetchedAt:z.iso.datetime({offset:true}).nullable(),acquisition:urlAcquisitionSchema.nullable().default(null)}).strict()
 .refine(value=>value.acquiredFrom==='UPLOAD'?value.fetchedAt===null&&value.acquisition===null:
  value.fetchedAt!==null&&value.acquisition!==null&&value.acquisition.finalUrl===value.sourceUrl);
const failureCode=z.enum(['IMPORT_PARSE_INVALID','IMPORT_PARSER_UNAVAILABLE','IMPORT_PARSE_TIMEOUT','IMPORT_SOURCE_INVALID']);
async function safe<T>(work:()=>Promise<T>):Promise<T>{
 try{return await work();}catch(error){if(error instanceof ImportStagingError)throw error;throw new ImportStagingError('INTERNAL_ERROR');}
}
async function authorize(client:PoolClient,actor:string):Promise<void>{
 if(!z.uuid().safeParse(actor).success)throw new ImportStagingError('FORBIDDEN');
 const profile=(await client.query("select role from public.staff_profiles where id=$1 and active for share",[actor])).rows[0];
 if(profile?.role!=='SUPER_ADMIN')throw new ImportStagingError('FORBIDDEN');
}
async function run<T>(actor:string,options:ImportStagingOptions,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 return safe(()=>transaction(async client=>{await client.query("set local statement_timeout='5s';set local lock_timeout='3s'");await authorize(client,actor);return work(client);},options.pool??getDatabasePool()));
}
export async function authorizeImportAdmin(actor:string,options:ImportStagingOptions={}):Promise<void>{await run(actor,options,async()=>undefined);}
function keyFor(options:ImportStagingOptions):string{
 const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new ImportStagingError('INTERNAL_ERROR');return key;
}
function view(row:ImportRow,key:string):ImportJobView {
 const metadata=sourceMetadataSchema.parse(JSON.parse(decryptStagingValue(row.source_metadata_encrypted,
  {jobId:row.id,checksum:row.checksum,revision:0,purpose:'SOURCE_METADATA'},key)));
 return {id:row.id,status:row.status,revision:row.revision,...metadata,format:row.format,byteLength:row.byte_length,
  createdAt:row.created_at.toISOString(),errorCode:row.error_code};
}
async function rowFor(client:PoolClient,id:string,includeOriginal=false):Promise<ImportRow>{
 if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
 const row=(await client.query<ImportRow>(`select ${columns}${includeOriginal?',original_ciphertext':''} from private.knowledge_import_jobs where id=$1 for share`,[id])).rows[0];
 if(!row)throw new ImportStagingError('NOT_FOUND');return row;
}
async function audit(client:PoolClient,actor:string,action:string,metadata:{importJobId:string;byteLength?:number;errorCode?:string}):Promise<void>{
 await client.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3)',[actor,action,metadata]);
}
function storageFor(options:ImportStagingOptions):OriginalStorage{return options.storage??createOriginalStorage();}
async function uploadReceipt(id:string,status:'UPLOADED'|'UNKNOWN',options:ImportStagingOptions):Promise<void>{
 // Technical delivery receipt only; a revoked uploader may not publish/stage, but retention must persist.
 await transaction(async client=>{
  await client.query("set local statement_timeout='5s';set local lock_timeout='3s'");
  const result=await client.query("update private.knowledge_original_uploads set status=$2,updated_at=clock_timestamp() where job_id=$1 and status='RESERVED'",[id,status]);
  if(result.rowCount!==1)throw new ImportStagingError('INTERNAL_ERROR');
 },options.pool??getDatabasePool());
}
export async function createImportJob(actor:string,source:ImportSource,options:ImportStagingOptions={}):Promise<{job:ImportJobView;duplicate:boolean}>{
 return safe(async()=>{
  await run(actor,options,async()=>undefined);
  let checked:ImportSource;try{checked=verifyImportSource(source);}catch{throw new ImportStagingError('INVALID_REQUEST');}
  let acquisition:UrlAcquisitionProvenance|null=null;
  if(checked.acquiredFrom==='URL')try{acquisition=validateUrlAcquisition(checked,options.acquisition);}catch{throw new ImportStagingError('INVALID_REQUEST');}
  else if(options.acquisition!==undefined&&options.acquisition!==null)throw new ImportStagingError('INVALID_REQUEST');
  const backend=options.originalBackend??'PRIVATE_STORAGE';
  if(backend!=='PRIVATE_DATABASE'&&backend!=='PRIVATE_STORAGE')throw new ImportStagingError('INVALID_REQUEST');
  const id=randomUUID(),original=encryptOriginal(checked,{jobId:id,id:randomUUID(),backend},keyFor(options));
  const sourceMetadata=encryptStagingValue(JSON.stringify({filename:checked.filename,mimeType:checked.mimeType,sourceUrl:checked.sourceUrl,
   acquiredFrom:checked.acquiredFrom,fetchedAt:checked.fetchedAt,acquisition}),{jobId:id,checksum:checked.checksum,revision:0,purpose:'SOURCE_METADATA'},keyFor(options));
  const existingJob=await run(actor,options,async client=>{
   await client.query("select pg_advisory_xact_lock(hashtextextended('yru.import-checksum:'||$1,0))",[checked.checksum]);
   const existing=(await client.query<ImportRow>(`select ${columns} from private.knowledge_import_jobs where checksum=$1`,[checked.checksum])).rows[0];
   if(existing){await audit(client,actor,'KNOWLEDGE_IMPORT_DUPLICATE',{importJobId:existing.id});return {job:view(existing,keyFor(options)),duplicate:true};}
   if(backend==='PRIVATE_STORAGE')await client.query(`insert into private.knowledge_original_uploads(job_id,original_id,creator_id,checksum,format,byte_length,key_version,source_metadata_encrypted)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[id,original.ref.id,actor,checked.checksum,checked.format,original.ref.byteLength,original.ref.keyVersion,sourceMetadata]);
   return null;
  });
  if(existingJob)return existingJob;
  if(backend==='PRIVATE_STORAGE'){
   try{await storageFor(options).upload(id,original.ref,original.envelope);await uploadReceipt(id,'UPLOADED',options);}
   catch{try{await uploadReceipt(id,'UNKNOWN',options);}catch{}throw new ImportStagingError('INTERNAL_ERROR');}
  }
  return run(actor,options,async client=>{
   await client.query("select pg_advisory_xact_lock(hashtextextended('yru.import-checksum:'||$1,0))",[checked.checksum]);
   const existing=(await client.query<ImportRow>(`select ${columns} from private.knowledge_import_jobs where checksum=$1`,[checked.checksum])).rows[0];
   if(existing){await audit(client,actor,'KNOWLEDGE_IMPORT_DUPLICATE',{importJobId:existing.id});return {job:view(existing,keyFor(options)),duplicate:true};}
   const row=(await client.query<ImportRow>(`insert into private.knowledge_import_jobs(id,original_id,creator_id,checksum,format,backend,byte_length,key_version,original_ciphertext,source_metadata_encrypted)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${columns}`,
    [id,original.ref.id,actor,checked.checksum,checked.format,original.ref.backend,original.ref.byteLength,original.ref.keyVersion,backend==='PRIVATE_DATABASE'?original.envelope:null,sourceMetadata])).rows[0];
   if(backend==='PRIVATE_STORAGE'){
    const linked=await client.query("update private.knowledge_original_uploads set status='LINKED',linked_import_id=$1,updated_at=clock_timestamp() where job_id=$1 and status='UPLOADED'",[id]);
    if(linked.rowCount!==1)throw new ImportStagingError('INTERNAL_ERROR');
   }
   await audit(client,actor,'KNOWLEDGE_IMPORT_STAGED',{importJobId:id,byteLength:checked.bytes.byteLength});return {job:view(row,keyFor(options)),duplicate:false};
  });
 });
}
export async function createOfficialUrlImportJob(actor:string,url:string,options:ImportStagingOptions={},acquisitionOptions:OfficialUrlOptions={}):Promise<{job:ImportJobView;duplicate:boolean}>{
 await run(actor,options,async()=>undefined);
 const {source,...acquisition}=await acquireOfficialUrl(url,acquisitionOptions);
 return createImportJob(actor,source,{...options,acquisition});
}
export async function listImportJobs(actor:string,options:ImportStagingOptions={}):Promise<ImportJobView[]>{
 return run(actor,options,async client=>{
  const rows=(await client.query<ImportRow>(`select ${columns} from private.knowledge_import_jobs order by created_at desc,id desc limit 50`)).rows;
  return rows.map(row=>view(row,keyFor(options)));
 });
}
export async function getImportJob(actor:string,id:string,options:ImportStagingOptions={}):Promise<ImportJobView>{
 return run(actor,options,async client=>view(await rowFor(client,id),keyFor(options)));
}
export async function readImportOriginal(actor:string,id:string,options:ImportStagingOptions={}):Promise<{job:ImportJobView;bytes:Uint8Array}>{
 return safe(async()=>{
  const snapshot=await run(actor,options,async client=>rowFor(client,id,true));
  const ref:OriginalRef={id:snapshot.original_id,backend:snapshot.backend,byteLength:snapshot.byte_length,format:snapshot.format,checksum:snapshot.checksum,keyVersion:snapshot.key_version};
  const envelope=snapshot.backend==='PRIVATE_STORAGE'?await storageFor(options).download(id,ref):snapshot.original_ciphertext;
  if(!envelope)throw new ImportStagingError('INTERNAL_ERROR');
  const bytes=decryptOriginal(envelope,id,ref,keyFor(options));
  // Reauthorize after loading/decryption and immediately before returning original bytes.
  const job=await run(actor,options,async client=>{
   const current=await rowFor(client,id);if(current.revision!==snapshot.revision)throw new ImportStagingError('CONFLICT');
   await audit(client,actor,'KNOWLEDGE_ORIGINAL_READ',{importJobId:id,byteLength:bytes.byteLength});return view(current,keyFor(options));
  });
  return {job,bytes};
 });
}
export async function markImportFailed(actor:string,id:string,revision:number,code:string,options:ImportStagingOptions={}):Promise<ImportJobView>{
 return run(actor,options,async client=>{
  const parsed=failureCode.safeParse(code);if(!parsed.success||!z.number().int().min(0).max(999_999_999).safeParse(revision).success)throw new ImportStagingError('INVALID_REQUEST');
  if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  const current=(await client.query<ImportRow>(`select ${columns} from private.knowledge_import_jobs where id=$1 for update`,[id])).rows[0];
  if(!current)throw new ImportStagingError('NOT_FOUND');if(current.revision!==revision)throw new ImportStagingError('CONFLICT');
  const row=(await client.query<ImportRow>(`update private.knowledge_import_jobs set status='FAILED',error_code=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1 returning ${columns}`,[id,parsed.data])).rows[0];
  await audit(client,actor,'KNOWLEDGE_IMPORT_FAILED',{importJobId:id,errorCode:parsed.data});return view(row,keyFor(options));
 });
}
