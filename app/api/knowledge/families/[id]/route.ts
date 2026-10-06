import {z} from 'zod';
import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin,ImportStagingError} from '@/lib/imports/import-staging';
import {importPrivateJson,importApiFailure} from '@/lib/imports/import-api';
import {getKnowledgeFamily} from '@/lib/knowledge/catalog';
import {readCatalogPage} from '@/lib/knowledge/catalog-api';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{await authorizeImportAdmin(actor);const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');const query=readCatalogPage(request);return importPrivateJson({history:await getKnowledgeFamily(actor,id,query,{signal:request.signal})});}
 catch(error){return importApiFailure(error);}
}
