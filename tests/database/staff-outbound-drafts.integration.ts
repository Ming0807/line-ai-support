import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {beginStaffOutboundUpload,finishStaffOutboundUpload} from '../../lib/chat/staff-outbound-drafts';

const database=process.env.YRU_OUTBOUND_DRAFTS_DATABASE;
assert.match(database??'',/^yru_outbound_drafts_[a-f0-9]{12}$/u,'tests require the fixed isolated owned database');
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
