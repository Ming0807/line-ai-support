import {z} from 'zod';
import {createUserClient} from '../supabase/server';
import {TicketError} from './authorization';
import {executeTicketAction} from './ticket-service';
import {ticketActionSchemas,type StaffTicketAction} from '../../types/tickets';
import {readBoundedBody} from '../security/request-body';
import {isSameOrigin} from '../security/origin';

export async function apiStaffId():Promise<string|null> {
 try{
  const client=await createUserClient();const {data,error}=await client.auth.getClaims();
  const subject=data?.claims?.sub;
  return !error&&typeof subject==='string'&&z.uuid().safeParse(subject).success?subject:null;
 }catch{return null;}
}
export function ticketApiFailure(error:unknown):Response {
 if(error instanceof TicketError){
  const status=error.code==='NOT_FOUND'?404:error.code==='CONFLICT'?409:400;
  return Response.json({error:error.code},{status});
 }
 if(error instanceof z.ZodError)return Response.json({error:'INVALID_REQUEST'},{status:400});
 console.error('TICKET_API_FAILED',{code:'INTERNAL_ERROR'});return Response.json({error:'INTERNAL_ERROR'},{status:503});
}
export async function ticketActionHandler(request:Request,id:string,action:StaffTicketAction):Promise<Response> {
 // Browser JSON writes require their Origin to match the host that received the request.
 if(!isSameOrigin(request))return Response.json({error:'INVALID_ORIGIN'},{status:403});
 const staffId=await apiStaffId();if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 if(!z.uuid().safeParse(id).success)return Response.json({error:'NOT_FOUND'},{status:404});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'INVALID_REQUEST'},{status:400});
 try{
  const bytes=await readBoundedBody(request,24_000);if(!bytes)return Response.json({error:'INVALID_REQUEST'},{status:413});
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return Response.json({error:'INVALID_REQUEST'},{status:400});}
  const input=ticketActionSchemas[action].parse(body);
  return Response.json(await executeTicketAction(staffId,id,action,input));
 }catch(error){return ticketApiFailure(error);}
}
