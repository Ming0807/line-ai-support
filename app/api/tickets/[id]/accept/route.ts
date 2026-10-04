import {ticketActionHandler} from '@/lib/tickets/api';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 return ticketActionHandler(request,(await params).id,'ACCEPT');
}