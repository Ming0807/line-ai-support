import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportStructuredPlan,getImportStructuredSource,structuredPlanRequestSchema} from '@/lib/imports/import-structured-plan';
import {REVIEW_LIMITS,hasStructuredMappingLimit} from '@/lib/imports/review-schema';
import {StructuredMappingError} from '@/lib/imports/structured-mapping-contract';
import {importApiFailure,importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  if(new URL(request.url).search)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({source:await getImportStructuredSource(actor,id,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
export async function POST(request:Request,context:Context){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,REVIEW_LIMITS.requestBytes);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const input=structuredPlanRequestSchema.safeParse(body);if(!input.success){if(hasStructuredMappingLimit(input.error))throw new StructuredMappingError('STRUCTURED_MAPPING_LIMIT_EXCEEDED');throw new ImportStagingError('INVALID_REQUEST');}
  return importPrivateJson({snapshot:await getImportStructuredPlan(actor,id,input.data,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
