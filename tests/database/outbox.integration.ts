import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {Pool} from 'pg';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {randomBytes} from 'node:crypto';

test('outbox claims enforce recipient order and leave other recipients available',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
 await client.connect();
 try{
  await client.query('begin');
  const a=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Test-${randomUUID()}`])).rows[0].id;
  const b=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Test-${randomUUID()}`])).rows[0].id;
  const insert=await client.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$4,'SYSTEM','encrypted'),($2,$4,'SYSTEM','encrypted'),($3,$5,'SYSTEM','encrypted') returning id",[randomUUID(),randomUUID(),randomUUID(),a,b]);
  const first=(await client.query("select * from private.claim_outbox('STUDENT')")).rows[0];
  const other=(await client.query("select * from private.claim_outbox('STUDENT')")).rows[0];
  assert.equal(first.id,insert.rows[0].id);assert.equal(other.id,insert.rows[2].id);
  assert.equal((await client.query("select * from private.claim_outbox('STUDENT')")).rowCount,0);
 }finally{await client.query('rollback');await client.end();}
});

test('concurrent outbox claimers have only one winner for one committed recipient job',async()=>{
 const local='postgresql://postgres:postgres@127.0.0.1:54422/postgres',setup=new Client({connectionString:local}),a=new Client({connectionString:local}),b=new Client({connectionString:local});
 await Promise.all([setup.connect(),a.connect(),b.connect()]);
 const session=(await setup.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Concurrent-${randomUUID()}`])).rows[0].id;
 const job=(await setup.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$2,'SYSTEM','encrypted') returning id",[randomUUID(),session])).rows[0].id;
 try{
  const results=await Promise.all([a.query("select * from private.claim_outbox('STUDENT')"),b.query("select * from private.claim_outbox('STUDENT')")]);
  assert.equal(results.reduce((count,result)=>count+(result.rowCount??0),0),1);
  assert.equal(results.some(result=>result.rows[0]?.id===job),true);
 }finally{await setup.query('delete from private.message_outbox where id=$1',[job]);await setup.query('delete from public.line_sessions where id=$1',[session]);await Promise.all([setup.end(),a.end(),b.end()]);}
});

test('expired attempted Reply is UNKNOWN and never reclaimed or switched to Push',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});await client.connect();
 try{
  await client.query('begin');
  const session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Reply-${randomUUID()}`])).rows[0].id;
  const job=(await client.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted,delivery_mode,status,attempts,lease_token,lease_until) values($1,$2,'SYSTEM','encrypted','REPLY','PROCESSING',1,gen_random_uuid(),clock_timestamp()-interval '1 second') returning id",[randomUUID(),session])).rows[0].id;
  assert.equal((await client.query("select * from private.claim_outbox('STUDENT')")).rowCount,0);
  assert.deepEqual((await client.query('select status,delivery_mode from private.message_outbox where id=$1',[job])).rows[0],{status:'UNKNOWN',delivery_mode:'REPLY'});
 }finally{await client.query('rollback');await client.end();}
});

test('real outbox dispatch commits attempt before HTTP and retry preserves key/body',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2});
 const key=randomBytes(32).toString('base64'),session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Outbox-${randomUUID()}`])).rows[0].id;
 const userId=`U${randomUUID().replaceAll('-','')}`;
 await pool.query("insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)",[session,hashLineUserId(userId,key),encryptValue(userId,key)]);
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$2,'SYSTEM',$3) returning id",[randomUUID(),session,encryptValue(JSON.stringify({messages:[{type:'text',text:'ทดสอบส่ง'}]}),key)])).rows[0].id;
 const requests:{retry:string|null;body:string}[]=[];
 const fetchImpl:typeof fetch=async (_url,init)=>{
  const committed=(await pool.query('select attempts from private.message_outbox where id=$1',[outbox])).rows[0];
  assert.equal(committed.attempts,requests.length+1,'attempt is visible from another connection before HTTP');
  requests.push({retry:new Headers(init?.headers).get('x-line-retry-key'),body:String(init?.body)});
  return new Response(null,{status:requests.length===1?503:409});
 };
 try{
  const first=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl});
  assert.equal(first.claimed,1);assert.equal(first.failed,1);
  await pool.query('update private.message_outbox set available_at=clock_timestamp() where id=$1',[outbox]);
  const second=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl});
  assert.equal(second.sent,1);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
  assert.equal((await pool.query('select status from private.message_outbox where id=$1',[outbox])).rows[0].status,'SENT');
 }finally{
  await pool.query('delete from private.delivery_attempts where outbox_id=$1',[outbox]);await pool.query('delete from private.message_outbox where id=$1',[outbox]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
});

test('a database finalization failure after accepted Push retries safely with the same key',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2});
 const key=randomBytes(32).toString('base64'),suffix=randomUUID().replaceAll('-',''),name=`fixture_delivery_${suffix}`;
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Failure-${randomUUID()}`])).rows[0].id;
 const user=`U${randomUUID().replaceAll('-','')}`;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$2,'SYSTEM',$3) returning id",[randomUUID(),session,encryptValue(JSON.stringify({messages:[{type:'text',text:'DB failure fixture'}]}),key)])).rows[0].id;
 const requests:{body:string;key:string|null}[]=[];
 const fetchImpl:typeof fetch=async(_url,init)=>{requests.push({body:String(init?.body),key:new Headers(init?.headers).get('x-line-retry-key')});return new Response(null,{status:requests.length===1?200:409});};
 try{
  // Both interpolated identifiers come only from randomUUID, never request input. Fixture is local and narrowly targeted.
  await pool.query(`create function private.${name}() returns trigger language plpgsql as $fixture$ begin if new.outbox_id='${outbox}'::uuid then raise exception 'controlled finalization failure' using errcode='40001'; end if; return new; end $fixture$`);
  await pool.query(`create trigger ${name} before insert on private.delivery_attempts for each row execute function private.${name}()`);
  await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl});
  const failed=(await pool.query('select status,attempts from private.message_outbox where id=$1',[outbox])).rows[0];
  assert.deepEqual(failed,{status:'PENDING',attempts:1});
  await pool.query(`drop trigger ${name} on private.delivery_attempts`);await pool.query(`drop function private.${name}()`);
  await pool.query('update private.message_outbox set available_at=clock_timestamp() where id=$1',[outbox]);
  assert.equal((await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fake',STAFF:'fake'},fetchImpl})).sent,1);
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 }finally{
  await pool.query(`drop trigger if exists ${name} on private.delivery_attempts`);await pool.query(`drop function if exists private.${name}()`);
  await pool.query('delete from private.delivery_attempts where outbox_id=$1',[outbox]);await pool.query('delete from private.message_outbox where id=$1',[outbox]);
  await pool.query('delete from private.line_identities where line_session_id=$1',[session]);await pool.query('delete from public.line_sessions where id=$1',[session]);await pool.end();
 }
});
