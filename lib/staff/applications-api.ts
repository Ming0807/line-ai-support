import {z} from 'zod';
import {getVerifiedStaffAuth} from '../auth/line-staff-server';
import {readStaffLineConfig} from '../auth/line-staff-config';
import {isSameOrigin} from '../security/origin';
import {readBoundedBody} from '../security/request-body';
import {applicationQuerySchema,decideApplicationSchema,StaffApplicationError,submitApplicationSchema,suspendApplicationSchema} from './applications-contracts';
import {getStaffApplicationContext,listStaffApplications,submitStaffApplication,decideStaffApplication,suspendStaffApplication} from './applications';

function response(body:unknown,status=200):Response {
 return Response.json(body,{status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
}
function failure(error:unknown):Response {
 if(error instanceof StaffApplicationError){
  const status=error.code==='INVALID_REQUEST'?400:error.code==='UNAUTHENTICATED'?401:
   ['FORBIDDEN','STAFF_ACCOUNT_INACTIVE'].includes(error.code)?403:error.code==='NOT_FOUND'?404:error.code==='UNAVAILABLE'?503:409;
  return response({error:error.code},status);
 }
 if(error instanceof z.ZodError||error instanceof SyntaxError)return response({error:'INVALID_REQUEST'},400);
 console.error('STAFF_APPLICATION_REQUEST_FAILED',{code:'UNAVAILABLE'});return response({error:'UNAVAILABLE'},503);
}
async function auth(){const current=await getVerifiedStaffAuth();if(!current)throw new StaffApplicationError('UNAUTHENTICATED');return current;}
async function readBody(request:Request):Promise<unknown> {
 if(new URL(request.url).search||request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')throw new StaffApplicationError('INVALID_REQUEST');
 const bytes=await readBoundedBody(request,16384);if(!bytes)throw new StaffApplicationError('INVALID_REQUEST');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new StaffApplicationError('INVALID_REQUEST');}
}
export async function getOnboarding(request:Request):Promise<Response> {
 try{
  if(new URL(request.url).search)throw new StaffApplicationError('INVALID_REQUEST');
  const config=readStaffLineConfig(),current=await getVerifiedStaffAuth();
  return response(current?await getStaffApplicationContext(current,config):{authenticated:false,lineLinked:false,
   staffActive:false,loginAvailable:config.loginAvailable,canReview:false,application:null,departments:[]});
 }catch(error){return failure(error);}
}
export async function getApplications(request:Request):Promise<Response> {
 try{
  const current=await auth(),params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new StaffApplicationError('INVALID_REQUEST');
  const query=applicationQuerySchema.parse(Object.fromEntries(params));
  return response(await listStaffApplications(current.userId,query,readStaffLineConfig()));
 }catch(error){return failure(error);}
}
export async function postApplication(request:Request):Promise<Response> {
 if(!isSameOrigin(request))return response({error:'INVALID_ORIGIN'},403);
 try{
  const current=await auth(),body=await readBody(request);submitApplicationSchema.parse(body);
  return response(await submitStaffApplication(current,body,readStaffLineConfig()));
 }catch(error){return failure(error);}
}
async function review(request:Request,id:string,kind:'DECIDE'|'SUSPEND'):Promise<Response> {
 if(!isSameOrigin(request))return response({error:'INVALID_ORIGIN'},403);
 try{
  const current=await auth();if(!z.uuid().safeParse(id).success)throw new StaffApplicationError('INVALID_REQUEST');
  const body=await readBody(request);(kind==='DECIDE'?decideApplicationSchema:suspendApplicationSchema).parse(body);
  return response(kind==='DECIDE'?await decideStaffApplication(current.userId,id,body,readStaffLineConfig()):
   await suspendStaffApplication(current.userId,id,body,readStaffLineConfig()));
 }catch(error){return failure(error);}
}
export async function decideApplication(request:Request,id:string):Promise<Response>{return review(request,id,'DECIDE');}
export async function suspendApplication(request:Request,id:string):Promise<Response>{return review(request,id,'SUSPEND');}
