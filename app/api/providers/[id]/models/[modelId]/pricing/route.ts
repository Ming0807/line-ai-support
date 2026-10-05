import {refreshModelPricing} from '@/lib/ai/provider-pricing';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request,context:{params:Promise<{id:string;modelId:string}>}){
 const {id,modelId}=await context.params;
 return providerWrite(request,(staffId,body)=>refreshModelPricing(staffId,id,modelId,body,{},request.signal));
}
