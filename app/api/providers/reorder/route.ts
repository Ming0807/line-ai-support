import {reorderProviders} from '@/lib/ai/provider-order';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request){return providerWrite(request,(staffId,body)=>reorderProviders(staffId,body));}
