import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {OperationsError} from './contracts';
import {parseMetricQuery,parseUsageQuery} from './metrics-contracts';
import {readOperationsSummary,readOperationsAnalytics,readOperationsUsage,readOperationsDepartments,readOperationsSettings} from './metrics';
function response(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});}
export async function metricsHandler(request:Request,kind:'summary'|'analytics'|'usage'|'departments'|'settings'){
 const staffId=await apiStaffId();if(!staffId)return response({error:'UNAUTHENTICATED'},401);
 try{
  const params=new URL(request.url).searchParams;
  if((kind==='departments'||kind==='settings')&&params.size)throw new OperationsError('INVALID_REQUEST');
  const body=kind==='summary'?await readOperationsSummary(staffId,parseMetricQuery(params)):kind==='analytics'?await readOperationsAnalytics(staffId,parseMetricQuery(params)):kind==='usage'?await readOperationsUsage(staffId,parseUsageQuery(params)):kind==='departments'?await readOperationsDepartments(staffId):await readOperationsSettings(staffId);
  return response(body);
 }catch(error){
  if(error instanceof TicketError&&error.code==='NOT_FOUND')return response({error:'NOT_FOUND'},404);
  if(error instanceof z.ZodError)return response({error:'INVALID_REQUEST'},400);
  if(error instanceof OperationsError)return response({error:error.code},{INVALID_REQUEST:400,FORBIDDEN:403,NOT_FOUND:404,UNAVAILABLE:503}[error.code]);
  return response({error:'UNAVAILABLE'},503);
 }
}
