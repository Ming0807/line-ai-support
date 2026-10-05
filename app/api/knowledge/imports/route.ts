import {apiStaffId} from '@/lib/tickets/api';
import {listImportJobs} from '@/lib/imports/import-staging';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
export async function GET(){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{return importPrivateJson({jobs:await listImportJobs(actor)});}catch(error){return importApiFailure(error);}
}
