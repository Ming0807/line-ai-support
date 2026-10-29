import {STAFF_LINE_LOGIN_PROVIDER,projectVerifiedLineStaffUser,type VerifiedStaffAuth} from './line-staff';
import {createLineFlowCookie,parseLineFlowRequest,readLineFlowCookie,trustedLineCallbackUrl} from './line-staff-flow';
import {StaffApplicationError} from '../staff/applications-contracts';

interface OAuthCredentials {provider:typeof STAFF_LINE_LOGIN_PROVIDER;options:{redirectTo:string;scopes:string;skipBrowserRedirect:boolean}}
interface OAuthResult {data:{url:string|null;flowId?:string|null};error:unknown}
export interface StaffLineOAuthDependencies {
 config:{loginAvailable:boolean;sameProviderConfirmed:boolean;appBaseUrl:string;supabaseUrl:string;encryptionKey:string};
 now:()=>number;readCookie:()=>string|undefined;writeCookie:(value:string|null)=>void;
 client:()=>Promise<{auth:{
  getUser:()=>Promise<{data:{user:unknown|null};error:{status?:number;name?:string}|null}>;
  signInWithOAuth:(input:OAuthCredentials)=>Promise<OAuthResult>;
  linkIdentity:(input:OAuthCredentials)=>Promise<OAuthResult>;
  exchangeCodeForSession:(code:string,options?:{flowId:string})=>Promise<{data:unknown;error:unknown}>;
  signOut:(options:{scope:'local'})=>Promise<unknown>;
 }}>;
 sync:(auth:VerifiedStaffAuth)=>Promise<void>;
}
const headers={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Cookie'};
function failure(code:string,status:number){return Response.json({error:code},{status,headers});}
function redirect(url:string){return new Response(null,{status:302,headers:{...headers,Location:url}});}
function available(deps:StaffLineOAuthDependencies):string|null {
 return deps.config.loginAvailable&&deps.config.sameProviderConfirmed&&deps.config.encryptionKey?
  trustedLineCallbackUrl(deps.config.appBaseUrl):null;
}
function providerRedirect(value:string|null,supabaseUrl:string):string|null {
 try{
  if(!value||/[\p{Cc}]/u.test(value))return null;const url=new URL(value),base=new URL(supabaseUrl);
  if(url.username||url.password||url.hash)return null;
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;
  return ((url.origin===base.origin&&url.pathname==='/auth/v1/authorize')||
   (url.origin==='https://access.line.me'&&url.pathname==='/oauth2/v2.1/authorize'))?url.toString():null;
 }catch{return null;}
}
function safeError(error:unknown):Response {
 if(error instanceof StaffApplicationError){
  return failure(error.code,error.code==='UNAUTHENTICATED'?401:error.code==='STAFF_ACCOUNT_INACTIVE'?403:
   error.code==='UNAVAILABLE'?503:409);
 }
 // No SDK/provider error bodies, callback code, subject, token or URL in logs.
 console.error('STAFF_LINE_LOGIN_FAILED',{code:'UNAVAILABLE'});return failure('UNAVAILABLE',503);
}
async function freshUser(auth:Awaited<ReturnType<StaffLineOAuthDependencies['client']>>['auth']):Promise<VerifiedStaffAuth|null> {
 const result=await auth.getUser();
 if(result.error){
  if(result.error.name==='AuthSessionMissingError'&&result.error.status===400)return null;
  throw new StaffApplicationError('UNAVAILABLE');
 }
 if(!result.data.user)return null;
 const projected=projectVerifiedLineStaffUser(result.data.user);
 if(!projected)throw new StaffApplicationError('IDENTITY_CHANGED');return projected;
}

export async function beginLineLogin(request:Request,deps:StaffLineOAuthDependencies):Promise<Response> {
 const flow=parseLineFlowRequest(new URL(request.url).searchParams);if(!flow)return failure('INVALID_REQUEST',400);
 const callback=available(deps);if(!callback)return failure('UNAVAILABLE',503);
 if(request.headers.get('sec-fetch-site')==='cross-site')return failure('INVALID_ORIGIN',403);
 try{
  const client=await deps.client(),current=await freshUser(client.auth);
  // A signed-in person must use explicit linking; sign-in never replaces their account.
  if(flow.mode==='signin'&&current)return redirect(new URL(flow.next,callback).toString());
  if(flow.mode==='link'&&!current)return failure('UNAUTHENTICATED',401);
  if(flow.mode==='link'&&current?.lineIdentity){await deps.sync(current);return redirect(new URL(flow.next,callback).toString());}
  const credentials:OAuthCredentials={provider:STAFF_LINE_LOGIN_PROVIDER,options:{redirectTo:callback,scopes:'openid profile',skipBrowserRedirect:true}};
  const result=flow.mode==='link'?await client.auth.linkIdentity(credentials):await client.auth.signInWithOAuth(credentials);
  if(result.error)return failure('UNAVAILABLE',503);
  const url=providerRedirect(result.data.url,deps.config.supabaseUrl);if(!url)return failure('UNAVAILABLE',503);
  const cookie=createLineFlowCookie({...flow,userId:flow.mode==='link'?current!.userId:null,pkceFlowId:result.data.flowId??null},deps.config.encryptionKey,deps.now());
  deps.writeCookie(cookie);return redirect(url);
 }catch(error){return safeError(error);}
}
export async function finishLineLogin(request:Request,deps:StaffLineOAuthDependencies):Promise<Response> {
 // Consume browser intent on EVERY callback path, including denied/malformed flows.
 const cookie=deps.readCookie();deps.writeCookie(null);
 const callback=available(deps);if(!callback)return failure('UNAVAILABLE',503);
 const flow=cookie?readLineFlowCookie(cookie,deps.config.encryptionKey,deps.now()):null;
 const params=new URL(request.url).searchParams;
 if(!flow||[...params.keys()].some(key=>!['code','sb_flow_id','error','error_code','error_description'].includes(key)||params.getAll(key).length!==1))
  return failure('INVALID_REQUEST',400);
 if(params.has('error')||params.has('error_code')||params.has('error_description'))return failure('LINE_LOGIN_DENIED',400);
 const code=params.get('code'),flowId=params.get('sb_flow_id');
 if(!code||!/^[A-Za-z0-9._~-]{1,2048}$/u.test(code)||(flowId!==null&&flowId!==flow.pkceFlowId))return failure('INVALID_REQUEST',400);
 try{
  const client=await deps.client();
  // Another tab may have signed in after this OAuth flow began. Reject BEFORE
  // PKCE exchange writes new SSR session cookies; preserve that current account.
  const beforeExchange=await freshUser(client.auth);
  if(flow.mode==='signin'?beforeExchange!==null:beforeExchange?.userId!==flow.userId)
   return failure('IDENTITY_CHANGED',409);
  const exchanged=await client.auth.exchangeCodeForSession(code,flow.pkceFlowId?{flowId:flow.pkceFlowId}:undefined);
  if(exchanged.error)return failure('LINE_LOGIN_FAILED',400);
  const current=await freshUser(client.auth);
  if(!current?.lineIdentity||(flow.mode==='link'&&flow.userId!==current.userId)){
   await client.auth.signOut({scope:'local'});return failure('IDENTITY_CHANGED',409);
  }
  await deps.sync(current);
  return redirect(new URL(flow.next,callback).toString());
 }catch(error){return safeError(error);}
}
