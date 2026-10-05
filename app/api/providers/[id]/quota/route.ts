import {refreshProviderQuota} from '@/lib/ai/provider-quota-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 return providerWrite(request,(staffId,body)=>refreshProviderQuota(staffId,id,body,{},request.signal));
}
