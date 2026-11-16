import {studentMediaFileHandler} from '@/lib/chat/student-media-viewer-api';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{attachmentId:string}>}){
 const params=await context.params;return studentMediaFileHandler(request,params.attachmentId);
}
