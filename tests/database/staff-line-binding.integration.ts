import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {createBindingChallenge,getBindingStatus,unlinkStaffLine,consumeStaffBinding} from '../../lib/staff/line-binding';
import {parseBindingCommand} from '../../lib/staff/line-binding-contracts';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import {transaction} from '../../lib/database/pool';
import {processInboxEvent} from '../../lib/queue/process-inbox';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:5,application_name:'staff-binding-owned-qa'});
after(()=>pool.end());
async function fixture(){
 const key=randomBytes(32).toString('base64'),staff=randomUUID(),other=randomUUID(),department=randomUUID(),user='U'+randomUUID().replaceAll('-','');
 await pool.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$2,$2)',[department,'BIND_'+department.replaceAll('-','')]);
 for(const id of [staff,other]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,department_id,role,display_name) values($1,$2,'STAFF','QA')",[id,department]);}
 const options={pool,encryptionKey:key};
 const issue=(actor=staff,requestId=randomUUID())=>createBindingChallenge(actor,{requestId},options);
 const claim=(command:string,identity=user)=>transaction(c=>consumeStaffBinding(c,command,identity,key),pool);
 return {key,staff,other,department,user,options,issue,claim};
}
test('issuer-only encrypted challenge recovery, supersession and safe status DTO',async()=>{
 const f=await fixture(),requestId=randomUUID();const a=await f.issue(f.staff,requestId),retry=await f.issue(f.staff,requestId);
 assert.deepEqual(a,retry);assert(parseBindingCommand(a.command));
 const row=(await pool.query('select * from private.staff_binding_challenges where staff_id=$1',[f.staff])).rows[0];
 assert.equal(decryptValue(row.token_encrypted,f.key),parseBindingCommand(a.command));assert(!JSON.stringify(row).includes(a.command));assert(!JSON.stringify(row).includes(parseBindingCommand(a.command)!));
 assert.deepEqual(await getBindingStatus(f.staff,{pool}),{bound:false,pending:true,expiresAt:a.expiresAt});
 const other=await f.issue(f.other,requestId);assert.notEqual(other.command,a.command);
 const b=await f.issue();assert.notEqual(b.command,a.command);assert.equal(await f.claim(a.command),'BINDING_INVALID');
 await assert.rejects(f.issue(f.staff,requestId),{code:'CHALLENGE_EXPIRED'});assert.equal(await f.claim(b.command),null);
 assert.deepEqual(await getBindingStatus(f.staff,{pool}),{bound:true,pending:false,expiresAt:null});
});
test('exact command, one identity, same-user duplicate and actor authorization are enforced',async()=>{
 const f=await fixture(),a=await f.issue();assert.equal(await f.claim(a.command+' '),'BINDING_INVALID');
 assert.equal(await f.claim(a.command),null);assert.equal(await f.claim(a.command),null);
 assert.equal(await f.claim(a.command,'Uanother'),'BINDING_INVALID');
 await assert.rejects(f.issue(),{code:'ALREADY_BOUND'});
 const row=(await pool.query('select * from private.staff_line_identities where staff_id=$1',[f.staff])).rows[0];
 assert.equal(row.user_hash,hashStaffLineUserId(f.user,f.key));assert.equal(decryptValue(row.user_id_encrypted,f.key),f.user);assert(!JSON.stringify(row).includes(f.user));
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);
 assert.equal(await f.claim(a.command),'BINDING_INVALID');await assert.rejects(getBindingStatus(f.staff,{pool}),{code:'NOT_FOUND'});
});
test('expired and deactivated challenges cannot bind or mint roles',async()=>{
 const f=await fixture(),a=await f.issue();await pool.query("update private.staff_binding_challenges set expires_at=clock_timestamp()-interval '1 second' where staff_id=$1",[f.staff]);
 assert.equal(await f.claim(a.command),'BINDING_EXPIRED');assert.equal((await getBindingStatus(f.staff,{pool})).pending,false);
 const b=await f.issue();await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);assert.equal(await f.claim(b.command),'BINDING_INVALID');
 await assert.rejects(f.issue(),{code:'NOT_FOUND'});
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where staff_id=$1',[f.staff])).rows[0].n,0);
});
test('concurrent attempts to bind one LINE identity to different staff cannot transfer ownership',async()=>{
 const f=await fixture(),a=await f.issue(),b=await f.issue(f.other);
 const results=await Promise.all([f.claim(a.command),f.claim(b.command)]);assert.equal(results.filter(x=>x===null).length,1);assert.equal(results.filter(x=>x==='BINDING_UNAVAILABLE').length,1);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_identities where user_hash=$1',[hashStaffLineUserId(f.user,f.key)])).rows[0].n,1);
 const owner=(await pool.query('select staff_id from private.staff_line_identities where user_hash=$1',[hashStaffLineUserId(f.user,f.key)])).rows[0].staff_id;
 await unlinkStaffLine(owner,{pool});assert.equal(await f.claim(owner===f.staff?b.command:a.command),'BINDING_UNAVAILABLE');
});
async function ticket(f:Awaited<ReturnType<typeof fixture>>){
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 return (await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,'QA binding','IT_NETWORK','HUMAN','WAITING_STAFF') returning id",[session,conversation,f.department])).rows[0].id as string;
}
test('unlink invalidates challenges/action tokens and suppresses later actual Staff outbox delivery',async()=>{
 const f=await fixture(),a=await f.issue();assert.equal(await f.claim(a.command),null);const id=await ticket(f);
 await pool.query("insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at) values($1,$2,$3,'ACCEPT',0,clock_timestamp()+interval '10 minutes')",[randomBytes(32).toString('hex'),f.staff,id]);
 const outbox=await transaction(c=>enqueueOutbound(c,{idempotencyKey:randomUUID(),channel:'STAFF',recipientStaffId:f.staff,ticketId:id,kind:'NOTIFICATION',messages:[{type:'text',text:'QA notification'}]},f.key),pool);
 assert(outbox);
 const result=await unlinkStaffLine(f.staff,{pool});assert.deepEqual(result,{bound:false,pending:false,expiresAt:null});assert.deepEqual(await unlinkStaffLine(f.staff,{pool}),result);
 assert.equal(await f.claim(a.command),'BINDING_INVALID');
 assert.equal((await pool.query('select count(*)::int n from private.staff_action_tokens where staff_id=$1 and consumed_at is null',[f.staff])).rows[0].n,0);
 let calls=0;await runOutboxCycle(pool,f.key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl:async()=>{calls++;return new Response(null,{status:200});}});assert.equal(calls,0);
 assert.equal((await pool.query('select status from private.message_outbox where id=$1',[outbox])).rows[0].status,'SUPPRESSED');
 const b=await f.issue();assert.equal(await f.claim(b.command,'Ureplacement'),null);assert.equal(await f.claim(a.command),'BINDING_INVALID');
});
test('unlink waits behind the established Staff delivery fence',async()=>{
 const f=await fixture(),a=await f.issue();assert.equal(await f.claim(a.command),null);const lock=await pool.connect();
 await lock.query('select pg_advisory_lock(hashtextextended($1,0))',[`delivery:STAFF:${f.staff}`]);let complete=false;
 const pending=unlinkStaffLine(f.staff,{pool}).then(r=>{complete=true;return r;});
 try{
  let waiting=false;for(let i=0;i<40;i++){waiting=(await pool.query("select exists(select 1 from pg_stat_activity where application_name='staff-binding-owned-qa' and wait_event='advisory') yes")).rows[0].yes;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
  assert(waiting,'real pending advisory lock');assert.equal(complete,false);
 }finally{await lock.query('select pg_advisory_unlock(hashtextextended($1,0))',[`delivery:STAFF:${f.staff}`]);lock.release();}
 assert.equal((await pending).bound,false);
});
test('Staff durable inbox binds in its lease transaction; stale completion rolls back all effects',async()=>{
 const f=await fixture(),a=await f.issue();
 async function ingress(command:string,expire?:'before'|'after'){
  const event={type:'message',source:{type:'user',userId:f.user},message:{type:'text',id:randomUUID(),text:command},replyToken:'synthetic'};
  const job=(await pool.query("insert into private.webhook_inbox(channel,event_id,event_kind,user_hash,payload_encrypted,status,lease_token,lease_until) values('STAFF',$1,'MESSAGE',$2,$3,'PROCESSING',gen_random_uuid(),clock_timestamp()+interval '1 minute') returning *",[randomUUID(),hashLineUserId(f.user,f.key),encryptValue(JSON.stringify(event),f.key)])).rows[0];
  return transaction(async c=>{
   if(expire==='before')await c.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[job.id]);
   const fenced=new Proxy(c,{get(target,prop){if(prop!=='query')return Reflect.get(target,prop);return async(text:string,values?:unknown[])=>{
    if(expire==='after'&&text.startsWith("update private.webhook_inbox set status='DONE'"))await target.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[job.id]);
    return target.query(text,values);
   };}});
   await processInboxEvent(fenced,job,f.key);return job.id;
  },pool);
 }
 for(const when of ['before','after'] as const){await assert.rejects(ingress(a.command,when),/STALE_LEASE/);assert.equal((await getBindingStatus(f.staff,{pool})).bound,false);}
 const id=await ingress(a.command);assert.equal((await pool.query('select status from private.webhook_inbox where id=$1',[id])).rows[0].status,'DONE');assert.equal((await getBindingStatus(f.staff,{pool})).bound,true);
 assert.equal((await pool.query('select count(*)::int n from private.staff_inbound_messages where source_event_id=$1',[id])).rows[0].n,0);
});
test('challenge table denies browser roles and has indexed ownership without plaintext identities',async()=>{
 for(const role of ['anon','authenticated'])assert.equal((await pool.query("select has_table_privilege($1,'private.staff_binding_challenges','select,insert,update,delete') allowed",[role])).rows[0].allowed,false);
 assert.equal((await pool.query("select relrowsecurity from pg_class where oid='private.staff_binding_challenges'::regclass")).rows[0].relrowsecurity,true);
 const f=await fixture(),a=await f.issue();assert.equal(await f.claim(a.command),null);
 await assert.rejects(pool.query('update private.staff_binding_challenges set request_id=$2 where staff_id=$1',[f.staff,randomUUID()]),{code:'23514'});
 await assert.rejects(pool.query('update private.staff_binding_challenges set consumed_at=null,consumed_user_hash=null where staff_id=$1',[f.staff]),{code:'23514'});
 await unlinkStaffLine(f.staff,{pool});await assert.rejects(pool.query('update private.staff_binding_challenges set invalidated_at=null where staff_id=$1',[f.staff]),{code:'23514'});
});
