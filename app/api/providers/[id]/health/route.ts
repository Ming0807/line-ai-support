import {checkProviderHealth,ProviderAdminError} from '@/lib/ai/provider-admin';
import {providerWrite} from '@/lib/ai/provider-api';
import {healthCheckSchema} from '@/types/providers';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,async(staffId,body)=>{
  const parsed=healthCheckSchema.safeParse(body);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
  return checkProviderHealth(staffId,id,parsed.data.modelId);
 });
}
