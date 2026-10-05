import {apiStaffId} from '@/lib/tickets/api';
import {ProviderAdminError} from '@/lib/ai/provider-admin';
import {getEmbeddingStatus} from '@/lib/knowledge/embedding-status';

export async function GET(){
 const staffId=await apiStaffId();
 if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 const headers={'cache-control':'private, no-store'};
 try{return Response.json({embedding:await getEmbeddingStatus(staffId)},{headers});}
 catch(error){
  if(error instanceof ProviderAdminError&&error.code==='FORBIDDEN')return Response.json({error:'FORBIDDEN'},{status:403,headers});
  return Response.json({error:'EMBEDDING_UNAVAILABLE'},{status:503,headers});
 }
}
