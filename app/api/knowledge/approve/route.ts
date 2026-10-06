import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {approveImport,publicationRequestSchema} from '@/lib/imports/import-publication';
import {importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';
import {publicationApiFailure} from '@/lib/imports/publication-api';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,2048);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const input=publicationRequestSchema.safeParse(body);if(!input.success)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({publication:await approveImport(actor,input.data,{signal:request.signal})});
 }catch(error){return publicationApiFailure(error);}
}
