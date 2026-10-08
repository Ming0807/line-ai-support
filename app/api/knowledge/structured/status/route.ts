import {apiStaffId} from '@/lib/tickets/api';
import {importApiFailure,importPrivateJson} from '@/lib/imports/import-api';
import {ImportStagingError} from '@/lib/imports/import-staging';
import {getStructuredAvailability} from '@/lib/knowledge/structured-readiness';
export const runtime='nodejs';
export async function GET(request:Request){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{if(new URL(request.url).search)throw new ImportStagingError('INVALID_REQUEST');return importPrivateJson({structured:await getStructuredAvailability(actor)});}catch(error){return importApiFailure(error);}
}
