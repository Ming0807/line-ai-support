import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {isSameOrigin} from '../security/origin';
import {readImportRequestBody,ImportBodyError} from '../imports/import-api';
import {ImportStagingError} from '../imports/import-staging';
import {IncidentError} from './contracts';
import {listIncidents,getIncident,getIncidentRules,getSimilarIssues,parseIncidentQuery} from './reads';
import {changeIncidentStatus,updateIncidentRules} from './actions';
export function incidentResponse(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});}
function failure(error:unknown){
 if(error instanceof ImportBodyError)return incidentResponse({error:'INVALID_REQUEST'},error.status);
 if(error instanceof TicketError&&error.code==='NOT_FOUND')return incidentResponse({error:'NOT_FOUND'},404);
 if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof ImportStagingError&&error.code==='INVALID_REQUEST'))return incidentResponse({error:'INVALID_REQUEST'},400);
 if(error instanceof IncidentError)return incidentResponse({error:error.code},{INCIDENT_INPUT_INVALID:400,INVALID_REQUEST:400,NOT_FOUND:404,FORBIDDEN:403,CONFLICT:409,UNAVAILABLE:503}[error.code]);
 return incidentResponse({error:'UNAVAILABLE'},503);
}
export async function incidentRead(request:Request,kind:'list'|'detail'|'rules'|'similar',id?:string){
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{
  const params=new URL(request.url).searchParams;
  if(kind!=='list'&&params.size)throw new IncidentError('INVALID_REQUEST');
  return incidentResponse(kind==='list'?await listIncidents(actor,parseIncidentQuery(params)):kind==='rules'?await getIncidentRules(actor):kind==='similar'?await getSimilarIssues(actor,id!):await getIncident(actor,id!));
 }catch(error){return failure(error);}
}
export async function incidentMutation(request:Request,kind:'status'|'rules',id?:string){
 if(!isSameOrigin(request))return incidentResponse({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new IncidentError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,8192);let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new IncidentError('INVALID_REQUEST');}
  const body=JSON.parse(text);
  return incidentResponse(kind==='rules'?await updateIncidentRules(actor,body):await changeIncidentStatus(actor,id!,body));
 }catch(error){return failure(error);}
}
