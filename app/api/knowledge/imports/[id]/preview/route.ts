import {apiStaffId} from '@/lib/tickets/api';
import {getImportPreview} from '@/lib/imports/import-extraction';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{const {id}=await context.params;return importPrivateJson({preview:await getImportPreview(actor,id)});}catch(error){return importApiFailure(error);}
}
