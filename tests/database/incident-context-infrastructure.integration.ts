import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4,application_name:'incident-context-infrastructure-qa'});
const ownedDepartments:string[]=[];
after(async()=>{try{
 await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where department_id=any($1::uuid[]) and status<>'CLOSED'",[ownedDepartments]);
 await pool.query("update private.incident_detection_jobs j set status='DONE',lease_token=null,lease_until=null from public.tickets t where j.ticket_id=t.id and t.department_id=any($1::uuid[])",[ownedDepartments]);
 await pool.query('update public.departments set active=false where id=any($1::uuid[])',[ownedDepartments]);
}finally{await pool.end();}});
const hash='a'.repeat(64),cipher='v1.'+'x'.repeat(60);
async function current(){return (await pool.query("select revision::text epoch,(clock_timestamp() at time zone 'Asia/Bangkok')::date::text as \"day\" from private.structured_selection_epoch where id=1")).rows[0] as {epoch:string;day:string};}
async function fixture(){
 await pool.query("update public.tickets set status='CLOSED',revision=revision+1 where category='CTX_INFRA' and status<>'CLOSED'");
 await pool.query("update private.incident_detection_jobs j set status='DONE',lease_token=null,lease_until=null from public.tickets t where j.ticket_id=t.id and t.category='CTX_INFRA'");
 const department=randomUUID(),session=randomUUID(),conversation=randomUUID(),ticket=randomUUID();
 await pool.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$2,$2)',[department,'CTX_'+department.replaceAll('-','')]);
 ownedDepartments.push(department);
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,'CTX_INFRA_'+session]);
 await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type) values($1,$2,'HUMAN','TICKET')",[conversation,session]);
 await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,$3,$4,'Owned infrastructure fixture','CTX_INFRA','HUMAN','WAITING_STAFF')",[ticket,session,conversation,department]);
 return {department,session,conversation,ticket};
}
async function proof(ticket:string,state='READY',requires=true,day?:string){
 const token=await current();
 await pool.query(`insert into private.incident_context_proofs(ticket_id,ticket_revision,support_binding_digest,state,requires_catalog,catalog_revision,evaluation_date,proof_encrypted)
 values($1,0,$2,$3,$4,$5,$6,$7)`,[ticket,requires?hash:null,state,requires,requires?token.epoch:null,requires?day??token.day:null,state==='READY'&&requires?cipher:null]);
 await pool.query("update private.incident_detection_jobs set status='DONE',context_epoch=$2,context_evaluation_date=$3 where ticket_id=$1",[ticket,token.epoch,day??token.day]);
 return token;
}
test('private infrastructure uses RLS, exact column grants and no browser or destructive service privileges',async()=>{
 const objects=(await pool.query("select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('structured_selection_epoch','incident_context_proofs')")).rows;
 assert.equal(objects.length,2);assert(objects.every(row=>row.relrowsecurity));
 for(const role of ['anon','authenticated','service_role']){
  const c=await pool.connect();try{await c.query('begin');await c.query(`set local role ${role}`);
   for(const obj of objects){const rights=(await c.query("select has_table_privilege(current_user,$1::oid,'SELECT') read,has_table_privilege(current_user,$1::oid,'DELETE') remove,has_column_privilege(current_user,$1::oid,$2,'UPDATE') identity_write",[obj.oid,obj.relname==='structured_selection_epoch'?'id':'ticket_id'])).rows[0];
    assert.equal(rights.read,role==='service_role');assert.equal(rights.remove,false);assert.equal(rights.identity_write,false);
   }
  }finally{await c.query('rollback');c.release();}
 }
 const epoch=await current();assert.match(epoch.epoch,/^[0-9]+$/u);
 await assert.rejects(()=>pool.query('update private.structured_selection_epoch set revision=revision where id=1'),/CATALOG_EPOCH_INVALID/);
 await assert.rejects(()=>pool.query('update private.structured_selection_epoch set id=2,revision=revision+1 where id=1'),/CATALOG_EPOCH_INVALID/);
});
test('proof state enforces catalog/day pairs, encrypted READY copies and ticket foreign key',async()=>{
 const f=await fixture(),token=await current();
 const insert=(binding:string|null,state:string,requires:boolean,epoch:string|null,day:string|null,encrypted:string|null,ticket=f.ticket)=>pool.query(`insert into private.incident_context_proofs(ticket_id,ticket_revision,support_binding_digest,state,requires_catalog,catalog_revision,evaluation_date,proof_encrypted) values($1,0,$2,$3,$4,$5,$6,$7)`,[ticket,binding,state,requires,epoch,day,encrypted]);
 await assert.rejects(()=>insert(hash,'READY',true,token.epoch,null,cipher),/check constraint/);
 await assert.rejects(()=>insert(hash,'READY',false,null,null,null),/check constraint/);
 await assert.rejects(()=>insert(null,'READY',false,null,null,null,randomUUID()),/foreign key constraint/);
 await insert(null,'READY',false,null,null,null);
});
test('catalog mutation atomically invalidates known, negative and BLOCKED proofs and revokes stale leases',async()=>{
 const f=await fixture();await proof(f.ticket);await pool.query("update private.incident_detection_jobs set status='PROCESSING',lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds' where ticket_id=$1",[f.ticket,randomUUID()]);
 const before=await current();await pool.query('update public.departments set name_en=name_en where id=$1',[f.department]);const after=await current();assert(BigInt(after.epoch)>BigInt(before.epoch));
 const job=(await pool.query('select * from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0];assert.equal(job.status,'PENDING');assert.equal(job.lease_token,null);assert.equal(job.attempts,0);assert.equal(String(job.context_epoch),after.epoch);
 await pool.query("update private.incident_context_proofs set state='BLOCKED',proof_encrypted=null where ticket_id=$1",[f.ticket]);await pool.query("update private.incident_detection_jobs set status='DEAD',attempts=5 where ticket_id=$1",[f.ticket]);
 await pool.query('update public.departments set name_en=name_en where id=$1',[f.department]);assert.equal((await pool.query('select status from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0].status,'PENDING');
 assert.equal((await pool.query('select state from private.incident_context_proofs where ticket_id=$1',[f.ticket])).rows[0].state,'BLOCKED');
});
test('rolled-back eligibility mutations preserve epoch, queued state and retained proof',async()=>{
 const f=await fixture();await proof(f.ticket);const before=await current(),c=await pool.connect();
 try{await c.query('begin');await c.query('update public.departments set name_en=name_en where id=$1',[f.department]);assert(BigInt((await c.query('select revision from private.structured_selection_epoch')).rows[0].revision)>BigInt(before.epoch));await c.query('rollback');}finally{c.release();}
 assert.equal((await current()).epoch,before.epoch);assert.equal((await pool.query('select status from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0].status,'DONE');assert.equal((await pool.query('select count(*)::int n from private.incident_context_proofs where ticket_id=$1',[f.ticket])).rows[0].n,1);
});
test('catalog reader makes direct source and provenance writers retry rather than deadlock',async()=>{
 const f=await fixture(),c=await pool.connect();try{await c.query('begin');await c.query("select pg_advisory_xact_lock_shared(hashtextextended('knowledge-structured-selection-catalog:v1',0))");
  for(const sql of ['update public.departments set name_en=name_en where id=$1','update private.structured_row_provenance set mapper_version=mapper_version where false','update private.structured_publication_effects set mapper_version=mapper_version where false','update private.knowledge_import_publications set source_checksum=source_checksum where false','update private.knowledge_import_jobs set source_metadata_encrypted=source_metadata_encrypted where false']){
   await assert.rejects(()=>pool.query(sql,sql.includes('$1')?[f.department]:[]),(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='40001');
  }
 }finally{await c.query('rollback');c.release();}
});
test('day refresh is bounded and does not repeatedly reset same-day failures or live leases',async()=>{
 const f=await fixture();const today=await current(),yesterday=(await pool.query("select ($1::date-1)::text as \"day\"",[today.day])).rows[0].day;await proof(f.ticket,'READY',true,yesterday);
 await pool.query('select private.refresh_incident_context_jobs()');const first=(await pool.query('select * from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0];assert.equal(first.status,'PENDING');assert.equal(String(first.context_epoch),today.epoch);
 await pool.query("update private.incident_detection_jobs set status='DEAD',attempts=5 where ticket_id=$1",[f.ticket]);await pool.query('select private.refresh_incident_context_jobs()');assert.equal((await pool.query('select status,attempts from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0].attempts,5);
 const lease=randomUUID();await pool.query("update private.incident_detection_jobs set status='PROCESSING',attempts=1,lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds',context_epoch=null,context_evaluation_date=null where ticket_id=$1",[f.ticket,lease]);await pool.query('select private.refresh_incident_context_jobs()');assert.equal((await pool.query('select lease_token from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0].lease_token,lease);
});
test('late immutable support-copy insertion requeues its owned ticket without exposing or deleting previous proof',async()=>{
 const f=await fixture();await proof(f.ticket,'READY',false);
 await pool.query('insert into private.ticket_support_contexts(ticket_id,conversation_id,line_session_id,source_digest,state_digest,context_encrypted) values($1,$2,$3,$4,$4,$5)',[f.ticket,f.conversation,f.session,hash,cipher]);
 const job=(await pool.query('select * from private.incident_detection_jobs where ticket_id=$1',[f.ticket])).rows[0];assert.equal(job.status,'PENDING');assert.equal(job.context_epoch,null);
 assert.equal((await pool.query('select count(*)::int n from private.incident_context_proofs where ticket_id=$1',[f.ticket])).rows[0].n,1);
});
test('bounded day refresh processes at most100 and skips locked jobs without losing remaining work',async()=>{
 const f=await fixture(),stamp=await current();const fixtures=Array.from({length:105},()=>({id:randomUUID(),session:randomUUID(),conversation:randomUUID()}));
 const json=JSON.stringify(fixtures);
 await pool.query("insert into public.line_sessions(id,anonymous_code) select session,'CTX_INFRA_'||session::text from jsonb_to_recordset($1::jsonb) x(id uuid,session uuid,conversation uuid)",[json]);
 await pool.query("insert into public.conversations(id,line_session_id,mode,conversation_type) select conversation,session,'HUMAN','TICKET' from jsonb_to_recordset($1::jsonb) x(id uuid,session uuid,conversation uuid)",[json]);
 await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status) select id,session,conversation,$2,'Bounded fixture','CTX_INFRA','HUMAN','WAITING_STAFF' from jsonb_to_recordset($1::jsonb) x(id uuid,session uuid,conversation uuid)",[json,f.department]);
 const ids=fixtures.map(row=>row.id).sort();
 await pool.query(`insert into private.incident_context_proofs(ticket_id,ticket_revision,support_binding_digest,state,requires_catalog,catalog_revision,evaluation_date,proof_encrypted)
  select id,revision,$2,'READY',true,$3,($4::date-1),$5 from public.tickets where id=any($1::uuid[])`,[ids,hash,stamp.epoch,stamp.day,cipher]);
 await pool.query("update private.incident_detection_jobs set status='DONE',context_epoch=$2,context_evaluation_date=$3::date-1 where ticket_id=any($1::uuid[])",[ids,stamp.epoch,stamp.day]);
 const c=await pool.connect();try{await c.query('begin');await c.query('select ticket_id from private.incident_detection_jobs where ticket_id=$1 for update',[ids[0]]);
  assert.equal((await pool.query('select private.refresh_incident_context_jobs() n')).rows[0].n,100);
  const states=(await pool.query("select status,count(*)::int n from private.incident_detection_jobs where ticket_id=any($1::uuid[]) group by status",[ids])).rows;
  assert.equal(states.find(row=>row.status==='PENDING')?.n,100);assert.equal(states.find(row=>row.status==='DONE')?.n,5);
 }finally{await c.query('rollback');c.release();}
 assert.equal((await pool.query('select private.refresh_incident_context_jobs() n')).rows[0].n,5);
 assert.equal((await pool.query('select private.refresh_incident_context_jobs() n')).rows[0].n,0);
});
test('service role can advance protected epoch and persist proof without identity update or deletion',async()=>{
 const f=await fixture(),token=await current(),c=await pool.connect();try{await c.query('begin');await c.query('set local role service_role');
  const updated=(await c.query('update private.structured_selection_epoch set revision=revision+1 returning revision::text epoch,updated_at<=clock_timestamp() db_time')).rows[0];assert.equal(updated.epoch,(BigInt(token.epoch)+BigInt(1)).toString());assert.equal(updated.db_time,true);
  await c.query("insert into private.incident_context_proofs(ticket_id,ticket_revision,state,requires_catalog) values($1,0,'READY',false)",[f.ticket]);
  await c.query("update private.incident_context_proofs set state='BLOCKED' where ticket_id=$1",[f.ticket]);
  assert.equal((await c.query('select state from private.incident_context_proofs where ticket_id=$1',[f.ticket])).rows[0].state,'BLOCKED');
  await assert.rejects(()=>c.query('update private.incident_context_proofs set ticket_id=ticket_id where ticket_id=$1',[f.ticket]),/permission denied/);
 }finally{await c.query('rollback');c.release();}
 const d=await pool.connect();try{await d.query('begin');await d.query('set local role service_role');await assert.rejects(()=>d.query('delete from private.structured_selection_epoch where id=1'),/permission denied/);}finally{await d.query('rollback');d.release();}
});
