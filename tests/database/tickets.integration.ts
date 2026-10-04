import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {applyTicketAction} from '../../lib/tickets/ticket-service';

const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4});
const key=randomBytes(32).toString('base64');
test('ticket ACCEPT atomically sets HUMAN and writes exactly one audit',async()=>{
 const client=await pool.connect(),staff=randomUUID();
 try{
  await client.query('begin');
  await client.query('insert into auth.users(id) values ($1)',[staff]);
  const dept=(await client.query("insert into public.departments(code,name_th,name_en) values ($1,'ฝ่ายทดสอบ','Test') returning id",[`TEST-${randomUUID()}`])).rows[0].id;
  await client.query("insert into public.staff_profiles(id,display_name,department_id,role) values ($1,'Test Staff',$2,'STAFF')",[staff,dept]);
  const session=(await client.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`Test-${randomUUID()}`])).rows[0].id;
  const conversation=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
  const ticket=(await client.query('insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary) values($1,$2,$3,\'ทดสอบ\') returning id',[session,conversation,dept])).rows[0].id;
  const result=await applyTicketAction(client,staff,ticket,'ACCEPT',{revision:0,requestId:randomUUID()},key);
  assert.equal(result.status,'STAFF_HANDLING');
  assert.equal(result.revision,1);
  assert.equal((await client.query('select mode from public.conversations where id=$1',[conversation])).rows[0].mode,'HUMAN');
  assert.equal((await client.query("select count(*)::int as n from public.ticket_history where ticket_id=$1 and action='ACCEPTED'",[ticket])).rows[0].n,1);
 }finally{await client.query('rollback');client.release();await pool.end();}
});
