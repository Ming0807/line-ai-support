import {z} from 'zod';
import {apiStaffId} from '../tickets/api';
import {TicketError} from '../tickets/authorization';
import {isSameOrigin} from '../security/origin';
import {readImportRequestBody,ImportBodyError} from '../imports/import-api';
import {ImportStagingError} from '../imports/import-staging';
import {BindingError,bindingChallengeInput} from './line-binding-contracts';
import {getBindingStatus,createBindingChallenge,unlinkStaffLine} from './line-binding';
function response(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});}
function failure(error:unknown){
 if(error instanceof ImportBodyError)return response({error:'INVALID_REQUEST'},error.status);
 if(error instanceof TicketError&&error.code==='NOT_FOUND')return response({error:'NOT_FOUND'},404);
 if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof ImportStagingError&&error.code==='INVALID_REQUEST'))return response({error:'INVALID_REQUEST'},400);
 if(error instanceof BindingError)return response({error:error.code},error.code==='INVALID_REQUEST'?400:error.code==='UNAVAILABLE'?503:409);
 console.error('STAFF_LINE_BINDING_FAILED',{code:'UNAVAILABLE'});return response({error:'UNAVAILABLE'},503);
}
export async function bindingRead(request:Request){
 const actor=await apiStaffId();if(!actor)return response({error:'UNAUTHENTICATED'},401);
 try{if(new URL(request.url).search)throw new BindingError('INVALID_REQUEST');return response(await getBindingStatus(actor));}catch(e){return failure(e);}
}
export async function bindingMutation(request:Request,kind:'challenge'|'unlink'){
 if(!isSameOrigin(request))return response({error:'INVALID_ORIGIN'},403);
 const actor=await apiStaffId();if(!actor)return response({error:'UNAUTHENTICATED'},401);
 try{
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new BindingError('INVALID_REQUEST');
  const bytes=await readImportRequestBody(request,1024);let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new BindingError('INVALID_REQUEST');}
  const body:unknown=JSON.parse(text);
  return response(kind==='challenge'?await createBindingChallenge(actor,bindingChallengeInput.parse(body)):
   (z.strictObject({}).parse(body),await unlinkStaffLine(actor)));
 }catch(e){return failure(e);}
}
