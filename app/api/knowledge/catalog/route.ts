import {apiStaffId} from '@/lib/tickets/api';
import {authorizeImportAdmin} from '@/lib/imports/import-staging';
import {importPrivateJson,importApiFailure} from '@/lib/imports/import-api';
import {listKnowledgeCatalog} from '@/lib/knowledge/catalog';
import {readCatalogQuery} from '@/lib/knowledge/catalog-api';
export const runtime='nodejs';
export async function GET(request:Request){
 const actor=await apiStaffId();if(!actor)return importPrivateJson({error:'UNAUTHENTICATED'},401);
 try{await authorizeImportAdmin(actor);const query=readCatalogQuery(request);return importPrivateJson({catalog:await listKnowledgeCatalog(actor,query,{signal:request.signal})});}
 catch(error){return importApiFailure(error);}
}
