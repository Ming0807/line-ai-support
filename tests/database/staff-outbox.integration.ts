import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {runOutboxCycle} from '../../lib/queue/run-outbox';

const localUrl='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const testTokens={STUDENT:'student-test-access-token',STAFF:'staff-test-access-token'};

interface StaffFixture {id:string;userId:string}
interface Fixture {
 pool:Pool;key:string;departmentId:string;sessionId:string;conversationId:string;ticketId:string;
 staff:StaffFixture[];admin?:StaffFixture;student?:{userId:string};outboxIds:string[];cleanup:()=>Promise<void>;
}

async function createFixture(options:{staffCount?:number;includeAdmin?:boolean;includeStudent?:boolean}={}):Promise<Fixture> {
 const pool=new Pool({connectionString:localUrl,max:5});
 const key=randomBytes(32).toString('base64');
 const fixture:Omit<Fixture,'cleanup'>={pool,key,departmentId:'',sessionId:'',conversationId:'',ticketId:'',staff:[],outboxIds:[]};
 try {
  const department=(await pool.query(
   'insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
   [`OUTBOX-${randomUUID()}`,'ทดสอบการส่ง','Outbox test'],
  )).rows[0];
  fixture.departmentId=department.id;
  for(let index=0;index<(options.staffCount??1);index++){
   await createStaff(pool,key,fixture.departmentId,'STAFF',staff=>fixture.staff.push(staff));
  }
  if(options.includeAdmin){
   await createStaff(pool,key,fixture.departmentId,'ADMIN',staff=>{fixture.admin=staff;});
   assert.ok(fixture.admin);
   await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[fixture.admin.id,fixture.departmentId]);
  }
  fixture.sessionId=(await pool.query(
   'insert into public.line_sessions(anonymous_code) values($1) returning id',[`OUTBOX-${randomUUID()}`],
  )).rows[0].id;
  fixture.conversationId=(await pool.query(
   'insert into public.conversations(line_session_id) values($1) returning id',[fixture.sessionId],
  )).rows[0].id;
  fixture.ticketId=(await pool.query(
   'insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary) values($1,$2,$3,$4) returning id',
   [fixture.sessionId,fixture.conversationId,fixture.departmentId,'Controlled outbox integration fixture'],
  )).rows[0].id;
  if(options.includeStudent){
   const userId=lineUserId();
   await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [fixture.sessionId,hashLineUserId(userId,key),encryptValue(userId,key)]);
   fixture.student={userId};
  }
  return {...fixture,cleanup:()=>cleanupFixture(fixture)};
 }catch(error){
  await cleanupFixture(fixture).catch(()=>undefined);
  throw error;
 }
}

async function createStaff(pool:Pool,key:string,departmentId:string,role:'STAFF'|'ADMIN',track:(staff:StaffFixture)=>void):Promise<void> {
 const id=randomUUID(),userId=lineUserId();
 track({id,userId});
 await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query('insert into public.staff_profiles(id,department_id,display_name,role) values($1,$2,$3,$4)',
  [id,role==='ADMIN'?null:departmentId,`Controlled ${role}`,role]);
 await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',
  [id,hashStaffLineUserId(userId,key),encryptValue(userId,key)]);
}

function lineUserId():string {return `U${randomUUID().replaceAll('-','')}`;}

async function cleanupFixture(fixture:Omit<Fixture,'cleanup'>):Promise<void> {
 const client=await fixture.pool.connect();
 try {
  await client.query('begin');
  if(fixture.outboxIds.length){
   await client.query('delete from private.delivery_attempts where outbox_id=any($1::uuid[])',[fixture.outboxIds]);
   await client.query('delete from private.message_outbox where id=any($1::uuid[])',[fixture.outboxIds]);
  }
  if(fixture.ticketId){
   await client.query('delete from private.staff_action_tokens where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from private.ticket_action_receipts where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from private.activities where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from public.ticket_history where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from public.messages where ticket_id=$1 or conversation_id=$2',[fixture.ticketId,fixture.conversationId]);
   if(fixture.conversationId)await client.query('update public.conversations set active_ticket_id=null where id=$1',[fixture.conversationId]);
   await client.query('delete from private.incident_detection_jobs where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from private.incident_ticket_vectors where ticket_id=$1',[fixture.ticketId]);
   await client.query('delete from public.tickets where id=$1',[fixture.ticketId]);
  }
  if(fixture.conversationId)await client.query('delete from public.conversations where id=$1',[fixture.conversationId]);
  if(fixture.sessionId){
   await client.query('delete from private.line_identities where line_session_id=$1',[fixture.sessionId]);
   await client.query('delete from public.line_sessions where id=$1',[fixture.sessionId]);
  }
  const staffIds=[...fixture.staff.map(staff=>staff.id),...(fixture.admin?[fixture.admin.id]:[])];
  if(staffIds.length){
   await client.query('delete from private.staff_line_identities where staff_id=any($1::uuid[])',[staffIds]);
   await client.query('delete from public.staff_department_grants where staff_id=any($1::uuid[])',[staffIds]);
   if(fixture.ticketId)await client.query('delete from public.ticket_history where ticket_id=$1 or actor_id=any($2::uuid[])',[fixture.ticketId,staffIds]);
   await client.query('delete from public.staff_profiles where id=any($1::uuid[])',[staffIds]);
   await client.query('delete from auth.users where id=any($1::uuid[])',[staffIds]);
  }
  if(fixture.departmentId)await client.query('delete from public.departments where id=$1',[fixture.departmentId]);
  await client.query('commit');
 }catch(error){await client.query('rollback').catch(()=>undefined);throw error;}
 finally{client.release();await fixture.pool.end();}
}

async function assertOutboxReadyEmpty(pool:Pool,channels:('STUDENT'|'STAFF')[]):Promise<void> {
 const result=await pool.query(
  `select count(*)::int as count from private.message_outbox
   where channel=any($1::text[]) and ((status='PENDING' and available_at<=clock_timestamp())
    or (status='PROCESSING' and lease_until<=clock_timestamp()))`,[channels],
 );
 assert.equal(result.rows[0].count,0,'the dedicated local outbox channels must be empty before this fixture');
}

async function enqueueStaff(fixture:Fixture,recipient:StaffFixture,text:string):Promise<string> {
 const client=await fixture.pool.connect();
 try{
  await client.query('begin');
  const id=await enqueueOutbound(client,{
   idempotencyKey:`staff-outbox-test:${randomUUID()}`,channel:'STAFF',kind:'NOTIFICATION',
   recipientStaffId:recipient.id,ticketId:fixture.ticketId,messages:[{type:'text',text}],
  },fixture.key);
  assert.ok(id,'the controlled Staff notification should be inserted');
  await client.query('commit');fixture.outboxIds.push(id);return id;
 }catch(error){await client.query('rollback').catch(()=>undefined);throw error;}
 finally{client.release();}
}

async function insertExpiredStudentReply(fixture:Fixture):Promise<string> {
 assert.ok(fixture.student,'the Student identity must be part of this fixture');
 const result=await fixture.pool.query(
  `insert into private.message_outbox(idempotency_key,channel,kind,line_session_id,payload_encrypted,delivery_mode,reply_deadline_at)
   values($1,'STUDENT','SYSTEM',$2,$3,'REPLY',clock_timestamp()-interval '1 second') returning id`,
  [`student-reply-test:${randomUUID()}`,fixture.sessionId,
   encryptValue(JSON.stringify({messages:[{type:'text',text:'Expired reply falls back to Push'}],replyToken:'fixture-only-expired-reply-token'}),fixture.key)],
 );
 fixture.outboxIds.push(result.rows[0].id);return result.rows[0].id;
}

async function dispatch(pool:Pool,key:string,fetchImpl:typeof fetch) {
 return runOutboxCycle(pool,key,{accessTokens:testTokens,fetchImpl});
}

test('Staff notification uses the bound Staff recipient and token; 503 retry preserves exact key and body through 409',async()=>{
 const fixture=await createFixture();
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  const outboxId=await enqueueStaff(fixture,fixture.staff[0],'Controlled Staff delivery');
  const requests:{url:string;authorizationMatches:boolean;body:string;retryKey:string|null;attemptVisible:boolean;frozenRecipient:boolean}[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
   const state=(await fixture.pool.query(
    'select attempts,recipient_user_id_encrypted,first_attempt_at,status from private.message_outbox where id=$1',[outboxId],
   )).rows[0];
   const body=String(init?.body);
   const parsed=JSON.parse(body) as {to?:string;messages?:{text?:string}[]};
   requests.push({
    url:String(input),authorizationMatches:new Headers(init?.headers).get('authorization')==='Bearer '+testTokens.STAFF,
    body,retryKey:new Headers(init?.headers).get('x-line-retry-key'),
    attemptVisible:state.attempts===requests.length+1&&state.status==='PROCESSING'&&state.first_attempt_at!==null,
    frozenRecipient:typeof state.recipient_user_id_encrypted==='string'&&decryptValue(state.recipient_user_id_encrypted,fixture.key)===fixture.staff[0].userId,
   });
   assert.equal(parsed.to===fixture.staff[0].userId,true,'Staff push is addressed to the current bound Staff LINE user');
   assert.equal(parsed.messages?.[0]?.text==='Controlled Staff delivery',true);
   return new Response(null,{status:requests.length===1?503:409});
  };
  const first=await dispatch(fixture.pool,fixture.key,fetchImpl);
  assert.equal(first.claimed,1);assert.equal(first.failed,1);assert.equal(requests.length,1);
  await fixture.pool.query('update private.message_outbox set available_at=clock_timestamp() where id=$1',[outboxId]);
  const second=await dispatch(fixture.pool,fixture.key,fetchImpl);
  assert.equal(second.sent,1);assert.equal(requests.length,2);
  assert.equal(requests.every(request=>request.url.endsWith('/v2/bot/message/push')),true);
  assert.equal(requests.every(request=>request.authorizationMatches),true,'Staff jobs use the Staff channel access token');
  assert.equal(requests.every(request=>request.attemptVisible),true,'attempt state commits before the HTTP request');
  assert.equal(requests.every(request=>request.frozenRecipient),true,'the first attempt freezes the bound recipient');
  assert.equal(requests[0].retryKey!==null,true);assert.equal(requests[0].retryKey===requests[1].retryKey,true);
  assert.equal(requests[0].body===requests[1].body,true,'a Push retry reuses the exact request body');
  const final=(await fixture.pool.query('select status,attempts,recipient_user_id_encrypted from private.message_outbox where id=$1',[outboxId])).rows[0];
  assert.equal(final.status,'SENT');assert.equal(final.attempts,2);
  assert.equal(decryptValue(final.recipient_user_id_encrypted,fixture.key)===fixture.staff[0].userId,true);
 }finally{await fixture.cleanup();}
});

test('per-recipient ordering blocks later work for one Staff member while another recipient remains eligible',async()=>{
 const fixture=await createFixture({staffCount:2});
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  const a1=await enqueueStaff(fixture,fixture.staff[0],'recipient A first');
  const b=await enqueueStaff(fixture,fixture.staff[1],'recipient B');
  const a2=await enqueueStaff(fixture,fixture.staff[0],'recipient A second');
  const sent:{a:boolean;b:boolean;text:string}[]=[];
  const fetchImpl:typeof fetch=async(_input,init)=>{
   const parsed=JSON.parse(String(init?.body)) as {to?:string;messages?:{text?:string}[]};
   sent.push({a:parsed.to===fixture.staff[0].userId,b:parsed.to===fixture.staff[1].userId,text:parsed.messages?.[0]?.text??''});
   return new Response(null,{status:200});
  };
  for(let index=0;index<3;index++)assert.equal((await dispatch(fixture.pool,fixture.key,fetchImpl)).sent,1);
  assert.deepEqual(sent,[
   {a:true,b:false,text:'recipient A first'},
   {a:false,b:true,text:'recipient B'},
   {a:true,b:false,text:'recipient A second'},
  ]);
  const statuses=(await fixture.pool.query('select id,status from private.message_outbox where id=any($1::uuid[]) order by id',[ [a1,b,a2] ])).rows;
  assert.equal(statuses.length,3);assert.equal(statuses.every(row=>row.status==='SENT'),true);
 }finally{await fixture.cleanup();}
});

test('revoking a Staff administrator department grant before first send suppresses the notification',async()=>{
 const fixture=await createFixture({includeAdmin:true});
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  assert.ok(fixture.admin);
  const outboxId=await enqueueStaff(fixture,fixture.admin,'Must remain private after grant revocation');
  await fixture.pool.query('delete from public.staff_department_grants where staff_id=$1 and department_id=$2',
   [fixture.admin.id,fixture.departmentId]);
  let calls=0;
  const result=await dispatch(fixture.pool,fixture.key,async()=>{calls++;return new Response(null,{status:200});});
  assert.equal(result.claimed,1);assert.equal(calls,0,'out-of-scope Staff must never be contacted');
  const row=(await fixture.pool.query('select status,last_error_code,attempts from private.message_outbox where id=$1',[outboxId])).rows[0];
  assert.deepEqual(row,{status:'SUPPRESSED',last_error_code:'RECIPIENT_INACTIVE_OR_DENIED',attempts:0});
 }finally{await fixture.cleanup();}
});

test('a Staff binding change after the first attempt suppresses instead of retargeting the frozen retry',async()=>{
 const fixture=await createFixture();
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  const recipient=fixture.staff[0],outboxId=await enqueueStaff(fixture,recipient,'Do not retarget a retry');
  let calls=0;
  const fetchImpl:typeof fetch=async()=>{calls++;return new Response(null,{status:503});};
  assert.equal((await dispatch(fixture.pool,fixture.key,fetchImpl)).failed,1);
  const frozen=(await fixture.pool.query('select recipient_user_id_encrypted,attempts,status from private.message_outbox where id=$1',[outboxId])).rows[0];
  assert.equal(frozen.attempts,1);assert.equal(frozen.status,'PENDING');
  assert.equal(decryptValue(frozen.recipient_user_id_encrypted,fixture.key)===recipient.userId,true);
  const changedUserId=lineUserId();
  await fixture.pool.query('update private.staff_line_identities set user_hash=$2,user_id_encrypted=$3 where staff_id=$1',
   [recipient.id,hashStaffLineUserId(changedUserId,fixture.key),encryptValue(changedUserId,fixture.key)]);
  await fixture.pool.query('update private.message_outbox set available_at=clock_timestamp() where id=$1',[outboxId]);
  const result=await dispatch(fixture.pool,fixture.key,fetchImpl);
  assert.equal(result.claimed,1);assert.equal(calls,1,'a changed binding receives no retry HTTP request');
  const final=(await fixture.pool.query('select status,last_error_code,attempts,recipient_user_id_encrypted from private.message_outbox where id=$1',[outboxId])).rows[0];
  assert.equal(final.status,'SUPPRESSED');assert.equal(final.last_error_code,'RECIPIENT_CHANGED');assert.equal(final.attempts,1);
  assert.equal(decryptValue(final.recipient_user_id_encrypted,fixture.key)===recipient.userId,true,'the frozen target remains the original recipient');
 }finally{await fixture.cleanup();}
});

test('expired unused Student Reply is persisted as Push with frozen recipient before HTTP',async()=>{
 const fixture=await createFixture({includeStudent:true});
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  const outboxId=await insertExpiredStudentReply(fixture);
  let calls=0;
  const fetchImpl:typeof fetch=async(input,init)=>{
   calls++;
   const row=(await fixture.pool.query(
    'select delivery_mode,attempts,recipient_user_id_encrypted,first_attempt_at,status from private.message_outbox where id=$1',[outboxId],
   )).rows[0];
   assert.equal(row.delivery_mode,'PUSH');assert.equal(row.attempts,1);assert.equal(row.status,'PROCESSING');
   assert.equal(row.first_attempt_at!==null,true,'first attempt time commits before HTTP');
   assert.equal(decryptValue(row.recipient_user_id_encrypted,fixture.key)===fixture.student!.userId,true,'frozen Student target is visible from another connection');
   assert.equal(String(input).endsWith('/v2/bot/message/push'),true,'expired Reply uses the Push endpoint');
   assert.equal(new Headers(init?.headers).get('authorization')==='Bearer '+testTokens.STUDENT,true);
   const body=String(init?.body),parsed=JSON.parse(body) as {to?:string;replyToken?:string;messages?:{text?:string}[]};
   assert.equal(parsed.to===fixture.student!.userId,true);assert.equal(parsed.replyToken,undefined);
   assert.equal(parsed.messages?.[0]?.text==='Expired reply falls back to Push',true);
   assert.equal(body.includes('fixture-only-expired-reply-token'),false,'the unused reply token is not sent to Push');
   return new Response(null,{status:200});
  };
  const result=await dispatch(fixture.pool,fixture.key,fetchImpl);
  assert.equal(result.claimed,1);assert.equal(result.sent,1);assert.equal(calls,1);
  const final=(await fixture.pool.query('select delivery_mode,status,attempts from private.message_outbox where id=$1',[outboxId])).rows[0];
  assert.deepEqual(final,{delivery_mode:'PUSH',status:'SENT',attempts:1});
 }finally{await fixture.cleanup();}
});

test('database channel-kind checks reject Staff SYSTEM and Student NOTIFICATION outbox rows',async()=>{
 const fixture=await createFixture();
 const client=await fixture.pool.connect();
 try{
  await assertOutboxReadyEmpty(fixture.pool,['STUDENT','STAFF']);
  await client.query('begin');
  await client.query('savepoint reject_staff_system');
  await assert.rejects(client.query(
   `insert into private.message_outbox(idempotency_key,channel,kind,recipient_staff_id,ticket_id,payload_encrypted,delivery_mode)
    values($1,'STAFF','SYSTEM',$2,$3,$4,'PUSH')`,
   [`invalid-staff-kind:${randomUUID()}`,fixture.staff[0].id,fixture.ticketId,encryptValue('{"messages":[{"type":"text","text":"fixture"}]}',fixture.key)],
  ),(error:unknown)=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='23514');
  await client.query('rollback to savepoint reject_staff_system');
  await client.query('savepoint reject_student_notification');
  await assert.rejects(client.query(
   `insert into private.message_outbox(idempotency_key,channel,kind,line_session_id,payload_encrypted,delivery_mode)
    values($1,'STUDENT','NOTIFICATION',$2,$3,'PUSH')`,
   [`invalid-student-kind:${randomUUID()}`,fixture.sessionId,encryptValue('{"messages":[{"type":"text","text":"fixture"}]}',fixture.key)],
  ),(error:unknown)=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='23514');
  await client.query('rollback to savepoint reject_student_notification');
  await client.query('commit');
 }finally{
  await client.query('rollback').catch(()=>undefined);client.release();await fixture.cleanup();
 }
});
