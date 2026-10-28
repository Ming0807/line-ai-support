import {z} from 'zod';
import {apiStaffId,ticketApiFailure} from '../tickets/api';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {parseInboxQuery,parseThreadQuery,readChatInputSchema,noteChatInputSchema} from './contracts';
import {listInbox,readThread,acknowledgeRead,addInternalNote} from './service';

function privateResponse(response:Response):Response{
 response.headers.set('Cache-Control','private, no-store, max-age=0');response.headers.set('Vary','Cookie');return response;
}
const error=(code:string,status:number)=>privateResponse(Response.json({error:code},{status}));
async function body(request:Request):Promise<unknown>{
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new z.ZodError([]);
 const bytes=await readBoundedBody(request,24000);if(!bytes)throw new z.ZodError([]);
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new z.ZodError([]);}
}
export async function inboxListHandler(request:Request):Promise<Response>{
 const staffId=await apiStaffId();if(!staffId)return error('UNAUTHENTICATED',401);
 try{return privateResponse(Response.json(await listInbox(staffId,parseInboxQuery(new URL(request.url).searchParams))));}
 catch(failure){return privateResponse(ticketApiFailure(failure));}
}
export async function inboxThreadHandler(request:Request,id:string):Promise<Response>{
 const staffId=await apiStaffId();if(!staffId)return error('UNAUTHENTICATED',401);
 if(!z.uuid().safeParse(id).success)return error('NOT_FOUND',404);
 try{return privateResponse(Response.json(await readThread(staffId,id,parseThreadQuery(new URL(request.url).searchParams))));}
 catch(failure){return privateResponse(ticketApiFailure(failure));}
}
export async function inboxWriteHandler(request:Request,id:string,action:'READ'|'NOTE'):Promise<Response>{
 if(!isSameOrigin(request))return error('INVALID_ORIGIN',403);
 const staffId=await apiStaffId();if(!staffId)return error('UNAUTHENTICATED',401);
 if(!z.uuid().safeParse(id).success)return error('NOT_FOUND',404);
 try{
  const raw=await body(request);
  const result=action==='READ'?await acknowledgeRead(staffId,id,readChatInputSchema.parse(raw).throughSequence)
   :await addInternalNote(staffId,id,noteChatInputSchema.parse(raw));
  return privateResponse(Response.json(result));
 }catch(failure){return privateResponse(ticketApiFailure(failure));}
}
