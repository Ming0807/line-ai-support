import {cookies} from 'next/headers';
import {readServerEnv} from '../config/env';
import {createUserClient} from '../supabase/server';
import {syncStaffLineLoginAuthority} from '../staff/applications';
import {readStaffLineConfig} from './line-staff-config';
import {LINE_STAFF_FLOW_COOKIE,LINE_STAFF_FLOW_SECONDS} from './line-staff-flow';
import {beginLineLogin,finishLineLogin,type StaffLineOAuthDependencies} from './line-staff-oauth';

export async function staffLineRoute(request:Request,kind:'BEGIN'|'FINISH'):Promise<Response> {
 try{
  const env=readServerEnv(),config=readStaffLineConfig(),store=await cookies();
  const deps:StaffLineOAuthDependencies={
   config:{...config,appBaseUrl:env.appBaseUrl,supabaseUrl:env.supabaseUrl,encryptionKey:env.encryptionKey??''},
   now:Date.now,readCookie:()=>store.get(LINE_STAFF_FLOW_COOKIE)?.value,
   writeCookie:value=>store.set(LINE_STAFF_FLOW_COOKIE,value??'',{httpOnly:true,secure:new URL(env.appBaseUrl).protocol==='https:',
    sameSite:'lax',path:'/auth',maxAge:value===null?0:LINE_STAFF_FLOW_SECONDS}),
   client:createUserClient,sync:auth=>syncStaffLineLoginAuthority(auth,config),
  };
  return kind==='BEGIN'?await beginLineLogin(request,deps):await finishLineLogin(request,deps);
 }catch{
  console.error('STAFF_LINE_ROUTE_FAILED',{code:'UNAVAILABLE'});
  return Response.json({error:'UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer'}});
 }
}
