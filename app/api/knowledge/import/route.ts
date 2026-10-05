export const runtime='nodejs';
import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {isSameOrigin} from '@/lib/security/origin';
import {authorizeImportAdmin,createImportJob,createOfficialUrlImportJob,ImportStagingError} from '@/lib/imports/import-staging';
import {createImportSource} from '@/lib/imports/source';
import {IMPORT_LIMITS} from '@/lib/imports/types';
import {importApiFailure,importPrivateJson,readImportRequestBody} from '@/lib/imports/import-api';
const urlInput=z.object({url:z.string().min(1).max(2048)}).strict();
export async function POST(request:Request){
 if(!isSameOrigin(request))return importPrivateJson({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);
  const type=request.headers.get('content-type')??'',mime=type.split(';',1)[0].trim().toLowerCase();
  if(mime==='application/json'){
   const bytes=await readImportRequestBody(request,8192);let input:unknown;
   try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ImportStagingError('INVALID_REQUEST');}
   const parsed=urlInput.safeParse(input);if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');
   const result=await createOfficialUrlImportJob(actor,parsed.data.url,{}, {signal:request.signal});return importPrivateJson(result,result.duplicate?200:201);
  }
  if(mime!=='multipart/form-data')throw new ImportStagingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,IMPORT_LIMITS.originalBytes+64*1024);
  let form:FormData;try{form=await new Response(Uint8Array.from(bytes),{headers:{'content-type':type}}).formData();}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const files=form.getAll('file'),urls=form.getAll('sourceUrl');
  if([...form.keys()].some(name=>name!=='file'&&name!=='sourceUrl')||files.length!==1||!(files[0] instanceof File)||urls.length>1||urls.some(value=>typeof value!=='string'))throw new ImportStagingError('INVALID_REQUEST');
  const file=files[0];if(file.size<1||file.size>IMPORT_LIMITS.originalBytes)throw new ImportStagingError('INVALID_REQUEST');
  let source;try{source=createImportSource({bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,mimeType:file.type,
   sourceUrl:urls.length&&typeof urls[0]==='string'&&urls[0]!==''?urls[0]:null,acquiredFrom:'UPLOAD',fetchedAt:null});}catch{throw new ImportStagingError('INVALID_REQUEST');}
  const result=await createImportJob(actor,source);return importPrivateJson(result,result.duplicate?200:201);
 }catch(error){return importApiFailure(error);}
}
