import {updateProvider} from '@/lib/ai/provider-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,(staffId,body)=>updateProvider(staffId,id,body));
}
