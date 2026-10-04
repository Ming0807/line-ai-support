import {updateModel} from '@/lib/ai/provider-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function PATCH(request:Request,context:{params:Promise<{id:string;modelId:string}>}){
 const {id,modelId}=await context.params;return providerWrite(request,(staffId,body)=>updateModel(staffId,id,modelId,body));
}
