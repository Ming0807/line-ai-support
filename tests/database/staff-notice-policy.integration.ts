import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { transaction } from '../../lib/database/pool';
import { classifyEventKind, type DirectUserEvent } from '../../lib/line/events';
import { processInboxEvent, type InboxJob } from '../../lib/queue/process-inbox';
import { decryptValue, encryptValue, hashLineUserId, hashStaffLineUserId } from '../../lib/security/identity';
import { notifyTicketUserReply } from '../../lib/tickets/notifications';
import { hashOpaqueToken } from '../../lib/conversation/quick-reply';
import { applyTicketAction } from '../../lib/tickets/ticket-service';
import { runOutboxCycle } from '../../lib/queue/run-outbox';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'STAFF-NOTICE tests require an owned disposable database');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:5,application_name:`staff-notice-${randomUUID()}`});
const key=Buffer.alloc(32,97).toString('base64');
const staffIds:string[]=[],staffLineIds:string[]=[],ticketIds:string[]=[],inboxIds:string[]=[],outboxIds:string[]=[];
let departmentId='';
interface StaffFixture{id:string;lineUserId:string}
interface TicketFixture{id:string;ticketNo:string;sessionId:string;conversationId:string;studentLineUserId:string}

before(async()=>{
 if(!process.env.APP_BASE_URL)process.env.APP_BASE_URL='https://helpdesk.example.invalid';
 departmentId=(await pool.query('insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
  [`NOTICE_QA_${randomUUID().slice(0,8).toUpperCase().replace(/[0-9]/g,d=>String.fromCharCode(75+Number(d)))}`,'แผนกทดสอบ Staff notice','Staff notice fixture'])).rows[0].id;
});

after(async()=>{
 try{
  await pool.query("update private.webhook_inbox set status='DONE',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=any($1::uuid[])",[inboxIds]);
  await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp()) where id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[outboxIds]);
  await pool.query("update private.staff_line_identities set active=false where staff_id=any($1::uuid[])",[staffIds]);
  await pool.query("update public.staff_profiles set active=false where id=any($1::uuid[])",[staffIds]);
  await pool.query("update public.tickets set status='CANCELLED' where id=any($1::uuid[]) and status not in('CANCELLED','CLOSED','RESOLVED')",[ticketIds]);
  if(departmentId)await pool.query('update public.departments set active=false where id=$1',[departmentId]);
 }finally{await pool.end();}
});

afterEach(async()=>{
 if(!ticketIds.length&&!staffIds.length&&!outboxIds.length)return;
 await pool.query(`update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,
  completed_at=coalesce(completed_at,clock_timestamp()) where status in('PENDING','PROCESSING') and (
   id=any($1::uuid[]) or ticket_id=any($2::uuid[]) or recipient_staff_id=any($3::uuid[]) or
   line_session_id in(select line_session_id from public.tickets where id=any($2::uuid[])))`,[outboxIds,ticketIds,staffIds]);
});

async function seedStaff():Promise<StaffFixture>{
 const id=randomUUID(),lineUserId=`U${randomUUID().replaceAll('-','')}`;staffIds.push(id);staffLineIds.push(lineUserId);
 await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query(`insert into public.staff_profiles(id,display_name,department_id,role,active,can_view_sensitive,can_view_restricted)
  values($1,$2,$3,'STAFF',true,false,false)`,[id,`Staff notice ${id.slice(0,8)}`,departmentId]);
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [id,hashStaffLineUserId(lineUserId,key),encryptValue(lineUserId,key)]);
 return{id,lineUserId};
}
async function seedTicket():Promise<TicketFixture>{
 const sessionId=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`NOTICE_${randomUUID()}`])).rows[0].id as string;
 const studentId=`U${randomUUID().replaceAll('-','')}`;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[sessionId,hashLineUserId(studentId,key),encryptValue(studentId,key)]);
 const conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode) values($1,'TICKET','HUMAN') returning id",[sessionId])).rows[0].id as string;
 const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
  values($1,$2,$3,$4,'HUMAN','WAITING_STAFF','GENERAL',null) returning id,ticket_no`,[sessionId,conversationId,departmentId,`NOTICE_PRIVATE_${randomUUID()}`])).rows[0] as {id:string;ticket_no:string};
 ticketIds.push(ticket.id);await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
 return{id:ticket.id,ticketNo:ticket.ticket_no,sessionId,conversationId,studentLineUserId:studentId};
}
async function addInbox(staff:StaffFixture,event:DirectUserEvent):Promise<InboxJob>{
 const lease=randomUUID(),row=(await pool.query(`insert into private.webhook_inbox(channel,event_id,event_kind,user_hash,payload_encrypted,status,lease_token,lease_until,attempts)
  values('STAFF',$1,$2,$3,$4,'PROCESSING',$5,clock_timestamp()+interval '1 minute',1) returning *`,
  [randomUUID(),classifyEventKind(event),hashLineUserId(staff.lineUserId,key),encryptValue(JSON.stringify(event),key),lease])).rows[0];
 inboxIds.push(row.id as string);return{id:row.id,channel:'STAFF',lease_token:lease,payload_encrypted:row.payload_encrypted,user_hash:row.user_hash,attempts:row.attempts};
}
async function processStaff(staff:StaffFixture,event:DirectUserEvent):Promise<void>{
 const job=await addInbox(staff,event);await transaction(c=>processInboxEvent(c,job,key),pool);
}
function payload(encrypted:string):{messages:Array<{text?:string;quickReply?:{items:Array<{action:{type:string;label:string;uri?:string}}>} }>;replyToken?:string}{return JSON.parse(decryptValue(encrypted,key));}
async function dispatchOwnedTargets(ids:string[],maxCycles=6):Promise<Array<{to?:string;messages?:unknown[]}>>{
 const requests:Array<{to?:string;messages?:unknown[]}>=[];
 for(let cycle=0;cycle<maxCycles;cycle++){
  const rows=(await pool.query('select status from private.message_outbox where id=any($1::uuid[])',[ids])).rows;
  if(rows.length===ids.length&&rows.every(row=>row.status==='SENT'||row.status==='SUPPRESSED'||row.status==='DEAD'||row.status==='UNKNOWN'))break;
  await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fixture-student',STAFF:'fixture-staff'},fetchImpl:async(_url,init)=>{
   requests.push(JSON.parse(String(init?.body??'{}')) as {to?:string;messages?:unknown[]});return new Response(null,{status:200});
  }});
 }
 return requests;
}

 test('real Staff ingress keeps only dashboard guidance, exact scoped notices, and UNFOLLOW revocation',async()=>{
 const owner=await seedStaff(),other=await seedStaff(),ticket=await seedTicket();
 const oldOpen:DirectUserEvent={type:'postback',source:{type:'user',userId:owner.lineUserId},postback:{data:`yru:staff:chat:${'a'.repeat(43)}`}};
 const oldReply:DirectUserEvent={type:'message',source:{type:'user',userId:owner.lineUserId},message:{type:'text',id:`line-${randomUUID()}`,text:'REPLY YRU-00000001 PRIVATE_STAFF_TEXT'}};
 await processStaff(owner,oldOpen);await processStaff(owner,oldReply);
 const inbox=(await pool.query('select content_encrypted from private.staff_inbound_messages where user_hash=$1 order by created_at',[hashLineUserId(owner.lineUserId,key)])).rows;
 assert.equal(inbox.length,1,'typed Staff content is retained privately for existing audit/intake');
 assert.equal(decryptValue(inbox[0].content_encrypted,key),'REPLY YRU-00000001 PRIVATE_STAFF_TEXT');
 const staffOutbox=(await pool.query("select id,payload_encrypted from private.message_outbox where channel='STAFF' and recipient_staff_id=$1 order by outbox_seq",[owner.id])).rows;
 outboxIds.push(...staffOutbox.map(r=>r.id as string));assert.equal(staffOutbox.length,2,'legacy OPEN and typed REPLY receive safe guidance only');
 for(const row of staffOutbox){const text=JSON.stringify(payload(row.payload_encrypted));assert.match(text,/\/inbox/);assert.doesNotMatch(text,/PRIVATE_STAFF_TEXT|NOTICE_PRIVATE_|YRU-00000001/);}
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where channel='STUDENT' and ticket_id=$1",[ticket.id])).rows[0].n,0,'Staff OA ingress never creates Student delivery');

 await pool.query('update public.tickets set assigned_staff_id=$2,status=\'WAITING_USER\' where id=$1',[ticket.id,owner.id]);
 await pool.query("update public.conversations set status='WAITING' where id=$1",[ticket.conversationId]);
 await transaction(async c=>notifyTicketUserReply(c,{id:ticket.id,ticket_no:ticket.ticketNo,department_id:departmentId,sensitive_level:'GENERAL',assigned_staff_id:owner.id},`user-${randomUUID()}`,key),pool);
 const exact=(await pool.query("select id,payload_encrypted from private.message_outbox where channel='STAFF' and recipient_staff_id=$1 and kind='NOTIFICATION' and ticket_id=$2 order by outbox_seq desc limit 1",[owner.id,ticket.id])).rows[0];
 assert.ok(exact,'the current assigned Staff owner receives the ticket notice');outboxIds.push(exact.id);
 const exactText=JSON.stringify(payload(exact.payload_encrypted));assert.ok(exactText.includes(`/inbox?ticket=${ticket.id}`));
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where channel='STAFF' and recipient_staff_id=$1 and ticket_id=$2",[other.id,ticket.id])).rows[0].n,0,'a non-owner receives no exact-case link');
 await processStaff(owner,{type:'unfollow',source:{type:'user',userId:owner.lineUserId}});
 assert.equal((await pool.query('select active from private.staff_line_identities where staff_id=$1',[owner.id])).rows[0].active,false,'UNFOLLOW still revokes the existing technical binding');
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where channel='STAFF' and recipient_staff_id=$1 and kind in('CONTROL','CHAT')",[owner.id])).rows[0].n,2,'UNFOLLOW sends no follow-up');
});

test('two real Staff identities cannot both claim the same notice; one CAS owner wins',async()=>{
 const first=await seedStaff(),second=await seedStaff(),ticket=await seedTicket();
 const tokens=[{staff:first,token:randomBytesToken()},{staff:second,token:randomBytesToken()}];
 for(const item of tokens){await pool.query(`insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at)
  values($1,$2,$3,'ACCEPT',0,clock_timestamp()+interval '10 minutes')`,[hashOpaqueToken(item.token,key,'staff-command'),item.staff.id,ticket.id]);}
 const results=await Promise.all(tokens.map(async({staff,token})=>{
  const event:DirectUserEvent={type:'postback',source:{type:'user',userId:staff.lineUserId},postback:{data:`yru:staff:accept:${token}`}};
  const job=await addInbox(staff,event);await transaction(c=>processInboxEvent(c,job,key),pool);return job.id;
 }));
 const state=(await pool.query('select status,assigned_staff_id,revision from public.tickets where id=$1',[ticket.id])).rows[0];
 assert.equal(state.status,'STAFF_HANDLING');assert.ok([first.id,second.id].includes(state.assigned_staff_id));assert.equal(state.revision,1);
 assert.equal((await pool.query("select count(*)::int n from public.ticket_history where ticket_id=$1 and action='ACCEPTED'",[ticket.id])).rows[0].n,1,'only one ACCEPTED state transition commits');
 assert.equal((await pool.query("select count(*)::int n from private.webhook_inbox where id=any($1::uuid[]) and status='DONE'",[results])).rows[0].n,2,'both actual signed ingress events finish');
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where channel='STUDENT' and ticket_id=$1",[ticket.id])).rows[0].n,0,'claim creates no Student reply');
 const receipts=(await pool.query(`select id,idempotency_key,recipient_staff_id,ticket_id,kind,payload_encrypted
  from private.message_outbox where idempotency_key=any($1::text[]) order by recipient_staff_id`,[results.map(id=>`staff-chat:${id}`)])).rows;
 assert.equal(receipts.length,2,'the winner and loser both receive Staff-only Dashboard guidance');outboxIds.push(...receipts.map(r=>r.id as string));
 const winner=receipts.find(r=>r.recipient_staff_id===state.assigned_staff_id),loser=receipts.find(r=>r.recipient_staff_id!==state.assigned_staff_id);
 assert.ok(winner&&loser);assert.equal(winner.kind,'NOTIFICATION');assert.equal(winner.ticket_id,ticket.id);
 assert.equal(loser.kind,'CONTROL');assert.equal(loser.ticket_id,null,'the losing Staff member gets no case-specific destination');
 const caseUri=new URL(`/inbox?ticket=${ticket.id}`,process.env.APP_BASE_URL??'https://helpdesk.example.invalid').toString();
 const winnerPayload=payload(winner.payload_encrypted);assert.ok(JSON.stringify(winnerPayload).includes(caseUri));
 const winnerUri=winnerPayload.messages[0]?.quickReply?.items.find(item=>item.action.type==='uri')?.action.uri;
 assert.deepEqual({kind:winner.kind,ticketId:winner.ticket_id,uri:winnerUri},{kind:'NOTIFICATION',ticketId:ticket.id,uri:caseUri},'safe receipt metadata binds the Dashboard URI to the current owner’s exact ticket');
 assert.doesNotMatch(JSON.stringify(payload(loser.payload_encrypted)),new RegExp(ticket.id),'the loser receives only generic Dashboard guidance');
 const requests=await dispatchOwnedTargets(receipts.map(r=>r.id as string));
 const targetRequests=requests.filter(r=>[first.lineUserId,second.lineUserId].includes(r.to??''));
 assert.equal(targetRequests.length,2,'both Staff notice jobs dispatch over bounded cycles');
 assert.deepEqual(targetRequests.map(r=>r.to).sort(),[first.lineUserId,second.lineUserId].sort(),'the notice destination remains the bound technical identity');
 assert.ok(targetRequests.some(r=>JSON.stringify(r.messages).includes(caseUri)),'the exact owner case link survives actual dispatch');
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where id=any($1::uuid[]) and status='SENT'",[receipts.map(r=>r.id)])).rows[0].n,2,'neither scoped receipt is treated as retired CHAT');
});

test('dispatch suppresses queued legacy LINE manual content but preserves Dashboard-owned Student content',async()=>{
 const owner=await seedStaff(),lineTicket=await seedTicket(),dashboardTicket=await seedTicket();
 for(const ticket of [lineTicket,dashboardTicket]){
  await pool.query("update public.tickets set assigned_staff_id=$2,status='STAFF_HANDLING' where id=$1",[ticket.id,owner.id]);
  await pool.query("update public.conversations set status='ACTIVE' where id=$1",[ticket.conversationId]);
 }
 const bindingHash=hashStaffLineUserId(owner.lineUserId,key),selectionId=randomUUID();
 const epoch=(await pool.query('select staff_line_epoch from public.tickets where id=$1',[lineTicket.id])).rows[0].staff_line_epoch;
 const selectionEvent=await addInbox(owner,{type:'message',source:{type:'user',userId:owner.lineUserId},message:{type:'text',id:`selection-${randomUUID()}`,text:'fixture selection source'}});
 const sourceEventSeq=(await pool.query('select event_seq from private.webhook_inbox where id=$1',[selectionEvent.id])).rows[0].event_seq;
 await pool.query(`insert into private.staff_line_case_context(staff_id,ticket_id,assignment_epoch,binding_hash,selection_id,source_event_seq,expires_at,viewed_through_seq)
  values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '10 minutes',0)`,[owner.id,lineTicket.id,epoch,bindingHash,selectionId,sourceEventSeq]);
 await transaction(c=>applyTicketAction(c,owner.id,lineTicket.id,'STAFF_REPLY',
  {revision:0,requestId:randomUUID(),text:'Legacy LINE reply must not dispatch'},key,{bindingHash,selectionId}),pool);
 await transaction(c=>applyTicketAction(c,owner.id,dashboardTicket.id,'STAFF_REPLY',
  {revision:0,requestId:randomUUID(),text:'Dashboard response remains deliverable'},key),pool);
 const pending=(await pool.query("select id,ticket_id from private.message_outbox where ticket_id=any($1::uuid[]) and channel='STUDENT' and kind='STAFF' order by id",[[lineTicket.id,dashboardTicket.id]])).rows;
 outboxIds.push(...pending.map(r=>r.id as string));
 assert.equal(pending.length,2,'both real service calls created guarded Student outbox records');
 const requests=await dispatchOwnedTargets(pending.map(r=>r.id as string));
 const states=(await pool.query('select ticket_id,status from private.message_outbox where id=any($1::uuid[])',[pending.map(r=>r.id)])).rows;
 assert.equal(states.find(r=>r.ticket_id===lineTicket.id)?.status,'SUPPRESSED','legacy LINE-origin manual content is fenced before HTTP');
 assert.equal(states.find(r=>r.ticket_id===dashboardTicket.id)?.status,'SENT','the Dashboard-origin reply passes its current owner/assignment guard');
 const targetRequests=requests.filter(r=>[lineTicket.studentLineUserId,dashboardTicket.studentLineUserId].includes(r.to??''));
 assert.equal(targetRequests.length,1,'only the Dashboard-owned Student message reaches LINE dispatch');
 assert.equal(targetRequests[0]?.to,dashboardTicket.studentLineUserId,'the authorized Dashboard reply keeps its exact Student recipient');
 assert.doesNotMatch(JSON.stringify(targetRequests[0]?.messages),/Legacy LINE reply must not dispatch/);
});

function randomBytesToken():string{return randomBytes(32).toString('base64url');}
