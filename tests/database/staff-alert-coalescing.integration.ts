import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {after,afterEach,test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {notifyTicketStaff} from '../../lib/tickets/notifications';
import {flushStaffAlerts} from '../../lib/incidents/staff-alerts';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {getIncidentRules} from '../../lib/incidents/reads';
import {updateIncidentRules} from '../../lib/incidents/actions';
import {applyTicketAction} from '../../lib/tickets/ticket-service';
import {encryptValue,decryptValue,hashStaffLineUserId} from '../../lib/security/identity';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:5,application_name:'staff-alert-owned-qa'});
const departments:string[]=[],staffIds:string[]=[];
const key=randomBytes(32).toString('base64'),appBaseUrl='https://helpdesk.example.edu';
afterEach(async()=>{
 await pool.query("update private.staff_alert_events set status='SUPPRESSED',suppression_code='ALERT_CONTEXT_CHANGED',completed_at=clock_timestamp() where staff_id=any($1::uuid[]) and status='PENDING'",[staffIds]);
 await pool.query("update private.message_outbox set status='SUPPRESSED',last_error_code='OWNED_QA_CLEANUP',lease_token=null,lease_until=null where recipient_staff_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[staffIds]);
 await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[]) and active',[staffIds]);
});
after(async()=>{try{
 await pool.query("update private.message_outbox set status='SUPPRESSED',last_error_code='OWNED_QA_CLEANUP',lease_token=null,lease_until=null where recipient_staff_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[staffIds]);
 await pool.query('update public.departments set active=false where id=any($1::uuid[])',[departments]);
}finally{await pool.end();}});
async function fixture(count=3){
 const department=randomUUID(),staff=randomUUID();departments.push(department);staffIds.push(staff);
 await pool.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$2,$2)',[department,'ALERT_'+department.replaceAll('-','').toUpperCase()]);
 await pool.query('insert into auth.users(id) values($1)',[staff]);
 await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$2,'STAFF','QA')",[staff,department]);
 const staffUser='U'+randomUUID().replaceAll('-','');
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',[staff,hashStaffLineUserId(staffUser,key),encryptValue(staffUser,key)]);
 const tickets:{id:string;ticket_no:string;department_id:string;sensitive_level:string;priority:string;revision:number}[]=[];
 for(let i=0;i<count;i++){
  const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['ALERT_'+randomUUID()])).rows[0].id;
  const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,status) values($1,'HUMAN','TICKET','ACTIVE') returning id",[session])).rows[0].id;
  const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,'PRIVATE_STUDENT_BODY_SHOULD_NOT_LEAK','IT_NETWORK','HUMAN','WAITING_STAFF') returning *",[session,conversation,department])).rows[0];
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket.id]);tickets.push(ticket);
 }
 return {department,staff,staffUser,tickets,notify:()=>transaction(async c=>{for(const ticket of tickets)await notifyTicketStaff(c,ticket,key);},pool)};
}
async function debounce(seconds:number){await pool.query('update private.incident_rules set alert_debounce_seconds=$1 where id=1',[seconds]);}
async function incident(f:Awaited<ReturnType<typeof fixture>>){
 const id=randomUUID();await pool.query("insert into public.incidents(id,department_id,title,category,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at) values($1,$2,'PRIVATE_GROUP_TITLE','IT_NETWORK','HIGH','GENERAL',$3,$3,clock_timestamp(),clock_timestamp())",[id,f.department,f.tickets.length]);
 for(const t of f.tickets)await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,$3,.95)',[id,t.id,t.revision]);return id;
}
test('ordinary source capture is durable and idempotent before any token or transport queue entry',async()=>{
 await debounce(30);const f=await fixture(2);await f.notify();await f.notify();
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].n,0);
 assert.equal((await pool.query('select count(*)::int n from private.staff_action_tokens where staff_id=$1',[f.staff])).rows[0].n,0);
 const rows=(await pool.query('select * from private.staff_alert_events where staff_id=$1 order by id',[f.staff])).rows;
 assert.equal(rows.length,2);assert(rows.every(r=>r.status==='PENDING'&&r.due_at.getTime()-r.captured_at.getTime()===30000));
 const deadlines=rows.map(r=>r.due_at.toISOString());await f.notify();
 assert.deepEqual((await pool.query('select due_at from private.staff_alert_events where staff_id=$1 order by id',[f.staff])).rows.map(r=>r.due_at.toISOString()),deadlines);
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
});
test('due related new cases coalesce once, retain every source and neither claim nor reveal Student bodies',async()=>{
 await debounce(0);const f=await fixture(),id=await incident(f);await f.notify();
 const results=await Promise.all([flushStaffAlerts(pool,key,{appBaseUrl}),flushStaffAlerts(pool,key,{appBaseUrl})]);
 assert.equal(results.reduce((n,r)=>n+r.released,0),1);
 const rows=(await pool.query('select * from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows;assert.equal(rows.length,1);assert.equal(rows[0].kind,'DIGEST');
 const body=JSON.parse(decryptValue(rows[0].payload_encrypted,key));assert(body.messages[0].text.includes('3 เคส'));assert(body.messages[0].text.includes(`/incidents/${id}`));
 assert(!JSON.stringify(body).includes('PRIVATE_STUDENT'));assert(!JSON.stringify(body).includes('PRIVATE_GROUP_TITLE'));assert(!JSON.stringify(body).includes(f.staffUser));
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and status='QUEUED' and outbox_id=$2",[f.staff,rows[0].id])).rows[0].n,3);
 assert.equal((await pool.query("select count(*)::int n from public.tickets where department_id=$1 and status='WAITING_STAFF' and assigned_staff_id is null",[f.department])).rows[0].n,3);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_case_context where staff_id=$1',[f.staff])).rows[0].n,0);
});
test('due source without completed semantic grouping releases an individual alert and fresh accept token',async()=>{
 await debounce(0);const f=await fixture(1);await f.notify();assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const row=(await pool.query('select * from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0];assert.equal(row.kind,'ALERT');
 const body=JSON.parse(decryptValue(row.payload_encrypted,key));assert(body.messages[0].quickReply.items[0].action.data.startsWith('yru:staff:accept:'));
 assert.equal((await pool.query("select count(*)::int n from private.staff_action_tokens where staff_id=$1 and expires_at>clock_timestamp()+interval '29 minutes'",[f.staff])).rows[0].n,1);
});
test('the oldest deadline admits a staggered later member without waiting for its own deadline',async()=>{
 await debounce(30);const f=await fixture(2);await incident(f);
 // Owned-only timestamps emulate t=0/t=20 at t=31 without a production clock override.
 for(const [i,t] of f.tickets.entries())await pool.query(`insert into private.staff_alert_events(source_kind,ticket_id,source_revision,assignment_epoch,staff_id,binding_hash,captured_at,due_at)
  select 'NEW_CASE',t.id,t.revision,t.staff_line_epoch,$2,i.user_hash,clock_timestamp()-make_interval(secs=>$3),
   clock_timestamp()+make_interval(secs=>$4) from public.tickets t join private.staff_line_identities i on i.staff_id=$2 where t.id=$1`,
 [t.id,f.staff,i===0?31:11,i===0?-1:19]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const h=(await pool.query('select case_count from private.staff_alert_deliveries where staff_id=$1',[f.staff])).rows[0];assert.equal(h.case_count,2);
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and status='QUEUED' and due_at>clock_timestamp()",[f.staff])).rows[0].n,1);
});
test('a critical ticket skips an existing ordinary source deadline',async()=>{
 await debounce(30);const f=await fixture(1);await f.notify();
 await pool.query("update public.tickets set priority='CRITICAL' where id=$1",[f.tickets[0].id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const row=(await pool.query('select kind,alert_priority from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0];assert.deepEqual(row,{kind:'ALERT',alert_priority:1});
});
test('critical incident promotion combines still-pending ordinary sources without waiting',async()=>{
 await debounce(30);const f=await fixture(3),id=await incident(f);await f.notify();
 await pool.query("update public.incidents set severity='CRITICAL',revision=revision+1 where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const h=(await pool.query('select purpose,case_count,new_case_count from private.staff_alert_deliveries where staff_id=$1',[f.staff])).rows[0];assert.deepEqual(h,{purpose:'CRITICAL_INCIDENT',case_count:3,new_case_count:3});
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and status='QUEUED'",[f.staff])).rows[0].n,4);
});
test('newly critical incident with already queued cases emits one separate link-only notice and preserves old packets',async()=>{
 await debounce(0);const f=await fixture(3),id=await incident(f);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 const old=(await pool.query('select id,payload_encrypted,line_retry_key,attempts from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0];
 await pool.query("update public.incidents set severity='CRITICAL',revision=revision+1 where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 assert.deepEqual((await pool.query('select id,payload_encrypted,line_retry_key,attempts from private.message_outbox where id=$1',[old.id])).rows[0],old);
 const h=(await pool.query("select outbox_id,case_count,new_case_count from private.staff_alert_deliveries where staff_id=$1 and purpose='CRITICAL_INCIDENT'",[f.staff])).rows[0];assert.equal(h.case_count,1);assert.equal(h.new_case_count,0);
 const packet=JSON.parse(decryptValue((await pool.query('select payload_encrypted from private.message_outbox where id=$1',[h.outbox_id])).rows[0].payload_encrypted,key));
 assert(packet.messages[0].text.includes('เหตุการณ์เร่งด่วน'));assert(!packet.messages[0].text.includes('เคสใหม่'));
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
});
test('controlled grouped delivery has exact current binding/provenance and no SQL transaction during HTTP; retry keeps UUID and complete packet',async()=>{
 await debounce(0);const f=await fixture(3);await incident(f);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 const requests:{text:string;retry:string|null}[]=[];
 const fetchImpl:typeof fetch=async(_url,init)=>{
  assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where application_name='staff-alert-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n,0);
  const body=JSON.parse(String(init?.body));assert.equal(body.to,f.staffUser);
  requests.push({text:JSON.stringify(body.messages),retry:new Headers(init?.headers).get('x-line-retry-key')});
  return new Response('{}',{status:requests.length===1?503:200});
 };
 const tokens={STUDENT:'controlled-only',STAFF:'controlled-only'};
 const first=await runOutboxCycle(pool,key,{accessTokens:tokens,fetchImpl});assert.equal(first.failed,1);
 await pool.query("update private.message_outbox set available_at=clock_timestamp() where recipient_staff_id=$1 and status='PENDING'",[f.staff]);
 assert.equal((await runOutboxCycle(pool,key,{accessTokens:tokens,fetchImpl})).sent,1);
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 assert.equal((await pool.query('select attempts from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].attempts,2);
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
});
for(const mutation of ['closed','hidden_member','tampered_packet','missing_provenance'] as const)test(`dispatch rejects ${mutation} before any network request`,async()=>{
 await debounce(0);const f=await fixture(mutation==='missing_provenance'?1:3);if(mutation!=='missing_provenance')await incident(f);
 if(mutation==='missing_provenance')await transaction(c=>enqueueOutbound(c,{idempotencyKey:'staff-alert:'+randomUUID(),channel:'STAFF',kind:'ALERT',recipientStaffId:f.staff,ticketId:f.tickets[0].id,messages:[{type:'text',text:'unproven'}],alertPriority:0},key),pool);
 else{
  await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
  if(mutation==='closed')await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where id=$1",[f.tickets[1].id]);
  if(mutation==='hidden_member')await pool.query("update public.tickets set sensitive_level='SENSITIVE',revision=revision+1 where id=$1",[f.tickets[2].id]);
  if(mutation==='tampered_packet')await pool.query('update private.message_outbox set payload_encrypted=$2 where recipient_staff_id=$1',[f.staff,encryptValue(JSON.stringify({messages:[{type:'text',text:'changed'}]}),key)]);
 }
 let calls=0;await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});
 assert.equal(calls,0);assert.equal((await pool.query('select status,last_error_code from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].status,'SUPPRESSED');
});
for(const change of ['binding','profile','grant'] as const)test(`revoke-restore ${change} never revives old pending source or guarded packet`,async()=>{
 await debounce(30);const f=await fixture(2);await f.notify();
 if(change==='binding'){
  await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[f.staff]);await pool.query('update private.staff_line_identities set active=true where staff_id=$1',[f.staff]);
 }else if(change==='profile'){
  await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await pool.query('update public.staff_profiles set active=true where id=$1',[f.staff]);
 }else{
  await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[f.staff,f.department]);
  await pool.query('delete from public.staff_department_grants where staff_id=$1',[f.staff]);
 }
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and status='SUPPRESSED' and suppression_code='STAFF_ALERT_ACCESS_CHANGED'",[f.staff])).rows[0].n,2);
 await f.notify();assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
 assert.equal((await pool.query('select count(*)::int n from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].n,0);
});
test('queued alert remains suppressed after permission restore; accepted source/proof stays retained',async()=>{
 await debounce(0);const f=await fixture(1);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await pool.query('update public.staff_profiles set active=true where id=$1',[f.staff]);
 let calls=0;await runOutboxCycle(pool,key,{fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});assert.equal(calls,0);
 assert.equal((await pool.query('select status from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].status,'SUPPRESSED');
 assert.equal((await pool.query('select status from private.staff_alert_events where staff_id=$1',[f.staff])).rows[0].status,'QUEUED');
});
test('debounce-only SUPER_ADMIN CAS edit preserves detection jobs and omitted notification value',async()=>{
 const f=await fixture(1),admin=randomUUID();await pool.query('insert into auth.users(id) values($1)',[admin]);
 await pool.query("insert into public.staff_profiles(id,role,display_name) values($1,'SUPER_ADMIN','QA')",[admin]);
 await pool.query("update private.incident_detection_jobs set status='DONE',lease_token=null,lease_until=null where ticket_id=$1",[f.tickets[0].id]);
 const before=await getIncidentRules(admin,{pool});
 await assert.rejects(updateIncidentRules(f.staff,{revision:before.revision,rules:before.rules,notifications:{debounceSeconds:17}},{pool}),/FORBIDDEN/);
 await updateIncidentRules(admin,{revision:before.revision,rules:before.rules,notifications:{debounceSeconds:17}},{pool});
 assert.equal((await pool.query('select status from private.incident_detection_jobs where ticket_id=$1',[f.tickets[0].id])).rows[0].status,'DONE');
 const next=await getIncidentRules(admin,{pool});assert.deepEqual(next.notifications,{debounceSeconds:17});
 await updateIncidentRules(admin,{revision:next.revision,rules:next.rules},{pool});assert.deepEqual((await getIncidentRules(admin,{pool})).notifications,{debounceSeconds:17});
 await assert.rejects(updateIncidentRules(admin,{revision:before.revision,rules:before.rules,notifications:{debounceSeconds:0}},{pool}),/CONFLICT/);
});
for(const barrier of ['ALERT','DIGEST','NOTIFICATION','PROCESSING','CHAT','CONTROL','CRITICAL_NOTIFICATION','CRITICAL_INCIDENT_NOTIFICATION'] as const)test(`critical claim respects ${barrier} priority/FIFO boundary`,async()=>{
 const f=await fixture(2),ticket=f.tickets[0],urgentTicket=f.tickets[1];
 await pool.query("update public.tickets set priority='CRITICAL' where id=$1",[urgentTicket.id]);
 const kind=barrier==='PROCESSING'?'ALERT':barrier==='CRITICAL_NOTIFICATION'||barrier==='CRITICAL_INCIDENT_NOTIFICATION'?'NOTIFICATION':barrier;
 if(barrier==='CRITICAL_NOTIFICATION')await pool.query("update public.tickets set priority='CRITICAL' where id=$1",[ticket.id]);
 if(barrier==='CRITICAL_INCIDENT_NOTIFICATION')await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[await incident(f)]);
 const prior=await transaction(c=>enqueueOutbound(c,{idempotencyKey:randomUUID(),channel:'STAFF',kind,recipientStaffId:f.staff,
  ...(kind==='CONTROL'?{}:{ticketId:ticket.id}),messages:[{type:'text',text:'prior'}],...(['ALERT','DIGEST'].includes(kind)?{alertPriority:0 as const}:{})},key),pool);assert(prior);
 await transaction(c=>notifyTicketStaff(c,urgentTicket,key),pool);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const urgent=(await pool.query('select outbox_id from private.staff_alert_deliveries where staff_id=$1',[f.staff])).rows[0].outbox_id;assert(urgent);
 await pool.query("update private.message_outbox set available_at=clock_timestamp()+interval '1 minute' where id=$1",[prior]);
 if(barrier==='PROCESSING')await pool.query("update private.message_outbox set status='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' where id=$1",[prior]);
 const old=(await pool.query('select line_retry_key,attempts,attempt_limit,first_attempt_at from private.message_outbox where id=$1',[urgent])).rows[0];
 const rows=(await pool.query("select * from private.claim_outbox('STAFF')")).rows;
 if(['ALERT','DIGEST','NOTIFICATION'].includes(barrier))assert.equal(rows[0]?.id,urgent);else assert.equal(rows.length,0);
 assert.deepEqual((await pool.query('select line_retry_key,attempts,attempt_limit,first_attempt_at from private.message_outbox where id=$1',[urgent])).rows[0],old);
});
test('source capture/deadline and accepted proof are retained; browser has no private grants',async()=>{
 await debounce(0);const f=await fixture(1);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 await assert.rejects(pool.query('update private.staff_alert_events set due_at=due_at+interval \'1 second\' where staff_id=$1',[f.staff]),/STAFF_ALERT_EVENT_IMMUTABLE/);
 await assert.rejects(pool.query('delete from private.staff_alert_deliveries where staff_id=$1',[f.staff]),/STAFF_ALERT_DELIVERY_IMMUTABLE/);
 for(const table of ['staff_alert_events','staff_alert_deliveries','staff_alert_delivery_cases']){
  const state=(await pool.query("select relrowsecurity from pg_class where oid=to_regclass($1)",['private.'+table])).rows[0];assert.equal(state.relrowsecurity,true);
  for(const role of ['anon','authenticated'])assert.equal((await pool.query('select has_table_privilege($1,$2,\'select\') allowed',[role,'private.'+table])).rows[0].allowed,false);
 }
});
test('concurrent assignment wins before locked flush snapshot and only still-unassigned sources enter its digest',async()=>{
 await debounce(0);const f=await fixture(3);await incident(f);await f.notify();
 const racePool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:1});
 const connect=racePool.connect.bind(racePool);let fired=false;
 const interceptedPool=new Proxy(racePool,{get(target,property){
  if(property==='query')return target.query.bind(target);
  if(property!=='connect')return Reflect.get(target,property,target);
  return async()=>{
  const client=await connect();return new Proxy(client,{get(target,property,receiver){
   if(property!=='query')return Reflect.get(target,property,receiver);
   return async(...args:unknown[])=>{const value=await Reflect.apply(target.query,target,args);
    if(!fired&&typeof args[0]==='string'&&args[0].startsWith('select id,conversation_id from public.tickets t')){
     fired=true;await transaction(c=>applyTicketAction(c,f.staff,f.tickets[1].id,'ACCEPT',{revision:0,requestId:randomUUID()},key),pool);
    }return value;
   };
  }});
  };
 }});
 try{
  assert.equal((await flushStaffAlerts(interceptedPool,key,{appBaseUrl})).released,1);assert(fired);
  const h=(await pool.query('select case_count,new_case_count from private.staff_alert_deliveries where staff_id=$1',[f.staff])).rows[0];assert.deepEqual(h,{case_count:2,new_case_count:2});
  assert.equal((await pool.query('select status from private.staff_alert_events where staff_id=$1 and ticket_id=$2',[f.staff,f.tickets[1].id])).rows[0].status,'SUPPRESSED');
 }finally{await racePool.end();}
});
test('access revocation cannot cross the active outside-SQL sender fence and is sticky after delivery completes',async()=>{
 await debounce(0);const f=await fixture(2);await incident(f);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 let checked=false;await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>{
  await assert.rejects(pool.query('update private.staff_line_identities set active=false where staff_id=$1',[f.staff]),(e:unknown)=>Boolean(e&&typeof e==='object'&&'code' in e&&e.code==='40001'));
  checked=true;return new Response('{}',{status:200});
 }});assert(checked);
 assert.equal((await pool.query('select status from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].status,'SENT');
 await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[f.staff]);
});
test('500 current source cases fit the bounded atomic digest and one controlled delivery',async()=>{
 await debounce(0);const f=await fixture(500);await incident(f);await f.notify();
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const h=(await pool.query('select case_count,new_case_count from private.staff_alert_deliveries where staff_id=$1',[f.staff])).rows[0];assert.deepEqual(h,{case_count:500,new_case_count:500});
 let calls=0;const result=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert(body.messages[0].text.includes('500 เคส'));assert(!JSON.stringify(body).includes('PRIVATE_STUDENT'));
  calls++;return new Response('{}',{status:200});
 }});assert.equal(result.sent,1);assert.equal(calls,1);
});
test('a captured critical source with every current case closed is suppressed instead of blocking later alerts',async()=>{
 await debounce(0);const f=await fixture(2),id=await incident(f);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 await pool.query(`insert into private.staff_alert_events(source_kind,ticket_id,incident_id,source_revision,assignment_epoch,staff_id,binding_hash,captured_at,due_at)
  select 'CRITICAL_INCIDENT',t.id,$2,0,t.staff_line_epoch,$3,i.user_hash,clock_timestamp(),clock_timestamp()
  from public.tickets t join private.staff_line_identities i on i.staff_id=$3 where t.id=$1`,[f.tickets[0].id,id,f.staff]);
 await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where department_id=$1",[f.department]);
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:1});
 assert.equal((await pool.query('select status from private.staff_alert_events where staff_id=$1',[f.staff])).rows[0].status,'SUPPRESSED');
 const next=await fixture(1);await next.notify();assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
});
test('a critical-purpose delivery requires an actual critical source, even if its ordinary sources are complete',async()=>{
 await debounce(0);const f=await fixture(2),id=await incident(f);await f.notify();
 await assert.rejects(transaction(async c=>{
  const outbox=await enqueueOutbound(c,{idempotencyKey:'staff-alert:'+randomUUID(),channel:'STAFF',kind:'DIGEST',recipientStaffId:f.staff,ticketId:f.tickets[0].id,messages:[{type:'text',text:'invalid critical proof'}],alertPriority:1},key);
  await c.query(`insert into private.staff_alert_deliveries(outbox_id,staff_id,binding_hash,incident_id,kind,purpose,case_count,new_case_count,proof_digest)
   select $1,$2,user_hash,$3,'DIGEST','CRITICAL_INCIDENT',2,2,repeat('a',64) from private.staff_line_identities where staff_id=$2`,[outbox,f.staff,id]);
  await c.query(`insert into private.staff_alert_delivery_cases(outbox_id,ticket_id,conversation_id,ticket_revision,assignment_epoch)
   select $1,id,conversation_id,revision,staff_line_epoch from public.tickets where department_id=$2`,[outbox,f.department]);
  await c.query("update private.staff_alert_events set status='QUEUED',outbox_id=$2,completed_at=clock_timestamp() where staff_id=$1 and status='PENDING'",[f.staff,outbox]);
 },pool),/STAFF_ALERT_DELIVERY_INCOMPLETE/);
});
for(const table of ['staff_line_identities','staff_department_grants'] as const)test(`truncate-restore ${table} cannot revive a captured source`,async()=>{
 await debounce(30);const f=await fixture(1);await f.notify();
 if(table==='staff_department_grants')await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[f.staff,f.department]);
 // Recapture after the grant insertion invalidated the first source: use a new fixture episode.
 const g=table==='staff_department_grants'?await fixture(1):f;
 await g.notify();
 const identity=(await pool.query('select * from private.staff_line_identities where staff_id=$1',[g.staff])).rows[0];
 await transaction(async c=>{
  if(table==='staff_line_identities'){
   await c.query('truncate private.staff_line_identities');
   await c.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,active) values($1,$2,$3,true)',[g.staff,identity.user_hash,identity.user_id_encrypted]);
  }else await c.query('truncate public.staff_department_grants');
 },pool);
 assert.equal((await pool.query('select status from private.staff_alert_events where staff_id=$1',[g.staff])).rows[0].status,'SUPPRESSED');
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
});
test('closed and reopened episode has a new assignment epoch and cannot inherit its previous alert deadline',async()=>{
 await debounce(0);const f=await fixture(1);await pool.query("update public.staff_profiles set role='SUPERVISOR' where id=$1",[f.staff]);await f.notify();
 let revision=0;
 for(const action of ['ACCEPT','RESOLVE','CLOSE'] as const){const r=await transaction(c=>applyTicketAction(c,f.staff,f.tickets[0].id,action,{revision,requestId:randomUUID()},key),pool);revision=r.revision;}
 await debounce(30);await transaction(c=>applyTicketAction(c,f.staff,f.tickets[0].id,'REOPEN',{revision,requestId:randomUUID(),reason:'New verified fixture episode'},key),pool);
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:1});
 const rows=(await pool.query('select status,assignment_epoch,due_at from private.staff_alert_events where staff_id=$1 order by captured_at',[f.staff])).rows;
 assert.equal(rows[0].status,'SUPPRESSED');assert.equal(rows[1].status,'PENDING');assert.notEqual(rows[0].assignment_epoch,rows[1].assignment_epoch);assert(rows[1].due_at>new Date());
});
test('changed queue priority cannot inherit an accepted ordinary alert proof',async()=>{
 await debounce(0);const f=await fixture(1);await f.notify();await flushStaffAlerts(pool,key,{appBaseUrl});
 await pool.query('update private.message_outbox set alert_priority=1 where recipient_staff_id=$1',[f.staff]);
 let calls=0;await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});
 assert.equal(calls,0);assert.equal((await pool.query('select status from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0].status,'SUPPRESSED');
});
test('a priority bit without current critical authority cannot bypass an older pending alert',async()=>{
 const f=await fixture(1);
 await transaction(async c=>{
  for(const priority of [0,1] as const)await enqueueOutbound(c,{idempotencyKey:randomUUID(),channel:'STAFF',kind:'ALERT',recipientStaffId:f.staff,ticketId:f.tickets[0].id,messages:[{type:'text',text:'queue proof'}],alertPriority:priority},key);
 },pool);
 const prior=(await pool.query('select id from private.message_outbox where recipient_staff_id=$1 order by outbox_seq limit 1',[f.staff])).rows[0].id;
 await pool.query("update private.message_outbox set available_at=clock_timestamp()+interval '1 minute' where id=$1",[prior]);
 assert.equal((await pool.query("select * from private.claim_outbox('STAFF')")).rows.length,0);
});
for(const sensitivity of ['GENERAL','SENSITIVE'] as const)for(const downgrade of [false,true])test(`later single ${sensitivity} case in an already-notified ${downgrade?'downgraded':'critical'} incident retains its notice without exposing an incident link`,async()=>{
 await debounce(30);const f=await fixture(2),id=await incident(f);
 await pool.query('update public.staff_profiles set can_view_sensitive=true where id=$1',[f.staff]);
 await pool.query('update public.tickets set sensitive_level=$2 where department_id=$1',[f.department,sensitivity]);
 await pool.query("update public.incidents set sensitive_level=$2,severity='CRITICAL' where id=$1",[id,sensitivity]);
 await f.notify();assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const transport={accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>new Response('{}',{status:200})};
 assert.equal((await runOutboxCycle(pool,key,transport)).sent,1);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['LATE_'+randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type,status) values($1,'HUMAN','TICKET','ACTIVE') returning id",[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level) values($1,$2,$3,'PRIVATE_STUDENT_LATE','IT_NETWORK','HUMAN','WAITING_STAFF',$4) returning *",[session,conversation,f.department,sensitivity])).rows[0];
 await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversation,ticket.id]);
 await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,0,.95)',[id,ticket.id]);
 await transaction(c=>notifyTicketStaff(c,ticket,key),pool);assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const alert=(await pool.query("select kind,alert_priority,payload_encrypted from private.message_outbox where ticket_id=$1 and recipient_staff_id=$2",[ticket.id,f.staff])).rows[0];
 assert.equal(alert.kind,'ALERT');assert.equal(alert.alert_priority,1);
 const payload=JSON.parse(decryptValue(alert.payload_encrypted,key));assert(!JSON.stringify(payload).includes('/incidents/'));assert(!JSON.stringify(payload).includes('PRIVATE_STUDENT'));
 if(downgrade)await pool.query("update public.incidents set severity='HIGH',revision=revision+1 where id=$1",[id]);
 assert.equal((await runOutboxCycle(pool,key,transport)).sent,1);
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and source_kind='CRITICAL_INCIDENT'",[f.staff])).rows[0].n,1);
});
test('priority-one proof cannot be accepted without critical authority in its locked capture transaction',async()=>{
 await debounce(0);const f=await fixture(1);await f.notify();
 await assert.rejects(transaction(async c=>{
  const outbox=await enqueueOutbound(c,{idempotencyKey:'staff-alert:'+randomUUID(),channel:'STAFF',kind:'ALERT',recipientStaffId:f.staff,ticketId:f.tickets[0].id,messages:[{type:'text',text:'invalid origin priority'}],alertPriority:1},key);
  await c.query(`insert into private.staff_alert_deliveries(outbox_id,staff_id,binding_hash,kind,purpose,case_count,new_case_count,alert_priority,proof_digest)
   select $1,$2,user_hash,'ALERT','NEW_CASES',1,1,1,repeat('a',64) from private.staff_line_identities where staff_id=$2`,[outbox,f.staff]);
  await c.query(`insert into private.staff_alert_delivery_cases(outbox_id,ticket_id,conversation_id,ticket_revision,assignment_epoch)
   select $1,id,conversation_id,revision,staff_line_epoch from public.tickets where department_id=$2`,[outbox,f.department]);
  await c.query("update private.staff_alert_events set status='QUEUED',outbox_id=$2,completed_at=clock_timestamp() where staff_id=$1 and status='PENDING'",[f.staff,outbox]);
 },pool),/STAFF_ALERT_DELIVERY_INCOMPLETE/);
});
for(const delivered of [false,true])test(`new critical episode emits once after an earlier ${delivered?'SENT':'suppressed queued'} notice without rewriting old packets`,async()=>{
 await debounce(30);const f=await fixture(2),id=await incident(f);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const transport={accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>new Response('{}',{status:200})};
 if(delivered)assert.equal((await runOutboxCycle(pool,key,transport)).sent,1);
 await pool.query("update public.incidents set severity='HIGH',revision=revision+1 where id=$1",[id]);
 if(!delivered)assert.equal((await runOutboxCycle(pool,key,transport)).sent,0);
 const previous=(await pool.query('select id,payload_encrypted,line_retry_key,status,attempts from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0];
 assert.equal(previous.status,delivered?'SENT':'SUPPRESSED');
 await pool.query("update public.incidents set severity='CRITICAL',revision=revision+1 where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 assert.deepEqual((await pool.query('select id,payload_encrypted,line_retry_key,status,attempts from private.message_outbox where id=$1',[previous.id])).rows[0],previous);
 assert.equal((await runOutboxCycle(pool,key,transport)).sent,1);
 assert.deepEqual(await flushStaffAlerts(pool,key,{appBaseUrl}),{released:0,suppressed:0});
 assert.equal((await pool.query("select count(*)::int n from private.staff_alert_events where staff_id=$1 and source_kind='CRITICAL_INCIDENT'",[f.staff])).rows[0].n,2);
});
test('a queued critical notice from an older episode stays suppressed when current severity is critical again',async()=>{
 await debounce(30);const f=await fixture(2),id=await incident(f);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const old=(await pool.query('select id,payload_encrypted,line_retry_key from private.message_outbox where recipient_staff_id=$1',[f.staff])).rows[0];
 await pool.query("update public.incidents set severity='HIGH' where id=$1",[id]);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 let calls=0;const transport={accessTokens:{STUDENT:'controlled-only',STAFF:'controlled-only'},fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}};
 assert.equal((await runOutboxCycle(pool,key,transport)).sent,0);
 assert.equal((await pool.query('select status from private.message_outbox where id=$1',[old.id])).rows[0].status,'SUPPRESSED');
 assert.deepEqual((await pool.query('select id,payload_encrypted,line_retry_key from private.message_outbox where id=$1',[old.id])).rows[0],old);
 assert.equal((await runOutboxCycle(pool,key,transport)).sent,1);assert.equal(calls,1);
});
test('critical episode counter ignores metadata and supplied counters but advances on critical reactivation',async()=>{
 const f=await fixture(2),id=await incident(f);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 const epoch=async()=>String((await pool.query('select critical_alert_epoch::text epoch from public.incidents where id=$1',[id])).rows[0].epoch);
 const before=await epoch();
 await pool.query("update public.incidents set revision=revision+1,critical_alert_epoch=1000000 where id=$1",[id]);
 assert.equal(await epoch(),before);
 await pool.query("update public.incidents set status='RESOLVED',revision=revision+1 where id=$1",[id]);
 assert.equal(await epoch(),before);
 await pool.query("update public.incidents set status='INVESTIGATING',revision=revision+1 where id=$1",[id]);
 assert.equal(await epoch(),String(BigInt(before)+BigInt(1)));
});
for(const priority of ['MEDIUM','CRITICAL'])test(`stale critical episode cannot bypass an older pending alert even with current ${priority} anchor`,async()=>{
 await debounce(30);const f=await fixture(2),id=await incident(f);
 await pool.query('update public.tickets set priority=$2 where department_id=$1',[f.department,priority]);
 const older=await transaction(c=>enqueueOutbound(c,{idempotencyKey:'stale-episode-barrier:'+randomUUID(),channel:'STAFF',kind:'ALERT',recipientStaffId:f.staff,
  ticketId:f.tickets[0].id,messages:[{type:'text',text:'older pending ordinary alert'}],alertPriority:0},key),pool);assert(older);
 await pool.query("update private.message_outbox set available_at=clock_timestamp()+interval '1 minute' where id=$1",[older]);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 await pool.query("update public.incidents set severity='HIGH' where id=$1",[id]);
 await pool.query("update public.incidents set severity='CRITICAL' where id=$1",[id]);
 assert.deepEqual((await pool.query("select id from private.claim_outbox('STAFF')")).rows,[]);
});
for(const action of ['ACCEPT','CLOSE'] as const)test(`critical ticket alert loses FIFO bypass after actual ${action}`,async()=>{
 const f=await fixture(1),t=f.tickets[0];
 await pool.query("update public.tickets set priority='CRITICAL' where id=$1",[t.id]);
 const older=await transaction(c=>enqueueOutbound(c,{idempotencyKey:'changed-case-barrier:'+randomUUID(),channel:'STAFF',kind:'ALERT',recipientStaffId:f.staff,
  ticketId:t.id,messages:[{type:'text',text:'older pending ordinary alert'}],alertPriority:0},key),pool);assert(older);
 await pool.query("update private.message_outbox set available_at=clock_timestamp()+interval '1 minute' where id=$1",[older]);
 await f.notify();assert.equal((await flushStaffAlerts(pool,key,{appBaseUrl})).released,1);
 const accepted=await transaction(c=>applyTicketAction(c,f.staff,t.id,'ACCEPT',{revision:0,requestId:randomUUID()},key),pool);
 if(action==='CLOSE'){
  const resolved=await transaction(c=>applyTicketAction(c,f.staff,t.id,'RESOLVE',{revision:accepted.revision,requestId:randomUUID()},key),pool);
  await transaction(c=>applyTicketAction(c,f.staff,t.id,'CLOSE',{revision:resolved.revision,requestId:randomUUID()},key),pool);
 }
 assert.deepEqual((await pool.query("select id from private.claim_outbox('STAFF')")).rows,[]);
});
