import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {runIncidentCycle} from '../../lib/incidents/worker';
import {getIncident,listIncidents,parseIncidentQuery,getIncidentRules,getSimilarIssues} from '../../lib/incidents/reads';
import {changeIncidentStatus,updateIncidentRules} from '../../lib/incidents/actions';
import {decryptValue} from '../../lib/security/identity';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'incident-owned-qa'});
after(()=>pool.end());
const vector=Array.from({length:384},(_,i)=>i===0?1:0);
async function fixture(sameSession=false,total=5){
 await pool.query("update private.incident_detection_jobs set status='DONE',lease_token=null,lease_until=null");
 await pool.query('update private.incident_rules set min_reports=5,min_distinct_sessions=5,window_minutes=15,min_similarity=.85 where id=1');
 const department=randomUUID(),otherDepartment=randomUUID(),superAdmin=randomUUID(),staff=randomUUID(),supervisor=randomUUID();
 for(const id of [department,otherDepartment])await pool.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$2,$2)',[id,'INC_'+id.replaceAll('-','')]);
 for(const id of [superAdmin,staff,supervisor])await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query(`insert into public.staff_profiles(id,department_id,role,display_name) values($1,null,'SUPER_ADMIN','QA'),($2,$4,'STAFF','QA'),($3,$4,'SUPERVISOR','QA')`,[superAdmin,staff,supervisor,department]);
 const tickets:string[]=[],sessions:string[]=[];let firstSession:string|undefined;
 for(let i=0;i<total;i++){
  const session=sameSession&&firstSession?firstSession:randomUUID();
  if(!sessions.includes(session)){await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,'INCIDENT_QA_'+session]);sessions.push(session);}
  firstSession=session;const conversation=randomUUID(),id=randomUUID();
  await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type) values($1,$2,'HUMAN','TICKET')",[conversation,session]);
  await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,$4,'ปัญหาทดสอบเครือข่ายโดยไม่มีข้อมูลบุคคล','IT_NETWORK','HUMAN','WAITING_STAFF')",[id,session,conversation,department]);tickets.push(id);
 }
 const list=(actor=staff)=>listIncidents(actor,parseIncidentQuery(new URLSearchParams('department='+department)),{pool});
 const drain=async()=>{const results=[];for(let i=0;i<total;i++)results.push(await runIncidentCycle(pool,{embed:async()=>vector}));return results;};
 return {department,otherDepartment,superAdmin,staff,supervisor,tickets,sessions,list,drain};
}
test('actual E5-shaped enrichment commits before HTTP and detects one idempotent five-report incident without ticket state changes',async()=>{
 const f=await fixture();let detected=0,calls=0;
 for(let i=0;i<5;i++){
  const result=await runIncidentCycle(pool,{embed:async()=>{
   calls++;const open=(await pool.query("select count(*)::int n from pg_stat_activity where application_name='incident-owned-qa' and pid<>pg_backend_pid() and xact_start is not null")).rows[0].n;
   assert.equal(open,0,'CPU HTTP stays outside SQL');return vector;
  }});assert.equal(result.failed,0);detected+=result.detected;
 }
 assert.equal(calls,5);assert.equal(detected,1);const page=await f.list();assert.equal(page.pagination.total,1);
 assert.equal(page.items[0].reportCount,5);assert.equal(page.items[0].distinctSessionCount,5);
 const detail=await getIncident(f.staff,page.items[0].id,{pool});assert.equal(detail.tickets.length,5);assert.equal(detail.canManage,false);
 assert(!JSON.stringify(detail).includes(f.sessions[0]));assert(!JSON.stringify(detail).includes('embedding'));
 assert(detail.tickets.every(t=>t.status==='WAITING_STAFF'));
 const similar=await getSimilarIssues(f.staff,f.tickets[0],{pool});assert.equal(similar.status,'READY');assert.equal(similar.items.length,4);
 assert(!JSON.stringify(similar).includes(f.sessions[0]));assert(!JSON.stringify(similar).includes('เครือข่าย'));
 assert.equal((await runIncidentCycle(pool,{embed:async()=>{throw Error('MUST_NOT_RUN');}})).claimed,0);
});
test('concurrent overlapping cohorts cannot bridge dissimilar members or create a second below-threshold incident',async()=>{
 const f=await fixture(false,7);
 const angled=(angle:number)=>vector.map((_,i)=>i===0?Math.cos(angle*Math.PI/180):i===1?Math.sin(angle*Math.PI/180):0);
 for(let i=0;i<f.tickets.length;i++)await pool.query(`insert into private.incident_ticket_vectors(ticket_id,ticket_revision,embedding,embedding_fingerprint)
  select id,revision,$2::extensions.vector,$3 from public.tickets where id=$1`,[f.tickets[i],JSON.stringify(i<5?vector:angled(i===5?-25:25)),LOCAL_EMBEDDING_FINGERPRINT]);
 await pool.query("update private.incident_detection_jobs set status='DONE' where ticket_id=any($1::uuid[])",[f.tickets.slice(0,5)]);
 let waiting=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const run=(angle:number)=>runIncidentCycle(pool,{embed:async()=>{waiting++;if(waiting===2)release();await barrier;return angled(angle);}});
 const results=await Promise.all([run(-25),run(25)]);assert(results.every(r=>r.failed===0));
 const page=await f.list();assert.equal(page.pagination.total,1);assert.equal(page.items[0].reportCount,6);assert.equal(page.items[0].distinctSessionCount,6);
 assert.equal((await pool.query('select count(*)::int n from public.incident_tickets where incident_id=$1',[page.items[0].id])).rows[0].n,6);
});
test('extending an incident rechecks conflicting known context on members outside the detection window',async()=>{
 const f=await fixture();await f.drain();const incident=(await f.list()).items[0];
 await pool.query("update private.incident_ticket_vectors set location_code='BUILDING_A' where ticket_id=$1",[f.tickets[0]]);
 await pool.query("update public.tickets set created_at=clock_timestamp()-interval '30 minutes' where id=$1",[f.tickets[0]]);
 const session=randomUUID(),conversation=randomUUID(),ticket=randomUUID();
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,'INCIDENT_QA_'+session]);
 await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type) values($1,$2,'HUMAN','TICKET')",[conversation,session]);
 await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,$4,'Context fixture','IT_NETWORK','HUMAN','WAITING_STAFF')",[ticket,session,conversation,f.department]);
 await pool.query("insert into private.incident_ticket_vectors(ticket_id,ticket_revision,embedding,embedding_fingerprint,location_code) select id,revision,$2::extensions.vector,$3,'BUILDING_B' from public.tickets where id=$1",[ticket,JSON.stringify(vector),LOCAL_EMBEDDING_FINGERPRINT]);
 const result=await runIncidentCycle(pool,{embed:async()=>vector});assert.equal(result.failed,0);assert.equal(result.detected,0);
 assert.equal((await f.list()).pagination.total,1);assert.equal((await getIncident(f.staff,incident.id,{pool})).incident.reportCount,5);
 assert.equal((await pool.query('select count(*)::int n from public.incident_tickets where ticket_id=$1',[ticket])).rows[0].n,0);
});
test('critical impact requires a durable encrypted staff verification, never naked booleans',async()=>{
 const f=await fixture();await f.drain();const incident=(await f.list()).items[0];
 const requestId=randomUUID(),encryptionKey=randomBytes(32).toString('base64');
 const base={revision:incident.revision,requestId,status:'INVESTIGATING',impact:{campusWide:true,criticalService:true,confirmedOutage:true}};
 await assert.rejects(()=>changeIncidentStatus(f.supervisor,incident.id,base,{pool,encryptionKey}),/INVALID_REQUEST/);
 await assert.rejects(()=>changeIncidentStatus(f.supervisor,incident.id,{...base,impact:{...base.impact,verificationNote:'short'}},{pool,encryptionKey}),/INVALID_REQUEST/);
 const input={...base,impact:{...base.impact,verificationNote:'เจ้าหน้าที่ตรวจยืนยันบริการสำคัญหยุดใช้งานทั่วมหาวิทยาลัย'}};
 assert.equal((await changeIncidentStatus(f.supervisor,incident.id,input,{pool,encryptionKey})).replayed,false);
 assert.equal((await getIncident(f.staff,incident.id,{pool})).incident.severity,'CRITICAL');
 const receipt=(await pool.query('select impact_verification_encrypted from private.incident_action_receipts where actor_id=$1 and incident_id=$2 and request_id=$3',[f.supervisor,incident.id,requestId])).rows[0];
 assert(!receipt.impact_verification_encrypted.includes(input.impact.verificationNote));
 assert.deepEqual(JSON.parse(decryptValue(receipt.impact_verification_encrypted,encryptionKey)),input.impact);
 assert(!JSON.stringify(await getIncident(f.staff,incident.id,{pool})).includes(input.impact.verificationNote));
 assert.equal((await changeIncidentStatus(f.supervisor,incident.id,input,{pool,encryptionKey})).replayed,true);
});
test('five tickets from one session cannot create an incident',async()=>{
 const f=await fixture(true);await f.drain();assert.equal((await f.list()).pagination.total,0);
});
test('revision change during enrichment suppresses stale vector/membership and leaves the fresh job eligible',async()=>{
 await fixture();let ticket='';
 const result=await runIncidentCycle(pool,{embed:async()=>{
  ticket=(await pool.query("select ticket_id from private.incident_detection_jobs where status='PROCESSING'")).rows[0].ticket_id;
  await pool.query("update public.tickets set problem_summary='ฉบับใหม่',revision=revision+1 where id=$1",[ticket]);return vector;
 }});
 assert.equal(result.suppressed,1);assert.equal(result.failed,0);
 assert.equal((await pool.query('select count(*)::int n from private.incident_ticket_vectors where ticket_id=$1',[ticket])).rows[0].n,0);
 assert.equal((await pool.query('select status from private.incident_detection_jobs where ticket_id=$1',[ticket])).rows[0].status,'PENDING');
});
test('scope/sensitivity is rechecked for every linked ticket and all public/private incident data stays inaccessible to browser roles',async()=>{
 const f=await fixture();await f.drain();const incident=(await f.list()).items[0];
 await pool.query("update public.tickets set sensitive_level='RESTRICTED',revision=revision+1 where id=$1",[f.tickets[0]]);
 assert.equal((await f.list()).pagination.total,0);await assert.rejects(()=>getIncident(f.staff,incident.id,{pool}),/NOT_FOUND/);
 assert.equal((await getSimilarIssues(f.staff,f.tickets[1],{pool})).items.length,3);
 assert.equal((await f.list(f.superAdmin)).pagination.total,1);
 await pool.query('update public.tickets set department_id=$2,revision=revision+1 where id=$1',[f.tickets[1],f.otherDepartment]);
 await assert.rejects(()=>changeIncidentStatus(f.supervisor,incident.id,{revision:incident.revision,requestId:randomUUID(),status:'INVESTIGATING'},{pool}),/NOT_FOUND/);
 for(const role of ['anon','authenticated']){
  const c=await pool.connect();try{await c.query('begin');
   const ids=(await c.query("select 'public.incidents'::regclass::oid public_id,'private.incident_ticket_vectors'::regclass::oid private_id")).rows[0];await c.query(`set local role ${role}`);
   assert.equal((await c.query("select has_table_privilege(current_user,$1::oid,'SELECT') allowed",[ids.public_id])).rows[0].allowed,false);
   assert.equal((await c.query("select has_table_privilege(current_user,$1::oid,'SELECT') allowed",[ids.private_id])).rows[0].allowed,false);
  }finally{await c.query('rollback');c.release();}
 }
});
test('status changes use fresh supervisor scope, revision and idempotency; configuration requires Super Admin',async()=>{
 const f=await fixture();await f.drain();const incident=(await f.list()).items[0],requestId=randomUUID();
 const input={revision:incident.revision,requestId,status:'INVESTIGATING'};
 await assert.rejects(()=>changeIncidentStatus(f.staff,incident.id,input,{pool}),/FORBIDDEN/);
 const first=await changeIncidentStatus(f.supervisor,incident.id,input,{pool});assert.equal(first.replayed,false);
 assert.equal((await changeIncidentStatus(f.supervisor,incident.id,input,{pool})).replayed,true);
 await assert.rejects(()=>changeIncidentStatus(f.supervisor,incident.id,{...input,status:'CLOSED'},{pool}),/CONFLICT/);
 await assert.rejects(()=>changeIncidentStatus(f.supervisor,incident.id,{...input,requestId:randomUUID()},{pool}),/CONFLICT/);
 const rules=await getIncidentRules(f.superAdmin,{pool});await assert.rejects(()=>getIncidentRules(f.supervisor,{pool}),/FORBIDDEN/);
 await assert.rejects(()=>updateIncidentRules(f.staff,{...rules,rules:{...rules.rules,minReports:4}},{pool}),/FORBIDDEN|INVALID_REQUEST/);
 const next=await updateIncidentRules(f.superAdmin,{revision:rules.revision,rules:{...rules.rules,minReports:3,minDistinctSessions:3}},{pool});assert.equal(next.revision,rules.revision+1);
 await assert.rejects(()=>updateIncidentRules(f.superAdmin,{revision:rules.revision,rules:rules.rules},{pool}),/CONFLICT/);
 assert((await pool.query('select status from public.tickets where id=any($1::uuid[])',[f.tickets])).rows.every(r=>r.status==='WAITING_STAFF'));
});
