import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {OperationsError,parseActivityQuery,parseLogQuery} from './contracts';
import {readActivities,readLogs} from './reads';
function response(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});}
export async function operationsHandler(request:Request,kind:'activities'|'logs'):Promise<Response>{
 const staffId=await apiStaffId();if(!staffId)return response({error:'UNAUTHENTICATED'},401);
 try{const params=new URL(request.url).searchParams;return response(kind==='activities'?await readActivities(staffId,parseActivityQuery(params)):await readLogs(staffId,parseLogQuery(params)));}
 catch(error){
  if(error instanceof TicketError&&error.code==='NOT_FOUND')return response({error:'NOT_FOUND'},404);
  if(error instanceof z.ZodError)return response({error:'INVALID_REQUEST'},400);
  if(error instanceof OperationsError){const status={INVALID_REQUEST:400,FORBIDDEN:403,NOT_FOUND:404,UNAVAILABLE:503}[error.code];return response({error:error.code},status);}
  return response({error:'UNAVAILABLE'},503);
 }
}
