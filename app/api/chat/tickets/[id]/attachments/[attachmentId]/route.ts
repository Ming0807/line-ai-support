import {chatAttachmentHandler} from '@/lib/chat/media-api';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string;attachmentId:string}>}){
 const params=await context.params;return chatAttachmentHandler(request,params.id,params.attachmentId);
}
