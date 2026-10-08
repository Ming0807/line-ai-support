import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {applyTicketAction} from '../../lib/tickets/ticket-service';

async function fixture(){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:5}),key=randomBytes(32).toString('base64'),staff=randomUUID();
 await pool.query('insert into auth.users(id) values($1)',[staff]);
 const dept=(await pool.query("insert into public.departments(code,name_th,name_en) values($1,'ทดสอบ','Test') returning id",[`RACE-${randomUUID()}`])).rows[0].id;
 await pool.query("insert into public.staff_profiles(id,department_id,display_name,role) values($1,$2,'Test','STAFF')",[staff,dept]);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Race-${randomUUID()}`])).rows[0].id;
 const user=`U${randomUUID().replaceAll('-','')}`;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const ticket=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary) values($1,$2,$3,'Test') returning id",[session,conversation,dept])).rows[0].id;
 async function cleanup(){
  await pool.query('delete from private.delivery_attempts where outbox_id in(select id from private.message_outbox where line_session_id=$1)',[session]);
  await pool.query('delete from private.message_outbox where line_session_id=$1',[session]);
  await pool.query('delete from private.ticket_action_receipts where ticket_id=$1',[ticket]);
  await pool.query('delete from private.activities where ticket_id=$1',[ticket]);
  await pool.query('delete from public.ticket_history where ticket_id=$1',[ticket]);
  await pool.query('update public.conversations set active_ticket_id=null where id=$1',[conversation]);
  await pool.query('delete from private.incident_detection_jobs where ticket_id=$1',[ticket]);
  await pool.query('delete from private.incident_ticket_vectors where ticket_id=$1',[ticket]);
  await pool.query('delete from public.tickets where id=$1',[ticket]);await pool.query('delete from public.conversations where id=$1',[conversation]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);await pool.query('delete from public.line_sessions where id=$1',[session]);
  await pool.query('delete from public.staff_profiles where id=$1',[staff]);await pool.query('delete from auth.users where id=$1',[staff]);await pool.query('delete from public.departments where id=$1',[dept]);await pool.end();
 }
 const enqueue=()=>transaction(client=>enqueueOutbound(client,{idempotencyKey:randomUUID(),channel:'STUDENT',kind:'AI',lineSessionId:session,conversationId:conversation,conversationRevision:0,messages:[{type:'text',text:'Controlled AI fixture'}]},key),pool);
 return {pool,key,staff,ticket,conversation,session,enqueue,cleanup};
}

test('accept wins the generation race; old-revision AI enqueue is suppressed',async()=>{
 const f=await fixture(),owner=await f.pool.connect();
 try{
  await owner.query('begin');await applyTicketAction(owner,f.staff,f.ticket,'ACCEPT',{revision:0,requestId:randomUUID()},f.key);
  const pending=f.enqueue();
  await owner.query('commit');assert.equal(await pending,null);
  assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].n,0);
 }finally{await owner.query('rollback');owner.release();await f.cleanup();}
});

test('enqueue before takeover is suppressed before dispatch',async()=>{
 const f=await fixture();let calls=0;
 try{
  assert(await f.enqueue());
  await transaction(client=>applyTicketAction(client,f.staff,f.ticket,'ACCEPT',{revision:0,requestId:randomUUID()},f.key),f.pool);
  await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl:async()=>{calls++;return new Response(null,{status:200});}});
  assert.equal(calls,0);assert.equal((await f.pool.query('select status from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].status,'SUPPRESSED');
 }finally{await f.cleanup();}
});

test('dispatch and takeover serialize across bounded HTTP without an open SQL transaction',async()=>{
 const f=await fixture(),acceptClient=await f.pool.connect();let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;}),released=new Promise<void>(resolve=>{release=resolve;});
 let acceptance:Promise<unknown>|undefined,dispatch:Promise<unknown>|undefined;
 try{
  await f.enqueue();
  const transport:typeof fetch=async()=>{
   assert.equal((await f.pool.query('select mode from public.conversations where id=$1',[f.conversation])).rows[0].mode,'AI');
   // Attempt persistence must be visible independently while HTTP is pending.
   assert.equal((await f.pool.query('select attempts from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].attempts,1);
   enter();await released;return new Response(null,{status:200});
  };
  dispatch=runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl:transport});await entered;
  await acceptClient.query('begin');const pid=(await acceptClient.query('select pg_backend_pid() pid')).rows[0].pid;
  acceptance=applyTicketAction(acceptClient,f.staff,f.ticket,'ACCEPT',{revision:0,requestId:randomUUID()},f.key);
  let blocked=false;
  for(let i=0;i<100;i++){
   const wait=(await f.pool.query('select wait_event from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event;
   if(wait==='advisory'){blocked=true;break;}
  }
  assert(blocked,'takeover must wait on dispatch conversation lock');
  assert.equal((await f.pool.query('select mode from public.conversations where id=$1',[f.conversation])).rows[0].mode,'AI');
  release();await dispatch;await acceptance;await acceptClient.query('commit');
  assert.equal((await f.pool.query('select mode from public.conversations where id=$1',[f.conversation])).rows[0].mode,'HUMAN');
  assert.equal((await f.pool.query('select status from private.message_outbox where conversation_id=$1',[f.conversation])).rows[0].status,'SENT');
 }finally{release();if(dispatch)await dispatch;if(acceptance)await acceptance.catch(()=>{});await acceptClient.query('rollback');acceptClient.release();await f.cleanup();}
});
