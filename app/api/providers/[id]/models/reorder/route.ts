import {reorderModels} from '@/lib/ai/provider-order';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,(staffId,body)=>reorderModels(staffId,id,body));
}
