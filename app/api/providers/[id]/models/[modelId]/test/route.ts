import {testProviderModel} from '@/lib/ai/provider-probe-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request,context:{params:Promise<{id:string;modelId:string}>}){
 const {id,modelId}=await context.params;
 return providerWrite(request,(staffId,body)=>testProviderModel(staffId,id,modelId,body,{},request.signal));
}
