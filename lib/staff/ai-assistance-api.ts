import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {isSameOrigin} from '../security/origin';
import {readImportRequestBody,ImportBodyError} from '../imports/import-api';
import {ImportStagingError} from '../imports/import-staging';
import {AssistError,assistInputSchema} from './ai-assistance-contracts';
import {createStaffAssistance} from './ai-assistance';
function response(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});}
export async function staffAssistHandler(request:Request,id:string){
 if(!isSameOrigin(request))return response({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return response({error:'UNAUTHENTICATED'},401);
 try{
  if(!z.uuid().safeParse(id).success)throw new AssistError('NOT_FOUND');
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new AssistError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,1024);let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AssistError('INVALID_REQUEST');}
  const input=assistInputSchema.parse(JSON.parse(text));
  return response(await createStaffAssistance(actor,id,input,{signal:request.signal}));
 }catch(error){
  if(error instanceof ImportBodyError)return response({error:'INVALID_REQUEST'},error.status);
  if(error instanceof TicketError&&error.code==='NOT_FOUND')return response({error:'NOT_FOUND'},404);
  if(error instanceof AssistError)return response({error:error.code},{INVALID_REQUEST:400,NOT_FOUND:404,CONFLICT:409,UNAVAILABLE:503}[error.code]);
  if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof ImportStagingError&&error.code==='INVALID_REQUEST'))return response({error:'INVALID_REQUEST'},400);
  console.error('STAFF_ASSIST_FAILED',{code:'UNAVAILABLE'});return response({error:'UNAVAILABLE'},503);
 }
}
