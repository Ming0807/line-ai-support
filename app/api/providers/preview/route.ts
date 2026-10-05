import {previewProviderOrder} from '@/lib/ai/provider-preview';
import {providerWrite} from '@/lib/ai/provider-api';
export async function POST(request:Request){return providerWrite(request,(staffId,body)=>previewProviderOrder(staffId,body));}
