import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportReview,saveImportReview} from '@/lib/imports/import-review';
import {reviewSaveSchema,REVIEW_LIMITS} from '@/lib/imports/review-schema';
import {importApiFailure,importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
async function pathId(context:Context){const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');return id;}
export async function GET(request:Request,context:Context){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{await authorizeImportAdmin(actor);const id=await pathId(context);return importPrivateJson({review:await getImportReview(actor,id,{signal:request.signal})});}
 catch(error){return importApiFailure(error);}
}
export async function PUT(request:Request,context:Context){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const id=await pathId(context);
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,REVIEW_LIMITS.requestBytes);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const input=reviewSaveSchema.safeParse(body);if(!input.success)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({review:await saveImportReview(actor,id,input.data,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
