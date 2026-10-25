import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportAssistance} from '@/lib/imports/assistance';
import {importPrivateJson,importApiFailure} from '@/lib/imports/import-api';
import {readImportRequestBody} from '@/lib/imports/import-api';
import {isSameOrigin} from '@/lib/security/origin';
import {getImportModelAssistance,ImportModelAssistanceError} from '@/lib/imports/model-assistance';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  if(new URL(request.url).searchParams.size!==0)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({assistance:await getImportAssistance(actor,id,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  if(new URL(request.url).searchParams.size||request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,2048);let input:unknown;
  try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  return importPrivateJson({modelAssistance:await getImportModelAssistance(actor,id,input,{signal:request.signal})});
 }catch(error){
  if(error instanceof ImportModelAssistanceError)return importPrivateJson({error:error.code},error.code==='AI_UNAVAILABLE'?503:422);
  return importApiFailure(error);
 }
}
