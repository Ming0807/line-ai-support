import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {addInternalNote,acknowledgeRead,listInbox,readThread} from '../../lib/chat/service';
import {parseInboxQuery} from '../../lib/chat/contracts';
import {transaction} from '../../lib/database/pool';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {encryptValue} from '../../lib/security/identity';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:6,application_name:'inbox-chat-owned-qa'});
const key=Buffer.alloc(32,83).toString('base64');
const letters=()=>randomUUID().replaceAll('-','').toUpperCase().replace(/[0-9]/gu,value=>String.fromCharCode(65+Number(value)));
const hasCode=(code:string)=>(error:unknown)=>error instanceof Error&&'code'in error&&error.code===code;
after(async()=>{await pool.end();});

type TicketFixture={id:string;conversationId:string;lineSessionId:string;ticketCode:string};
type Fixture={staff:string;otherStaff:string;department:string;otherDepartment:string;main:TicketFixture;peer:TicketFixture;alternate:TicketFixture;other:TicketFixture;marker:string};

async function withFixture(run:(f:Fixture)=>Promise<void>):Promise<void>{
 const marker=`INBOX_${letters()}`,departmentIds:string[]=[],sessionIds:string[]=[],actorIds=[randomUUID(),randomUUID()];
 try{
  const departments=(await pool.query("insert into public.departments(code,name_th,name_en) values($1,$2,$3),($4,$5,$6) returning id,code",
   [`INBOX_${letters().slice(0,20)}`,'ฝ่ายทดสอบกล่องข้อความ','Inbox test department',`INBOX_${letters().slice(0,20)}`,'ฝ่ายทดสอบกล่องข้อความต่างฝ่าย','Inbox test other department'])).rows;
  const department=departments[0].id as string,otherDepartment=departments[1].id as string;
  departmentIds.push(department,otherDepartment);
  for(const actor of actorIds)await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query("insert into public.staff_profiles(id,department_id,role,display_name,active) values($1,$2,'STAFF','Inbox fixture staff',true),($3,$4,'STAFF','Inbox other department staff',true)",
   [actorIds[0],department,actorIds[1],otherDepartment]);
  const mainSession=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`${marker}_A`])).rows[0].id as string;
  const peerSession=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`${marker}_P`])).rows[0].id as string;
  const alternateSession=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`${marker}_C`])).rows[0].id as string;
  const otherSession=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`${marker}_B`])).rows[0].id as string;
  sessionIds.push(mainSession,peerSession,alternateSession,otherSession);
  const createTicket=async(staff:string,dept:string,lineSessionId:string):Promise<TicketFixture>=>{
   const conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode,status) values($1,'TICKET','HUMAN','ACTIVE') returning id",[lineSessionId])).rows[0].id as string;
   const row=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,assigned_staff_id) values($1,$2,$3,'Owned inbox chat fixture','IT_NETWORK','HUMAN','STAFF_HANDLING',$4) returning id,ticket_no",
    [lineSessionId,conversationId,dept,staff])).rows[0];
   await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,row.id]);
   return {id:row.id,conversationId,lineSessionId,ticketCode:row.ticket_no};
  };
  const main=await createTicket(actorIds[0],department,mainSession),peer=await createTicket(actorIds[0],department,peerSession),alternate=await createTicket(actorIds[0],department,alternateSession),other=await createTicket(actorIds[1],otherDepartment,otherSession);
  await run({staff:actorIds[0],otherStaff:actorIds[1],department,otherDepartment,main,peer,alternate,other,marker});
 }finally{
  if(sessionIds.length)await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessionIds]);
  if(departmentIds.length)await pool.query('update public.departments set active=false where id=any($1::uuid[]) and active',[departmentIds]);
 }
}

async function addMessage(ticket:TicketFixture,sender:'USER'|'AI'|'STAFF'|'SYSTEM',content:string,staffId?:string):Promise<string>{
 return (await pool.query('insert into public.messages(conversation_id,ticket_id,sender_type,sender_staff_id,content) values($1,$2,$3,$4,$5) returning id',
  [ticket.conversationId,ticket.id,sender,sender==='STAFF'?staffId:null,content])).rows[0].id as string;
}

async function directDelivery(f:Fixture,ticket:TicketFixture,messageId:string,status:'SENT'|'PENDING',idempotencyKey=`staff-reply:${ticket.id}:${messageId}`):Promise<void>{
 const id=await transaction(client=>enqueueOutbound(client,{idempotencyKey,channel:'STUDENT',kind:'STAFF',lineSessionId:ticket.lineSessionId,
  conversationId:ticket.conversationId,ticketId:ticket.id,messages:[{type:'text',text:`Delivery fixture ${messageId}`} ]},key),pool);
 assert(id);
 await pool.query('update private.message_outbox set status=$2,completed_at=case when $2=\'SENT\' then clock_timestamp() else null end where id=$1',[id,status]);
 void f;
}

/** Seed two immutable per-case mappings from one batch; the second names a different actual incident session. */
async function batchProof(f:Fixture,entries:{ticket:TicketFixture;messageId:string;recipientSessionId:string}[]):Promise<void>{
 const incidentId=randomUUID(),batchId=randomUUID(),requestId=randomUUID();
 await pool.query("insert into public.incidents(id,department_id,title,category,status,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at) values($1,$2,'Inbox fixture incident','IT_NETWORK','INVESTIGATING','HIGH','GENERAL',3,3,clock_timestamp(),clock_timestamp())",[incidentId,f.department]);
 const members=[f.main,f.peer,f.alternate];
 for(const ticket of members){
  const revision=(await pool.query('select revision from public.tickets where id=$1',[ticket.id])).rows[0].revision;
  await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,$3,.95)',[incidentId,ticket.id,revision]);
 }
 await transaction(async client=>{
  await client.query(`insert into private.incident_reply_batches(id,incident_id,staff_id,request_id,request_hash,prepared_encrypted,case_count,recipient_count)
   values($1,$2,$3,$4,$5,$6,$7,$7)`,[batchId,incidentId,f.staff,requestId,'a'.repeat(64),encryptValue('owned batch fixture',key),entries.length]);
  for(const [index,entry] of entries.entries()){
   const recipientId=randomUUID(),recipientCode=`R${index+1}`;
   const outboxId=await enqueueOutbound(client,{idempotencyKey:`inbox-batch:${batchId}:${recipientCode}`,channel:'STUDENT',kind:'BATCH',lineSessionId:entry.recipientSessionId,
    messages:[{type:'text',text:`Batch delivery fixture ${entry.messageId}`} ]},key);
   assert(outboxId);
   await client.query("update private.message_outbox set status='SENT',completed_at=clock_timestamp() where id=$1",[outboxId]);
   await client.query(`insert into private.incident_reply_recipients(id,batch_id,recipient_code,line_session_id,outbox_id,packet_digest,case_count)
    values($1,$2,$3,$4,$5,$6,1)`,[recipientId,batchId,recipientCode,entry.recipientSessionId,outboxId,'b'.repeat(64)]);
   const assignmentEpoch=(await client.query('select staff_line_epoch from public.tickets where id=$1',[entry.ticket.id])).rows[0].staff_line_epoch;
   await client.query(`insert into private.incident_reply_cases(batch_id,ticket_id,recipient_id,conversation_id,ticket_code,reporter_label,staff_message_id,assignment_epoch)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[batchId,entry.ticket.id,recipientId,entry.ticket.conversationId,entry.ticket.ticketCode,'Owned inbox case',entry.messageId,assignmentEpoch]);
  }
 },pool);
}

test('thread pages use stable per-ticket sequences and only exact direct/batch SENT provenance marks a Staff message sent',()=>withFixture(async f=>{
 for(let index=0;index<56;index++){
  const sender=index%4===0?'USER':index%4===1?'AI':index%4===2?'SYSTEM':'STAFF';
  await addMessage(f.main,sender,`${f.marker}_message_${index}`,sender==='STAFF'?f.staff:undefined);
 }
 const directSent=await addMessage(f.main,'STAFF',`${f.marker}_direct_sent`,f.staff);
 const directPending=await addMessage(f.main,'STAFF',`${f.marker}_direct_pending`,f.staff);
 const directWrongKey=await addMessage(f.main,'STAFF',`${f.marker}_direct_wrong_key`,f.staff);
 const batchSent=await addMessage(f.main,'STAFF',`${f.marker}_batch_sent`,f.staff);
 const batchWrongSession=await addMessage(f.peer,'STAFF',`${f.marker}_batch_wrong_session`,f.staff);
 await directDelivery(f,f.main,directSent,'SENT');
 await directDelivery(f,f.main,directPending,'PENDING');
 await directDelivery(f,f.main,directWrongKey,'SENT',`staff-reply:${f.main.id}:not-${directWrongKey}`);
 await batchProof(f,[
  {ticket:f.main,messageId:batchSent,recipientSessionId:f.main.lineSessionId},
  {ticket:f.peer,messageId:batchWrongSession,recipientSessionId:f.alternate.lineSessionId},
 ]);
 // The second immutable case is structurally present, but its recipient/outbox belongs to another actual incident session.
 // It must not prove that this ticket's Staff message reached its Student.

 const expected=(await pool.query('select message_seq::text seq from private.inbox_message_order where ticket_id=$1 order by message_seq',[f.main.id])).rows.map(r=>Number(r.seq));
 assert.equal(expected.length,60);
 const recent=await readThread(f.staff,f.main.id,{limit:50},{pool,key});
 assert.equal(recent.messages.length,50);assert.equal(recent.hasMore,true);assert.equal(recent.nextBefore,recent.messages[0].sequence);
 assert.deepEqual(recent.messages.map(m=>m.sequence),expected.slice(-50));
 const older=await readThread(f.staff,f.main.id,{beforeSequence:recent.nextBefore!,limit:50},{pool,key});
 assert.equal(older.hasMore,false);assert.deepEqual(older.messages.map(m=>m.sequence),expected.slice(0,-50));
 const full=[...older.messages,...recent.messages];
 assert.equal(new Set(full.map(m=>m.id)).size,expected.length,'HISTORY_PAGES_MUST_NOT_DUPLICATE_MESSAGES');
 assert.deepEqual(full.map(m=>m.sequence),expected,'HISTORY_PAGES_MUST_NOT_SKIP_OR_REORDER_MESSAGES');
 const byContent=new Map(full.map(message=>[message.content,message]));
 assert.equal(byContent.get(`${f.marker}_direct_sent`)?.deliveryStatus,'SENT');
 assert.equal(byContent.get(`${f.marker}_direct_pending`)?.deliveryStatus,'PENDING');
 assert.notEqual(byContent.get(`${f.marker}_direct_wrong_key`)?.deliveryStatus,'SENT','A DIFFERENT DIRECT OUTBOX KEY MUST NOT PROVE DELIVERY');
 assert.equal(byContent.get(`${f.marker}_batch_sent`)?.deliveryStatus,'SENT');
 const badBatchThread=await readThread(f.staff,f.peer.id,{}, {pool,key});
 assert.notEqual(badBatchThread.messages.find(message=>message.content===`${f.marker}_batch_wrong_session`)?.deliveryStatus,'SENT','BATCH RECIPIENT SESSION MUST MATCH THE MESSAGE CONVERSATION');
}));

test('inbox unread counts count USER messages only and acknowledgements stay monotone and ticket-bound',()=>withFixture(async f=>{
 const firstUser=await addMessage(f.main,'USER',`${f.marker}_user_1`);
 await addMessage(f.main,'STAFF',`${f.marker}_staff_1`,f.staff);
 const secondUser=await addMessage(f.main,'USER',`${f.marker}_user_2`);
 await addMessage(f.main,'AI',`${f.marker}_ai_1`);
 const thirdUser=await addMessage(f.main,'USER',`${f.marker}_user_3`);
 const foreignUser=await addMessage(f.other,'USER',`${f.marker}_foreign_user`);
 const sequence=async(messageId:string,ticketId:string)=>Number((await pool.query('select message_seq::text from private.inbox_message_order where message_id=$1 and ticket_id=$2',[messageId,ticketId])).rows[0].message_seq);
 const [seq1,seq2,seq3,foreignSeq]=await Promise.all([sequence(firstUser,f.main.id),sequence(secondUser,f.main.id),sequence(thirdUser,f.main.id),sequence(foreignUser,f.other.id)]);
 const inbox=()=>listInbox(f.staff,parseInboxQuery(new URLSearchParams('view=all')), {pool});
 assert.equal((await inbox()).unreadCounts[f.main.id],3,'UNREAD_COUNTS_INCLUDE_USER_MESSAGES_ONLY');
 await assert.rejects(acknowledgeRead(f.staff,f.main.id,foreignSeq,{pool}),hasCode('INVALID_REQUEST'),'A SEQUENCE FROM ANOTHER TICKET IS NOT ACKNOWLEDGEABLE');
 await assert.rejects(acknowledgeRead(f.staff,f.main.id,seq3+1000,{pool}),hasCode('INVALID_REQUEST'),'FUTURE SEQUENCES ARE NOT ACKNOWLEDGEABLE');
 assert.equal((await readThread(f.staff,f.main.id,{}, {pool,key})).readThroughSequence,0);
 assert.equal((await acknowledgeRead(f.staff,f.main.id,seq2,{pool})).readThroughSequence,seq2);
 assert.equal((await acknowledgeRead(f.staff,f.main.id,seq1,{pool})).readThroughSequence,seq2,'READ_CURSOR_MUST_NOT_MOVE_BACKWARDS');
 assert.equal((await readThread(f.staff,f.main.id,{}, {pool,key})).readThroughSequence,seq2);
 assert.equal((await inbox()).unreadCounts[f.main.id],1);
 assert.equal((await acknowledgeRead(f.staff,f.main.id,seq3,{pool})).readThroughSequence,seq3);
 const unread=await listInbox(f.staff,parseInboxQuery(new URLSearchParams('view=unread')), {pool});
 assert.equal(unread.tickets.some(ticket=>ticket.id===f.main.id),false);
}));

test('wrong-department and inactive Staff reads fail closed with NOT_FOUND',()=>withFixture(async f=>{
 await addMessage(f.main,'USER',`${f.marker}_private_user`);
 await assert.rejects(readThread(f.staff,f.other.id,{}, {pool,key}),hasCode('NOT_FOUND'));
 await assert.rejects(addInternalNote(f.staff,f.other.id,{text:'private note',requestId:randomUUID()},{pool,key}),hasCode('NOT_FOUND'));
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);
 await assert.rejects(listInbox(f.staff,parseInboxQuery(new URLSearchParams()),{pool}),hasCode('NOT_FOUND'));
 await assert.rejects(readThread(f.staff,f.main.id,{}, {pool,key}),hasCode('NOT_FOUND'));
}));

test('internal notes are encrypted, idempotent and absent from Student messages and outbox',()=>withFixture(async f=>{
 await addMessage(f.main,'USER',`${f.marker}_user_before_note`);
 const beforeMessages=(await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.main.id])).rows[0].n;
 const beforeOutbox=(await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1 or line_session_id=$2',[f.main.id,f.main.lineSessionId])).rows[0].n;
 const requestId=randomUUID(),text=`${f.marker} internal staff-only note`;
 const first=await addInternalNote(f.staff,f.main.id,{text:`  ${text}  `,requestId},{pool,key});
 const replay=await addInternalNote(f.staff,f.main.id,{text,requestId},{pool,key});
 assert.equal(first.id,replay.id);assert.equal(replay.text,text);
 await assert.rejects(addInternalNote(f.staff,f.main.id,{text:`${text} changed`,requestId},{pool,key}),hasCode('CONFLICT'));
 const thread=await readThread(f.staff,f.main.id,{}, {pool,key});
 assert.equal(thread.notes.length,1);assert.equal(thread.notes[0].id,first.id);assert.equal(thread.notes[0].text,text);
 assert.equal(thread.messages.some(message=>message.content.includes(text)),false,'NOTES_MUST_NOT_ENTER_STUDENT_MESSAGE_HISTORY');
 assert.equal((await pool.query('select count(*)::int n from public.messages where ticket_id=$1',[f.main.id])).rows[0].n,beforeMessages);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1 or line_session_id=$2',[f.main.id,f.main.lineSessionId])).rows[0].n,beforeOutbox);
 const stored=(await pool.query('select content_encrypted from private.inbox_notes where id=$1',[first.id])).rows[0].content_encrypted as string;
 assert.equal(stored.includes(text),false,'NOTE_PLAINTEXT_MUST_NOT_BE_STORED');
 await assert.rejects(readThread(f.otherStaff,f.main.id,{}, {pool,key}),hasCode('NOT_FOUND'));
}));
