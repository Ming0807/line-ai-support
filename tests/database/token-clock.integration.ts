import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {hashOpaqueToken,consumeChoice} from '../../lib/conversation/quick-reply';
import {hashStaffLineUserId,encryptValue} from '../../lib/security/identity';
import {processStaffCommand} from '../../lib/tickets/staff-command';

test('database-expired choice cannot be consumed when app clock lags',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});await client.connect();
 const key=randomBytes(32).toString('base64'),token=randomBytes(32).toString('base64url'),originalNow=Date.now;
 try{
  await client.query('begin');
  const session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Clock-${randomUUID()}`])).rows[0].id;
  await client.query("insert into private.pending_route_choices(token_hash,line_session_id,choice,candidate_snapshot,expires_at) values($1,$2,'{\"action\":\"NEW\"}','[]',clock_timestamp()-interval '1 second')",[hashOpaqueToken(token,key),session]);
  Date.now=()=>0;
  assert.equal(await consumeChoice(client,session,`yru:choice:${token}`,[],key),null);
  assert.equal((await client.query('select consumed_at from private.pending_route_choices where token_hash=$1',[hashOpaqueToken(token,key)])).rows[0].consumed_at,null);
 }finally{Date.now=originalNow;await client.query('rollback');await client.end();}
});

test('database-expired Staff ACCEPT token is denied despite a lagging app clock',async()=>{
 const client=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});await client.connect();
 const key=randomBytes(32).toString('base64'),token=randomBytes(32).toString('base64url'),staff=randomUUID(),user=`U${randomUUID().replaceAll('-','')}`,originalNow=Date.now;
 try{
  await client.query('begin');await client.query('insert into auth.users(id) values($1)',[staff]);
  await client.query("insert into public.staff_profiles(id,display_name,role) values($1,'Clock fixture','SUPER_ADMIN')",[staff]);
  await client.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted) values($1,$2,$3)',[staff,hashStaffLineUserId(user,key),encryptValue(user,key)]);
  const dept=(await client.query("insert into public.departments(code,name_th,name_en) values($1,'Test','Test') returning id",[`CLOCK-${randomUUID()}`])).rows[0].id;
  const session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Clock-${randomUUID()}`])).rows[0].id;
  const conversation=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
  const ticket=(await client.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode) values($1,$2,$3,'Test','HUMAN') returning id",[session,conversation,dept])).rows[0].id;
  await client.query("insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at) values($1,$2,$3,'ACCEPT',0,clock_timestamp()-interval '1 second')",[hashOpaqueToken(token,key,'staff-command'),staff,ticket]);
  Date.now=()=>0;
  assert.equal(await processStaffCommand(client,{type:'postback',source:{type:'user',userId:user},postback:{data:`yru:staff:accept:${token}`}},key),'INVALID_STAFF_COMMAND');
  assert.equal((await client.query('select revision from public.tickets where id=$1',[ticket])).rows[0].revision,0);
  assert.equal((await client.query('select consumed_at from private.staff_action_tokens where token_hash=$1',[hashOpaqueToken(token,key,'staff-command')])).rows[0].consumed_at,null);
 }finally{Date.now=originalNow;await client.query('rollback');await client.end();}
});
