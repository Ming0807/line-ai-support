import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportAssistance} from '@/lib/imports/assistance';
import {importPrivateJson,importApiFailure} from '@/lib/imports/import-api';
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
