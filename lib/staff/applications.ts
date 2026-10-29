import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {readServerEnv} from '../config/env';
import {loadActor,TicketError} from '../tickets/authorization';
import {decryptValue,encryptValue,hashStaffLineUserId} from '../security/identity';
import {STAFF_LINE_LOGIN_PROVIDER,type VerifiedStaffAuth} from '../auth/line-staff';
import {applicationQuerySchema,decideApplicationSchema,StaffApplicationError,submitApplicationSchema,suspendApplicationSchema} from './applications-contracts';
import type {StaffApplicationContext,StaffApplicationItem,StaffApplicationList,StaffApplicationStatus} from '../../types/staff-applications';

export interface StaffApplicationOptions {pool?:Pool;key?:string;loginAvailable?:boolean;sameProviderConfirmed?:boolean}
type Client=PoolClient;
interface ApplicationRow {
 id:string;auth_user_id:string;auth_identity_id:string|null;line_subject_hash:string;line_subject_encrypted:string;
 applicant_name:string;staff_code:string;requested_department_id:string;approved_department_id:string|null;
 status:StaffApplicationStatus;revision:number;submitted_at:Date;reviewed_at:Date|null;decision_reason:string|null;
 requested_name:string;approved_name:string|null;reviewer_name:string|null;
}
const applicationSelect=`select a.*,d.name_th requested_name,f.name_th approved_name,s.display_name reviewer_name
 from private.staff_applications a join public.departments d on d.id=a.requested_department_id
 left join public.departments f on f.id=a.approved_department_id left join public.staff_profiles s on s.id=a.reviewed_by`;
const uuid=z.uuid();
function keyFor(options:StaffApplicationOptions):string {
 const key=options.key??readServerEnv().encryptionKey;if(!key)throw new StaffApplicationError('UNAVAILABLE');return key;
}
function item(row:ApplicationRow):StaffApplicationItem {
 return {id:row.id,applicantName:row.applicant_name,staffCode:row.staff_code,
  requestedDepartmentId:row.requested_department_id,requestedDepartmentName:row.requested_name,
  approvedDepartmentId:row.approved_department_id,approvedDepartmentName:row.approved_name,status:row.status,revision:row.revision,
  submittedAt:row.submitted_at.toISOString(),reviewedAt:row.reviewed_at?.toISOString()??null,
  reviewerName:row.reviewer_name,decisionReason:row.decision_reason};
}
async function rowById(c:Client,id:string,lock=false):Promise<ApplicationRow> {
 const row=(await c.query<ApplicationRow>(`${applicationSelect} where a.id=$1${lock?' for update of a':''}`,[id])).rows[0];
 if(!row)throw new StaffApplicationError('NOT_FOUND');return row;
}
async function departments(c:Client):Promise<{id:string;name:string}[]> {
 return (await c.query('select id,name_th as name from public.departments where active order by name_th,id')).rows;
}
async function activeDepartment(c:Client,id:string):Promise<void> {
 if(!(await c.query('select id from public.departments where id=$1 and active for share',[id])).rowCount)throw new StaffApplicationError('INVALID_REQUEST');
}
async function work<T>(options:StaffApplicationOptions,run:(c:Client)=>Promise<T>):Promise<T> {
 try{return await transaction(async c=>{
  await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='2s'");return run(c);
 },options.pool);}catch(error){
  if(error instanceof StaffApplicationError)throw error;
  if(error&&typeof error==='object'&&'code'in error){
   if(['23503','23505','40001','40P01','55P03'].includes(String(error.code)))throw new StaffApplicationError('CONFLICT');
   if(error.code==='57014')throw new StaffApplicationError('UNAVAILABLE');
  }
  throw error;
 }
}
/** Admission changes are low-volume. Serialize this catalog rather than adding infrastructure;
 * existing binding/delivery/access locks still fence all current OA senders and revocation. */
async function mutation(c:Client):Promise<void> {
 await c.query("select pg_advisory_xact_lock(hashtextextended('staff-onboarding:catalog',0))");
}
async function bindingMutation(c:Client,staffId:string):Promise<void> {
 await c.query("select pg_advisory_xact_lock(hashtextextended('staff-line-binding:catalog',0))");
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`delivery:STAFF:${staffId}`]);
 if(!(await c.query("select pg_try_advisory_xact_lock(hashtextextended('staff-chat:access',0)) ok")).rows[0].ok)throw new StaffApplicationError('CONFLICT');
}
async function reviewer(c:Client,actorId:string):Promise<void> {
 if(!uuid.safeParse(actorId).success)throw new StaffApplicationError('FORBIDDEN');
 try{if((await loadActor(c,actorId)).role!=='SUPER_ADMIN')throw new StaffApplicationError('FORBIDDEN');}
 catch(error){if(error instanceof TicketError)throw new StaffApplicationError('FORBIDDEN');throw error;}
}
async function identity(c:Client,auth:VerifiedStaffAuth,required=false):Promise<VerifiedStaffAuth['lineIdentity']> {
 if(!uuid.safeParse(auth.userId).success)throw new StaffApplicationError('UNAUTHENTICATED');
 // Auth owns these tables. Do not request UPDATE privileges merely to row-lock them.
 // Application/binding FKs fence deletion; unlink removes OAuth channel authority.
 if(!(await c.query('select id from auth.users where id=$1',[auth.userId])).rowCount)throw new StaffApplicationError('UNAUTHENTICATED');
 if(!auth.lineIdentity){if(required)throw new StaffApplicationError('FORBIDDEN');return null;}
 const proof=auth.lineIdentity;
 if(!uuid.safeParse(proof.identityId).success||!/^U[0-9a-fA-F]{32}$/u.test(proof.subject))throw new StaffApplicationError('IDENTITY_CHANGED');
 const rows=(await c.query('select id,provider_id,identity_data from auth.identities where user_id=$1 and provider=$2',
  [auth.userId,STAFF_LINE_LOGIN_PROVIDER])).rows;
 if(rows.length!==1||rows[0].id!==proof.identityId||rows[0].provider_id!==proof.subject||rows[0].identity_data?.sub!==proof.subject)
  throw new StaffApplicationError('IDENTITY_CHANGED');
 return proof;
}
async function applicationIdentity(c:Client,row:ApplicationRow,key:string):Promise<{identityId:string;subject:string}> {
 if(!row.auth_identity_id)throw new StaffApplicationError('IDENTITY_CHANGED');
 const subject=decryptValue(row.line_subject_encrypted,key);
 if(hashStaffLineUserId(subject,key)!==row.line_subject_hash)throw new StaffApplicationError('IDENTITY_CHANGED');
 const proof=await identity(c,{userId:row.auth_user_id,lineIdentity:{identityId:row.auth_identity_id,subject}},true);
 if(!proof)throw new StaffApplicationError('IDENTITY_CHANGED');return proof;
}
function digest(action:string,id:string|null,payload:unknown):string {
 return createHash('sha256').update(JSON.stringify([action,id,payload])).digest('hex');
}
async function replay(c:Client,actorId:string,requestId:string,action:string,id:string|null,hash:string):Promise<StaffApplicationItem|null> {
 const receipt=(await c.query('select * from private.staff_application_actions where actor_id=$1 and request_id=$2',[actorId,requestId])).rows[0];
 if(!receipt)return null;
 if(receipt.action!==action||(id!==null&&receipt.application_id!==id)||receipt.request_digest!==hash)throw new StaffApplicationError('CONFLICT');
 return receipt.response;
}
async function record(c:Client,actorId:string,requestId:string,action:string,id:string,hash:string):Promise<StaffApplicationItem> {
 const result=item(await rowById(c,id));
 await c.query(`insert into private.staff_application_actions(actor_id,request_id,application_id,action,request_digest,response)
  values($1,$2,$3,$4,$5,$6::jsonb)`,[actorId,requestId,id,action,hash,JSON.stringify(result)]);return result;
}
async function bindConfirmed(c:Client,staffId:string,proof:{identityId:string;subject:string},key:string):Promise<void> {
 const hash=hashStaffLineUserId(proof.subject,key);
 const rows=(await c.query('select staff_id,user_hash,active from private.staff_line_identities where staff_id=$1 or user_hash=$2 for update',[staffId,hash])).rows;
 if(rows.some(row=>row.staff_id!==staffId||row.user_hash!==hash))throw new StaffApplicationError('CONFLICT');
 // Inactive/unfollowed bindings require explicit challenge rebinding, not automatic revival.
 if(rows.length)return;
 await c.query(`insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,auth_identity_id)
  values($1,$2,$3,$4)`,[staffId,hash,encryptValue(proof.subject,key),proof.identityId]);
}

export async function getStaffApplicationContext(auth:VerifiedStaffAuth,options:StaffApplicationOptions={}):Promise<StaffApplicationContext> {
 return work(options,async c=>{
  const proof=await identity(c,auth),profile=(await c.query('select active,role from public.staff_profiles where id=$1 for share',[auth.userId])).rows[0];
  const row=(await c.query<ApplicationRow>(`${applicationSelect} where a.auth_user_id=$1`,[auth.userId])).rows[0];
  if(profile&&!profile.active&&row?.status!=='SUSPENDED')throw new StaffApplicationError('STAFF_ACCOUNT_INACTIVE');
  return {authenticated:true,lineLinked:!!proof,staffActive:profile?.active===true,loginAvailable:options.loginAvailable===true,
   canReview:profile?.active===true&&profile.role==='SUPER_ADMIN',application:row?item(row):null,departments:await departments(c)};
 });
}
export async function submitStaffApplication(auth:VerifiedStaffAuth,input:unknown,options:StaffApplicationOptions={}):Promise<StaffApplicationItem> {
 const parsed=submitApplicationSchema.safeParse(input);if(!parsed.success)throw new StaffApplicationError('INVALID_REQUEST');
 const command=parsed.data,key=keyFor(options),hash=digest('SUBMIT',null,command);
 return work(options,async c=>{
  await mutation(c);const proof=await identity(c,auth,true);if(!proof)throw new StaffApplicationError('FORBIDDEN');
  const profile=(await c.query('select active from public.staff_profiles where id=$1 for share',[auth.userId])).rows[0];
  if(profile)throw new StaffApplicationError(profile.active?'ALREADY_STAFF':'STAFF_ACCOUNT_INACTIVE');
  const old=await replay(c,auth.userId,command.requestId,'SUBMIT',null,hash);if(old)return old;
  if((await c.query('select id from private.staff_applications where auth_user_id=$1',[auth.userId])).rowCount)throw new StaffApplicationError('CONFLICT');
  await activeDepartment(c,command.departmentId);
  const row=(await c.query(`insert into private.staff_applications(auth_user_id,auth_identity_id,line_subject_hash,line_subject_encrypted,
   applicant_name,staff_code,requested_department_id) values($1,$2,$3,$4,$5,$6,$7) returning id`,
  [auth.userId,proof.identityId,hashStaffLineUserId(proof.subject,key),encryptValue(proof.subject,key),command.applicantName,command.staffCode,command.departmentId])).rows[0];
  return record(c,auth.userId,command.requestId,'SUBMIT',row.id,hash);
 });
}
export async function listStaffApplications(actorId:string,input:unknown,options:StaffApplicationOptions={}):Promise<StaffApplicationList> {
 const parsed=applicationQuerySchema.safeParse(input);if(!parsed.success)throw new StaffApplicationError('INVALID_REQUEST');
 const query=parsed.data;
 return work(options,async c=>{
  await reviewer(c,actorId);
  const where=query.status?' where a.status=$1':'',values=query.status?[query.status]:[];
  const total=Number((await c.query(`select count(*) from private.staff_applications a${where}`,values)).rows[0].count);
  const rows=(await c.query<ApplicationRow>(`${applicationSelect}${where} order by a.submitted_at desc,a.id limit $${values.length+1} offset $${values.length+2}`,
   [...values,query.pageSize,(query.page-1)*query.pageSize])).rows;
  const totalPages=Math.ceil(total/query.pageSize);
  return {items:rows.map(item),departments:await departments(c),pagination:{page:query.page,pageSize:query.pageSize,total,totalPages,
   hasNext:query.page<totalPages,hasPrevious:query.page>1}};
 });
}
export async function decideStaffApplication(actorId:string,id:string,input:unknown,options:StaffApplicationOptions={}):Promise<StaffApplicationItem> {
 const parsed=decideApplicationSchema.safeParse(input);if(!parsed.success||!uuid.safeParse(id).success)throw new StaffApplicationError('INVALID_REQUEST');
 const command=parsed.data,hash=digest(command.decision,id,command);
 return work(options,async c=>{
  await mutation(c);await reviewer(c,actorId);
  const old=await replay(c,actorId,command.requestId,command.decision,id,hash);if(old)return old;
  // Do not hold the application row while acquiring a new Auth identity FK:
  // Auth unlink may need this row for ON DELETE SET NULL. The catalog serializes
  // decisions; acquire the row and recheck revision AFTER binding's FK fence.
  let row=await rowById(c,id);
  // Identity revocation takes precedence over stale revision: there is no live applicant proof.
  const proof=command.decision==='APPROVE'?await applicationIdentity(c,row,keyFor(options)):null;
  if(row.status!=='PENDING'||row.revision!==command.revision)throw new StaffApplicationError('CONFLICT');
  if(command.decision==='APPROVE'){
   await activeDepartment(c,command.departmentId);await bindingMutation(c,row.auth_user_id);
   await applicationIdentity(c,row,keyFor(options));
   if((await c.query('select id from public.staff_profiles where id=$1 for update',[row.auth_user_id])).rowCount)throw new StaffApplicationError('CONFLICT');
   await c.query(`insert into public.staff_profiles(id,department_id,display_name,role,active,can_view_sensitive,can_view_restricted)
    values($1,$2,$3,'STAFF',true,false,false)`,[row.auth_user_id,command.departmentId,row.applicant_name]);
   if(options.sameProviderConfirmed===true&&proof)await bindConfirmed(c,row.auth_user_id,proof,keyFor(options));
  }
  row=await rowById(c,id,true);
  if(command.decision==='APPROVE')await applicationIdentity(c,row,keyFor(options));
  if(row.status!=='PENDING'||row.revision!==command.revision)throw new StaffApplicationError('CONFLICT');
  await c.query(`update private.staff_applications set status=$2,approved_department_id=$3,reviewed_by=$4,
   reviewed_at=clock_timestamp(),decision_reason=$5 where id=$1`,
  [id,command.decision==='APPROVE'?'APPROVED':'REJECTED',command.decision==='APPROVE'?command.departmentId:null,actorId,command.reason??null]);
  await c.query('insert into private.activities(actor_id,action,metadata) values($1,$2,$3::jsonb)',
   [actorId,`STAFF_APPLICATION_${command.decision}`,JSON.stringify({applicationId:id})]);
  return record(c,actorId,command.requestId,command.decision,id,hash);
 });
}
export async function suspendStaffApplication(actorId:string,id:string,input:unknown,options:StaffApplicationOptions={}):Promise<StaffApplicationItem> {
 const parsed=suspendApplicationSchema.safeParse(input);if(!parsed.success||!uuid.safeParse(id).success)throw new StaffApplicationError('INVALID_REQUEST');
 const command=parsed.data,hash=digest('SUSPEND',id,command);
 return work(options,async c=>{
  await mutation(c);await reviewer(c,actorId);
  const old=await replay(c,actorId,command.requestId,'SUSPEND',id,hash);if(old)return old;
  const row=await rowById(c,id,true);if(row.status!=='APPROVED'||row.revision!==command.revision)throw new StaffApplicationError('CONFLICT');
  await bindingMutation(c,row.auth_user_id);
  await c.query('update public.staff_profiles set active=false where id=$1',[row.auth_user_id]);
  await c.query('update private.staff_line_identities set active=false where staff_id=$1 and active',[row.auth_user_id]);
  await c.query('update private.staff_action_tokens set consumed_at=clock_timestamp() where staff_id=$1 and consumed_at is null',[row.auth_user_id]);
  await c.query('update private.staff_binding_challenges set invalidated_at=clock_timestamp() where staff_id=$1 and invalidated_at is null',[row.auth_user_id]);
  await c.query(`update private.staff_applications set status='SUSPENDED',reviewed_at=clock_timestamp(),reviewed_by=$2,decision_reason=$3 where id=$1`,[id,actorId,command.reason]);
  await c.query("insert into private.activities(actor_id,action,metadata) values($1,'STAFF_APPLICATION_SUSPEND',$2::jsonb)",[actorId,JSON.stringify({applicationId:id})]);
  return record(c,actorId,command.requestId,'SUSPEND',id,hash);
 });
}

/** Called after fresh PKCE authentication, never by a browser-supplied identity.
 * Refreshing a pending same-subject proof does not confer institutional access. */
export async function syncStaffLineLoginAuthority(auth:VerifiedStaffAuth,options:StaffApplicationOptions={}):Promise<void> {
 const key=keyFor(options);
 await work(options,async c=>{
  await mutation(c);const proof=await identity(c,auth,true);if(!proof)throw new StaffApplicationError('IDENTITY_CHANGED');
  const initial=(await c.query<ApplicationRow>(`${applicationSelect} where a.auth_user_id=$1`,[auth.userId])).rows[0];
  if(initial&&initial.line_subject_hash!==hashStaffLineUserId(proof.subject,key))throw new StaffApplicationError('IDENTITY_CHANGED');
  // Bind first so Auth deletion never waits for our application-row lock while
  // we wait for its identity FK. Recheck all authority after the FK is acquired.
  await bindingMutation(c,auth.userId);
  const profile=(await c.query('select active from public.staff_profiles where id=$1 for share',[auth.userId])).rows[0];
  if(profile&&!profile.active&&initial?.status!=='SUSPENDED')throw new StaffApplicationError('STAFF_ACCOUNT_INACTIVE');
  if(profile?.active&&options.sameProviderConfirmed===true)await bindConfirmed(c,auth.userId,proof,key);
  const current=await identity(c,auth,true);if(!current)throw new StaffApplicationError('IDENTITY_CHANGED');
  if(initial){
   const row=await rowById(c,initial.id,true);
   if(row.line_subject_hash!==hashStaffLineUserId(proof.subject,key))throw new StaffApplicationError('IDENTITY_CHANGED');
   if(row.status==='PENDING'&&row.auth_identity_id!==proof.identityId){
    await c.query('update private.staff_applications set auth_identity_id=$2 where id=$1',[row.id,proof.identityId]);
    await record(c,auth.userId,randomUUID(),'SYNC_IDENTITY',row.id,digest('SYNC_IDENTITY',row.id,{revision:row.revision}));
   }
  }
 });
}
