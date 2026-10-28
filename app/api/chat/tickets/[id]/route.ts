import {inboxThreadHandler} from '@/lib/chat/api';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 return inboxThreadHandler(request,(await context.params).id);
}
