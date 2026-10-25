import {saveFreeAccountGrant,revokeFreeAccountGrant} from '@/lib/ai/account-free-admin';
import {providerWrite} from '@/lib/ai/provider-api';
export async function PUT(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,(staffId,body)=>saveFreeAccountGrant(staffId,id,body));
}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;return providerWrite(request,(staffId,body)=>revokeFreeAccountGrant(staffId,id,body));
}
