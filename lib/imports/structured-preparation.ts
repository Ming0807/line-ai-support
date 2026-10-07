import {authorizeImportAdmin,ImportStagingError,readImportOriginal} from './import-staging';
import {createImportSource} from './source';
import type {ImportPreview,ImportExtractionOptions} from './import-extraction';
import {buildStructuredMappingPlan} from './structured-mapper';
import type {StructuredMappingPlan} from './structured-mapping-contract';
export {computeStructuredAcknowledgment} from './structured-acknowledgment';

/** Source preparation outside SQL; caller owns final authorization/revision fence. */
export async function readImportStructuredSource(actor:string,preview:ImportPreview,options:ImportExtractionOptions={}){
 await authorizeImportAdmin(actor,options);
 if(options.signal?.aborted||preview.job.status!=='READY')throw new ImportStagingError('CONFLICT');
 const original=await readImportOriginal(actor,preview.job.id,options);
 if(original.job.id!==preview.job.id||original.job.revision!==preview.job.revision||options.signal?.aborted)throw new ImportStagingError('CONFLICT');
 const source=createImportSource({bytes:original.bytes,filename:original.job.filename,mimeType:original.job.mimeType,sourceUrl:original.job.sourceUrl,acquiredFrom:original.job.acquiredFrom,fetchedAt:original.job.fetchedAt});
 return source;
}
export async function prepareImportStructuredPlan(actor:string,preview:ImportPreview,reviewRevision:number,mapping:unknown,options:ImportExtractionOptions={}):Promise<StructuredMappingPlan>{
 const source=await readImportStructuredSource(actor,preview,options);
 return buildStructuredMappingPlan(source,preview.extraction,{jobId:preview.job.id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,reviewRevision},mapping);
}
