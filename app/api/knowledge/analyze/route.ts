import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {analyzeImportJob} from '@/lib/imports/import-extraction';
import {importApiFailure,importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';
export const runtime='nodejs';
const schema=z.object({id:z.uuid(),revision:z.number().int().min(0).max(999_999_999)}).strict();
export async function POST(request:Request){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,8192);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const input=schema.safeParse(body);if(!input.success)throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({preview:await analyzeImportJob(actor,input.data.id,input.data.revision,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
