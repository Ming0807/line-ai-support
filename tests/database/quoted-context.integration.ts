import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {loadCandidates} from '../../lib/conversation/context-resolver';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import type {RouteCandidate} from '../../lib/conversation/router';
import {enqueueOutbound} from '../../lib/queue/outbox';
import type {InboxJob} from '../../lib/queue/process-inbox';
import {transaction} from '../../lib/database/pool';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {recordLineDeliveryReceipt,resolveQuotedContext} from '../../lib/conversation/quoted-context';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'PRIVATE_OWNED_DATABASE_REQUIRED');
const key=Buffer.alloc(32,70).toString('base64');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'quoted-context-owned-qa'});

after(async()=>{await pool.end();});

interface Fixture {
 userId:string;
 session:string;
 conversation:string;
 ticket:string;
 routedUserMessageId:string;
}

async function fixture():Promise<Fixture>{
 const userId=`U${randomUUID().replaceAll('-','')}`;
 const hash=hashLineUserId(userId,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',
  [`QUOTE_${randomUUID().replaceAll('-','')}`])).rows[0].id as string;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [session,hash,encryptValue(userId,key)]);
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,topic) values($1,'HUMAN','TICKET','Quote fixture') returning id",[session])).rows[0].id as string;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,(select id from public.departments where code='REGISTRAR'),'Quote fixture','HUMAN','STAFF_HANDLING') returning id",[session,conversation])).rows[0].id as string;
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket]);
 const routedUserMessageId=`1000000000000000001${randomUUID().replaceAll('-','')}`;
 await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,line_message_id,metadata)
  values($1,$2,'USER','TEXT','A routed question',$3,'{"routing_status":"ROUTED"}'::jsonb)`,[conversation,ticket,routedUserMessageId]);
 return {userId,session,conversation,ticket,routedUserMessageId};
}

async function addHumanContext(session:string,topic:string):Promise<{conversation:string;ticket:string}>{
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,topic) values($1,'HUMAN','TICKET',$2) returning id",[session,topic])).rows[0].id as string;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,(select id from public.departments where code='REGISTRAR'),$3,'HUMAN','STAFF_HANDLING') returning id",[session,conversation,topic])).rows[0].id as string;
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket]);
 return {conversation,ticket};
}

async function candidates(session:string):Promise<RouteCandidate[]>{return loadCandidates(pool,session);}

async function addStaffActor(f:Fixture):Promise<string>{
 const staffId=randomUUID();
 const department=(await pool.query('select department_id from public.tickets where id=$1',[f.ticket])).rows[0].department_id as string;
 await pool.query('insert into auth.users(id) values($1)',[staffId]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name,active) values($1,$2,'STAFF','Quoted context fixture',true)",[staffId,department]);
 return staffId;
}

async function addStaffMessage(conversation:string,ticket:string,staffId:string,text:string):Promise<string>{
 return (await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,sender_staff_id,message_type,content)
  values($1,$2,'STAFF',$3,'TEXT',$4) returning id`,[conversation,ticket,staffId,text])).rows[0].id as string;
}

type DirectOutboxInput={idempotencyKey:string;kind:'STAFF'|'AI';session:string;conversation:string;ticket?:string;revision?:number;text:string};
async function enqueueDirectOutbox(input:DirectOutboxInput,status:'SENT'|'PENDING'='SENT'):Promise<string>{
 const id=await transaction(c=>enqueueOutbound(c,{idempotencyKey:input.idempotencyKey,channel:'STUDENT',kind:input.kind,
  lineSessionId:input.session,conversationId:input.conversation,...(input.ticket?{ticketId:input.ticket}:{}),
  ...(input.revision===undefined?{}:{conversationRevision:input.revision}),messages:[{type:'text',text:input.text}]},key),pool);
 assert.ok(id,'OUTBOX_CREATED');
 if(status==='SENT')await pool.query("update private.message_outbox set status='SENT',completed_at=clock_timestamp() where id=$1",[id]);
 return id;
}

async function addStaffReply(f:Fixture,staffId:string,text='Delivered staff text'):Promise<{messageId:string;outboxId:string}>{
 const messageId=await addStaffMessage(f.conversation,f.ticket,staffId,text);
 const outboxId=await enqueueDirectOutbox({idempotencyKey:`staff-reply:${f.ticket}:${messageId}`,kind:'STAFF',session:f.session,
  conversation:f.conversation,ticket:f.ticket,text});
 return {messageId,outboxId};
}

async function recordReceipt(outboxId:string,ids:readonly string[]):Promise<void>{
 await transaction(c=>recordLineDeliveryReceipt(c,outboxId,ids,key),pool);
}

async function addProcessingQuotedEvent(f:Fixture,quotedMessageId:string):Promise<InboxJob>{
 const event={type:'message',source:{type:'user',userId:f.userId},message:{type:'text',id:`event-${randomUUID()}`,text:'A follow-up question',quotedMessageId}};
 return (await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts)
  values('STUDENT',$1,$2,$3,'MESSAGE','PROCESSING',$4,clock_timestamp()+interval '30 seconds',1) returning *`,
 [randomUUID(),hashLineUserId(f.userId,key),encryptValue(JSON.stringify(event),key),randomUUID()])).rows[0] as InboxJob;
}

test('a routed same-session USER quote reaches classification only as its candidate and sender role',async()=>{
 const f=await fixture(),job=await addProcessingQuotedEvent(f,f.routedUserMessageId);
 let seen:unknown;
 await classifyStudentInboxContext(pool,job,key,async input=>{
  seen=input.quotedContext;
  return {decision:'ASK',candidateCode:null,confidence:.99};
 });
 assert.deepEqual(seen,{candidateCode:'C1',senderType:'USER'});
 assert.equal(JSON.stringify(seen).includes(f.routedUserMessageId),false,'LINE_MESSAGE_ID_STAYS_OUT_OF_CLASSIFIER_HINT');
});

test('only exact own SENT STAFF and AI receipts resolve, and foreign or unsent context is denied',async()=>{
 const f=await fixture(),staffId=await addStaffActor(f),staff=await addStaffReply(f,staffId);
 await recordReceipt(staff.outboxId,['700001']);
 const staffCandidates=await candidates(f.session);
 assert.deepEqual(await resolveQuotedContext(pool,f.session,'700001',staffCandidates,key),{
  messageId:staff.messageId,conversationId:f.conversation,ticketId:f.ticket,senderType:'STAFF',outboxId:staff.outboxId,
 });

 const aiConversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,topic) values($1,'AI','GENERAL','AI quote fixture') returning id,revision",[f.session])).rows[0];
 const aiJobId=randomUUID();
 const aiMessageId=(await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,metadata)
  values($1,'AI','TEXT','Delivered AI text',$2::jsonb) returning id`,[aiConversation.id,JSON.stringify({ai_job_id:aiJobId})])).rows[0].id as string;
 const aiOutboxId=await enqueueDirectOutbox({idempotencyKey:`ai-job:${aiJobId}`,kind:'AI',session:f.session,
  conversation:aiConversation.id,revision:aiConversation.revision,text:'Delivered AI text'});
 await recordReceipt(aiOutboxId,['700002']);
 assert.deepEqual(await resolveQuotedContext(pool,f.session,'700002',await candidates(f.session),key),{
  messageId:aiMessageId,conversationId:aiConversation.id,ticketId:null,senderType:'AI',outboxId:aiOutboxId,
 });

 const foreign=await fixture();
 assert.equal(await resolveQuotedContext(pool,foreign.session,'700001',await candidates(foreign.session),key),null,'A receipt from another LINE session cannot become an anchor');

 const pendingMessage=await addStaffMessage(f.conversation,f.ticket,staffId,'Unsent staff draft');
 const pendingOutbox=await enqueueDirectOutbox({idempotencyKey:`staff-reply:${f.ticket}:${pendingMessage}`,kind:'STAFF',session:f.session,
  conversation:f.conversation,ticket:f.ticket,text:'Unsent staff draft'},'PENDING');
 await recordReceipt(pendingOutbox,['700003']);
 assert.equal((await pool.query('select count(*)::int count from private.line_delivery_receipts where outbox_id=$1',[pendingOutbox])).rows[0].count,0);
 assert.equal(await resolveQuotedContext(pool,f.session,'700003',await candidates(f.session),key),null,'No receipt exists for an unsent reply');

 const closed=staffCandidates.map(candidate=>({...candidate,ticketStatus:'CLOSED' as const}));
 assert.equal(await resolveQuotedContext(pool,f.session,'700001',closed,key),null,'A closed current candidate is not a quote anchor');
 assert.equal(await resolveQuotedContext(pool,f.session,'700001',[],key),null,'A quote cannot supply a missing current candidate');
});

test('identical receipt replay is a no-op and divergent replay permanently invalidates the receipt',async()=>{
 const f=await fixture(),staffId=await addStaffActor(f),reply=await addStaffReply(f,staffId);
 await recordReceipt(reply.outboxId,['710001']);
 const original=(await pool.query('select message_hashes,consistent from private.line_delivery_receipts where outbox_id=$1',[reply.outboxId])).rows[0];
 assert.equal(original.consistent,true);
 await recordReceipt(reply.outboxId,['710001']);
 assert.deepEqual((await pool.query('select message_hashes,consistent from private.line_delivery_receipts where outbox_id=$1',[reply.outboxId])).rows[0],original);

 await recordReceipt(reply.outboxId,['710002']);
 const divergent=(await pool.query('select message_hashes,consistent from private.line_delivery_receipts where outbox_id=$1',[reply.outboxId])).rows[0];
 assert.equal(divergent.consistent,false,'A different LINE message ID makes the receipt permanently inconsistent');
 assert.deepEqual(divergent.message_hashes,original.message_hashes,'The first receipt hashes stay immutable');
 await recordReceipt(reply.outboxId,['710001']);
 const replayed=(await pool.query('select message_hashes,consistent from private.line_delivery_receipts where outbox_id=$1',[reply.outboxId])).rows[0];
 assert.equal(replayed.consistent,false,'A matching replay cannot repair a prior conflict');
 assert.deepEqual(replayed.message_hashes,original.message_hashes);
 assert.equal(await resolveQuotedContext(pool,f.session,'710001',await candidates(f.session),key),null);
});

test('global receipt-ID collisions and multi-case batch provenance fail closed',async()=>{
 const first=await fixture(),second=await fixture();
 const firstStaff=await addStaffActor(first),secondStaff=await addStaffActor(second);
 const firstReply=await addStaffReply(first,firstStaff),secondReply=await addStaffReply(second,secondStaff);
 await recordReceipt(firstReply.outboxId,['720001']);
 await recordReceipt(secondReply.outboxId,['720001']);
 assert.equal(await resolveQuotedContext(pool,first.session,'720001',await candidates(first.session),key),null,
  'A globally colliding ID remains ambiguous even when one receipt belongs to this session');

 const batchFixture=await fixture(),batchStaff=await addStaffActor(batchFixture),other=await addHumanContext(batchFixture.session,'Second batch case');
 const firstBatchMessage=await addStaffMessage(batchFixture.conversation,batchFixture.ticket,batchStaff,'First case reply');
 const secondBatchMessage=await addStaffMessage(other.conversation,other.ticket,batchStaff,'Second case reply');
 const batchId=randomUUID(),incidentId=randomUUID(),recipientId=randomUUID(),requestId=randomUUID();
 const ticketRows=(await pool.query('select id,ticket_no from public.tickets where id=any($1::uuid[])',[[batchFixture.ticket,other.ticket]])).rows;
 const ticketNo=(ticketId:string)=>ticketRows.find(row=>row.id===ticketId)!.ticket_no as string;
 const outboxId=await transaction(async c=>{
  await c.query(`insert into public.incidents(id,department_id,title,category,status,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at)
   values($1,(select department_id from public.tickets where id=$2),'Quote batch fixture','IT_NETWORK','INVESTIGATING','HIGH','GENERAL',2,2,clock_timestamp(),clock_timestamp())`,[incidentId,batchFixture.ticket]);
  const outbox=await enqueueOutbound(c,{idempotencyKey:`incident-batch:${batchId}:R1`,channel:'STUDENT',kind:'BATCH',lineSessionId:batchFixture.session,
   conversationId:batchFixture.conversation,ticketId:batchFixture.ticket,messages:[{type:'text',text:'One delivered packet for two cases'}]},key);
  assert.ok(outbox);
  await c.query("update private.message_outbox set status='SENT',completed_at=clock_timestamp() where id=$1",[outbox]);
  await c.query(`insert into private.incident_reply_batches(id,incident_id,staff_id,request_id,request_hash,prepared_encrypted,case_count,recipient_count)
   values($1,$2,$3,$4,$5,$6,2,1)`,[batchId,incidentId,batchStaff,requestId,'a'.repeat(64),encryptValue('reviewed batch fixture',key)]);
  await c.query(`insert into private.incident_reply_recipients(id,batch_id,recipient_code,line_session_id,outbox_id,packet_digest,case_count)
   values($1,$2,'R1',$3,$4,$5,2)`,[recipientId,batchId,batchFixture.session,outbox,'b'.repeat(64)]);
  await c.query(`insert into private.incident_reply_cases(batch_id,ticket_id,recipient_id,conversation_id,ticket_code,reporter_label,staff_message_id,assignment_epoch)
   values($1,$2,$3,$4,$5,$6,$7,0),($1,$8,$3,$9,$10,$6,$11,0)`,
   [batchId,batchFixture.ticket,recipientId,batchFixture.conversation,ticketNo(batchFixture.ticket),'ANONYMIZED_QUOTE_FIXTURE',firstBatchMessage,
    other.ticket,other.conversation,ticketNo(other.ticket),secondBatchMessage]);
  return outbox;
 },pool);
 await recordReceipt(outboxId,['720002']);
 assert.equal(await resolveQuotedContext(pool,batchFixture.session,'720002',await candidates(batchFixture.session),key),null,
  'One batch packet naming two Staff messages does not identify a unique quote anchor');
});

test('receipt-index failure inside a caller transaction preserves the already-SENT outbox',async()=>{
 const f=await fixture(),staffId=await addStaffActor(f),reply=await addStaffReply(f,staffId);
 await pool.query('update private.message_outbox set payload_encrypted=$2 where id=$1',[reply.outboxId,encryptValue('not-json',key)]);
 await transaction(async c=>{
  await recordLineDeliveryReceipt(c,reply.outboxId,['730001'],key);
  assert.equal((await c.query('select status from private.message_outbox where id=$1',[reply.outboxId])).rows[0].status,'SENT');
 },pool);
 assert.equal((await pool.query('select status from private.message_outbox where id=$1',[reply.outboxId])).rows[0].status,'SENT');
 assert.equal((await pool.query('select count(*)::int count from private.line_delivery_receipts where outbox_id=$1',[reply.outboxId])).rows[0].count,0);
});
