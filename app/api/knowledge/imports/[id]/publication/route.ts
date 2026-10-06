import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {getImportPublication} from '@/lib/imports/import-publication';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{
  await authorizeImportAdmin(actor);const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
  if(new URL(request.url).search!=='')throw new ImportStagingError('INVALID_REQUEST');
  return importPrivateJson({publication:await getImportPublication(actor,id,{signal:request.signal})});
 }catch(error){return importApiFailure(error);}
}
