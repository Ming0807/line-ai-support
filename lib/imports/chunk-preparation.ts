import {authorizeImportAdmin,ImportStagingError,readImportOriginal} from './import-staging';
import {createImportSource} from './source';
import type {ImportPreview,ImportExtractionOptions} from './import-extraction';
import {buildLocatedChunkPlan} from '../knowledge/located-chunk-plan';
import {LocatedPlanError,type LocatedChunkPlan} from '../knowledge/located-plan-types';
import {createLocalE5EmbeddingProvider,type PassageTokenCounter} from '../knowledge/embedding-client';
export interface ImportChunkPreparationOptions extends ImportExtractionOptions {counter?:PassageTokenCounter}
export class ImportChunkPlanError extends Error {
 constructor(readonly code:'CHUNK_PLAN_UNAVAILABLE'|'CHUNK_PLAN_TOO_LARGE'|'CHUNK_PLAN_TABLE_ROW_TOO_LARGE'|'CHUNK_PLAN_GRAPHEME_TOO_LARGE'|'CHUNK_PLAN_TIMEOUT',readonly status:number){super(code);this.name='ImportChunkPlanError';}
}
/** Private preparation only; each caller must final-fence the returned extraction/review snapshot. */
export async function prepareImportChunkPlan(actor:string,preview:ImportPreview,options:ImportChunkPreparationOptions={}):Promise<LocatedChunkPlan>{
 await authorizeImportAdmin(actor,options);const deadline=performance.now()+45_000;
 if(options.signal?.aborted||preview.job.status!=='READY')throw new ImportStagingError('CONFLICT');
 const read=await readImportOriginal(actor,preview.job.id,options);
 if(read.job.revision!==preview.job.revision||read.job.id!==preview.job.id||options.signal?.aborted)throw new ImportStagingError('CONFLICT');
 const source=createImportSource({bytes:read.bytes,filename:read.job.filename,mimeType:read.job.mimeType,sourceUrl:read.job.sourceUrl,acquiredFrom:read.job.acquiredFrom,fetchedAt:read.job.fetchedAt});
 const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);
 try{
  return await buildLocatedChunkPlan(source,preview.extraction,{jobId:preview.job.id,extractionRevision:preview.extractionRevision},options.counter??createLocalE5EmbeddingProvider(),{signal:options.signal,timeoutMs:remaining});
 }catch(error){
  if(error instanceof LocatedPlanError){
   if(error.code==='KNOWLEDGE_PLAN_ABORTED')throw new ImportStagingError('CONFLICT');
   if(error.code==='KNOWLEDGE_PLAN_TIMEOUT')throw new ImportChunkPlanError('CHUNK_PLAN_TIMEOUT',408);
   if(error.code==='KNOWLEDGE_PLAN_LIMIT_EXCEEDED')throw new ImportChunkPlanError('CHUNK_PLAN_TOO_LARGE',413);
   if(error.code==='KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE')throw new ImportChunkPlanError('CHUNK_PLAN_TABLE_ROW_TOO_LARGE',422);
   if(error.code==='KNOWLEDGE_PLAN_GRAPHEME_TOO_LARGE')throw new ImportChunkPlanError('CHUNK_PLAN_GRAPHEME_TOO_LARGE',422);
  }
  throw new ImportChunkPlanError('CHUNK_PLAN_UNAVAILABLE',503);
 }
}
