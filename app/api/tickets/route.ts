import {apiStaffId,ticketApiFailure} from '@/lib/tickets/api';
import {listTickets} from '@/lib/tickets/reads';
import {parseTicketQuery} from '@/types/tickets';
export const runtime='nodejs';
function privateResponse(response:Response):Response{
 response.headers.set('Cache-Control','private, no-store, max-age=0');response.headers.set('Vary','Cookie');response.headers.set('X-Content-Type-Options','nosniff');return response;
}
export async function GET(request:Request){
 const staffId=await apiStaffId();if(!staffId)return privateResponse(Response.json({error:'UNAUTHENTICATED'},{status:401}));
 try{return privateResponse(Response.json(await listTickets(staffId,parseTicketQuery(new URL(request.url).searchParams))));}
 catch(error){return privateResponse(ticketApiFailure(error));}
}
