import {apiStaffId,ticketApiFailure} from '@/lib/tickets/api';
import {listTickets} from '@/lib/tickets/reads';
import {ticketFiltersSchema} from '@/types/tickets';
export const runtime='nodejs';
export async function GET(request:Request){
 const staffId=await apiStaffId();if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 try{return Response.json(await listTickets(staffId,ticketFiltersSchema.parse(Object.fromEntries(new URL(request.url).searchParams))));}
 catch(error){return ticketApiFailure(error);}
}
