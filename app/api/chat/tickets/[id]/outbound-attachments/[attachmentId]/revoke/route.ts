import {staffOutboundRevokeHandler} from '@/lib/chat/staff-outbound-revoke-api';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;attachmentId:string}>}){
 const params=await context.params;return staffOutboundRevokeHandler(request,params.id,params.attachmentId);
}
