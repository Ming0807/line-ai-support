import {staffOutboundConfirmHandler} from '@/lib/chat/staff-outbound-confirm-api';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;attachmentId:string}>}){
 const params=await context.params;return staffOutboundConfirmHandler(request,params.id,params.attachmentId);
}
