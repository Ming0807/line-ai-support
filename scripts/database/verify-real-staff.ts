import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { databaseConnection } from '../../lib/database/connection';
import { developmentConfig, hasExpectedAccountSet, readCredentials } from '../auth/common';

const config=developmentConfig();
const credentials=await readCredentials();
if(!credentials || !hasExpectedAccountSet(credentials)) throw new Error('VERIFIED_STAFF_CREDENTIALS_REQUIRED');
const client=new Client(databaseConnection(config.directUrl));
const session=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()];
try {
 await client.connect();
 await client.query('begin');
 await client.query('insert into public.line_sessions(id,anonymous_code) values ($1,$2)',[session,`Anonymous #Dev-RLS-${randomUUID()}`]);
 for(const [index,department,sensitivity] of [[0,'IT','GENERAL'],[1,'LIBRARY','GENERAL'],[2,'IT','RESTRICTED']] as const) {
  const conversation=randomUUID();
  await client.query('insert into public.conversations(id,line_session_id) values ($1,$2)',[conversation,session]);
  await client.query(`insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,sensitive_level)
   values ($1,$2,$3,(select id from public.departments where code=$4),'Development rollback-only access fixture',$5)`,
  [ids[index],session,conversation,department,sensitivity]);
 }
 for(const account of credentials.accounts) {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:account.id,role:'authenticated'})]);
  const visible=(await client.query('select id from public.tickets where id=any($1::uuid[]) order by id',[ids])).rows.map(row=>row.id);
  const expected=account.role==='SUPER_ADMIN'?ids:account.departmentCode==='IT'?[ids[0]]:[ids[1]];
  if(visible.length!==expected.length || expected.some(id=>!visible.includes(id))) throw new Error('REAL_STAFF_SCOPE_ASSERTION_FAILED');
  const profile=(await client.query('select id,role from public.staff_profiles')).rows;
  if(profile.length!==1 || profile[0].id!==account.id || profile[0].role!==account.role) throw new Error('REAL_STAFF_SELF_PROFILE_ASSERTION_FAILED');
  await client.query('reset role');
  console.log(JSON.stringify({stage:'real_subject_rls',role:account.role,department:account.departmentCode,
   scopedTicketCount:visible.length,crossDepartmentDenied:account.role!=='SUPER_ADMIN',restrictedDenied:account.role!=='SUPER_ADMIN',selfProfileOnly:true}));
 }
 await client.query('rollback');
 const retained=await client.query('select count(*)::int as count from public.line_sessions where id=$1',[session]);
 if(retained.rows[0].count!==0) throw new Error('REAL_STAFF_FIXTURE_NOT_ROLLED_BACK');
 console.log('REAL_STAFF_RLS_VERIFIED_FIXTURES_ROLLED_BACK');
} catch(error) {
 await client.query('reset role').catch(()=>undefined);
 await client.query('rollback').catch(()=>undefined);
 const message=error instanceof Error?error.message:'';
 console.error(/^[A-Z_]+$/.test(message)?message:'REAL_STAFF_RLS_FAILED');
 process.exitCode=1;
} finally {await client.end();}
