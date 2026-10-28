import {inboxWriteHandler} from '@/lib/chat/api';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 return inboxWriteHandler(request,(await context.params).id,'READ');
}
