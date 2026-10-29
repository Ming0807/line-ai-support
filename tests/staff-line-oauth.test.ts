import {beforeEach,expect,it,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createLineFlowCookie,readLineFlowCookie} from '@/lib/auth/line-staff-flow';
import {beginLineLogin,finishLineLogin} from '@/lib/auth/line-staff-oauth';

const appBaseUrl='https://staff.example.edu';
const supabaseUrl='https://project.supabase.co';
const userId='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const identityId='e3490a61-8d27-4b60-b7d6-80bd75854138';
const subject='U'+'a'.repeat(32);
const oauthUrl=`${supabaseUrl}/auth/v1/authorize?provider=custom%3Aline-staff`;
const key=randomBytes(32).toString('base64');
const nowValue=Date.UTC(2026,9,29,3,0,0);
const linkedUser={id:userId,identities:[{
  id:subject,provider:'custom:line-staff',identity_id:identityId,user_id:userId,identity_data:{sub:subject},
}]};

function fixture() {
  let cookie:string|undefined;
  let now=nowValue;
  const order:string[]=[];
  const auth={
    getUser:vi.fn().mockResolvedValue({data:{user:null},error:null}),
    signInWithOAuth:vi.fn().mockResolvedValue({data:{url:oauthUrl,flowId:'pkce-flow-1'},error:null}),
    linkIdentity:vi.fn().mockResolvedValue({data:{url:oauthUrl,flowId:'pkce-flow-1'},error:null}),
    exchangeCodeForSession:vi.fn().mockResolvedValue({data:{},error:null}),
    signOut:vi.fn().mockResolvedValue({error:null}),
  };
  const sync=vi.fn().mockResolvedValue(undefined);
  const deps={
    config:{loginAvailable:true,sameProviderConfirmed:true,appBaseUrl,supabaseUrl,encryptionKey:key},
    now:()=>now,
    readCookie:()=>cookie,
    writeCookie:(value:string|null)=>{order.push(value===null?'clear':'write');cookie=value??undefined;},
    client:vi.fn().mockResolvedValue({auth}),
    sync,
  };
  return {
    deps,auth,sync,order,
    get cookie(){return cookie;},
    set cookie(value:string|undefined){cookie=value;},
    setNow(value:number){now=value;},
  };
}

function req(path:string) {return new Request(`${appBaseUrl}${path}`);}
function redirectPath(response:Response) {return new URL(response.headers.get('location')??'/',appBaseUrl).pathname;}

beforeEach(()=>vi.restoreAllMocks());

it('does not start LINE OAuth when provider setup is unavailable or not same-provider confirmed',async()=>{
  const unavailable=fixture();unavailable.deps.config.loginAvailable=false;
  expect((await beginLineLogin(req('/auth/line'),unavailable.deps)).status).toBe(503);
  expect(unavailable.deps.client).not.toHaveBeenCalled();
  const unconfirmed=fixture();unconfirmed.deps.config.sameProviderConfirmed=false;
  expect((await beginLineLogin(req('/auth/line'),unconfirmed.deps)).status).toBe(503);
  expect(unconfirmed.deps.client).not.toHaveBeenCalled();
});

it('rejects unknown, duplicate and open-redirect initiation parameters before creating a client',async()=>{
  const f=fixture();
  for(const path of [
    '/auth/line?unexpected=x',
    '/auth/line?mode=link&mode=signin',
    '/auth/line?next=https%3A%2F%2Fevil.example',
    '/auth/line?next=%2F%2Fevil.example',
  ]) expect((await beginLineLogin(req(path),f.deps)).status).toBe(400);
  expect(f.deps.client).not.toHaveBeenCalled();
});

it('starts sign-in with the fixed custom provider, scope and trusted callback, then saves encrypted flow intent',async()=>{
  const f=fixture();
  const response=await beginLineLogin(req('/auth/line?next=%2Fstaff%2Fapply'),f.deps);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(oauthUrl);
  expect(f.auth.signInWithOAuth).toHaveBeenCalledWith({provider:'custom:line-staff',options:{
    redirectTo:`${appBaseUrl}/auth/callback`,scopes:'openid profile',skipBrowserRedirect:true,
  }});
  expect(f.auth.linkIdentity).not.toHaveBeenCalled();
  expect(f.order).toEqual(['write']);
  expect(f.cookie).toBeTruthy();
  expect(f.cookie).not.toContain('/staff/apply');
  expect(f.cookie).not.toContain('signin');
  expect(readLineFlowCookie(f.cookie!,key,nowValue)).toMatchObject({mode:'signin',next:'/staff/apply',userId:null});
});

it('redirects an already authenticated sign-in to the fixed target without replacing the session identity',async()=>{
  const f=fixture();f.auth.getUser.mockResolvedValue({data:{user:linkedUser},error:null});
  const response=await beginLineLogin(req('/auth/line?next=%2Fdashboard'),f.deps);
  expect(response.status).toBe(302);
  expect(redirectPath(response)).toBe('/dashboard');
  expect(f.auth.signInWithOAuth).not.toHaveBeenCalled();
  expect(f.auth.linkIdentity).not.toHaveBeenCalled();
  expect(f.order).toEqual([]);
});

it('requires an existing authenticated subject before beginning explicit account linking',async()=>{
  const f=fixture();
  const response=await beginLineLogin(req('/auth/line?mode=link&next=%2Fstaff%2Fapplication'),f.deps);
  expect(response.status).toBe(401);
  expect(f.auth.linkIdentity).not.toHaveBeenCalled();
  expect(f.order).toEqual([]);
});

it('links LINE only from an authenticated existing user and binds that subject into encrypted callback state',async()=>{
  const f=fixture();f.auth.getUser.mockResolvedValue({data:{user:{id:userId,identities:[]}},error:null});
  const response=await beginLineLogin(req('/auth/line?mode=link&next=%2Fstaff%2Fapplication'),f.deps);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(oauthUrl);
  expect(f.auth.linkIdentity).toHaveBeenCalledWith({provider:'custom:line-staff',options:{
    redirectTo:`${appBaseUrl}/auth/callback`,scopes:'openid profile',skipBrowserRedirect:true,
  }});
  expect(f.auth.signInWithOAuth).not.toHaveBeenCalled();
  expect(readLineFlowCookie(f.cookie!,key,nowValue)).toMatchObject({mode:'link',next:'/staff/application',userId});
});

it('rejects an OAuth redirect outside the fixed Supabase or LINE authorization endpoints',async()=>{
  for(const url of [
    'https://evil.example/collect',
    'https://user:PRIVATE_CREDENTIAL@project.supabase.co/auth/v1/authorize?provider=custom%3Aline-staff',
    `${oauthUrl}#access_token=PRIVATE_FRAGMENT`,
  ]) {
    const f=fixture();f.auth.signInWithOAuth.mockResolvedValue({data:{url,flowId:'pkce-flow-1'},error:null});
    const response=await beginLineLogin(req('/auth/line'),f.deps);
    expect(response.status).not.toBe(302);
    expect(f.order).toEqual([]);
    expect(response.headers.get('location')??'').not.toContain('evil.example');
    expect(response.headers.get('location')??'').not.toContain('PRIVATE_');
  }
});

it('treats a missing Auth session as unauthenticated but Auth network failures as unavailable',async()=>{
  const sessionMissing=fixture();
  sessionMissing.auth.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError',status:400}});
  const signin=await beginLineLogin(req('/auth/line'),sessionMissing.deps);
  expect(signin.status).toBe(302);
  expect(sessionMissing.auth.signInWithOAuth).toHaveBeenCalled();

  const linkMissing=fixture();
  linkMissing.auth.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError',status:400}});
  expect((await beginLineLogin(req('/auth/line?mode=link'),linkMissing.deps)).status).toBe(401);
  expect(linkMissing.auth.linkIdentity).not.toHaveBeenCalled();

  const networkFailure=fixture();
  networkFailure.auth.getUser.mockResolvedValue({data:{user:null},error:{status:503}});
  const unavailable=await beginLineLogin(req('/auth/line'),networkFailure.deps);
  expect(unavailable.status).toBe(503);
  expect(networkFailure.auth.signInWithOAuth).not.toHaveBeenCalled();
});

it('consumes a valid callback cookie before code exchange and syncs only a fresh verified LINE identity',async()=>{
  const f=fixture();
  const begin=await beginLineLogin(req('/auth/line?next=%2Fstaff%2Fapply'),f.deps);
  expect(begin.status).toBe(302);
  f.auth.exchangeCodeForSession.mockImplementation(async()=>{expect(f.cookie).toBeUndefined();return {data:{},error:null};});
  f.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{name:'AuthSessionMissingError',status:400}})
    .mockResolvedValueOnce({data:{user:linkedUser},error:null});
  const callback=await finishLineLogin(req('/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1'),f.deps);
  expect(f.order).toEqual(['write','clear']);
  expect(f.auth.exchangeCodeForSession).toHaveBeenCalledWith('oauth-code',{flowId:'pkce-flow-1'});
  expect(f.sync).toHaveBeenCalledWith({userId,lineIdentity:{identityId,subject}});
  expect(redirectPath(callback)).toBe('/staff/apply');
});

it('requires callback flow ids to match the PKCE flow returned at OAuth initiation',async()=>{
  const f=fixture();
  await beginLineLogin(req('/auth/line'),f.deps);
  const response=await finishLineLogin(req('/auth/callback?code=oauth-code&sb_flow_id=wrong-flow'),f.deps);
  expect(f.order).toEqual(['write','clear']);
  expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(f.sync).not.toHaveBeenCalled();
  expect(response.headers.get('location')??'').not.toContain('wrong-flow');
});

it('does not exchange a sign-in callback if another Auth session appeared after OAuth began',async()=>{
  const f=fixture();
  await beginLineLogin(req('/auth/line'),f.deps);
  f.auth.getUser.mockResolvedValue({data:{user:linkedUser},error:null});

  const response=await finishLineLogin(req('/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1'),f.deps);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({error:'IDENTITY_CHANGED'});
  expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(f.sync).not.toHaveBeenCalled();
  expect(f.auth.signOut).not.toHaveBeenCalled();
  expect(f.order).toEqual(['write','clear']);
});

it('preserves the existing account when explicit-link callback sees a different or missing Auth session',async()=>{
  const otherUserId='91e74be8-857d-4e89-9915-05ce51daf8fc';
  const otherUser={...linkedUser,id:otherUserId,identities:[{...linkedUser.identities[0],user_id:otherUserId}]};
  for(const currentUser of [otherUser,null]) {
    const f=fixture();
    f.auth.getUser.mockResolvedValueOnce({data:{user:{id:userId,identities:[]}},error:null});
    await beginLineLogin(req('/auth/line?mode=link&next=%2Fstaff%2Fapplication'),f.deps);
    f.auth.getUser.mockResolvedValue({data:{user:currentUser},error:currentUser?null:{name:'AuthSessionMissingError',status:400}});

    const response=await finishLineLogin(req('/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1'),f.deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({error:'IDENTITY_CHANGED'});
    expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(f.sync).not.toHaveBeenCalled();
    expect(f.auth.signOut).not.toHaveBeenCalled();
    expect(f.order).toEqual(['write','clear']);
  }
});

it('treats callback getUser authorization and generic client errors as unavailable without exchanging the code',async()=>{
  for(const error of [{status:429},{status:403},{status:400,name:'AuthClientError'}]) {
    const f=fixture();
    f.cookie=createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue);
    f.auth.getUser.mockResolvedValue({data:{user:null},error});

    const response=await finishLineLogin(req('/auth/callback?code=oauth-code'),f.deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'UNAVAILABLE'});
    expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(f.sync).not.toHaveBeenCalled();
    expect(f.auth.signOut).not.toHaveBeenCalled();
    expect(f.order).toEqual(['clear']);
  }
});

it('consumes expired, missing-cookie, missing-code, duplicate and unexpected-parameter callbacks without exchanging a code',async()=>{
  const expired=fixture();await beginLineLogin(req('/auth/line'),expired.deps);expired.setNow(nowValue+600_000);
  expect((await finishLineLogin(req('/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1'),expired.deps)).status).not.toBe(200);
  expect(expired.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  const cases=[
    ['/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1',undefined],
    ['/auth/callback?sb_flow_id=pkce-flow-1',createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue)],
    ['/auth/callback?code=one&code=two&sb_flow_id=pkce-flow-1',createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue)],
    ['/auth/callback?code=oauth-code&sb_flow_id=pkce-flow-1&unexpected=x',createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue)],
  ] as const;
  for(const [path,cookie] of cases){
    const f=fixture();f.cookie=cookie;
    await finishLineLogin(req(path),f.deps);
    expect(f.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(f.sync).not.toHaveBeenCalled();
  }
});

it('requires a fresh linked LINE identity after exchange and signs out locally if link mode changes Auth subjects',async()=>{
  const missingIdentity=fixture();
  missingIdentity.cookie=createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue);
  missingIdentity.auth.getUser.mockResolvedValueOnce({data:{user:null},error:null})
    .mockResolvedValueOnce({data:{user:{id:userId,identities:[]}},error:null});
  await finishLineLogin(req('/auth/callback?code=oauth-code'),missingIdentity.deps);
  expect(missingIdentity.sync).not.toHaveBeenCalled();

  const switched=fixture();
  switched.cookie=createLineFlowCookie({mode:'link',next:'/staff/application',userId},key,nowValue);
  switched.auth.getUser.mockResolvedValueOnce({data:{user:{id:userId,identities:[]}},error:null})
    .mockResolvedValueOnce({data:{user:{...linkedUser,id:'91e74be8-857d-4e89-9915-05ce51daf8fc',identities:[{
    ...linkedUser.identities[0],user_id:'91e74be8-857d-4e89-9915-05ce51daf8fc',
  }]}},error:null});
  await finishLineLogin(req('/auth/callback?code=oauth-code'),switched.deps);
  expect(switched.auth.signOut).toHaveBeenCalledWith({scope:'local'});
  expect(switched.sync).not.toHaveBeenCalled();
});

it('handles provider and exchange errors without reflecting callback secrets in output or logs',async()=>{
  const logger=vi.spyOn(console,'error').mockImplementation(()=>{});
  const providerError=fixture();providerError.cookie=createLineFlowCookie({mode:'signin',next:'/staff/apply',userId:null},key,nowValue);
  const denied=await finishLineLogin(req('/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAILS'),providerError.deps);
  expect(providerError.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(providerError.sync).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_PROVIDER_DETAILS');
  expect(denied.headers.get('location')??'').not.toContain('PRIVATE_PROVIDER_DETAILS');

  const failedExchange=fixture();
  await beginLineLogin(req('/auth/line'),failedExchange.deps);
  failedExchange.auth.exchangeCodeForSession.mockResolvedValue({data:{},error:new Error('TOKEN_SECRET_FROM_PROVIDER')});
  const failure=await finishLineLogin(req('/auth/callback?code=OAUTH_SECRET'),failedExchange.deps);
  expect(failedExchange.auth.exchangeCodeForSession).toHaveBeenCalledWith('OAUTH_SECRET',{flowId:'pkce-flow-1'});
  expect(failedExchange.sync).not.toHaveBeenCalled();
  expect(JSON.stringify(await failure.json())).not.toContain('TOKEN_SECRET_FROM_PROVIDER');
  expect(JSON.stringify(logger.mock.calls)).not.toContain('OAUTH_SECRET');
  expect(JSON.stringify(logger.mock.calls)).not.toContain('TOKEN_SECRET_FROM_PROVIDER');
  logger.mockRestore();
});
