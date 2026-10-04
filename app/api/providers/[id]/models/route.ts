import {createModel} from '@/lib/ai/provider-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,(staffId,body)=>createModel(staffId,id,body));
}
