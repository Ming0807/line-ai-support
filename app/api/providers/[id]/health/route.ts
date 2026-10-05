import {listProviders,ProviderAdminError} from '@/lib/ai/provider-admin';
import {testProviderModel} from '@/lib/ai/provider-probe-admin';
import {providerWrite} from '@/lib/ai/provider-api';
import {healthCheckSchema} from '@/types/providers';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,async(staffId,body)=>{
  const parsed=healthCheckSchema.safeParse(body);if(!parsed.success)throw new ProviderAdminError('INVALID_REQUEST');
  const provider=(await listProviders(staffId)).find(value=>value.id===id);
  const model=provider?.models.find(value=>value.id===parsed.data.modelId);
  if(!provider||!model)throw new ProviderAdminError('NOT_FOUND');
  return testProviderModel(staffId,id,model.id,{providerRevision:provider.revision,modelRevision:model.revision,action:'METADATA'},{},request.signal);
 });
}
