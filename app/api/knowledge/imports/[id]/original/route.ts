export const runtime='nodejs';
import {apiStaffId} from '@/lib/tickets/api';
import {readImportOriginal} from '@/lib/imports/import-staging';
import {importApiFailure,importPrivateHeaders,importPrivateJson} from '@/lib/imports/import-api';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  const {id}=await context.params,{job,bytes}=await readImportOriginal(actor,id),headers=importPrivateHeaders();
  headers.set('content-type','application/octet-stream');headers.set('content-length',String(bytes.byteLength));
  headers.set('content-security-policy',"sandbox; default-src 'none'");
  const filename=encodeURIComponent(job.filename).replace(/['()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase());
  headers.set('content-disposition',`attachment; filename*=UTF-8''${filename}`);
  return new Response(Uint8Array.from(bytes),{headers});
 }catch(error){return importApiFailure(error);}
}
