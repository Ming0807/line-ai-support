import {staffOutboundUploadHandler} from '@/lib/chat/staff-outbound-api';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const params=await context.params;return staffOutboundUploadHandler(request,params.id);
}
