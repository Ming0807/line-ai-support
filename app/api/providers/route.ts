import {apiStaffId} from '@/lib/tickets/api';
import {createProvider,listProviders} from '@/lib/ai/provider-admin';
import {providerApiFailure,providerWrite} from '@/lib/ai/provider-api';

export async function GET(){
 const staffId=await apiStaffId();if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 try{return Response.json({providers:await listProviders(staffId)});}catch(error){return providerApiFailure(error);}
}
export async function POST(request:Request){return providerWrite(request,(staffId,body)=>createProvider(staffId,body));}
