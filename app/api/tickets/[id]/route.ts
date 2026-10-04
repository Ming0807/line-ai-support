import {apiStaffId,ticketApiFailure} from '@/lib/tickets/api';
import {getTicketDetail} from '@/lib/tickets/reads';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const staffId=await apiStaffId();if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 try{const detail=await getTicketDetail(staffId,(await params).id);return detail?Response.json(detail):Response.json({error:'NOT_FOUND'},{status:404});}
 catch(error){return ticketApiFailure(error);}
}
