import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {draftImportOcrForRoute} from '@/lib/imports/import-ocr';
import {OCR_MAX_PAGES,OcrError,readOcrConfig} from '@/lib/imports/ocr-client';
import {importApiFailure,importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';
export const runtime='nodejs';
const schema=z.strictObject({revision:z.number().int().min(0).max(999_999_999),pages:z.array(z.number().int().min(0).max(999)).min(1).max(OCR_MAX_PAGES)});
/** OCR-IMP-01: hidden unless KNOWLEDGE_IMPORT_OCR_ENABLED and a valid OCR_API_URL are configured. Returns a draft only. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 if(!readOcrConfig())return importPrivateJson({error:'NOT_FOUND'},404);
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,4096);let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const input=schema.safeParse(body);if(!input.success)throw new ImportStagingError('INVALID_REQUEST');
  const {id}=await context.params;
  return importPrivateJson(await draftImportOcrForRoute(actor,id,input.data,{signal:request.signal}));
 }catch(error){
  if(error instanceof OcrError){console.error('IMPORT_OCR_FAILED',{code:error.code});return importPrivateJson({error:'OCR_UNAVAILABLE'},503);}
  return importApiFailure(error);
 }
}
