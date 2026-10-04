import {apiStaffId} from '../tickets/api';
import {readBoundedBody} from '../security/request-body';
import {isSameOrigin} from '../security/origin';
import {ProviderAdminError} from './provider-admin';

export function providerApiFailure(error:unknown):Response{
 const code=error instanceof ProviderAdminError?error.code:'INTERNAL_ERROR';
 const status=({FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,INVALID_REQUEST:400,INTERNAL_ERROR:503})[code];
 if(status===503)console.error('PROVIDER_API_FAILED',{code:'INTERNAL_ERROR'});
 return Response.json({error:code},{status});
}
export async function providerWrite(request:Request,work:(staffId:string,body:unknown)=>Promise<unknown>):Promise<Response>{
 if(!isSameOrigin(request))return Response.json({error:'INVALID_ORIGIN'},{status:403});
 const staffId=await apiStaffId();if(!staffId)return Response.json({error:'UNAUTHENTICATED'},{status:401});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'INVALID_REQUEST'},{status:400});
 try{
  const bytes=await readBoundedBody(request,16_000);if(!bytes)return Response.json({error:'INVALID_REQUEST'},{status:413});
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return Response.json({error:'INVALID_REQUEST'},{status:400});}
  return Response.json(await work(staffId,body));
 }catch(error){return providerApiFailure(error);}
}
