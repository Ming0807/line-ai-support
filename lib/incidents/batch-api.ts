import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {isSameOrigin} from '../security/origin';
import {readImportRequestBody,ImportBodyError} from '../imports/import-api';
import {IncidentError} from './contracts';
import {incidentResponse} from './api';
import {incidentReplySelectionSchema} from './batch-reply-contracts';
import {getIncidentReplyOptions,previewIncidentReply} from './batch-preview';
import {confirmIncidentReply} from './batch-confirm';
import {getIncidentReplyDraft,listIncidentReplyBatches,retryIncidentReplyBatch} from './batch-status';
import {incidentBatchConfirmInputSchema} from './batch-confirm-contracts';
import {incidentBatchRetryInputSchema} from './batch-status-contracts';
function failure(error:unknown){
 if(error instanceof ImportBodyError)return incidentResponse({error:'INVALID_REQUEST'},error.status);
 if(error instanceof z.ZodError||error instanceof SyntaxError)return incidentResponse({error:'INVALID_REQUEST'},400);
 if(error instanceof TicketError)return incidentResponse({error:error.code==='NOT_FOUND'?'NOT_FOUND':'CONFLICT'},error.code==='NOT_FOUND'?404:409);
 if(error instanceof IncidentError)return incidentResponse({error:error.code},{INCIDENT_INPUT_INVALID:400,INVALID_REQUEST:400,NOT_FOUND:404,FORBIDDEN:403,CONFLICT:409,UNAVAILABLE:503}[error.code]);
 return incidentResponse({error:'UNAVAILABLE'},503);
}
export async function incidentBatchOptions(request:Request,id:string){
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{if(new URL(request.url).search)throw new IncidentError('INVALID_REQUEST');return incidentResponse(await getIncidentReplyOptions(actor,id));}
 catch(error){return failure(error);}
}
export async function incidentBatchPreview(request:Request,id:string){
 if(!isSameOrigin(request))return incidentResponse({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new IncidentError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,65536);let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new IncidentError('INVALID_REQUEST');}
  const selection=incidentReplySelectionSchema.parse(JSON.parse(text));
  return incidentResponse(await previewIncidentReply(actor,id,selection));
 }catch(error){return failure(error);}
}
export async function incidentBatchStatus(request:Request,id:string){
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{if(new URL(request.url).search)throw new IncidentError('INVALID_REQUEST');return incidentResponse(await listIncidentReplyBatches(actor,id));}
 catch(error){return failure(error);}
}
export async function incidentBatchLatestDraft(request:Request,id:string){
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{if(new URL(request.url).search)throw new IncidentError('INVALID_REQUEST');return incidentResponse(await getIncidentReplyDraft(actor,id));}
 catch(error){return failure(error);}
}
async function mutation(request:Request,id:string,batchId?:string){
 if(!isSameOrigin(request))return incidentResponse({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return incidentResponse({error:'UNAUTHENTICATED'},401);
 try{
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new IncidentError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,batchId?8192:262144);let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new IncidentError('INVALID_REQUEST');}
  const raw=JSON.parse(text);
  return incidentResponse(batchId?await retryIncidentReplyBatch(actor,id,batchId,incidentBatchRetryInputSchema.parse(raw)):
   await confirmIncidentReply(actor,id,incidentBatchConfirmInputSchema.parse(raw)),202);
 }catch(error){return failure(error);}
}
export async function incidentBatchConfirm(request:Request,id:string){return mutation(request,id);}
export async function incidentBatchRetry(request:Request,id:string,batchId:string){return mutation(request,id,batchId);}
