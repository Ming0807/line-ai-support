import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,test} from 'node:test';
import {Pool} from 'pg';
import {previewIncidentReply} from '../../lib/incidents/batch-preview';
import {confirmIncidentReply} from '../../lib/incidents/batch-confirm';
import {decryptValue,encryptValue,hashLineUserId} from '../../lib/security/identity';
import {incidentBatchConfirmResultSchema} from '../../lib/incidents/batch-confirm-contracts';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {transaction} from '../../lib/database/pool';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {getTicketDetail} from '../../lib/tickets/reads';
import {getIncidentReplyDraft,listIncidentReplyBatches,retryIncidentReplyBatch} from '../../lib/incidents/batch-status';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:5});
const key=Buffer.alloc(32,83).toString('base64'),sessions:string[]=[],departments:string[]=[];
afterEach(async()=>{
 await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[sessions]);
 // Retain fixture history without polluting later suites' bounded active directory.
 await pool.query('update public.departments set active=false where id=any($1::uuid[]) and active',[departments]);
});
after(async()=>{await pool.end();});
const letters=()=>randomUUID().replaceAll('-','').toUpperCase().replace(/[0-9]/gu,v=>String.fromCharCode(65+Number(v)));
async function fixture(){
 const department=(await pool.query('insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',[`CONFIRM_QA_${letters().slice(0,20)}`,'แผนกฐานทดสอบแยก','Owned confirmation department'])).rows[0].id as string;
 departments.push(department);
 const actor=randomUUID();await pool.query('insert into auth.users(id) values($1)',[actor]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name,active) values($1,$2,'STAFF','Owned batch actor',true)",[actor,department]);
 const cases:{id:string;sessionId:string;conversationId:string;ticketCode:string}[]=[];
 const shared=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`ANON_${letters()}`])).rows[0].id as string;
 sessions.push(shared);
 for(let index=0;index<3;index++){
  const sessionId=index<2?shared:(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`ANON_${letters()}`])).rows[0].id as string;
  if(index===2)sessions.push(sessionId);
  const conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode,status) values($1,'TICKET','HUMAN','ACTIVE') returning id",[sessionId])).rows[0].id as string;
  const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,assigned_staff_id) values($1,$2,$3,'Owned batch problem','IT_NETWORK','HUMAN','STAFF_HANDLING',$4) returning id,ticket_no",[sessionId,conversationId,department,actor])).rows[0];
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
  await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER','เชื่อมต่อเครือข่ายไม่ได้')",[conversationId,ticket.id]);
  cases.push({id:ticket.id,sessionId,conversationId,ticketCode:ticket.ticket_no});
 }
 for(const sessionId of new Set(cases.map(c=>c.sessionId))){
  const user=`U${randomUUID().replaceAll('-','')}`;
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[sessionId,hashLineUserId(user,key),encryptValue(user,key)]);
 }
 const incidentId=randomUUID();
 await pool.query("insert into public.incidents(id,department_id,title,category,status,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at) values($1,$2,'Owned shared issue','IT_NETWORK','INVESTIGATING','HIGH','GENERAL',3,2,clock_timestamp(),clock_timestamp())",[incidentId,department]);
 for(const c of cases)await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,0,.95)',[incidentId,c.id]);
 const requestId=randomUUID(),text='กำลังตรวจสอบเครือข่ายครับ กรุณาเก็บข้อความแจ้งข้อผิดพลาดไว้เพื่อติดตามเรื่องนี้';
 const preview=await previewIncidentReply(actor,incidentId,{requestId,ticketIds:cases.map(c=>c.id),text,intervention:false},{pool,key});
 return {actor,department,incidentId,cases,requestId,text,preview};
}
async function effects(f:{actor:string;requestId:string;cases:{id:string;sessionId:string}[]}){
 const ids=f.cases.map(c=>c.id);
 return {messages:(await pool.query("select count(*)::int n from public.messages where ticket_id=any($1::uuid[]) and sender_type='STAFF'",[ids])).rows[0].n,
  history:(await pool.query("select count(*)::int n from public.ticket_history where ticket_id=any($1::uuid[]) and action='STAFF_REPLIED'",[ids])).rows[0].n,
  outbox:(await pool.query("select count(*)::int n from private.message_outbox where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)])).rows[0].n};
}
const conflict=(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='CONFLICT';
async function confirm(f:Awaited<ReturnType<typeof fixture>>){return confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:f.preview.previewReceipt},{pool,key});}
function capture(respond:(index:number)=>number=()=>200){
 const requests:{to:string;messages:{text:string}[];retry:string|null}[]=[];
 const fetchImpl:typeof fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push({to:body.to,messages:body.messages,retry:new Headers(init?.headers).get('x-line-retry-key')});
  return new Response('{}',{status:respond(requests.length)});
 };
 return {requests,cycle:()=>runOutboxCycle(pool,key,{accessTokens:{STUDENT:'owned-student-token',STAFF:'owned-staff-token'},fetchImpl})};
}

test('fixed private immutable batch infrastructure has RLS and no browser or service mutation grants',async()=>{
 const names=['incident_reply_batches','incident_reply_recipients','incident_reply_cases','incident_reply_retry_receipts'];
 const rows=(await pool.query("select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') anon_read,has_table_privilege('authenticated',c.oid,'INSERT') browser_write,has_table_privilege('service_role',c.oid,'UPDATE') service_update,has_table_privilege('service_role',c.oid,'DELETE') service_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any($1::text[])",[names])).rows;
 assert.equal(rows.length,4);
 for(const r of rows){assert.equal(r.relrowsecurity,true);assert.equal(r.anon_read,false);assert.equal(r.browser_write,false);assert.equal(r.service_update,false);assert.equal(r.service_delete,false);}
});
test('confirmation retains individual STAFF messages/history but enqueues exactly one complete own-label packet per session',async()=>{
 const f=await fixture(),result=await confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:f.preview.previewReceipt},{pool,key});
 assert.equal(incidentBatchConfirmResultSchema.safeParse(result).success,true);
 assert.equal(result.caseCount,3);assert.equal(result.recipientCount,2);assert.equal(result.replayed,false);
 assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
 const rows=(await pool.query("select line_session_id,payload_encrypted from private.message_outbox where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)])).rows;
 for(const row of rows){
  const payload=JSON.parse(decryptValue(row.payload_encrypted,key));
  const own=f.cases.filter(c=>c.sessionId===row.line_session_id).sort((a,b)=>a.id.localeCompare(b.id)).map(c=>c.ticketCode);
  assert.equal(payload.messages.map((m:{text:string})=>m.text).join(''),`อัปเดตเคส: ${own.join(', ')}\n\n${f.text}`);
  for(const other of f.cases.filter(c=>c.sessionId!==row.line_session_id))assert.equal(JSON.stringify(payload).includes(other.ticketCode),false);
 }
 assert.equal((await pool.query("select count(*)::int n from public.tickets where id=any($1::uuid[]) and status='WAITING_USER'",[f.cases.map(c=>c.id)])).rows[0].n,3);
});
test('simultaneous confirmation and a nonce-different equivalent receipt replay one immutable batch without duplicate effects',async()=>{
 const f=await fixture(),receipt=f.preview.previewReceipt;
 const results=await Promise.all([confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:receipt},{pool,key}),confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:receipt},{pool,key})]);
 assert.equal(results[0].batchId,results[1].batchId);assert.equal(results.filter(r=>r.replayed).length,1);
 const equivalent=encryptValue(decryptValue(receipt,key),key);
 assert.notEqual(equivalent,receipt);
 const replay=await confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:equivalent},{pool,key});assert.equal(replay.batchId,results[0].batchId);assert.equal(replay.replayed,true);
 assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
});
test('every selected ticket shows its grouped delivery before and after sending, including non-anchor cases',async()=>{
 const f=await fixture();await confirm(f);
 for(const member of f.cases){
  const detail=await getTicketDetail(f.actor,member.id,{pool});
  assert(detail);assert.equal(detail.deliveries.length,1);assert.equal(detail.deliveries[0].status,'PENDING');
 }
 const sender=capture();await sender.cycle();await sender.cycle();
 for(const member of f.cases){
  const detail=await getTicketDetail(f.actor,member.id,{pool});
  assert(detail);assert.equal(detail.deliveries.length,1);assert.equal(detail.deliveries[0].status,'SENT');
 }
});
test('new USER source after preview rejects confirmation before any side effect',async()=>{
 const f=await fixture(),c=f.cases[0];
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER','รายละเอียดเพิ่มเติมที่ต้องอ่านก่อนตอบ')",[c.conversationId,c.id]);
 await assert.rejects(confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:f.preview.previewReceipt},{pool,key}),conflict);
 assert.deepEqual(await effects(f),{messages:0,history:0,outbox:0});
});
for(const change of ['REMOVED_MEMBER','CLOSED_INCIDENT','PRIVATE_CASE','REASSIGNED','ACTOR_CHANGED','EXPIRED_RECEIPT','WRONG_ACTOR','WRONG_INCIDENT','TAMPERED_RECEIPT'] as const){
 test(`confirmation rejects ${change} with no partial messages, history or enqueue`,async()=>{
  const f=await fixture();let actor=f.actor,incidentId=f.incidentId,receipt=f.preview.previewReceipt;
  if(change==='REMOVED_MEMBER')await pool.query('delete from public.incident_tickets where incident_id=$1 and ticket_id=$2',[f.incidentId,f.cases[0].id]);
  if(change==='CLOSED_INCIDENT')await pool.query("update public.incidents set status='CLOSED',revision=revision+1 where id=$1",[f.incidentId]);
  if(change==='PRIVATE_CASE')await pool.query("update public.tickets set sensitive_level='SENSITIVE' where id=$1",[f.cases[0].id]);
  if(change==='REASSIGNED')await pool.query('update public.tickets set assigned_staff_id=null where id=$1',[f.cases[0].id]);
  if(change==='ACTOR_CHANGED')await pool.query("update public.staff_profiles set display_name='New reviewed authority required' where id=$1",[f.actor]);
  if(change==='EXPIRED_RECEIPT'){
   const parsed=JSON.parse(decryptValue(receipt,key));parsed.issuedAt=new Date(Date.now()-1200000).toISOString();parsed.expiresAt=new Date(Date.now()-600000).toISOString();receipt=encryptValue(JSON.stringify(parsed),key);
  }
  if(change==='WRONG_ACTOR')actor=randomUUID();
  if(change==='WRONG_INCIDENT')incidentId=randomUUID();
  if(change==='TAMPERED_RECEIPT')receipt+='changed';
  await assert.rejects(confirmIncidentReply(actor,incidentId,{previewReceipt:receipt},{pool,key}));
  assert.deepEqual(await effects(f),{messages:0,history:0,outbox:0});
  assert.equal((await pool.query('select count(*)::int n from private.incident_reply_batches where staff_id=$1 and request_id=$2',[f.actor,f.requestId])).rows[0].n,0);
 });
}
test('an explicitly reviewed supervisor intervention preserves each assignee and records the actual replying supervisor',async()=>{
 const f=await fixture(),supervisor=randomUUID();await pool.query('insert into auth.users(id) values($1)',[supervisor]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name,active) values($1,$2,'SUPERVISOR','Owned supervisor',true)",[supervisor,f.department]);
 const preview=await previewIncidentReply(supervisor,f.incidentId,{requestId:randomUUID(),ticketIds:f.cases.map(c=>c.id),text:f.text,intervention:true},{pool,key});
 const accepted=await confirmIncidentReply(supervisor,f.incidentId,{previewReceipt:preview.previewReceipt},{pool,key});assert.equal(accepted.caseCount,3);
 assert.equal((await pool.query('select count(*)::int n from public.tickets where id=any($1::uuid[]) and assigned_staff_id=$2',[f.cases.map(c=>c.id),f.actor])).rows[0].n,3);
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=any($1::uuid[]) and sender_type='STAFF' and sender_staff_id=$2",[f.cases.map(c=>c.id),supervisor])).rows[0].n,3);
 const sender=capture();await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,2);
});
test('changed text under the same request conflicts while replay after normal ticket revisions returns the original acceptance',async()=>{
 const f=await fixture(),first=await confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:f.preview.previewReceipt},{pool,key});
 const altered=JSON.parse(decryptValue(f.preview.previewReceipt,key));altered.selection.text+=' ข้อความใหม่';
 await assert.rejects(confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:encryptValue(JSON.stringify(altered),key)},{pool,key}),conflict);
 await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where id=$1",[f.cases[0].id]);
 const replay=await confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:f.preview.previewReceipt},{pool,key});assert.equal(replay.batchId,first.batchId);assert.equal(replay.replayed,true);
 assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
});
test('batch dispatch sends each complete reviewed packet once through the injected transport and preserves each case action receipt',async()=>{
 const f=await fixture(),accepted=await confirm(f),sender=capture();
 await sender.cycle();await sender.cycle();await sender.cycle();
 assert.equal(sender.requests.length,2);assert.equal(new Set(sender.requests.map(r=>r.to)).size,2);
 for(const request of sender.requests){
  const session=(await pool.query('select line_session_id,user_id_encrypted from private.line_identities where line_session_id=any($1::uuid[])',[f.cases.map(c=>c.sessionId)])).rows.find(r=>decryptValue(r.user_id_encrypted,key)===request.to);
  assert(session);const own=f.cases.filter(c=>c.sessionId===session.line_session_id).sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(request.messages.map(m=>m.text).join(''),`อัปเดตเคส: ${own.map(c=>c.ticketCode).join(', ')}\n\n${f.text}`);
 }
 assert.equal((await pool.query("select count(*)::int n from private.ticket_action_receipts where staff_id=$1 and request_id=$2 and action='INCIDENT_BATCH_REPLY'",[f.actor,f.requestId])).rows[0].n,3);
 const replay=await confirm(f);assert.equal(replay.batchId,accepted.batchId);await sender.cycle();assert.equal(sender.requests.length,2);
});
for(const change of ['CLOSED_TICKET','CLOSED_CONVERSATION','MOVED_ACTIVE_TICKET','PRIVATE_CASE','REASSIGNED','MISSING_GUARD_CASE','CHANGED_PACKET'] as const){
 test(`a grouped recipient is suppressed as a whole before HTTP after ${change}, while another recipient can still receive its own packet`,async()=>{
  const f=await fixture();await confirm(f);const member=f.cases[0];
  if(change==='CLOSED_TICKET')await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where id=$1",[member.id]);
  if(change==='CLOSED_CONVERSATION')await pool.query("update public.conversations set status='CLOSED' where id=$1",[member.conversationId]);
  if(change==='MOVED_ACTIVE_TICKET')await pool.query('update public.conversations set active_ticket_id=null where id=$1',[member.conversationId]);
  if(change==='PRIVATE_CASE')await pool.query("update public.tickets set sensitive_level='SENSITIVE' where id=$1",[member.id]);
  if(change==='REASSIGNED')await pool.query('update public.tickets set assigned_staff_id=null where id=$1',[member.id]);
  if(change==='MISSING_GUARD_CASE')await pool.query('delete from private.staff_chat_delivery_cases where ticket_id=$1',[member.id]);
  if(change==='CHANGED_PACKET')await pool.query("update private.message_outbox set payload_encrypted=$2 where line_session_id=$1 and kind='BATCH'",[member.sessionId,encryptValue(JSON.stringify({messages:[{type:'text',text:'ข้อความถูกแก้หลังตรวจพรีวิว'}]}),key)]);
  const sender=capture();await sender.cycle();await sender.cycle();
  assert.equal(sender.requests.length,1);assert.equal(sender.requests[0].messages.map(m=>m.text).join('').includes(f.cases[2].ticketCode),true);
  for(const same of f.cases.slice(0,2))assert.equal(JSON.stringify(sender.requests[0].messages).includes(same.ticketCode),false);
  assert.equal((await pool.query("select status from private.message_outbox where line_session_id=$1 and kind='BATCH'",[member.sessionId])).rows[0].status,'SUPPRESSED');
 });
}
test('a BATCH outbox with an otherwise valid CASE guard but no immutable batch mapping cannot send',async()=>{
 const f=await fixture(),member=f.cases[0];
 const outbox=await transaction(async c=>{
  const id=await enqueueOutbound(c,{idempotencyKey:`incident-batch:${randomUUID()}:R1`,channel:'STUDENT',kind:'BATCH',lineSessionId:member.sessionId,conversationId:member.conversationId,ticketId:member.id,messages:[{type:'text',text:'Unbacked batch must never send'}]},key);
  await c.query("insert into private.staff_chat_delivery_guards(outbox_id,staff_id,purpose) values($1,$2,'CASE')",[id,f.actor]);
  await c.query('insert into private.staff_chat_delivery_cases(outbox_id,ticket_id,assignment_epoch) values($1,$2,0)',[id,member.id]);return id;
 },pool);
 const sender=capture();await sender.cycle();assert.equal(sender.requests.length,0);
 const stored=(await pool.query('select status,last_error_code from private.message_outbox where id=$1',[outbox])).rows[0];assert.equal(stored.status,'SUPPRESSED');assert.equal(stored.last_error_code,'INCIDENT_BATCH_CHANGED');
});
test('a partial push retry keeps the original retry UUID and never resends the accepted recipient',async()=>{
 const f=await fixture();await confirm(f);const sender=capture(index=>index===1?503:200);
 await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,2);
 await pool.query("update private.message_outbox set available_at=clock_timestamp() where line_session_id=any($1::uuid[]) and kind='BATCH' and status='PENDING'",[f.cases.map(c=>c.sessionId)]);
 await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,3);
 assert.equal(sender.requests[2].to,sender.requests[0].to);assert.equal(sender.requests[2].retry,sender.requests[0].retry);
 assert.deepEqual(sender.requests[2].messages,sender.requests[0].messages);
});

test('long Unicode packets retain complete reviewed meaning after partial recipient failure and retry',async()=>{
 const f=await fixture();
 const pattern='กำลังตรวจสอบเครือข่าย 🧑🏽 กรุณารอสักครู่\n';
 f.text=pattern.repeat(Math.floor(3990/pattern.length))+'ตรวจสอบต่อ';
 assert(f.text.length<=4000);
 const shared=f.cases[0].sessionId;
 for(let index=0;index<97;index++){
  const conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode,status) values($1,'TICKET','HUMAN','ACTIVE') returning id",[shared])).rows[0].id;
  const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,assigned_staff_id) values($1,$2,$3,'Owned Unicode batch','IT_NETWORK','HUMAN','STAFF_HANDLING',$4) returning id,ticket_no",[shared,conversationId,f.department,f.actor])).rows[0];
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
  await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER','เครือข่ายทดสอบหลายเคส')",[conversationId,ticket.id]);
  await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,0,.95)',[f.incidentId,ticket.id]);
  f.cases.push({id:ticket.id,sessionId:shared,conversationId,ticketCode:ticket.ticket_no});
 }
 await pool.query('update public.incidents set report_count=100,revision=revision+1 where id=$1',[f.incidentId]);
 f.requestId=randomUUID();
 f.preview=await previewIncidentReply(f.actor,f.incidentId,{requestId:f.requestId,ticketIds:f.cases.map(c=>c.id),text:f.text,intervention:false},{pool,key});
 assert.equal(f.preview.caseCount,100);assert.equal(f.preview.recipientCount,2);
 assert(f.preview.deliveries.some(packet=>packet.messages.length>1),'LONG_UNICODE_MUST_ACTUALLY_SPAN_LINE_TEXT_MESSAGES');
 for(const packet of f.preview.deliveries){
  const complete=`อัปเดตเคส: ${packet.cases.map(c=>c.ticketCode).join(', ')}\n\n${f.text}`;
  assert.equal(packet.messages.map(m=>m.text).join(''),complete,'NO_TRUNCATION_OR_LOST_ORDER');
  const boundaries=new Set<number>([0]);
  for(const segment of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(complete))boundaries.add(segment.index+segment.segment.length);
  let length=0;for(const message of packet.messages){assert(message.text.length<=5000);length+=message.text.length;assert(boundaries.has(length),'PACKETS_MUST_END_AT_GRAPHEME_BOUNDARIES');}
 }
 const accepted=await confirm(f);assert.equal(accepted.caseCount,100);assert.equal(accepted.recipientCount,2);
 const sender=capture(index=>index===1?503:200);
 await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,2);
 const first=structuredClone(sender.requests[0]),succeeded=sender.requests[1].to;
 await pool.query("update private.message_outbox set available_at=clock_timestamp() where line_session_id=any($1::uuid[]) and kind='BATCH' and status='PENDING'",[f.cases.map(c=>c.sessionId)]);
 await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,3);
 assert.deepEqual(sender.requests[2],first,'RETRY_MUST_KEEP_IDENTICAL_RECIPIENT_KEY_AND_ALL_UNICODE_MESSAGES');
 assert.equal(sender.requests.filter(r=>r.to===succeeded).length,1,'ACCEPTED_RECIPIENT_MUST_NOT_BE_REPLAYED');
 assert.deepEqual(await effects(f),{messages:100,history:100,outbox:2});
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where line_session_id=any($1::uuid[]) and kind='BATCH' and status='SENT'",[f.cases.map(c=>c.sessionId)])).rows[0].n,2);
});
test('revoke and restore cannot revive a queued batch, and replay cannot create replacement deliveries',async()=>{
 const f=await fixture();await confirm(f);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);
 await assert.rejects(confirm(f));await pool.query('update public.staff_profiles set active=true where id=$1',[f.actor]);
 assert.equal((await confirm(f)).replayed,true);
 const sender=capture();await sender.cycle();assert.equal(sender.requests.length,0);assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
});
test('immutable headers, recipients and cases reject changes, incomplete commit, and all browser reads',async()=>{
 const f=await fixture(),accepted=await confirm(f);
 for(const [table,predicate] of [['incident_reply_batches','id'],['incident_reply_recipients','batch_id'],['incident_reply_cases','batch_id']] as const){
  await assert.rejects(pool.query(`delete from private.${table} where ${predicate}=$1`,[accepted.batchId]),/INCIDENT_BATCH_IMMUTABLE/u);
  for(const role of ['anon','authenticated'])await assert.rejects(transaction(async c=>{await c.query(`set local role ${role}`);await c.query(`select * from private.${table}`);},pool),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='42501');
 }
 await assert.rejects(transaction(async c=>{await c.query('insert into private.incident_reply_batches(incident_id,staff_id,request_id,request_hash,prepared_encrypted,case_count,recipient_count) values($1,$2,$3,$4,$5,1,1)',[f.incidentId,f.actor,randomUUID(),'0'.repeat(64),'owned-invalid-incomplete']);},pool),/INCIDENT_BATCH_INCOMPLETE/u);
 await assert.rejects(pool.query('truncate private.incident_reply_cases'),/INCIDENT_BATCH_IMMUTABLE/u);
});
test('scoped batch results expose mixed recipient outcomes without technical identities or frozen encrypted payloads',async()=>{
 const f=await fixture(),batch=await confirm(f),sender=capture(index=>index===1?503:200);
 await sender.cycle();await sender.cycle();
 const view=await listIncidentReplyBatches(f.actor,f.incidentId,{pool,key});assert.equal(view.batches.length,1);
 assert.equal(view.batches[0].batchId,batch.batchId);assert.deepEqual(view.batches[0].recipients.map(r=>r.deliveryStatus).sort(),['PENDING','SENT']);
 const serialized=JSON.stringify(view);for(const member of f.cases){assert.equal(serialized.includes(member.sessionId),false);assert.equal(serialized.includes(member.conversationId),false);}
 assert.equal(serialized.includes('payload_encrypted'),false);assert.equal(serialized.includes('line_retry_key'),false);
});
test('an explicit retry reuses one failed outbox and retry UUID; concurrent/replayed retry never resends a successful recipient',async()=>{
 const f=await fixture(),batch=await confirm(f),sender=capture(index=>index===1?503:200);await sender.cycle();await sender.cycle();
 await pool.query("update private.message_outbox set status='DEAD',completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and kind='BATCH' and status='PENDING'",[f.cases.map(c=>c.sessionId)]);
 const before=await listIncidentReplyBatches(f.actor,f.incidentId,{pool,key}),failed=before.batches[0].recipients.find(r=>r.deliveryStatus==='DEAD');assert(failed?.retryable);
 const input={requestId:randomUUID(),recipientCodes:[failed.recipientCode]};
 const both=before.batches[0].recipients.map(r=>r.recipientCode);
 await assert.rejects(retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,{requestId:randomUUID(),recipientCodes:both},{pool,key}),conflict);
 const results=await Promise.all([retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,input,{pool,key}),retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,input,{pool,key})]);
 assert.equal(results.filter(r=>r.replayed).length,1);assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
 await sender.cycle();await sender.cycle();assert.equal(sender.requests.length,3);assert.equal(sender.requests[2].to,sender.requests[0].to);assert.equal(sender.requests[2].retry,sender.requests[0].retry);assert.deepEqual(sender.requests[2].messages,sender.requests[0].messages);
 assert.equal((await retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,input,{pool,key})).replayed,true);await sender.cycle();assert.equal(sender.requests.length,3);
 await assert.rejects(retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,{...input,recipientCodes:both},{pool,key}),conflict);
 await assert.rejects(pool.query("update private.incident_reply_retry_receipts set recipient_codes=array['R100'] where batch_id=$1",[batch.batchId]),/INCIDENT_BATCH_IMMUTABLE/u);
 await assert.rejects(pool.query('truncate private.incident_reply_retry_receipts'),/INCIDENT_BATCH_IMMUTABLE/u);
});
test('a manual retry grants one extra attempt after the automatic budget, without resetting the counter, window or retry key',async()=>{
 const f=await fixture(),batch=await confirm(f);
 await pool.query("update private.message_outbox set status='DEAD',last_error_code='PUSH_RETRYABLE',first_attempt_at=clock_timestamp(),attempts=5,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)]);
 const prior=(await pool.query("select * from private.message_outbox where line_session_id=$1 and kind='BATCH'",[f.cases[0].sessionId])).rows[0];
 const recipient=(await pool.query('select recipient_code from private.incident_reply_recipients where outbox_id=$1',[prior.id])).rows[0].recipient_code;
 await retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,{requestId:randomUUID(),recipientCodes:[recipient]},{pool,key});
 const sender=capture();await sender.cycle();assert.equal(sender.requests.length,1);assert.equal(sender.requests[0].retry,prior.line_retry_key);
 const after=(await pool.query('select attempts,attempt_limit,first_attempt_at,status from private.message_outbox where id=$1',[prior.id])).rows[0];
 assert.equal(after.attempts,6);assert.equal(after.attempt_limit,6);assert.equal(after.status,'SENT');assert.equal(after.first_attempt_at.getTime(),prior.first_attempt_at.getTime());
});
for(const state of ['SENT','UNKNOWN','SUPPRESSED','EXPIRED','EXHAUSTED','REASSIGNED'] as const){
 test(`explicit retry rejects ${state} without a replacement outbox or changed retry identity`,async()=>{
  const f=await fixture(),batch=await confirm(f);
  await pool.query("update private.message_outbox set status='DEAD',last_error_code='PUSH_RETRYABLE',first_attempt_at=clock_timestamp(),attempts=5,completed_at=clock_timestamp() where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)]);
  if(state==='EXPIRED')await pool.query("update private.message_outbox set first_attempt_at=clock_timestamp()-interval '25 hours' where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)]);
  else if(state==='EXHAUSTED')await pool.query("update private.message_outbox set attempts=10,attempt_limit=10 where line_session_id=any($1::uuid[]) and kind='BATCH'",[f.cases.map(c=>c.sessionId)]);
  else if(state==='REASSIGNED')await pool.query('update public.tickets set assigned_staff_id=null where id=$1',[f.cases[0].id]);
  else await pool.query("update private.message_outbox set status=$2 where line_session_id=$1 and kind='BATCH'",[f.cases[0].sessionId,state]);
  const recipient=(await pool.query('select r.recipient_code from private.incident_reply_recipients r where r.batch_id=$1 and r.line_session_id=$2',[batch.batchId,f.cases[0].sessionId])).rows[0].recipient_code;
  const status=await listIncidentReplyBatches(f.actor,f.incidentId,{pool,key});assert.equal(status.batches[0].recipients.find(r=>r.recipientCode===recipient)?.retryable,false);
  const original=(await pool.query("select id,line_retry_key,payload_encrypted from private.message_outbox where line_session_id=any($1::uuid[]) and kind='BATCH' order by id",[f.cases.map(c=>c.sessionId)])).rows;
  await assert.rejects(retryIncidentReplyBatch(f.actor,f.incidentId,batch.batchId,{requestId:randomUUID(),recipientCodes:[recipient]},{pool,key}),conflict);
  assert.deepEqual((await pool.query("select id,line_retry_key,payload_encrypted from private.message_outbox where line_session_id=any($1::uuid[]) and kind='BATCH' order by id",[f.cases.map(c=>c.sessionId)])).rows,original);
 });
}
test('status never projects a partially hidden batch after a frozen case becomes inaccessible',async()=>{
 const f=await fixture();await confirm(f);
 await pool.query("update public.tickets set sensitive_level='SENSITIVE' where id=$1",[f.cases[0].id]);
 await assert.rejects(listIncidentReplyBatches(f.actor,f.incidentId,{pool,key}));
});

test('confirmation replay rejects an incident that became inaccessible while retaining the original committed batch',async()=>{
 const f=await fixture();await confirm(f);
 const original=await effects(f);
 await pool.query("update public.incidents set sensitive_level='SENSITIVE',revision=revision+1 where id=$1",[f.incidentId]);
 await assert.rejects(confirm(f));
 assert.deepEqual(await effects(f),original);
 assert.equal((await pool.query('select count(*)::int n from private.incident_reply_batches where incident_id=$1',[f.incidentId])).rows[0].n,1);
});

test('latest draft is empty before human confirmation and cannot send or select cases',async()=>{
 const f=await fixture();
 assert.deepEqual(await getIncidentReplyDraft(f.actor,f.incidentId,{pool,key}),{status:'EMPTY'});
 assert.deepEqual(await effects(f),{messages:0,history:0,outbox:0});
});

test('latest draft returns only authenticated readable reviewed text, with no private packet or send authority',async()=>{
 const f=await fixture(),accepted=await confirm(f),before=await effects(f);
 const draft=await getIncidentReplyDraft(f.actor,f.incidentId,{pool,key});
 assert.deepEqual(draft,{status:'AVAILABLE',batchId:accepted.batchId,acceptedAt:accepted.createdAt,text:f.text});
 assert.deepEqual(await effects(f),before);
 assert.equal(Object.keys(draft).some(name=>/receipt|recipient|messages|retry|session/i.test(name)),false);
 await assert.rejects(getIncidentReplyDraft(f.actor,f.incidentId,{pool,key:Buffer.alloc(32,22).toString('base64')}));
});

test('hidden frozen cases cannot donate common draft text even after they leave the visible incident',async()=>{
 const f=await fixture();await confirm(f);
 await pool.query('delete from public.incident_tickets where incident_id=$1 and ticket_id=$2',[f.incidentId,f.cases[0].id]);
 await pool.query("update public.tickets set sensitive_level='SENSITIVE' where id=$1",[f.cases[0].id]);
 assert.deepEqual(await getIncidentReplyDraft(f.actor,f.incidentId,{pool,key}),{status:'EMPTY'});
 await pool.query("update public.incidents set sensitive_level='SENSITIVE' where id=$1",[f.incidentId]);
 await assert.rejects(getIncidentReplyDraft(f.actor,f.incidentId,{pool,key}));
});

test('a later case receives the old common text only through a new explicit new-case review and confirmation',async()=>{
 const f=await fixture(),first=await confirm(f);
 const sessionId=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`LATE_${letters()}`])).rows[0].id;sessions.push(sessionId);
 const conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode,status) values($1,'TICKET','HUMAN','ACTIVE') returning id",[sessionId])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,assigned_staff_id) values($1,$2,$3,'Later same issue','IT_NETWORK','HUMAN','STAFF_HANDLING',$4) returning id",[sessionId,conversationId,f.department,f.actor])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER','กรณีเข้ามาภายหลัง')",[conversationId,ticket.id]);
 await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,0,.95)',[f.incidentId,ticket.id]);
 await pool.query('update public.incidents set report_count=4,distinct_session_count=3,revision=revision+1 where id=$1',[f.incidentId]);
 const draft=await getIncidentReplyDraft(f.actor,f.incidentId,{pool,key});assert.equal(draft.status,'AVAILABLE');
 if(draft.status!=='AVAILABLE')throw new Error('READABLE_DRAFT_REQUIRED');
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and sender_type='STAFF'",[ticket.id])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where line_session_id=$1',[sessionId])).rows[0].n,0);
 const review=await previewIncidentReply(f.actor,f.incidentId,{requestId:randomUUID(),ticketIds:[ticket.id],text:draft.text,intervention:false},{pool,key});
 assert.equal(review.caseCount,1);assert.equal(review.recipientCount,1);
 const second=await confirmIncidentReply(f.actor,f.incidentId,{previewReceipt:review.previewReceipt},{pool,key});assert.notEqual(second.batchId,first.batchId);
 assert.equal(second.caseCount,1);assert.equal((await pool.query('select count(*)::int n from private.incident_reply_cases where batch_id=$1',[second.batchId])).rows[0].n,1);
 assert.deepEqual(await effects(f),{messages:3,history:3,outbox:2});
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and sender_type='STAFF' and content=$2",[ticket.id,f.text])).rows[0].n,1);
});
