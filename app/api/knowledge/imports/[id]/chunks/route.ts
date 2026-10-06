export const runtime='nodejs';
import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportChunkPlan} from '@/lib/imports/import-chunk-plan';
import {versionRequestSchema} from '@/lib/imports/version-resolver';
import {ImportChunkPlanError} from '@/lib/imports/chunk-preparation';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  const url=new URL(request.url),keys=['expectedJobRevision','expectedExtractionRevision','expectedReviewRevision'];
  if(url.search.length>180||[...url.searchParams.keys()].some(key=>!keys.includes(key)))throw new ImportStagingError('INVALID_REQUEST');
  const values:Record<string,number>={};for(const key of keys){const entries=url.searchParams.getAll(key);if(entries.length!==1||! /^[1-9]\d{0,8}$/.test(entries[0]))throw new ImportStagingError('INVALID_REQUEST');values[key]=Number(entries[0]);}
  const input=versionRequestSchema.safeParse(values);if(!input.success)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({snapshot:await getImportChunkPlan(actor,id,input.data,{signal:request.signal})});
 }catch(error){if(error instanceof ImportChunkPlanError){if(error.status===503)console.error('IMPORT_CHUNK_PLAN_FAILED',{code:error.code});return importPrivateJson({error:error.code},error.status);}return importApiFailure(error);}
}
