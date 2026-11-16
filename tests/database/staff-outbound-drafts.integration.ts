import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {beginStaffOutboundUpload,finishStaffOutboundUpload,releaseStaffOutboundLease} from '../../lib/chat/staff-outbound-drafts';
import {uploadStaffOutboundAttachment} from '../../lib/chat/staff-outbound-upload';
import {openStaffOutbound,staffOutboundObjectPath,type StaffOutboundRef} from '../../lib/chat/staff-outbound-binary';
import {createHash} from 'node:crypto';
import {reconcileStaffOutboundUploads} from '../../lib/chat/staff-outbound-recovery';
import {confirmStaffOutboundAttachment} from '../../lib/chat/staff-outbound-confirm';
import {decryptValue} from '../../lib/security/identity';
import {findStudentViewableAttachment,revokeStaffOutboundDelivery,STUDENT_MEDIA_ACCESS_DAYS} from '../../lib/chat/student-media-access';
import {readThread} from '../../lib/chat/service';

// scripts/database/run-owned-test.ts provides YRU_OWNED_DATABASE; the older dedicated runner name stays accepted.
const database=process.env.YRU_OWNED_DATABASE??process.env.YRU_OUTBOUND_DRAFTS_DATABASE;
assert.match(database??'',/^yru_(?:owned|outbound_drafts)_[a-f0-9]{12}$/u,'tests require the fixed isolated owned database');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:8,connectionTimeoutMillis:2_000,idleTimeoutMillis:1_000});
const key=randomBytes(32).toString('base64');
const checksum='a'.repeat(64);

type Fixture={staffId:string;assignedStaffId:string;supervisorId:string;ticketId:string;conversationId:string;sessionId:string;userId:string;userHash:string;departmentId:string;revision:number};
type BeginInput=Parameters<typeof beginStaffOutboundUpload>[1];

async function makeStaff(departmentId:string,role:'STAFF'|'SUPERVISOR'|'ADMIN'|'SUPER_ADMIN'='STAFF',active=true):Promise<string>{
 const id=randomUUID();
 await pool.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.invalid`]);
 await pool.query('insert into public.staff_profiles(id,department_id,display_name,role,active) values($1,$2,$3,$4,$5)',[id,departmentId,'Outbound draft fixture',role,active]);
 return id;
}

async function makeCase(options:{actorActive?:boolean;actorDepartment?:'IT'|'LIBRARY';actorRole?:'STAFF'|'SUPERVISOR'|'ADMIN'|'SUPER_ADMIN';assignActor?:boolean;assignedActive?:boolean;assignedDepartment?:'IT'|'LIBRARY';ticketDepartment?:'IT'|'LIBRARY';ticketMode?:'HUMAN'|'AI';ticketStatus?:'NEW'|'AI_HANDLING'|'WAITING_STAFF'|'STAFF_HANDLING'|'WAITING_USER'|'RESOLVED'|'CLOSED'|'CANCELLED';conversationStatus?:'ACTIVE'|'WAITING'|'RESOLVED'|'CLOSED';sessionActive?:boolean}={}):Promise<Fixture>{
 const ticketDepartment=options.ticketDepartment??'IT';
 const departmentId=(await pool.query('select id from public.departments where code=$1 and active',[ticketDepartment])).rows[0]?.id as string|undefined;
 const actorDepartmentId=(await pool.query('select id from public.departments where code=$1 and active',[options.actorDepartment??ticketDepartment])).rows[0]?.id as string|undefined;
 const assignedDepartmentId=(await pool.query('select id from public.departments where code=$1 and active',[options.assignedDepartment??ticketDepartment])).rows[0]?.id as string|undefined;
 assert.ok(departmentId&&actorDepartmentId&&assignedDepartmentId,'seeded IT and LIBRARY departments exist');
 const actorRole=options.actorRole??'STAFF';
 const staffId=await makeStaff(actorDepartmentId,actorRole,options.actorActive??true);
 const assignedStaffId=(options.assignActor??actorRole!=='SUPERVISOR')?staffId:await makeStaff(assignedDepartmentId,'STAFF',options.assignedActive??true);
 const supervisorId=await makeStaff(departmentId,'SUPERVISOR',true);
 const userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 const sessionId=(await pool.query('insert into public.line_sessions(anonymous_code,active) values($1,$2) returning id',[`Outbound ${randomUUID()}`,options.sessionActive??true])).rows[0].id as string;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[sessionId,userHash,encryptValue(userId,key)]);
 const mode=options.ticketMode??'HUMAN';
 const conversationId=(await pool.query(`insert into public.conversations(line_session_id,conversation_type,mode,status,topic)
  values($1,'TICKET',$2,$3,'outbound draft fixture') returning id`,[sessionId,mode,options.conversationStatus??'ACTIVE'])).rows[0].id as string;
 const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,assigned_staff_id,problem_summary,mode,status)
  values($1,$2,$3,$4,'outbound draft fixture',$5,$6) returning id,revision`,[sessionId,conversationId,departmentId,assignedStaffId,mode,options.ticketStatus??'WAITING_USER'])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
 return {staffId,assignedStaffId,supervisorId,ticketId:ticket.id as string,conversationId,sessionId,userId,userHash,departmentId,revision:ticket.revision as number};
}

function request(f:Fixture,overrides:Partial<BeginInput>={}):BeginInput{
 return {staffId:f.staffId,ticketId:f.ticketId,requestId:randomUUID(),revision:f.revision,name:'guide.pdf',mimeType:'application/pdf',byteLength:128,checksum,...overrides} as BeginInput;
}

async function denied(f:Fixture,overrides:Partial<BeginInput>={}):Promise<void>{
 await assert.rejects(beginStaffOutboundUpload(pool,request(f,overrides),key),'unauthorized or stale Staff draft reservation must fail closed');
}

async function countDrafts(ticketId:string):Promise<number>{
 return (await pool.query('select count(*)::int as count from private.staff_outbound_attachments where ticket_id=$1',[ticketId])).rows[0].count as number;
}

async function draftRow(attachmentId:string):Promise<Record<string,unknown>>{
 return (await pool.query('select * from private.staff_outbound_attachments where id=$1',[attachmentId])).rows[0] as Record<string,unknown>;
}

async function insertDerivedDraft(baseId:string,options:{status:'UPLOADING'|'READY'|'FAILED';attempts:number;leaseToken:string|null;leaseUntil:string|null;objectId:string;readyAt:string|null;failureCode:string|null}):Promise<void>{
 const base=await draftRow(baseId);
 await pool.query(`insert into private.staff_outbound_attachments(id,staff_id,ticket_id,conversation_id,line_session_id,recipient_hash,
  ticket_revision,assignment_epoch,request_id,request_hash,name_encrypted,mime_type,byte_length,checksum,status,failure_code,
  attempts,lease_token,lease_until,object_id,ready_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,[
  randomUUID(),base.staff_id,base.ticket_id,base.conversation_id,base.line_session_id,base.recipient_hash,base.ticket_revision,base.assignment_epoch,
  randomUUID(),base.request_hash,base.name_encrypted,base.mime_type,base.byte_length,base.checksum,options.status,options.failureCode,
  options.attempts,options.leaseToken,options.leaseUntil,options.objectId,options.readyAt,
 ]);
}

async function expireLease(attachmentId:string):Promise<void>{
 await pool.query(`update private.staff_outbound_attachments set lease_until=clock_timestamp()-interval '1 second' where id=$1`,[attachmentId]);
}

after(async()=>pool.end());

test('private outbound draft schema has RLS and no browser grants or policies',async()=>{
 const relation=(await pool.query(`select to_regclass('private.staff_outbound_attachments')::text as table_name`)).rows[0];
 assert.ok(relation?.table_name,'additive private.staff_outbound_attachments table exists');
 const privileges=(await pool.query(`select c.relrowsecurity,
  has_table_privilege('anon','private.staff_outbound_attachments','SELECT') as anon_read,
  has_table_privilege('authenticated','private.staff_outbound_attachments','SELECT') as auth_read,
  has_table_privilege('anon','private.staff_outbound_attachments','INSERT,UPDATE,DELETE') as anon_write,
  has_table_privilege('authenticated','private.staff_outbound_attachments','INSERT,UPDATE,DELETE') as auth_write,
  has_table_privilege('service_role','private.staff_outbound_attachments','SELECT,INSERT,UPDATE') as service_access
  from pg_class c where c.oid='private.staff_outbound_attachments'::regclass`)).rows[0];
 assert.equal(privileges.relrowsecurity,true);
 assert.equal(privileges.anon_read,false);assert.equal(privileges.auth_read,false);
 assert.equal(privileges.anon_write,false);assert.equal(privileges.auth_write,false);assert.equal(privileges.service_access,true);
 assert.equal((await pool.query(`select count(*)::int as count from pg_policies where schemaname='private' and tablename='staff_outbound_attachments'`)).rows[0].count,0);
 const client=await pool.connect();
 try{await client.query('begin');await client.query('set local role authenticated');await assert.rejects(client.query('select * from private.staff_outbound_attachments'),/permission denied/u);}
 finally{await client.query('rollback').catch(()=>undefined);client.release();}
});

test('database guards reject forbidden initial states, partial terminal leases, and lease extension',async()=>{
 const f=await makeCase(),reservation=await beginStaffOutboundUpload(pool,request(f),key);
 assert.equal(reservation.status,'UPLOADING');if(reservation.status!=='UPLOADING')return;
 const farFuture=new Date(Date.now()+60*60*1000).toISOString(),future=()=>randomUUID();
 await assert.rejects(insertDerivedDraft(reservation.attachmentId,{status:'READY',attempts:1,leaseToken:null,leaseUntil:null,objectId:future(),readyAt:new Date().toISOString(),failureCode:null}),/STAFF_OUTBOUND_INITIAL_STATE_INVALID/u);
 await assert.rejects(insertDerivedDraft(reservation.attachmentId,{status:'FAILED',attempts:1,leaseToken:null,leaseUntil:null,objectId:future(),readyAt:null,failureCode:'AUTHORITY_CHANGED'}),/STAFF_OUTBOUND_INITIAL_STATE_INVALID/u);
 const longLeaseToken=future();
 await assert.rejects(insertDerivedDraft(reservation.attachmentId,{status:'UPLOADING',attempts:1,leaseToken:longLeaseToken,leaseUntil:farFuture,objectId:longLeaseToken,readyAt:null,failureCode:null}),/STAFF_OUTBOUND_INITIAL_STATE_INVALID/u);
 await assert.rejects(pool.query("update private.staff_outbound_attachments set status='FAILED',failure_code='AUTHORITY_CHANGED',lease_token=null where id=$1",[reservation.attachmentId]),/check constraint/u,
  'a terminal row must clear both lease fields, never only the token');
 await assert.rejects(pool.query('update private.staff_outbound_attachments set lease_until=clock_timestamp()+interval \'1 hour\' where id=$1',[reservation.attachmentId]),/STAFF_OUTBOUND_ATTEMPT_INVALID/u,
  'an existing live attempt cannot extend its lease');
});

test('assigned Staff can reserve and finish a private draft for the current active LINE recipient',async()=>{
 const f=await makeCase(),input=request(f),first=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(first.status,'UPLOADING');if(first.status!=='UPLOADING')return;
 assert.ok(first.attachmentId&&first.leaseToken&&first.objectId);
 assert.equal(await countDrafts(f.ticketId),1);
 const row=(await pool.query('select * from private.staff_outbound_attachments where id=$1',[first.attachmentId])).rows[0];
 assert.ok(row);assert.equal(JSON.stringify(row).includes(f.userId),false,'the persisted draft does not expose the LINE subject');
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:first.attachmentId,leaseToken:first.leaseToken},key),true,
  'finish represents the orchestrator confirming its private Storage upload');
 assert.deepEqual(await beginStaffOutboundUpload(pool,input,key),{status:'READY',attachmentId:first.attachmentId},'identical completed request remains an idempotent draft');
});

test('live duplicate lease conflicts and changed immutable digest fields conflict',async()=>{
 for(const change of [
  {name:'renamed.pdf'},{mimeType:'image/png'},{byteLength:129},{checksum:'b'.repeat(64)},{revision:1},
 ] as const){
  const f=await makeCase(),input=request(f),first=await beginStaffOutboundUpload(pool,input,key);
  assert.equal(first.status,'UPLOADING');
  await assert.rejects(beginStaffOutboundUpload(pool,input,key),'a live upload lease cannot be shared by another caller');
  await assert.rejects(beginStaffOutboundUpload(pool,{...input,...change},key),'same request UUID with changed immutable digest must conflict');
  assert.equal(await countDrafts(f.ticketId),1);
 }
});

test('concurrent duplicate calls produce one lease winner and conflicts for the rest',async()=>{
 const f=await makeCase(),input=request(f),results=await Promise.allSettled(Array.from({length:6},()=>beginStaffOutboundUpload(pool,input,key)));
 const uploads=results.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof beginStaffOutboundUpload>>>=>result.status==='fulfilled');
 const conflicts=results.filter(result=>result.status==='rejected');
 assert.equal(uploads.length,1,'only one concurrent caller owns the upload lease');
 assert.equal(conflicts.length,5,'the other duplicate callers receive a conflict');
 assert.equal(uploads[0].value.status,'UPLOADING');
 if(uploads[0].value.status!=='UPLOADING')return;
 assert.ok(uploads[0].value.attachmentId&&uploads[0].value.leaseToken&&uploads[0].value.objectId);
 assert.equal(await countDrafts(f.ticketId),1);
});

test('expired lease is reclaimed with a new object and stale finish loses',async()=>{
 const f=await makeCase(),input=request(f),first=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(first.status,'UPLOADING');if(first.status!=='UPLOADING')return;
 await expireLease(first.attachmentId);
 const second=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(second.status,'UPLOADING');if(second.status!=='UPLOADING')return;
 assert.notEqual(second.leaseToken,first.leaseToken);assert.notEqual(second.objectId,first.objectId);
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:first.attachmentId,leaseToken:first.leaseToken},key),false);
 const live=await draftRow(second.attachmentId);
 assert.equal(live.status,'UPLOADING');assert.equal(live.lease_token,second.leaseToken);assert.equal(live.object_id,second.objectId,
  'an expired worker cannot fail or replace the reclaimed attempt');
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:second.attachmentId,leaseToken:second.leaseToken},key),true);
});

test('third expired lease becomes terminal FAILED and cannot finish',async()=>{
 const f=await makeCase(),input=request(f);let current=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(current.status,'UPLOADING');if(current.status!=='UPLOADING')return;
 for(let expired=1;expired<=3;expired++){
  await expireLease(current.attachmentId);
  const next=await beginStaffOutboundUpload(pool,input,key);
  if(expired<3){assert.equal(next.status,'UPLOADING');if(next.status!=='UPLOADING')return;assert.notEqual(next.objectId,current.objectId);current=next;}
  else{assert.deepEqual(next,{status:'FAILED',attachmentId:current.attachmentId});const failed=await draftRow(current.attachmentId);assert.equal(failed.failure_code,'ATTEMPT_LIMIT');
   assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:current.attachmentId,leaseToken:current.leaseToken},key),false);}
 }
});

test('scoped same-department supervisor can reserve for another assigned Staff member',async()=>{
 const f=await makeCase({actorRole:'SUPERVISOR'}),input=request(f,{staffId:f.supervisorId});
 const result=await beginStaffOutboundUpload(pool,input,key);assert.equal(result.status,'UPLOADING');
});

test('inactive, cross-department and unassigned non-supervisor actors cannot reserve',async()=>{
 const inactive=await makeCase({actorActive:false});await denied(inactive);
 const outside=await makeCase({actorDepartment:'LIBRARY',assignActor:true});await denied(outside);
 const unassigned=await makeCase({assignActor:false});await denied(unassigned);
 const outsideSupervisor=await makeCase({actorDepartment:'LIBRARY',actorRole:'SUPERVISOR'});await denied(outsideSupervisor);
});

test('reservation requires the expected revision, replyable HUMAN ticket, active conversation and active recipient',async()=>{
 const stale=await makeCase();await denied(stale,{revision:stale.revision+1});
 const ai=await makeCase({ticketMode:'AI'});await denied(ai);
 const closed=await makeCase({ticketStatus:'CLOSED'});await denied(closed);
 const inactiveConversation=await makeCase({conversationStatus:'CLOSED'});await denied(inactiveConversation);
 const inactiveRecipient=await makeCase({sessionActive:false});await denied(inactiveRecipient);
});

test('finish fails closed when authority or the current recipient changes during upload',async()=>{
 const scenarios:[(f:Fixture)=>Promise<void>][]=[
  [async f=>{const replacement=await makeStaff(f.departmentId);await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1',[f.ticketId,replacement]);}],
  [async f=>{const library=(await pool.query("select id from public.departments where code='LIBRARY'")).rows[0].id;await pool.query('update public.tickets set department_id=$2 where id=$1',[f.ticketId,library]);}],
  [async f=>{await pool.query('update public.tickets set revision=revision+1 where id=$1',[f.ticketId]);}],
  [async f=>{await pool.query('update public.staff_profiles set active=false where id=$1',[f.staffId]);}],
  [async f=>{const other=`U${randomUUID().replaceAll('-','')}`;await pool.query('update private.line_identities set user_hash=$2,user_id_encrypted=$3 where line_session_id=$1',[f.sessionId,hashLineUserId(other,key),encryptValue(other,key)]);}],
  [async f=>{await pool.query("update public.tickets set status='CLOSED' where id=$1",[f.ticketId]);}],
 ];
 for(const [mutate] of scenarios){
  const f=await makeCase(),reservation=await beginStaffOutboundUpload(pool,request(f),key);
  assert.equal(reservation.status,'UPLOADING');if(reservation.status!=='UPLOADING')continue;
  await mutate(f);
  assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:reservation.attachmentId,leaseToken:reservation.leaseToken},key),false);
  const failed=await draftRow(reservation.attachmentId);assert.equal(failed.status,'FAILED');assert.equal(failed.failure_code,'AUTHORITY_CHANGED');
 }
});

test('changed recipient cannot retarget the original request to a second LINE subject',async()=>{
 const f=await makeCase(),input=request(f),reservation=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(reservation.status,'UPLOADING');if(reservation.status!=='UPLOADING')return;
 const other=`U${randomUUID().replaceAll('-','')}`;
 await pool.query('update private.line_identities set user_hash=$2,user_id_encrypted=$3 where line_session_id=$1',[f.sessionId,hashLineUserId(other,key),encryptValue(other,key)]);
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:reservation.attachmentId,leaseToken:reservation.leaseToken},key),false);
 await assert.rejects(beginStaffOutboundUpload(pool,input,key),'the same request receipt must not be rebound to a new recipient hash');
 assert.equal(await countDrafts(f.ticketId),1,'recipient change leaves one conflict-bound request instead of silently creating a retargeted draft');
 const failed=await draftRow(reservation.attachmentId);assert.equal(failed.status,'FAILED');assert.equal(failed.failure_code,'AUTHORITY_CHANGED');
});

test('retrying a draft with its old revision conflicts after the case revision changes',async()=>{
 const f=await makeCase(),input=request(f),reservation=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(reservation.status,'UPLOADING');
 await pool.query('update public.tickets set revision=revision+1 where id=$1',[f.ticketId]);
 await assert.rejects(beginStaffOutboundUpload(pool,input,key),'a stale request revision cannot replay against changed case state');
});

// CHAT-MEDIA-02D: a crash between reservation and finalization must not leave a draft UPLOADING forever.
async function ageLease(attachmentId:string,seconds:number):Promise<void>{
 await pool.query(`update private.staff_outbound_attachments set lease_until=clock_timestamp()-make_interval(secs=>$2) where id=$1`,[attachmentId,seconds]);
}

test('reconciliation retires crashed uploads after the grace period and keeps the private object reference',async()=>{
 const f=await makeCase(),input=request(f),crashed=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(crashed.status,'UPLOADING');if(crashed.status!=='UPLOADING')return;
 const recent=await beginStaffOutboundUpload(pool,request(f),key),live=await beginStaffOutboundUpload(pool,request(f),key);
 assert.equal(recent.status,'UPLOADING');assert.equal(live.status,'UPLOADING');if(recent.status!=='UPLOADING'||live.status!=='UPLOADING')return;
 await ageLease(crashed.attachmentId,601);await ageLease(recent.attachmentId,30);
 const result=await reconcileStaffOutboundUploads(pool,{graceSeconds:600});
 assert.ok(result.interrupted.includes(crashed.attachmentId),'a lease expired beyond the grace period is retired');
 assert.equal(result.interrupted.includes(recent.attachmentId),false,'a recently expired lease stays retryable by its own request');
 assert.equal(result.interrupted.includes(live.attachmentId),false,'a live upload is never touched');
 const row=await draftRow(crashed.attachmentId);
 assert.equal(row.status,'FAILED');assert.equal(row.failure_code,'UPLOAD_INTERRUPTED');
 assert.equal(row.lease_token,null);assert.equal(row.lease_until,null);
 assert.equal(row.object_id,crashed.objectId,'the attempt object reference is retained for audit; nothing is deleted');
 assert.equal(row.attempts,1);
 assert.equal((await draftRow(recent.attachmentId)).status,'UPLOADING');assert.equal((await draftRow(live.attachmentId)).status,'UPLOADING');
 assert.deepEqual(await beginStaffOutboundUpload(pool,input,key),{status:'FAILED',attachmentId:crashed.attachmentId},
  'replaying the crashed request reports the honest terminal state instead of a new lease');
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:crashed.attachmentId,leaseToken:crashed.leaseToken},key),false,
  'the crashed worker cannot finalize after reconciliation');
 const again=await reconcileStaffOutboundUploads(pool,{graceSeconds:600});
 assert.equal(again.interrupted.includes(crashed.attachmentId),false,'reconciliation is idempotent');
});

test('reconciliation marks an exhausted third attempt as ATTEMPT_LIMIT and leaves terminal drafts unchanged',async()=>{
 const f=await makeCase(),input=request(f);let current=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(current.status,'UPLOADING');if(current.status!=='UPLOADING')return;
 for(let attempt=1;attempt<3;attempt++){await expireLease(current.attachmentId);current=await beginStaffOutboundUpload(pool,input,key);
  assert.equal(current.status,'UPLOADING');if(current.status!=='UPLOADING')return;}
 await ageLease(current.attachmentId,601);
 const ready=await beginStaffOutboundUpload(pool,request(f),key);
 assert.equal(ready.status,'UPLOADING');if(ready.status!=='UPLOADING')return;
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:ready.attachmentId,leaseToken:ready.leaseToken},key),true);
 const before=await draftRow(ready.attachmentId);
 const result=await reconcileStaffOutboundUploads(pool,{graceSeconds:600});
 assert.ok(result.attemptLimit.includes(current.attachmentId));assert.equal(result.interrupted.includes(current.attachmentId),false);
 const exhausted=await draftRow(current.attachmentId);
 assert.equal(exhausted.status,'FAILED');assert.equal(exhausted.failure_code,'ATTEMPT_LIMIT');assert.equal(exhausted.attempts,3);
 assert.deepEqual(await draftRow(ready.attachmentId),before,'READY drafts are never rewritten by reconciliation');
});

test('database guard rejects UPLOAD_INTERRUPTED while the lease is still live and bounds the sweep input',async()=>{
 const f=await makeCase(),live=await beginStaffOutboundUpload(pool,request(f),key);
 assert.equal(live.status,'UPLOADING');if(live.status!=='UPLOADING')return;
 await assert.rejects(pool.query(`update private.staff_outbound_attachments set status='FAILED',failure_code='UPLOAD_INTERRUPTED',lease_token=null,lease_until=null where id=$1`,[live.attachmentId]),
  /STAFF_OUTBOUND_ATTEMPT_INVALID/u,'only an expired lease can be reported as interrupted');
 for(const options of [{graceSeconds:-1},{graceSeconds:59},{graceSeconds:1.5},{limit:0},{limit:1001}])
  await assert.rejects(reconcileStaffOutboundUploads(pool,options),/INVALID_RECONCILE_OPTIONS/u);
});

// CHAT-MEDIA-02E: lease release after a Storage failure and the full upload orchestration on real PostgreSQL.
test('an uploader can expire only its own live lease so the same request reclaims a new attempt at once',async()=>{
 const f=await makeCase(),input=request(f),first=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(first.status,'UPLOADING');if(first.status!=='UPLOADING')return;
 assert.equal(await releaseStaffOutboundLease(pool,{attachmentId:first.attachmentId,leaseToken:randomUUID()}),false,'a foreign token changes nothing');
 assert.equal((await draftRow(first.attachmentId)).lease_token,first.leaseToken);
 assert.equal(await releaseStaffOutboundLease(pool,{attachmentId:first.attachmentId,leaseToken:first.leaseToken}),true);
 assert.equal(await releaseStaffOutboundLease(pool,{attachmentId:first.attachmentId,leaseToken:first.leaseToken}),false,'release is not repeatable');
 const second=await beginStaffOutboundUpload(pool,input,key);
 assert.equal(second.status,'UPLOADING');if(second.status!=='UPLOADING')return;
 assert.notEqual(second.objectId,first.objectId);assert.equal((await draftRow(second.attachmentId)).attempts,2);
 assert.equal(await releaseStaffOutboundLease(pool,{attachmentId:second.attachmentId,leaseToken:first.leaseToken}),false,'the old attempt cannot expire the new lease');
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:second.attachmentId,leaseToken:second.leaseToken},key),true);
 assert.equal(await releaseStaffOutboundLease(pool,{attachmentId:second.attachmentId,leaseToken:second.leaseToken}),false,'a READY draft has no lease to release');
});

test('the upload orchestrator stores the sealed object outside SQL, retries after a Storage failure and finalizes READY',async()=>{
 const f=await makeCase(),bytes=new TextEncoder().encode('%PDF-1.7\nowned orchestrator fixture\n%%EOF\n');
 const digest=createHash('sha256').update(bytes).digest('hex'),stored=new Map<string,Uint8Array>();let failNext=true;
 const deps={key,verifyPdf:async()=>undefined,verifyImage:async()=>undefined,
  begin:(value:Parameters<typeof beginStaffOutboundUpload>[1])=>beginStaffOutboundUpload(pool,value,key),
  finish:(value:Parameters<typeof finishStaffOutboundUpload>[1])=>finishStaffOutboundUpload(pool,value,key),
  release:(value:{attachmentId:string;leaseToken:string})=>releaseStaffOutboundLease(pool,value),
  storage:{async put(ref:StaffOutboundRef,envelope:Uint8Array){if(failNext){failNext=false;throw new Error('storage down');}stored.set(staffOutboundObjectPath(ref),envelope);},
   async get(ref:StaffOutboundRef){const value=stored.get(staffOutboundObjectPath(ref));if(!value)throw new Error('missing');return value;}}};
 const upload={staffId:f.staffId,ticketId:f.ticketId,requestId:randomUUID(),revision:f.revision,name:'คู่มือ.pdf',contentType:'application/pdf',declaredChecksum:digest,bytes};
 await assert.rejects(uploadStaffOutboundAttachment(deps,upload),/UNAVAILABLE/u,'a Storage failure is reported, never READY');
 const result=await uploadStaffOutboundAttachment(deps,upload);
 assert.equal(result.status,'READY');
 const row=await draftRow(result.attachmentId);
 assert.equal(row.status,'READY');assert.equal(row.attempts,2,'the released lease was reclaimed immediately by the same request');
 const ref:StaffOutboundRef={attachmentId:result.attachmentId,objectId:row.object_id as string,ticketId:f.ticketId,mimeType:'application/pdf',byteLength:bytes.length,checksum:digest};
 assert.deepEqual([...stored.keys()],[staffOutboundObjectPath(ref)],'only the winning attempt object exists');
 assert.deepEqual(Array.from(openStaffOutbound(stored.get(staffOutboundObjectPath(ref))!,ref,key)),Array.from(bytes));
 assert.deepEqual(await uploadStaffOutboundAttachment(deps,upload),{status:'READY',attachmentId:result.attachmentId},'replay is idempotent and stores nothing new');
 assert.equal(stored.size,1);
});

// CHAT-MEDIA-02F: Staff confirms the exact recipient; one LIFF text goes through the existing STAFF_REPLY outbox.
const link={liffId:'1234567890-AbCdEfGh'};
async function readyDraft(f:Fixture,overrides:Partial<BeginInput>={}):Promise<string>{
 const reservation=await beginStaffOutboundUpload(pool,request(f,overrides),key);
 assert.equal(reservation.status,'UPLOADING');if(reservation.status!=='UPLOADING')throw new Error('fixture');
 assert.equal(await finishStaffOutboundUpload(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId:reservation.attachmentId,leaseToken:reservation.leaseToken},key),true);
 return reservation.attachmentId;
}
async function ticketState(ticketId:string):Promise<{revision:number;ticketNo:string;status:string}>{
 const row=(await pool.query('select revision,ticket_no,status from public.tickets where id=$1',[ticketId])).rows[0];
 return {revision:row.revision as number,ticketNo:row.ticket_no as string,status:row.status as string};
}
type ConfirmInput=Parameters<typeof confirmStaffOutboundAttachment>[1];
async function confirmInput(f:Fixture,attachmentId:string,overrides:Partial<ConfirmInput>={}):Promise<ConfirmInput>{
 const state=await ticketState(f.ticketId);
 return {staffId:f.staffId,ticketId:f.ticketId,attachmentId,requestId:randomUUID(),revision:state.revision,ticketNo:state.ticketNo,...overrides};
}
async function sideEffects(ticketId:string):Promise<{messages:number;outbox:number;deliveries:number}>{
 const row=(await pool.query(`select (select count(*)::int from public.messages where ticket_id=$1 and sender_type='STAFF') as messages,
  (select count(*)::int from private.message_outbox where ticket_id=$1) as outbox,
  (select count(*)::int from private.staff_outbound_deliveries where ticket_id=$1) as deliveries`,[ticketId])).rows[0];
 return row as {messages:number;outbox:number;deliveries:number};
}

test('confirm sends one LIFF text through the existing STAFF_REPLY outbox, guards and history in one transaction',async()=>{
 const f=await makeCase(),attachmentId=await readyDraft(f),before=await ticketState(f.ticketId),input=await confirmInput(f,attachmentId);
 const result=await confirmStaffOutboundAttachment(pool,input,key,link);
 assert.equal(result.attachmentId,attachmentId);assert.equal(result.status,'WAITING_USER');assert.equal(result.revision,before.revision+1);
 const message=(await pool.query('select * from public.messages where id=$1',[result.messageId])).rows[0];
 assert.equal(message.sender_type,'STAFF');assert.equal(message.sender_staff_id,f.staffId);assert.equal(message.ticket_id,f.ticketId);
 const url=`https://liff.line.me/${link.liffId}?attachment=${attachmentId}`;
 assert.ok(String(message.content).includes(url));assert.doesNotMatch(String(message.content),/storage|supabase|\.yruc|guide\.pdf/iu);
 const outbox=(await pool.query('select * from private.message_outbox where idempotency_key=$1',[`staff-reply:${f.ticketId}:${result.messageId}`])).rows[0];
 assert.ok(outbox);assert.equal(outbox.kind,'STAFF');assert.equal(outbox.channel,'STUDENT');assert.equal(outbox.line_session_id,f.sessionId);assert.equal(outbox.status,'PENDING');
 const payload=JSON.parse(decryptValue(outbox.payload_encrypted,key)) as {messages:{type:string;text:string}[]};
 assert.deepEqual(payload.messages.map(item=>item.type),['text','text']);assert.equal(payload.messages[0].text,before.ticketNo);assert.ok(payload.messages[1].text.includes(url));
 assert.equal((await pool.query('select count(*)::int as count from private.staff_chat_delivery_guards where outbox_id=$1 and staff_id=$2',[outbox.id,f.staffId])).rows[0].count,1);
 assert.equal((await pool.query('select count(*)::int as count from private.staff_chat_delivery_cases where outbox_id=$1 and ticket_id=$2',[outbox.id,f.ticketId])).rows[0].count,1);
 const delivery=(await pool.query('select * from private.staff_outbound_deliveries where attachment_id=$1',[attachmentId])).rows[0];
 assert.equal(delivery.message_id,result.messageId);assert.equal(delivery.outbox_id,outbox.id);assert.equal(delivery.staff_id,f.staffId);assert.equal(delivery.confirmed_revision,before.revision);
 assert.equal((await pool.query("select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='STAFF_REPLIED'",[f.ticketId])).rows[0].count,1);
 assert.equal((await draftRow(attachmentId)).status,'READY','the immutable draft is not rewritten by confirmation');
 assert.equal(JSON.stringify(delivery).includes(f.userId),false);
});

test('confirm replay returns the original result; a second confirmation of the same file conflicts',async()=>{
 const f=await makeCase(),attachmentId=await readyDraft(f),input=await confirmInput(f,attachmentId);
 const first=await confirmStaffOutboundAttachment(pool,input,key,link);
 assert.deepEqual(await confirmStaffOutboundAttachment(pool,input,key,link),first,'identical replay after the revision advanced is idempotent');
 await assert.rejects(confirmStaffOutboundAttachment(pool,{...input,ticketNo:'YRU-99999999'},key,link),/CONFLICT/u,'same request with changed payload conflicts');
 await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId),key,link),/CONFLICT/u,'one file is confirmed once');
 assert.deepEqual(await sideEffects(f.ticketId),{messages:1,outbox:1,deliveries:1});
});

test('concurrent confirmations of one draft produce exactly one message',async()=>{
 const f=await makeCase(),attachmentId=await readyDraft(f);
 const inputs=await Promise.all(Array.from({length:4},()=>confirmInput(f,attachmentId)));
 const settled=await Promise.allSettled(inputs.map(input=>confirmStaffOutboundAttachment(pool,input,key,link)));
 assert.equal(settled.filter(item=>item.status==='fulfilled').length,1);
 assert.deepEqual(await sideEffects(f.ticketId),{messages:1,outbox:1,deliveries:1});
});

test('confirm refuses non-READY drafts, another Staff member and another case',async()=>{
 const f=await makeCase(),reservation=await beginStaffOutboundUpload(pool,request(f),key);
 assert.equal(reservation.status,'UPLOADING');if(reservation.status!=='UPLOADING')return;
 await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(f,reservation.attachmentId),key,link),/CONFLICT/u,'an UPLOADING draft cannot be sent');
 const ready=await readyDraft(f);
 await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(f,ready,{staffId:f.supervisorId}),key,link),/NOT_FOUND/u,'only the uploader confirms its own draft');
 const other=await makeCase();
 await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(other,ready),key,link),/NOT_FOUND/u,'a draft never moves to another case');
 assert.deepEqual(await sideEffects(f.ticketId),{messages:0,outbox:0,deliveries:0});
 assert.deepEqual(await sideEffects(other.ticketId),{messages:0,outbox:0,deliveries:0});
});

test('confirm refuses a changed recipient or assignment even with a fresh revision, and needs current state',async()=>{
 const scenarios:[string,(f:Fixture)=>Promise<void>,RegExp][]=[
  ['recipient',async f=>{const other=`U${randomUUID().replaceAll('-','')}`;await pool.query('update private.line_identities set user_hash=$2,user_id_encrypted=$3 where line_session_id=$1',[f.sessionId,hashLineUserId(other,key),encryptValue(other,key)]);},/CONFLICT/u],
  ['assignment epoch',async f=>{const replacement=await makeStaff(f.departmentId);await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1',[f.ticketId,replacement]);await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1',[f.ticketId,f.staffId]);},/CONFLICT/u],
  ['resolved case',async f=>{await pool.query("update public.tickets set status='RESOLVED' where id=$1",[f.ticketId]);},/INVALID_ACTION/u],
  ['inactive staff',async f=>{await pool.query('update public.staff_profiles set active=false where id=$1',[f.staffId]);},/NOT_FOUND|INVALID_ACTION|CONFLICT/u],
 ];
 for(const [name,mutate,expected] of scenarios){
  const f=await makeCase(),attachmentId=await readyDraft(f);await mutate(f);
  await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId),key,link),expected,name);
  assert.deepEqual(await sideEffects(f.ticketId),{messages:0,outbox:0,deliveries:0},name);
 }
 const f=await makeCase(),attachmentId=await readyDraft(f);
 const stale=await confirmInput(f,attachmentId);await pool.query('update public.tickets set revision=revision+1 where id=$1',[f.ticketId]);
 await assert.rejects(confirmStaffOutboundAttachment(pool,stale,key,link),/CONFLICT/u,'stale revision');
 await assert.rejects(confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId,{ticketNo:'YRU-99999999'}),key,link),/CONFLICT/u,'wrong ticket number');
 await pool.query('update public.tickets set revision=revision+1 where id=$1',[f.ticketId]);
 const result=await confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId),key,link);
 assert.equal(result.attachmentId,attachmentId,'an intervening revision is re-reviewed explicitly, not forcing a new upload');
});

test('delivery records are private, immutable and accept only a READY draft of the same Staff and case',async()=>{
 const privileges=(await pool.query(`select c.relrowsecurity,
  has_table_privilege('anon','private.staff_outbound_deliveries','SELECT,INSERT,UPDATE,DELETE') as anon_any,
  has_table_privilege('authenticated','private.staff_outbound_deliveries','SELECT,INSERT,UPDATE,DELETE') as auth_any,
  has_table_privilege('service_role','private.staff_outbound_deliveries','SELECT,INSERT') as service_access
  from pg_class c where c.oid='private.staff_outbound_deliveries'::regclass`)).rows[0];
 assert.equal(privileges.relrowsecurity,true);assert.equal(privileges.anon_any,false);assert.equal(privileges.auth_any,false);assert.equal(privileges.service_access,true);
 assert.equal((await pool.query(`select count(*)::int as count from pg_policies where schemaname='private' and tablename='staff_outbound_deliveries'`)).rows[0].count,0);
 const f=await makeCase(),attachmentId=await readyDraft(f),result=await confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId),key,link);
 await assert.rejects(pool.query('update private.staff_outbound_deliveries set confirmed_revision=0 where attachment_id=$1',[attachmentId]),/STAFF_OUTBOUND_DELIVERY_IMMUTABLE/u);
 await assert.rejects(pool.query('delete from private.staff_outbound_deliveries where attachment_id=$1',[attachmentId]),/STAFF_OUTBOUND_DELIVERY_IMMUTABLE/u);
 const row=(await pool.query('select * from private.staff_outbound_deliveries where attachment_id=$1',[attachmentId])).rows[0];
 const g=await makeCase(),uploading=await beginStaffOutboundUpload(pool,request(g),key);
 assert.equal(uploading.status,'UPLOADING');
 const gMessage=(await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,sender_staff_id,content) values($1,$2,'STAFF',$3,'x') returning id`,[g.conversationId,g.ticketId,g.staffId])).rows[0].id;
 await assert.rejects(pool.query(`insert into private.staff_outbound_deliveries(attachment_id,staff_id,ticket_id,request_id,request_hash,message_id,outbox_id,confirmed_revision,result)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[uploading.attachmentId,g.staffId,g.ticketId,randomUUID(),'b'.repeat(64),gMessage,row.outbox_id,0,{}]),/STAFF_OUTBOUND_DELIVERY_INVALID/u,
  'an UPLOADING draft and a foreign outbox are rejected by the database guard');
 assert.ok(result.messageId);
});

// CHAT-MEDIA-02G: the Student viewer serves bytes only for a SENT delivery to the current verified recipient (DEC-202).
async function confirmedDelivery(f:Fixture):Promise<{attachmentId:string;outboxId:string}>{
 const attachmentId=await readyDraft(f),result=await confirmStaffOutboundAttachment(pool,await confirmInput(f,attachmentId),key,link);
 const outboxId=(await pool.query('select outbox_id from private.staff_outbound_deliveries where attachment_id=$1',[attachmentId])).rows[0].outbox_id as string;
 assert.ok(result.messageId);return {attachmentId,outboxId};
}
async function setOutbox(outboxId:string,status:'PENDING'|'PROCESSING'|'SENT'|'DEAD'|'SUPPRESSED',completedAgo='0 seconds'):Promise<void>{
 await pool.query(`update private.message_outbox set status=$2,completed_at=case when $2 in('SENT','DEAD','SUPPRESSED') then clock_timestamp()-$3::interval else null end,
  lease_token=case when $2='PROCESSING' then gen_random_uuid() else null end,lease_until=case when $2='PROCESSING' then clock_timestamp()+interval '60 seconds' else null end
  where id=$1`,[outboxId,status,completedAgo]);
}
const viewable=(attachmentId:string,userHash:string)=>findStudentViewableAttachment(pool,attachmentId,userHash);

test('viewer access exists only after the bound outbox row is SENT, with the immutable draft reference',async()=>{
 const f=await makeCase(),{attachmentId,outboxId}=await confirmedDelivery(f);
 for(const status of ['PENDING','PROCESSING','DEAD','SUPPRESSED'] as const){
  await setOutbox(outboxId,status);assert.equal(await viewable(attachmentId,f.userHash),null,status);
 }
 await setOutbox(outboxId,'SENT');
 const draft=await draftRow(attachmentId),ref=await viewable(attachmentId,f.userHash);
 assert.deepEqual(ref,{attachmentId,objectId:draft.object_id,ticketId:f.ticketId,mimeType:'application/pdf',byteLength:128,checksum});
 const unconfirmed=await readyDraft(await makeCase());
 assert.equal(await viewable(unconfirmed,f.userHash),null,'a READY draft that was never confirmed is not viewable');
 assert.equal(await viewable(randomUUID(),f.userHash),null);
});

test('viewer access needs the current recipient identity of an active LINE session',async()=>{
 const f=await makeCase(),{attachmentId,outboxId}=await confirmedDelivery(f);await setOutbox(outboxId,'SENT');
 const other=await makeCase();
 assert.equal(await viewable(attachmentId,other.userHash),null,'another Student account cannot open the file');
 assert.equal(await viewable(attachmentId,'d'.repeat(64)),null);
 await pool.query('update public.line_sessions set active=false where id=$1',[f.sessionId]);
 assert.equal(await viewable(attachmentId,f.userHash),null,'unfollow/block suspends access');
 await pool.query('update public.line_sessions set active=true where id=$1',[f.sessionId]);
 assert.ok(await viewable(attachmentId,f.userHash),'follow again restores access');
 const replacement=`U${randomUUID().replaceAll('-','')}`;
 await pool.query('update private.line_identities set user_hash=$2,user_id_encrypted=$3 where line_session_id=$1',[f.sessionId,hashLineUserId(replacement,key),encryptValue(replacement,key)]);
 assert.equal(await viewable(attachmentId,f.userHash),null,'the original hash alone is not enough once the session identity changes');
 assert.equal(await viewable(attachmentId,hashLineUserId(replacement,key)),null,'a new identity is not the confirmed recipient');
});

test('a delivered file stays viewable after the case closes, within the access window only',async()=>{
 const f=await makeCase(),{attachmentId,outboxId}=await confirmedDelivery(f);await setOutbox(outboxId,'SENT');
 await pool.query("update public.tickets set status='RESOLVED' where id=$1",[f.ticketId]);
 assert.ok(await viewable(attachmentId,f.userHash),'closing the case does not withdraw a delivered file');
 assert.equal(STUDENT_MEDIA_ACCESS_DAYS,30);
 await setOutbox(outboxId,'SENT',`${STUDENT_MEDIA_ACCESS_DAYS} days -1 hour`);
 assert.ok(await viewable(attachmentId,f.userHash),'inside the window');
 await setOutbox(outboxId,'SENT',`${STUDENT_MEDIA_ACCESS_DAYS} days 1 minute`);
 assert.equal(await viewable(attachmentId,f.userHash),null,'after the window');
 assert.equal((await draftRow(attachmentId)).status,'READY','expiry never rewrites or deletes the draft');
});

test('revocation is append-only, scoped to sender/assignee/scoped supervisor and immediately ends access',async()=>{
 const privileges=(await pool.query(`select c.relrowsecurity,
  has_table_privilege('anon','private.staff_outbound_revocations','SELECT,INSERT,UPDATE,DELETE') as anon_any,
  has_table_privilege('authenticated','private.staff_outbound_revocations','SELECT,INSERT,UPDATE,DELETE') as auth_any,
  has_table_privilege('service_role','private.staff_outbound_revocations','SELECT,INSERT') as service_access
  from pg_class c where c.oid='private.staff_outbound_revocations'::regclass`)).rows[0];
 assert.equal(privileges.relrowsecurity,true);assert.equal(privileges.anon_any,false);assert.equal(privileges.auth_any,false);assert.equal(privileges.service_access,true);
 const f=await makeCase(),{attachmentId,outboxId}=await confirmedDelivery(f);await setOutbox(outboxId,'SENT');
 const outsider=await makeStaff((await pool.query("select id from public.departments where code='LIBRARY'")).rows[0].id as string,'SUPERVISOR');
 const colleague=await makeStaff(f.departmentId,'STAFF');
 for(const staffId of [outsider,colleague])
  await assert.rejects(revokeStaffOutboundDelivery(pool,{staffId,ticketId:f.ticketId,attachmentId}),/NOT_FOUND/u,'no revocation without scope and relation');
 await assert.rejects(revokeStaffOutboundDelivery(pool,{staffId:f.staffId,ticketId:(await makeCase()).ticketId,attachmentId}),/NOT_FOUND/u,'wrong case');
 assert.ok(await viewable(attachmentId,f.userHash));
 assert.deepEqual(await revokeStaffOutboundDelivery(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId}),{attachmentId,revoked:true});
 assert.equal(await viewable(attachmentId,f.userHash),null,'revoked immediately');
 assert.deepEqual(await revokeStaffOutboundDelivery(pool,{staffId:f.supervisorId,ticketId:f.ticketId,attachmentId}),{attachmentId,revoked:true},'idempotent for a scoped supervisor');
 const row=(await pool.query('select * from private.staff_outbound_revocations where attachment_id=$1',[attachmentId])).rows;
 assert.equal(row.length,1);assert.equal(row[0].revoked_by,f.staffId);
 await assert.rejects(pool.query('update private.staff_outbound_revocations set revoked_by=$2 where attachment_id=$1',[attachmentId,f.supervisorId]),/STAFF_OUTBOUND_REVOCATION_IMMUTABLE/u);
 await assert.rejects(pool.query('delete from private.staff_outbound_revocations where attachment_id=$1',[attachmentId]),/STAFF_OUTBOUND_REVOCATION_IMMUTABLE/u);
 assert.equal((await draftRow(attachmentId)).status,'READY','revocation never deletes or rewrites the private object reference');
 const unconfirmed=await makeCase(),draft=await readyDraft(unconfirmed);
 await assert.rejects(revokeStaffOutboundDelivery(pool,{staffId:unconfirmed.staffId,ticketId:unconfirmed.ticketId,attachmentId:draft}),/NOT_FOUND/u,'only a confirmed delivery can be revoked');
 const g=await makeCase(),second=await confirmedDelivery(g);await setOutbox(second.outboxId,'SENT');
 await pool.query("update public.tickets set status='RESOLVED' where id=$1",[g.ticketId]);
 assert.deepEqual(await revokeStaffOutboundDelivery(pool,{staffId:g.staffId,ticketId:g.ticketId,attachmentId:second.attachmentId}),{attachmentId:second.attachmentId,revoked:true},
  'a closed case can still be revoked by the sender');
});

// CHAT-MEDIA-02H (DEC-205): the Staff thread shows a confirmed file with derived Student access, never the LIFF link parsed from text.
const outboundEnv={CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED:'true',CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED:'true',LINE_STUDENT_MEDIA_VIEWER_ENABLED:'true',
 LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED:'true',LINE_STUDENT_LOGIN_CHANNEL_ID:link.liffId.split('-')[0],LINE_STUDENT_LIFF_ID:link.liffId,ENCRYPTION_KEY:key};
async function threadFile(staffId:string,f:Fixture,env:Record<string,string|undefined>=outboundEnv){
 const thread=await readThread(staffId,f.ticketId,{},{pool,key,env});
 return {thread,file:thread.messages.find(message=>message.outboundAttachment)?.outboundAttachment??null};
}

test('thread API exposes outboundFiles and the confirmed file with derived studentAccess and canRevoke',async()=>{
 const f=await makeCase(),{attachmentId,outboxId}=await confirmedDelivery(f);
 const {thread,file}=await threadFile(f.staffId,f);
 assert.deepEqual(thread.outboundFiles,{enabled:true});
 assert.deepEqual(file,{id:attachmentId,name:'guide.pdf',mimeType:'application/pdf',size:128,studentAccess:'WAITING_DELIVERY',canRevoke:true});
 const owner=thread.messages.find(message=>message.outboundAttachment);
 assert.equal(owner?.senderType,'STAFF');
 assert.equal(thread.messages.filter(message=>message.outboundAttachment).length,1,'only the confirming STAFF message carries the file');
 assert.equal((await threadFile(f.staffId,f,{...outboundEnv,CHAT_STAFF_OUTBOUND_UPLOAD_ENABLED:'false'})).thread.outboundFiles?.enabled,false);
 assert.equal((await threadFile(f.staffId,f,{...outboundEnv,CHAT_STAFF_OUTBOUND_CONFIRM_ENABLED:'false'})).file?.canRevoke,false,'revoke route hidden');
 await setOutbox(outboxId,'SENT');assert.equal((await threadFile(f.staffId,f)).file?.studentAccess,'AVAILABLE');
 await setOutbox(outboxId,'SENT',`${STUDENT_MEDIA_ACCESS_DAYS} days 1 minute`);assert.equal((await threadFile(f.staffId,f)).file?.studentAccess,'EXPIRED');
 for(const status of ['DEAD','SUPPRESSED'] as const){await setOutbox(outboxId,status);assert.equal((await threadFile(f.staffId,f)).file?.studentAccess,'NOT_DELIVERED',status);}
 await setOutbox(outboxId,'SENT');
 const colleague=await makeStaff(f.departmentId,'STAFF');
 assert.equal((await threadFile(colleague,f)).file?.canRevoke,false,'a scoped colleague sees the file but cannot revoke');
 assert.equal((await threadFile(f.supervisorId,f)).file?.canRevoke,true,'a scoped supervisor can revoke');
 await revokeStaffOutboundDelivery(pool,{staffId:f.staffId,ticketId:f.ticketId,attachmentId});
 assert.deepEqual((await threadFile(f.supervisorId,f)).file,{id:attachmentId,name:'guide.pdf',mimeType:'application/pdf',size:128,studentAccess:'REVOKED',canRevoke:false});
 const plain=await makeCase(),ready=await readyDraft(plain);
 const unconfirmed=await threadFile(plain.staffId,plain);
 assert.equal(unconfirmed.file,null,'an unconfirmed READY draft is not listed');assert.ok(ready);
});
