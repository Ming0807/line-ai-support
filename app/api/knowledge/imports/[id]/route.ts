import {apiStaffId} from '@/lib/tickets/api';
import {getImportJob} from '@/lib/imports/import-staging';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{const {id}=await context.params;return importPrivateJson({job:await getImportJob(actor,id)});}catch(error){return importApiFailure(error);}
}
