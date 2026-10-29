import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {StaffApplicationError} from '../../lib/staff/applications-contracts';
import {consumeStaffBinding,createBindingChallenge,getBindingStatus} from '../../lib/staff/line-binding';
import {transaction} from '../../lib/database/pool';
import {encryptValue,hashStaffLineUserId} from '../../lib/security/identity';
import type {
 DecideStaffApplication,StaffApplicationContext,StaffApplicationItem,StaffApplicationList,
 StaffApplicationStatus,SubmitStaffApplication,SuspendStaffApplication,
} from '../../types/staff-applications';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'PRIVATE_OWNED_DATABASE_REQUIRED');
const key=Buffer.alloc(32,71).toString('base64');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:8,application_name:'staff-applications-owned-qa'});
const authFixturePool=new Pool({connectionString:`postgresql://supabase_admin:postgres@127.0.0.1:54422/${database}`,max:2,application_name:'staff-applications-auth-fixture'});
const serviceModulePath:string='../../lib/staff/applications';

interface VerifiedStaffAuth {userId:string;lineIdentity:{identityId:string;subject:string}|null}
interface ApplicationOptions {pool:Pool;key:string;loginAvailable?:boolean;sameProviderConfirmed?:boolean}
type ApplicationQuery={status?:StaffApplicationStatus;page:number;pageSize:number};
interface StaffApplicationsService {
 getStaffApplicationContext(auth:VerifiedStaffAuth,options:ApplicationOptions):Promise<StaffApplicationContext>;
 submitStaffApplication(auth:VerifiedStaffAuth,input:SubmitStaffApplication,options:ApplicationOptions):Promise<StaffApplicationItem>;
 listStaffApplications(actorId:string,query:ApplicationQuery,options:ApplicationOptions):Promise<StaffApplicationList>;
 decideStaffApplication(actorId:string,id:string,input:DecideStaffApplication,options:ApplicationOptions):Promise<StaffApplicationItem>;
 suspendStaffApplication(actorId:string,id:string,input:SuspendStaffApplication,options:ApplicationOptions):Promise<StaffApplicationItem>;
 syncStaffLineLoginAuthority(auth:VerifiedStaffAuth,options:ApplicationOptions):Promise<void>;
}

after(async()=>{await Promise.all([pool.end(),authFixturePool.end()]);});

async function applications():Promise<StaffApplicationsService>{
 return await import(serviceModulePath) as StaffApplicationsService;
}
async function within<T>(promise:Promise<T>,milliseconds:number,label:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),milliseconds);} )]);}
 finally{if(timer)clearTimeout(timer);}
}
function options(loginAvailable=true,sameProviderConfirmed?:boolean):ApplicationOptions{
 return {pool,key,loginAvailable,...(sameProviderConfirmed===undefined?{}:{sameProviderConfirmed})};
}
function subject():string{return `U${randomUUID().replaceAll('-','')}`;}
async function department(active=true):Promise<{id:string;name:string}>{
 const id=randomUUID(),code=`QA_ONB_${randomUUID().replaceAll('-','').slice(0,20)}`,name=`Onboarding QA ${code}`;
 await pool.query('insert into public.departments(id,code,name_th,name_en,active) values($1,$2,$3,$3,$4)',[id,code,name,active]);
 return {id,name};
}
async function authAdminQuery(text:string,values:unknown[]=[]):Promise<void>{
 const client=await authFixturePool.connect();
 try{
  await client.query('begin');
  await client.query("set local statement_timeout='2500ms'");
  await client.query("set local lock_timeout='1500ms'");
  await client.query(text,values);
  await client.query('commit');
 }catch(error){
  await client.query('rollback');
  throw error;
 }finally{client.release();}
}
async function createAuthUser(withLineIdentity=true):Promise<{auth:VerifiedStaffAuth;identityId:string|null;subject:string|null}>{
 const userId=randomUUID();
 await pool.query('insert into auth.users(id) values($1)',[userId]);
 if(!withLineIdentity)return {auth:{userId,lineIdentity:null},identityId:null,subject:null};
 const identity=await addLineIdentity(userId);
 return {auth:{userId,lineIdentity:identity},identityId:identity.identityId,subject:identity.subject};
}
async function addLineIdentity(userId:string,lineSubject=subject()):Promise<{identityId:string;subject:string}>{
 const identityId=randomUUID();
 await authAdminQuery('insert into auth.identities(id,user_id,identity_data,provider,provider_id) values($1,$2,$3::jsonb,$4,$5)',
  [identityId,userId,JSON.stringify({sub:lineSubject,name:'QA Applicant'}),'custom:line-staff',lineSubject]);
 return {identityId,subject:lineSubject};
}
async function createProfile(input:{userId?:string;role:'STAFF'|'SUPERVISOR'|'ADMIN'|'SUPER_ADMIN';active?:boolean;departmentId?:string|null}):Promise<string>{
 const userId=input.userId??randomUUID();
 if(!input.userId)await pool.query('insert into auth.users(id) values($1)',[userId]);
 await pool.query('insert into public.staff_profiles(id,department_id,display_name,role,active,can_view_sensitive,can_view_restricted) values($1,$2,$3,$4,$5,false,false)',
  [userId,input.departmentId??null,`QA ${input.role}`,input.role,input.active??true]);
 return userId;
}
async function reviewer():Promise<string>{return createProfile({role:'SUPER_ADMIN'});}
function submission(deptId:string,overrides:Partial<SubmitStaffApplication>={}):SubmitStaffApplication{
 return {applicantName:'ผู้สมัครทดสอบ',staffCode:`QA-${randomUUID().slice(0,8)}`,departmentId:deptId,requestId:randomUUID(),...overrides};
}
async function expectCode(work:()=>Promise<unknown>,code:StaffApplicationError['code']):Promise<void>{
 await assert.rejects(work,(error:unknown)=>{
  assert.ok(error instanceof StaffApplicationError,'STAFF_APPLICATION_ERROR_TYPE');
  assert.equal(error.code,code);
  return true;
 });
}
async function submitOne(deptId:string):Promise<{auth:VerifiedStaffAuth;item:StaffApplicationItem;lineSubject:string}>{
 const applicant=await createAuthUser(true);
 assert.ok(applicant.identityId&&applicant.subject);
 const api=await applications(),input=submission(deptId);
 const item=await api.submitStaffApplication(applicant.auth,input,options());
 return {auth:applicant.auth,item,lineSubject:applicant.subject};
}

test('private application tables are RLS protected and inaccessible to browser roles',async()=>{
 const relations=await pool.query(`
  select c.relname,c.relrowsecurity,
   has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
   has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in('staff_applications','staff_application_actions') and c.relkind='r'
  order by c.relname`);
 assert.deepEqual(relations.rows.map(row=>row.relname),['staff_application_actions','staff_applications'],
  'STAFF_APPLICATION_PRIVATE_TABLES_MISSING');
 assert.deepEqual(relations.rows.map(row=>[row.relrowsecurity,row.anon_access,row.authenticated_access]),
  [[true,false,false],[true,false,false]],'STAFF_APPLICATION_TABLE_PRIVACY');
});

test('unlinked authenticated context reports login availability and only active departments',async()=>{
 const api=await applications(),dept=await department(),inactive=await department(false),unlinked=await createAuthUser(false);
 const unavailable=await api.getStaffApplicationContext(unlinked.auth,options(false));
 assert.equal(unavailable.authenticated,true);
 assert.equal(unavailable.lineLinked,false);
 assert.equal(unavailable.staffActive,false);
 assert.equal(unavailable.canReview,false);
 assert.equal(unavailable.loginAvailable,false);
 assert.equal(unavailable.application,null);
 assert.ok(unavailable.departments.some(item=>item.id===dept.id));
 assert.equal(unavailable.departments.some(item=>item.id===inactive.id),false);
 const available=await api.getStaffApplicationContext(unlinked.auth,options(true));
 assert.equal(available.loginAvailable,true);
 assert.equal(available.lineLinked,false);
 assert.equal(JSON.stringify(available).includes(unlinked.auth.userId),false,'AUTH_SUBJECT_NOT_IN_BROWSER_DTO');
});
test('submission requires a current verified LINE identity and active requested department',async()=>{
 const api=await applications(),dept=await department(),inactive=await department(false);
 const unlinked=await createAuthUser(false);
 await expectCode(()=>api.submitStaffApplication(unlinked.auth,submission(dept.id),options()),'FORBIDDEN');

 const linked=await createAuthUser(true);
 await expectCode(()=>api.submitStaffApplication(linked.auth,submission(inactive.id),options()),'INVALID_REQUEST');
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=$1',[linked.auth.userId])).rows[0].n,0);
});

test('pending same-subject Auth identity can refresh without granting employment; changed subject is rejected',async()=>{
 const api=await applications(),dept=await department(),applicant=await createAuthUser(true);
 assert.ok(applicant.identityId&&applicant.subject);
 const submitted=await api.submitStaffApplication(applicant.auth,submission(dept.id),options());
 await authAdminQuery('delete from auth.identities where id=$1',[applicant.identityId]);
 const detached=(await pool.query('select auth_identity_id,status,revision,line_subject_hash from private.staff_applications where id=$1',[submitted.id])).rows[0];
 assert.equal(detached.auth_identity_id,null);
 assert.equal(detached.status,'PENDING');
 const replacement=await addLineIdentity(applicant.auth.userId,applicant.subject);
 const refreshedAuth:VerifiedStaffAuth={userId:applicant.auth.userId,lineIdentity:replacement};
 await api.syncStaffLineLoginAuthority(refreshedAuth,options());
 const refreshed=(await pool.query('select auth_identity_id,status,revision,line_subject_hash from private.staff_applications where id=$1',[submitted.id])).rows[0];
 assert.equal(refreshed.auth_identity_id,replacement.identityId);
 assert.equal(refreshed.status,'PENDING');
 assert.equal(refreshed.revision,detached.revision+1);
 assert.equal(refreshed.line_subject_hash,detached.line_subject_hash);
 assert.equal((await pool.query("select count(*)::int n from private.staff_application_actions where actor_id=$1 and application_id=$2 and action='SYNC_IDENTITY'",
  [applicant.auth.userId,submitted.id])).rows[0].n,1,'ONE_INTERNAL_SYNC_IDENTITY_AUDIT_RECEIPT');
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[applicant.auth.userId])).rows[0].n,0,
  'IDENTITY_REFRESH_DOES_NOT_GRANT_EMPLOYMENT');
 const refreshedContext=await api.getStaffApplicationContext(refreshedAuth,options());
 assert.equal(JSON.stringify(refreshedContext).includes(applicant.subject),false,'SYNC_SUBJECT_NEVER_ENTERS_BROWSER_DTO');
 const actor=await reviewer();
 const approved=await api.decideStaffApplication(actor,submitted.id,
  {decision:'APPROVE',departmentId:dept.id,revision:refreshed.revision,requestId:randomUUID()},options());
 assert.equal(approved.status,'APPROVED','REFRESHED_REVISION_CAN_BE_APPROVED');

 const different=await createAuthUser(true),second=await api.submitStaffApplication(different.auth,submission(dept.id),options());
 assert.ok(different.identityId);
 const before=(await pool.query('select auth_identity_id,status,revision,line_subject_hash from private.staff_applications where id=$1',[second.id])).rows[0];
 const otherSubject=subject();
 await authAdminQuery('update auth.identities set provider_id=$2,identity_data=$3::jsonb where id=$1',
  [different.identityId,otherSubject,JSON.stringify({sub:otherSubject})]);
 const changedAuth:VerifiedStaffAuth={userId:different.auth.userId,lineIdentity:{identityId:different.identityId,subject:otherSubject}};
 await expectCode(()=>api.syncStaffLineLoginAuthority(changedAuth,options()),'IDENTITY_CHANGED');
 const after=(await pool.query('select auth_identity_id,status,revision,line_subject_hash from private.staff_applications where id=$1',[second.id])).rows[0];
 assert.deepEqual(after,before,'DIFFERENT_LINE_SUBJECT_DOES_NOT_CHANGE_APPLICATION');
});

test('explicit same-provider sync binds active password Staff and never revives an inactive binding',async()=>{
 const api=await applications(),dept=await department(),passwordStaff=await createAuthUser(true);
 await createProfile({userId:passwordStaff.auth.userId,role:'STAFF',active:true,departmentId:dept.id});
 await api.syncStaffLineLoginAuthority(passwordStaff.auth,options(true));
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[passwordStaff.auth.userId])).rows[0].n,0,
  'LOGIN_AVAILABILITY_ALONE_IS_NOT_SAME_PROVIDER_PROOF');
 await api.syncStaffLineLoginAuthority(passwordStaff.auth,options(true,true));
 const binding=(await pool.query('select active,auth_identity_id from private.staff_line_identities where staff_id=$1',[passwordStaff.auth.userId])).rows[0];
 assert.deepEqual(binding,{active:true,auth_identity_id:passwordStaff.identityId});

 const legacy=await createAuthUser(true);
 await createProfile({userId:legacy.auth.userId,role:'STAFF',active:true,departmentId:dept.id});
 assert.ok(legacy.auth.lineIdentity);
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,active) values($1,$2,$3,false)',
  [legacy.auth.userId,hashStaffLineUserId(legacy.auth.lineIdentity.subject,key),encryptValue(legacy.auth.lineIdentity.subject,key)]);
 await api.syncStaffLineLoginAuthority(legacy.auth,options(true,true));
 const inactiveBinding=(await pool.query('select active,auth_identity_id from private.staff_line_identities where staff_id=$1',[legacy.auth.userId])).rows[0];
 assert.deepEqual(inactiveBinding,{active:false,auth_identity_id:null},'SYNC_NEVER_REVIVES_LEGACY_UNFOLLOW_BINDING');
});

test('manual challenge rebind clears OAuth authority and survives later Auth identity unlink',async()=>{
 const api=await applications(),dept=await department(),staff=await createAuthUser(true);
 assert.ok(staff.auth.lineIdentity&&staff.identityId);
 await createProfile({userId:staff.auth.userId,role:'STAFF',active:true,departmentId:dept.id});
 await api.syncStaffLineLoginAuthority(staff.auth,options(true,true));
 const identityHash=hashStaffLineUserId(staff.auth.lineIdentity.subject,key);
 const before=(await pool.query('select active,auth_identity_id,user_hash,user_id_encrypted from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0];
 assert.deepEqual({active:before.active,auth_identity_id:before.auth_identity_id,user_hash:before.user_hash},
  {active:true,auth_identity_id:staff.identityId,user_hash:identityHash});
 await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[staff.auth.userId]);

 const challenge=await createBindingChallenge(staff.auth.userId,{requestId:randomUUID()},{pool,encryptionKey:key});
 const verifiedSubject=staff.auth.lineIdentity.subject;
 const consumed=await transaction(c=>consumeStaffBinding(c,challenge.command,verifiedSubject,key),pool);
 assert.equal(consumed,null);
 const rebound=(await pool.query('select active,auth_identity_id,user_hash,user_id_encrypted from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0];
 assert.deepEqual({active:rebound.active,auth_identity_id:rebound.auth_identity_id,user_hash:rebound.user_hash},
  {active:true,auth_identity_id:null,user_hash:identityHash},'CHALLENGE_REBIND_CLEARS_OAUTH_FK');
 assert.equal((await getBindingStatus(staff.auth.userId,{pool})).bound,true);
 await authAdminQuery('delete from auth.identities where id=$1',[staff.identityId]);
 const retained=(await pool.query('select active,auth_identity_id,user_hash,user_id_encrypted from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0];
 assert.deepEqual({active:retained.active,auth_identity_id:retained.auth_identity_id,user_hash:retained.user_hash},
  {active:true,auth_identity_id:null,user_hash:identityHash},'EXPLICIT_CHALLENGE_BINDING_SURVIVES_AUTH_UNLINK');
 assert.equal((await getBindingStatus(staff.auth.userId,{pool})).bound,true);
 assert.equal((await pool.query('select active from public.staff_profiles where id=$1',[staff.auth.userId])).rows[0].active,true,
  'AUTH_UNLINK_DOES_NOT_CHANGE_STAFF_EMPLOYMENT');
});

test('Auth unlink at the binding-FK barrier fails fast, then retries cleanly after binding',async()=>{
 const api=await applications(),dept=await department(),staff=await createAuthUser(true);
 await createProfile({userId:staff.auth.userId,role:'STAFF',active:true,departmentId:dept.id});
 assert.ok(staff.identityId);
 let releaseQuery!:()=>void,signalQuery!:()=>void,intercepted=false;
 const queryReached=new Promise<void>(resolve=>{signalQuery=resolve;});
 const continueQuery=new Promise<void>(resolve=>{releaseQuery=resolve;});
 const gatedPool=new Proxy(pool,{get(target,property,receiver){
  if(property!=='connect'){
   const value=Reflect.get(target,property,receiver);
   return typeof value==='function'?value.bind(target):value;
  }
  return async()=>{
   const client=await target.connect();
   return new Proxy(client,{get(connection,clientProperty,clientReceiver){
    if(clientProperty==='query')return async(text:string,values?:unknown[])=>{
     if(!intercepted&&text.startsWith('insert into private.staff_line_identities(')){
      intercepted=true;signalQuery();await continueQuery;
     }
     return connection.query(text,values);
    };
    const value=Reflect.get(connection,clientProperty,clientReceiver);
    return typeof value==='function'?value.bind(connection):value;
   }}) as PoolClient;
  };
 }}) as Pool;
 const gatedOptions={...options(true,true),pool:gatedPool};
 const outcome=api.syncStaffLineLoginAuthority(staff.auth,gatedOptions).then(()=>({ok:true as const}),error=>({ok:false as const,error}));
 try{
  await within(queryReached,3000,'AUTH_BINDING_INSERT_BARRIER_TIMEOUT');
  await assert.rejects(()=>within(authAdminQuery('delete from auth.identities where id=$1',[staff.identityId]),3000,'AUTH_IDENTITY_UNLINK_BLOCKED'),
   (error:unknown)=>{
    assert.ok(error&&typeof error==='object'&&'code'in error);
    assert.equal(error.code,'40001');
    assert.match('message'in error&&typeof error.message==='string'?error.message:'',/STAFF_CHAT_ACCESS_BUSY/u);
    return true;
   });
  assert.equal((await pool.query('select count(*)::int n from auth.identities where id=$1',[staff.identityId])).rows[0].n,1,
   'FAILED_UNLINK_ROLLS_BACK_IDENTITY_DELETE');
  assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0].n,0,
   'NO_PARTIAL_BINDING_BEFORE_SYNC_RESUMES');
 }finally{releaseQuery();}
 const result=await within(outcome,4000,'SYNC_DID_NOT_TERMINATE_AFTER_AUTH_UNLINK');
 assert.equal(result.ok,true,'SYNC_TERMINATES_AFTER_FAIL_FAST_AUTH_UNLINK');
 const binding=(await pool.query('select active,auth_identity_id from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0];
 assert.deepEqual(binding,{active:true,auth_identity_id:staff.identityId});
 await within(authAdminQuery('delete from auth.identities where id=$1',[staff.identityId]),3000,'AUTH_IDENTITY_UNLINK_RETRY_BLOCKED');
 assert.equal((await pool.query('select count(*)::int n from auth.identities where id=$1',[staff.identityId])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[staff.auth.userId])).rows[0].n,0,
  'NO_PARTIAL_OA_BINDING');
 assert.equal((await pool.query('select active from public.staff_profiles where id=$1',[staff.auth.userId])).rows[0].active,true,
  'FAILED_BINDING_DOES_NOT_PARTIALLY_CHANGE_STAFF_PROFILE');
});

test('submission is request-id idempotent, preserves one pending audit, and grants no Staff access',async()=>{
 const api=await applications(),dept=await department(),applicant=await createAuthUser(true);
 assert.ok(applicant.identityId&&applicant.subject);
 const input=submission(dept.id),first=await api.submitStaffApplication(applicant.auth,input,options());
 const retry=await api.submitStaffApplication(applicant.auth,input,options());
 assert.deepEqual(retry,first);
 const submitReceipt=(await pool.query('select action,response from private.staff_application_actions where actor_id=$1 and request_id=$2',
  [applicant.auth.userId,input.requestId])).rows[0];
 assert.equal(submitReceipt.action,'SUBMIT');
 assert.deepEqual(submitReceipt.response,first,'SUBMIT_REPLAY_USES_IMMUTABLE_RECEIPT');
 assert.equal(first.status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[applicant.auth.userId])).rows[0].n,0,
  'PENDING_APPLICATION_MUST_NOT_CREATE_STAFF');
 const persisted=(await pool.query('select * from private.staff_applications where auth_user_id=$1',[applicant.auth.userId])).rows[0];
 assert.ok(persisted);
 assert.equal(persisted.status,'PENDING');
 assert.equal(JSON.stringify(persisted).includes(applicant.subject),false,'RAW_LINE_SUBJECT_NOT_STORED');
 assert.equal(JSON.stringify(first).includes(applicant.subject),false,'LINE_SUBJECT_NOT_IN_BROWSER_DTO');
 assert.equal(JSON.stringify(first).includes(applicant.identityId),false,'AUTH_IDENTITY_NOT_IN_BROWSER_DTO');

 await expectCode(()=>api.submitStaffApplication(applicant.auth,{...input,staffCode:'CHANGED'},options()),'CONFLICT');
 await expectCode(()=>api.submitStaffApplication(applicant.auth,{...input,requestId:randomUUID()},options()),'CONFLICT');
 await expectCode(()=>api.listStaffApplications(applicant.auth.userId,{page:1,pageSize:20},options()),'FORBIDDEN');
 const context=await api.getStaffApplicationContext(applicant.auth,options());
 assert.equal(context.application?.id,first.id);
 assert.equal(context.application?.status,'PENDING');
 assert.equal(context.staffActive,false);
});

test('cross-user and stale provider identities fail closed; unlink preserves audit and revokes OAuth binding',async()=>{
 const api=await applications(),dept=await department(),stale=await createAuthUser(true);
 const owner=await createAuthUser(true),otherUser=await createAuthUser(false);
 assert.ok(owner.auth.lineIdentity);
 const transferred:VerifiedStaffAuth={userId:otherUser.auth.userId,lineIdentity:owner.auth.lineIdentity};
 await expectCode(()=>api.submitStaffApplication(transferred,submission(dept.id),options()),'IDENTITY_CHANGED');
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=$1',[otherUser.auth.userId])).rows[0].n,0,
  'LINE_IDENTITY_CANNOT_TRANSFER_ACROSS_AUTH_USERS');
 assert.ok(stale.identityId&&stale.subject);
 await authAdminQuery('update auth.identities set provider_id=$2 where id=$1',[stale.identityId,subject()]);
 await expectCode(()=>api.submitStaffApplication(stale.auth,submission(dept.id),options()),'IDENTITY_CHANGED');
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=$1',[stale.auth.userId])).rows[0].n,0);

 const pending=await submitOne(dept.id),actor=await reviewer();
 const identityId=pending.auth.lineIdentity?.identityId;
 assert.ok(identityId);
 await authAdminQuery('delete from auth.identities where id=$1',[identityId]);
 const retained=(await pool.query('select auth_identity_id,status from private.staff_applications where id=$1',[pending.item.id])).rows[0];
 assert.equal(retained.status,'PENDING');
 assert.equal(retained.auth_identity_id,null,'IDENTITY_DELETE_RETAINS_APPLICATION_AUDIT');
 await expectCode(()=>api.decideStaffApplication(actor,pending.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:0,requestId:randomUUID()},options()),'IDENTITY_CHANGED');
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[pending.auth.userId])).rows[0].n,0);

 const collision=await submitOne(dept.id),legacyOwner=await createProfile({role:'STAFF',departmentId:dept.id});
 assert.ok(collision.auth.lineIdentity);
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,active) values($1,$2,$3,false)',
  [legacyOwner,hashStaffLineUserId(collision.auth.lineIdentity.subject,key),encryptValue(collision.auth.lineIdentity.subject,key)]);
 await expectCode(()=>api.decideStaffApplication(actor,collision.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:0,requestId:randomUUID()},options(true,true)),'CONFLICT');
 const legacyBinding=(await pool.query('select staff_id,active from private.staff_line_identities where user_hash=$1',
  [hashStaffLineUserId(collision.auth.lineIdentity.subject,key)])).rows[0];
 assert.deepEqual(legacyBinding,{staff_id:legacyOwner,active:false},'CONFIRMED_BINDING_NEVER_TRANSFERS_OR_REVIVES_INACTIVE_OWNER');
 assert.equal((await pool.query('select status,revision from private.staff_applications where id=$1',[collision.item.id])).rows[0].status,'PENDING');
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[collision.auth.userId])).rows[0].n,0,
  'CONFLICTING_BINDING_ROLLS_BACK_APPROVAL_PROFILE');

 const confirmed=await submitOne(dept.id),approved=await api.decideStaffApplication(actor,confirmed.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:0,requestId:randomUUID()},options(true,true));
 assert.equal(approved.status,'APPROVED');
 assert.ok(confirmed.auth.lineIdentity);
 const binding=(await pool.query('select auth_identity_id from private.staff_line_identities where staff_id=$1',[confirmed.auth.userId])).rows[0];
 assert.equal(binding.auth_identity_id,confirmed.auth.lineIdentity.identityId,'CONFIRMED_SAME_PROVIDER_BINDING');
 await authAdminQuery('delete from auth.identities where id=$1',[confirmed.auth.lineIdentity.identityId]);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[confirmed.auth.userId])).rows[0].n,0,
  'AUTH_IDENTITY_UNLINK_REVOKES_OAUTH_BINDING');
 const retainedApproval=(await pool.query('select auth_identity_id,status from private.staff_applications where id=$1',[confirmed.item.id])).rows[0];
 assert.deepEqual(retainedApproval,{auth_identity_id:null,status:'APPROVED'});
 assert.equal((await pool.query('select active from public.staff_profiles where id=$1',[confirmed.auth.userId])).rows[0].active,true,
  'AUTH_IDENTITY_UNLINK_DOES_NOT_REWRITE_EMPLOYMENT_APPROVAL');
});

test('active and inactive existing Staff accounts cannot create applications',async()=>{
 const api=await applications(),dept=await department();
 const inactive=await createAuthUser(true),active=await createAuthUser(true);
 await createProfile({userId:inactive.auth.userId,role:'STAFF',active:false,departmentId:dept.id});
 await createProfile({userId:active.auth.userId,role:'STAFF',active:true,departmentId:dept.id});
 await expectCode(()=>api.submitStaffApplication(inactive.auth,submission(dept.id),options()),'STAFF_ACCOUNT_INACTIVE');
 await expectCode(()=>api.submitStaffApplication(active.auth,submission(dept.id),options()),'ALREADY_STAFF');
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=any($1::uuid[])',
  [[inactive.auth.userId,active.auth.userId]])).rows[0].n,0);
});

test('concurrent submits converge on one immutable request or one application per Auth user',async()=>{
 const api=await applications(),dept=await department();
 const sameRequest=await createAuthUser(true),sameInput=submission(dept.id);
 const identical=await Promise.all([
  api.submitStaffApplication(sameRequest.auth,sameInput,options()),
  api.submitStaffApplication(sameRequest.auth,sameInput,options()),
 ]);
 assert.deepEqual(identical[0],identical[1]);
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=$1',[sameRequest.auth.userId])).rows[0].n,1);

 const competing=await createAuthUser(true);
 const outcomes=await Promise.allSettled([
  api.submitStaffApplication(competing.auth,submission(dept.id,{applicantName:'First claim'}),options()),
  api.submitStaffApplication(competing.auth,submission(dept.id,{applicantName:'Second claim'}),options()),
 ]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
 const rejected=outcomes.find(result=>result.status==='rejected');
 assert.ok(rejected&&rejected.status==='rejected');
 assert.ok(rejected.reason instanceof StaffApplicationError);
 assert.equal(rejected.reason.code,'CONFLICT');
 assert.equal((await pool.query('select count(*)::int n from private.staff_applications where auth_user_id=$1',[competing.auth.userId])).rows[0].n,1);
});

test('only active SUPER_ADMIN reviewers can enumerate applications',async()=>{
 const api=await applications(),dept=await department();
 const pendingBefore=Number((await pool.query("select count(*)::int n from private.staff_applications where status='PENDING'")).rows[0].n);
 const first=await submitOne(dept.id),second=await submitOne(dept.id);
 assert.ok(first.auth.lineIdentity&&second.auth.lineIdentity);
 const staff=await createProfile({role:'STAFF',departmentId:dept.id}),admin=await createProfile({role:'ADMIN'});
 const inactiveSuperAdmin=await createProfile({role:'SUPER_ADMIN',active:false});
 const superAdmin=await reviewer();
 await expectCode(()=>api.listStaffApplications(first.auth.userId,{page:1,pageSize:20},options()),'FORBIDDEN');
 await expectCode(()=>api.listStaffApplications(staff,{page:1,pageSize:20},options()),'FORBIDDEN');
 await expectCode(()=>api.listStaffApplications(admin,{page:1,pageSize:20},options()),'FORBIDDEN');
 await expectCode(()=>api.listStaffApplications(inactiveSuperAdmin,{page:1,pageSize:20},options()),'FORBIDDEN');
 const result=await api.listStaffApplications(superAdmin,{status:'PENDING',page:1,pageSize:1},options());
 assert.equal(result.items.length,1);
 assert.equal(result.pagination.total,pendingBefore+2,'LIST_TOTAL_IS_RELATIVE_TO_OWNED_FIXTURES');
 assert.equal(result.pagination.pageSize,1);
 assert.equal(result.pagination.hasNext,true);
 assert.equal(JSON.stringify(result).includes(first.auth.userId),false,'AUTH_SUBJECT_NOT_IN_REVIEWER_DTO');
 assert.equal(JSON.stringify(result).includes(first.lineSubject),false,'LINE_SUBJECT_NOT_IN_REVIEWER_DTO');
 assert.equal(JSON.stringify(result).includes(second.auth.lineIdentity.identityId),false,'IDENTITY_ID_NOT_IN_REVIEWER_DTO');
});

test('concurrent reviewers produce one revision-checked terminal decision',async()=>{
 const api=await applications(),dept=await department(),pending=await submitOne(dept.id);
 const firstReviewer=await reviewer(),secondReviewer=await reviewer();
 const requestApprove:DecideStaffApplication={decision:'APPROVE',departmentId:dept.id,revision:0,requestId:randomUUID()};
 const requestReject:DecideStaffApplication={decision:'REJECT',reason:'เอกสารไม่ครบ',revision:0,requestId:randomUUID()};
 const outcomes=await Promise.allSettled([
  api.decideStaffApplication(firstReviewer,pending.item.id,requestApprove,options()),
  api.decideStaffApplication(secondReviewer,pending.item.id,requestReject,options()),
 ]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
 const rejected=outcomes.find(result=>result.status==='rejected');
 assert.ok(rejected&&rejected.status==='rejected');
 assert.ok(rejected.reason instanceof StaffApplicationError);
 assert.equal(rejected.reason.code,'CONFLICT');
 const current=(await pool.query('select status,revision from private.staff_applications where id=$1',[pending.item.id])).rows[0];
 assert.ok(current.status==='APPROVED'||current.status==='REJECTED');
 assert.equal(current.revision,1);
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[pending.auth.userId])).rows[0].n,
  current.status==='APPROVED'?1:0);
});

test('approval is idempotent, selects an active final department, and creates only base STAFF',async()=>{
 const api=await applications(),requested=await department(),finalDepartment=await department(),other=await department();
 const pending=await submitOne(requested.id),actor=await reviewer();
 const input:DecideStaffApplication={decision:'APPROVE',departmentId:finalDepartment.id,reason:'ตรวจเอกสารแล้ว',revision:0,requestId:randomUUID()};
 const first=await api.decideStaffApplication(actor,pending.item.id,input,options());
 assert.equal(first.status,'APPROVED');
 assert.equal(first.approvedDepartmentId,finalDepartment.id);
 assert.equal(first.requestedDepartmentId,requested.id);
 assert.deepEqual(await api.decideStaffApplication(actor,pending.item.id,input,options()),first);
 const decisionReceipt=(await pool.query('select action,response from private.staff_application_actions where actor_id=$1 and request_id=$2',
  [actor,input.requestId])).rows[0];
 assert.equal(decisionReceipt.action,'APPROVE');
 assert.deepEqual(decisionReceipt.response,first,'APPROVAL_REPLAY_USES_IMMUTABLE_RECEIPT');
 await expectCode(()=>api.decideStaffApplication(actor,pending.item.id,{...input,departmentId:other.id},options()),'CONFLICT');
 const profile=(await pool.query('select department_id,role,active,can_view_sensitive,can_view_restricted from public.staff_profiles where id=$1',[pending.auth.userId])).rows[0];
 assert.deepEqual(profile,{department_id:finalDepartment.id,role:'STAFF',active:true,can_view_sensitive:false,can_view_restricted:false});
 assert.equal((await pool.query('select count(*)::int n from public.staff_department_grants where staff_id=$1',[pending.auth.userId])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[pending.auth.userId])).rows[0].n,0,
  'UNCONFIRMED_APPROVAL_DOES_NOT_CREATE_OA_BINDING');
 const context=await api.getStaffApplicationContext(pending.auth,options());
 assert.equal(context.staffActive,true);
 assert.equal(context.canReview,false);
 assert.equal(context.application?.status,'APPROVED');
 assert.equal(JSON.stringify(first).includes(pending.lineSubject),false);

 await pool.query('update public.staff_profiles set active=false where id=$1',[actor]);
 await expectCode(()=>api.decideStaffApplication(actor,pending.item.id,input,options()),'FORBIDDEN');
});

test('rejection is replayable, records a reason, and never grants a Staff profile',async()=>{
 const api=await applications(),dept=await department(),pending=await submitOne(dept.id),actor=await reviewer();
 const input:DecideStaffApplication={decision:'REJECT',reason:'ข้อมูลไม่ครบ',revision:0,requestId:randomUUID()};
 const rejected=await api.decideStaffApplication(actor,pending.item.id,input,options());
 assert.equal(rejected.status,'REJECTED');
 assert.equal(rejected.decisionReason,'ข้อมูลไม่ครบ');
 assert.deepEqual(await api.decideStaffApplication(actor,pending.item.id,input,options()),rejected);
 assert.equal((await pool.query('select count(*)::int n from public.staff_profiles where id=$1',[pending.auth.userId])).rows[0].n,0);
 await expectCode(()=>api.decideStaffApplication(actor,pending.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:1,requestId:randomUUID()},options()),'CONFLICT');
 await expectCode(()=>api.submitStaffApplication(pending.auth,submission(dept.id),options()),'CONFLICT');
});

test('suspension revokes active Staff and its OA binding, and cannot be replayed with changed input',async()=>{
 const api=await applications(),dept=await department(),pending=await submitOne(dept.id),actor=await reviewer();
 await api.decideStaffApplication(actor,pending.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:0,requestId:randomUUID()},options());
 assert.ok(pending.auth.lineIdentity);
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [pending.auth.userId,hashStaffLineUserId(pending.auth.lineIdentity.subject,key),encryptValue(pending.auth.lineIdentity.subject,key)]);
 const input:SuspendStaffApplication={reason:'สิ้นสุดสิทธิ์ชั่วคราว',revision:1,requestId:randomUUID()};
 const suspended=await api.suspendStaffApplication(actor,pending.item.id,input,options());
 assert.equal(suspended.status,'SUSPENDED');
 assert.deepEqual(await api.suspendStaffApplication(actor,pending.item.id,input,options()),suspended);
 const profile=(await pool.query('select active from public.staff_profiles where id=$1',[pending.auth.userId])).rows[0];
 assert.equal(profile.active,false);
 const binding=(await pool.query('select active from private.staff_line_identities where staff_id=$1',[pending.auth.userId])).rows[0];
 assert.equal(binding.active,false);
 const context=await api.getStaffApplicationContext(pending.auth,options());
 assert.equal(context.staffActive,false);
 assert.equal(context.application?.status,'SUSPENDED');
 await expectCode(()=>api.suspendStaffApplication(actor,pending.item.id,{...input,reason:'changed'},options()),'CONFLICT');
 await expectCode(()=>api.decideStaffApplication(actor,pending.item.id,
  {decision:'APPROVE',departmentId:dept.id,revision:2,requestId:randomUUID()},options()),'CONFLICT');
});
